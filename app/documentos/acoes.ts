"use server";

// Mutações da biblioteca de documentos.
//
// O UPLOAD É EM TRÊS TEMPOS, e nenhum byte do arquivo passa pelo CRM (desde
// 2026-10-28; antes era uma rota, e a Vercel devolvia 413 acima de ~4,5 MB):
//   1. `prepararEnvio` confere tamanho e nome e devolve a URL assinada;
//   2. o navegador sobe direto para o Supabase (app/documentos/painel.tsx);
//   3. `registrarEnvio` grava a linha depois de lib/documentos.ts conferir no
//      Storage o que chegou.
//
// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; `exigirModulo` acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe, ainda está ativa e
// tem este módulo.
import { revalidatePath } from "next/cache";
import { BUCKET_DOCUMENTOS, urlDeEnvio } from "@/lib/armazenamento";
import { exigirModulo } from "@/lib/auth/dal";
import {
  arquivarDocumento,
  excluirDocumento,
  nomeEmUso,
  novoCaminho,
  registrarDocumento,
  renomearDocumento,
  TETO_BYTES,
  TETO_MB,
  usosDoDocumento,
} from "@/lib/documentos";
import { ehDuplicado, Recusa } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";

export type Resultado = { ok: boolean; mensagem: string };

const TETO_NOME = 120;
const TETO_DESCRICAO = 500;

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function idValido(id: string) {
  return ehUuid(id);
}

// Sem nome digitado, o nome do arquivo vira o título. É o atalho que faz subir
// cinco PDFs de uma vez não virar cinco formulários — dá para renomear depois,
// na lista.
function nomeDoArquivo(nomeArquivo: string): string {
  return nomeArquivo.replace(/\.[^.]+$/, "").trim().slice(0, TETO_NOME) || "Documento";
}

/** Passo 1: confere o que dá para conferir antes de subir e assina o envio. */
export async function prepararEnvio(dados: {
  nomeArquivo: unknown;
  tamanho: unknown;
}): Promise<{ ok: true; caminho: string; url: string } | { ok: false; mensagem: string }> {
  await exigirModulo("documentos", "criar");
  const nomeArquivo = texto(dados.nomeArquivo, 255);
  const tamanho = Number(dados.tamanho);
  if (!nomeArquivo) return { ok: false, mensagem: "Escolha um arquivo." };
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, mensagem: "Arquivo vazio." };
  if (tamanho > TETO_BYTES) return { ok: false, mensagem: `Arquivo acima do limite de ${TETO_MB} MB.` };

  // O nome repetido o banco também recusaria, mas só depois de o arquivo
  // inteiro ter subido.
  const nome = nomeDoArquivo(nomeArquivo);
  if (await nomeEmUso(nome)) return { ok: false, mensagem: `Já existe um documento chamado "${nome}".` };

  const caminho = novoCaminho(nomeArquivo);
  return { ok: true, caminho, url: await urlDeEnvio(BUCKET_DOCUMENTOS, caminho) };
}

/** Passo 3: o arquivo já está no Storage; grava o documento. */
export async function registrarEnvio(dados: {
  caminho: unknown;
  nomeArquivo: unknown;
}): Promise<Resultado> {
  const { usuario } = await exigirModulo("documentos", "criar");
  const nomeArquivo = texto(dados.nomeArquivo, 255);
  const nome = nomeDoArquivo(nomeArquivo);

  try {
    await registrarDocumento({
      nome,
      descricao: null,
      arquivoNome: nomeArquivo,
      caminho: typeof dados.caminho === "string" ? dados.caminho : "",
      criadoPor: usuario.id,
    });
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, mensagem: e.message };
    // ux_documentos_nome: alguém subiu um com o mesmo nome enquanto este subia.
    if (ehDuplicado(e)) return { ok: false, mensagem: `Já existe um documento chamado "${nome}".` };
    throw e;
  }

  revalidatePath("/documentos");
  return { ok: true, mensagem: "Documento enviado." };
}

export async function salvarDocumento(dados: {
  id: string;
  nome: unknown;
  descricao: unknown;
}): Promise<Resultado> {
  await exigirModulo("documentos", "editar");
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
  await exigirModulo("documentos", "editar");
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
  await exigirModulo("documentos", "excluir");
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
