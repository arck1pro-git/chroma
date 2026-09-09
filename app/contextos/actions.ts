"use server";

// Mutações dos Contextos. Roda no servidor — entrada não confiável, como toda
// server action deste app (que ainda não tem sessão: docs/automacoes-arquitetura
// §3.1).
//
// O corte de tamanho não é decoração: o conteúdo daqui vai INTEIRO no system de
// cada pergunta à IA. Um bloco de 200 KB colado sem querer não quebraria nada
// visível — só multiplicaria o custo de toda conversa, em silêncio.
import { revalidatePath } from "next/cache";
import {
  alternarContexto,
  criarContexto,
  editarContexto,
  ESCOPOS,
  type EscopoContexto,
} from "@/lib/contextos";

const TETO_CONTEUDO = 8000;
const TETO_NOME = 80;

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function escopoValido(v: unknown): EscopoContexto {
  const s = String(v ?? "");
  return (ESCOPOS.find((e) => e.id === s)?.id ?? "analise") as EscopoContexto;
}

export type Resultado = { ok: boolean; mensagem: string };

export async function salvarContexto(dados: {
  id?: string;
  nome: unknown;
  descricao: unknown;
  conteudo: unknown;
  escopo: unknown;
}): Promise<Resultado> {
  const nome = texto(dados.nome, TETO_NOME);
  const conteudo = texto(dados.conteudo, TETO_CONTEUDO);

  if (!nome) return { ok: false, mensagem: "Dê um nome ao contexto." };
  if (!conteudo) return { ok: false, mensagem: "O bloco de prompt está vazio." };

  const limpo = {
    nome,
    descricao: texto(dados.descricao, 200) || null,
    conteudo,
    escopo: escopoValido(dados.escopo),
  };

  try {
    if (dados.id) await editarContexto(dados.id, limpo);
    else await criarContexto(limpo);
  } catch (e) {
    // ux_contextos_nome é UNIQUE em lower(nome): dois "Auditoria de proposta"
    // tornariam a escolha na tela um chute. O erro do Postgres não serve para
    // ler, então vira esta frase.
    const msg = e instanceof Error ? e.message : String(e);
    if (/ux_contextos_nome|duplicate key/i.test(msg)) {
      return { ok: false, mensagem: `Já existe um contexto chamado "${nome}".` };
    }
    return { ok: false, mensagem: msg };
  }

  revalidatePath("/contextos");
  return { ok: true, mensagem: dados.id ? "Contexto salvo." : "Contexto criado." };
}

export async function ligarContexto(id: string, ativo: boolean): Promise<Resultado> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, mensagem: "Contexto inválido." };
  }
  await alternarContexto(id, ativo);
  revalidatePath("/contextos");
  return {
    ok: true,
    mensagem: ativo ? "Contexto ligado." : "Contexto desligado.",
  };
}
