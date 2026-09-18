"use server";

// Mutações da biblioteca de documentos — menos o upload, que é Route Handler
// (app/api/documentos/route.ts) porque server action topa 1 MB de corpo.
//
// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; `exigirModulo` acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe, ainda está ativa e
// tem este módulo.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import {
  arquivarDocumento,
  excluirDocumento,
  renomearDocumento,
  usosDoDocumento,
} from "@/lib/documentos";

export type Resultado = { ok: boolean; mensagem: string };

const TETO_NOME = 120;
const TETO_DESCRICAO = 500;

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function idValido(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

export async function salvarDocumento(dados: {
  id: string;
  nome: unknown;
  descricao: unknown;
}): Promise<Resultado> {
  await exigirModulo("documentos");
  if (!idValido(dados.id)) return { ok: false, mensagem: "Documento inválido." };

  const nome = texto(dados.nome, TETO_NOME);
  if (!nome) return { ok: false, mensagem: "Dê um nome ao documento." };

  try {
    await renomearDocumento(dados.id, nome, texto(dados.descricao, TETO_DESCRICAO) || null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ux_documentos_nome|duplicate key/i.test(msg)) {
      return { ok: false, mensagem: `Já existe um documento chamado "${nome}".` };
    }
    return { ok: false, mensagem: msg };
  }

  revalidatePath("/documentos");
  return { ok: true, mensagem: "Documento salvo." };
}

/**
 * Arquivar é o "excluir" de uso diário: some dos seletores de anexo (da coluna
 * da cadência, do chat) e o que já foi enviado continua intacto.
 *
 * É a ação que a tela oferece primeiro, e de propósito — na maioria das vezes o
 * que a pessoa quer dizer é "parem de mandar isto", não "apague o arquivo".
 */
export async function alternarArquivado(
  id: string,
  arquivado: boolean,
): Promise<Resultado> {
  await exigirModulo("documentos");
  if (!idValido(id)) return { ok: false, mensagem: "Documento inválido." };

  try {
    await arquivarDocumento(id, arquivado);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Desarquivar esbarra no índice único de nome quando, enquanto ele estava
    // guardado, alguém subiu outro com o mesmo título.
    if (/ux_documentos_nome|duplicate key/i.test(msg)) {
      return {
        ok: false,
        mensagem:
          "Já existe um documento ativo com este nome. Renomeie um dos dois antes de desarquivar.",
      };
    }
    return { ok: false, mensagem: msg };
  }

  revalidatePath("/documentos");
  return {
    ok: true,
    mensagem: arquivado
      ? "Documento arquivado — não aparece mais para anexar."
      : "Documento de volta à biblioteca.",
  };
}

/**
 * Exclui de vez: a linha e o arquivo no disco.
 *
 * RECUSA quando o documento já foi enviado a alguém. Não é zelo excessivo: a
 * mensagem no histórico do atendimento aponta para esta linha, e apagá-la
 * deixaria uma conversa entregue exibindo um anexo que não existe mais — sem
 * nada no CRM explicando por quê. O ON DELETE RESTRICT da migração é quem
 * garante isso de fato; a contagem aqui existe para dizer ao usuário o que
 * fazer em vez de deixá-lo ler um erro de FK.
 */
export async function removerDocumento(id: string): Promise<Resultado> {
  await exigirModulo("documentos");
  if (!idValido(id)) return { ok: false, mensagem: "Documento inválido." };

  const usos = await usosDoDocumento(id);
  if (usos > 0) {
    return {
      ok: false,
      mensagem: `Este documento já foi enviado em ${usos} ${
        usos === 1 ? "mensagem" : "mensagens"
      } e não pode ser excluído — apagá-lo deixaria o anexo em branco no histórico. Arquive: ele some da lista de anexar e a conversa continua inteira.`,
    };
  }

  try {
    await excluirDocumento(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Corrida: alguém anexou o documento entre a contagem e o DELETE. O banco
    // recusou, que é exatamente o que ele deve fazer.
    if (/violates foreign key|23503/i.test(msg)) {
      return {
        ok: false,
        mensagem:
          "Este documento acabou de ser usado em uma mensagem e não pode mais ser excluído. Arquive em vez disso.",
      };
    }
    return { ok: false, mensagem: msg };
  }

  revalidatePath("/documentos");
  return { ok: true, mensagem: "Documento excluído." };
}
