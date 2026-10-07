"use server";

// As IAs de atendimento (criar, editar, excluir) e as duas pontas do "quem a
// IA atende": a IA da etapa e o interruptor do contato (ver app/funil/ia.ts e
// lib/ia/atendente.ts).
//
// Módulo "inicio": é onde o quadro, a gaveta de contatos e a de IAs moram, e
// as outras ações da gaveta (app/contatos/actions.ts) pedem o mesmo. O chat tem
// a sua própria entrada para o interruptor do contato (app/chat/actions.ts).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { sql } from "@/lib/db";
import { exigirAlgumModulo, exigirModulo } from "@/lib/auth/dal";
import { enderecoDoCrm } from "@/lib/endereco";
import { gravarIaDoContato } from "@/lib/ia/contato-ia";
import { garantirAgendadorDeRetomada } from "@/lib/ia/retomada";
import {
  CHAVES_ACOES,
  LIMITE_NOME_IA,
  LIMITE_PALAVRA_IA,
  LIMITE_PROMPT_IA,
  MAX_RETOMADAS,
  RETOMADA_MAX_MINUTOS,
  RETOMADA_MIN_MINUTOS,
} from "@/lib/ia/catalogo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DadosIa = {
  nome: string;
  prompt: string;
  acoes: string[];
  palavra?: string | null;
  /** Minutos de silêncio antes de cada retomada (lib/ia/retomada.ts). */
  retomarApos?: number[];
  retomarDas?: number;
  retomarAte?: number;
};
type IaValidada = {
  nome: string;
  prompt: string;
  acoes: string[];
  palavra: string | null;
  retomarApos: number[];
  retomarDas: number;
  retomarAte: number;
};

/** Limpa e confere o que veio do formulário; string = o erro para a tela. */
function validar(d: DadosIa): IaValidada | string {
  const nome = (d.nome ?? "").trim();
  const prompt = (d.prompt ?? "").trim();
  if (!nome) return "Dê um nome para a IA.";
  if (nome.length > LIMITE_NOME_IA) return `Nome com no máximo ${LIMITE_NOME_IA} caracteres.`;
  if (!prompt) return "Escreva o prompt da IA.";
  if (prompt.length > LIMITE_PROMPT_IA) return `Prompt com no máximo ${LIMITE_PROMPT_IA.toLocaleString("pt-BR")} caracteres.`;
  // Chave desconhecida é descartada, não recusada: o catálogo é a lista válida.
  // (As chaves não têm vírgula — é o que deixa gravar com string_to_array, já
  // que array como parâmetro não passa nesta conexão; ver listaUuid em lib/db.)
  const acoes = [...new Set((d.acoes ?? []).filter((a) => CHAVES_ACOES.includes(a)))];
  // A palavra do celular é comparada com a mensagem INTEIRA, sem diferença de
  // maiúscula (alternarIaPelaPalavra, em lib/ia/atendente.ts). Vazia = sem palavra.
  const palavra = (d.palavra ?? "").trim().replaceAll("…", "...") || null;
  if (palavra && palavra.length > LIMITE_PALAVRA_IA) return `Palavra com no máximo ${LIMITE_PALAVRA_IA} caracteres.`;
  if (palavra && /[\r\n]/.test(palavra)) return "A palavra precisa caber numa linha só.";
  const retomarApos = d.retomarApos ?? [];
  if (retomarApos.length > MAX_RETOMADAS) return `No máximo ${MAX_RETOMADAS} retomadas.`;
  if (retomarApos.some((m) => !Number.isInteger(m) || m < RETOMADA_MIN_MINUTOS || m > RETOMADA_MAX_MINUTOS)) {
    return `Cada retomada espera de ${RETOMADA_MIN_MINUTOS} minutos a 30 dias.`;
  }
  const retomarDas = d.retomarDas ?? 9;
  const retomarAte = d.retomarAte ?? 19;
  if (
    !Number.isInteger(retomarDas) ||
    !Number.isInteger(retomarAte) ||
    retomarDas < 0 ||
    retomarAte > 24 ||
    retomarDas >= retomarAte
  ) {
    return "O horário das retomadas precisa começar antes de terminar.";
  }
  return { nome, prompt, acoes, palavra, retomarApos, retomarDas, retomarAte };
}

/**
 * Com retomadas, liga o agendador do n8n que as dispara (lib/ia/retomada.ts).
 * Devolve o aviso para a tela quando não deu: a IA fica salva do mesmo jeito.
 */
async function ligarAgendador(v: IaValidada): Promise<string | undefined> {
  if (v.retomarApos.length === 0) return undefined;
  const { url, publico, host } = enderecoDoCrm(await headers());
  // O n8n é o da produção: um agendador apontando para localhost não falharia
  // aqui, falharia lá, de 5 em 5 minutos.
  if (!publico) {
    return `Retomadas salvas. Quem as dispara é o agendador do n8n, que não alcança "${host}": salve esta IA uma vez pelo endereço público para ligá-lo.`;
  }
  try {
    await garantirAgendadorDeRetomada(url);
    return undefined;
  } catch (e) {
    console.error("[ias] agendador das retomadas não ligou:", e);
    return `Retomadas salvas, mas o agendador no n8n não ligou (${(e instanceof Error ? e.message : String(e)).slice(0, 200)}). Salve de novo para tentar outra vez.`;
  }
}

/**
 * Uma palavra, uma IA (ux_ias_palavra_chave). Confere antes para dizer DE QUEM
 * ela é; o índice segura a corrida de duas gravações ao mesmo tempo.
 */
async function palavraEmUso(palavra: string | null, id: string | null): Promise<string | null> {
  if (!palavra) return null;
  const [outra] = await sql`
    SELECT nome FROM ias
     WHERE lower(palavra_chave) = lower(${palavra}) AND id IS DISTINCT FROM ${id}::uuid`;
  return outra ? `A palavra "${palavra}" já liga a IA "${outra.nome}". Escolha outra.` : null;
}

const PALAVRA_REPETIDA = "Essa palavra já é de outra IA. Escolha outra.";
const ehRepetida = (e: unknown) => (e as { code?: string })?.code === "23505";

export async function criarIa(d: DadosIa): Promise<{ id?: string; erro?: string; aviso?: string }> {
  await exigirModulo("inicio");
  const v = validar(d);
  if (typeof v === "string") return { erro: v };
  const repetida = await palavraEmUso(v.palavra, null);
  if (repetida) return { erro: repetida };
  let nova;
  try {
    [nova] = await sql`
      INSERT INTO ias (nome, prompt, acoes, palavra_chave, retomar_apos, retomar_das, retomar_ate)
      VALUES (${v.nome}, ${v.prompt}, string_to_array(${v.acoes.join(",")}, ','), ${v.palavra},
              string_to_array(${v.retomarApos.join(",")}, ',')::int[], ${v.retomarDas}, ${v.retomarAte})
      RETURNING id`;
  } catch (e) {
    if (ehRepetida(e)) return { erro: PALAVRA_REPETIDA };
    throw e;
  }
  revalidatePath("/");
  return { id: nova.id as string, aviso: await ligarAgendador(v) };
}

export async function atualizarIa(id: string, d: DadosIa): Promise<{ erro?: string; aviso?: string }> {
  await exigirModulo("inicio");
  if (!UUID.test(id)) return { erro: "IA inválida." };
  const v = validar(d);
  if (typeof v === "string") return { erro: v };
  const repetida = await palavraEmUso(v.palavra, id);
  if (repetida) return { erro: repetida };
  let linha;
  try {
    [linha] = await sql`
      UPDATE ias SET nome = ${v.nome}, prompt = ${v.prompt}, acoes = string_to_array(${v.acoes.join(",")}, ','),
             palavra_chave = ${v.palavra},
             retomar_apos = string_to_array(${v.retomarApos.join(",")}, ',')::int[],
             retomar_das = ${v.retomarDas}, retomar_ate = ${v.retomarAte}
       WHERE id = ${id}
      RETURNING id`;
  } catch (e) {
    if (ehRepetida(e)) return { erro: PALAVRA_REPETIDA };
    throw e;
  }
  if (!linha) return { erro: "Essa IA não existe mais." };
  revalidatePath("/");
  revalidatePath("/chat");
  return { aviso: await ligarAgendador(v) };
}

/**
 * Exclui a IA. As etapas e os contatos que a usavam ficam SEM IA (a FK é
 * ON DELETE SET NULL) — a tela avisa quantos antes de confirmar. O contato
 * ligado à mão nela volta a seguir a etapa, e não a ficar "ligado sem IA".
 */
export async function excluirIa(id: string): Promise<{ erro?: string }> {
  const { usuario } = await exigirModulo("inicio");
  if (!UUID.test(id)) return { erro: "IA inválida." };
  const contatos = await sql`SELECT id FROM contatos WHERE ia_id = ${id}`;
  for (const c of contatos) await gravarIaDoContato(c.id as string, null, null, usuario.id);
  await sql`DELETE FROM ias WHERE id = ${id}`;
  revalidatePath("/");
  revalidatePath("/chat");
  return {};
}

/** A IA que atende quem está na etapa; `null` desliga. */
export async function definirIaDaEtapa(etapaId: string, iaId: string | null): Promise<{ erro?: string }> {
  await exigirModulo("inicio");
  if (!UUID.test(etapaId)) return { erro: "Etapa inválida." };
  if (iaId !== null && !UUID.test(iaId)) return { erro: "IA inválida." };
  try {
    await sql`UPDATE etapas SET ia_id = ${iaId}::uuid WHERE id = ${etapaId}`;
  } catch {
    // FK: a IA foi excluída por outra pessoa enquanto o diálogo estava aberto.
    return { erro: "Essa IA não existe mais. Recarregue a página." };
  }
  revalidatePath("/");
  return {};
}

/**
 * `true` ligada à mão (com a IA `iaId`), `false` desligada à mão, `null` volta
 * a seguir a etapa.
 */
export async function definirIaDoContato(
  contatoId: string,
  valor: boolean | null,
  iaId: string | null,
): Promise<{ erro?: string }> {
  const { usuario } = await exigirAlgumModulo("inicio", "contatos");
  if (!UUID.test(contatoId)) return { erro: "Contato inválido." };
  if (iaId !== null && !UUID.test(iaId)) return { erro: "IA inválida." };
  const r = await gravarIaDoContato(contatoId, valor, iaId, usuario.id);
  if (r.erro) return r;
  revalidatePath("/");
  revalidatePath("/chat");
  return {};
}
