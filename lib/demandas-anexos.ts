// Os anexos das demandas: foto ou documento (pedido dele, 2026-10-15).
// Tabela em migration-demanda-anexos.sql — só id, nome e a demanda.
//
// O ARQUIVO não passa pelo CRM: a Vercel corta corpo acima de ~4,5 MB, e foto
// de celular e PDF passam disso fácil. É o caminho dos vídeos, em três tempos:
//   1. prepararEnvio sorteia o id (que é o nome do objeto no bucket) e assina
//      um upload só para ele;
//   2. o navegador sobe direto para o Supabase — a foto já comprimida em WebP
//      (app/demandas/anexos-envio.ts);
//   3. quem cria a demanda (ou anexa depois) manda o id, e o servidor confere
//      no Storage que o arquivo chegou antes de gravar a linha.
//
// NA DEMANDA "PARA TODOS" cada cópia tem a sua linha e o seu objeto: a
// primeira fica com o que foi enviado, as outras ganham uma cópia feita dentro
// do Storage. O "mesmo anexo" nas cópias é o de mesmo nome — por isso o nome é
// único dentro de uma demanda (nomeLivre).
//
// QUEM: anexar e tirar é de quem criou a demanda, em todas as cópias (a regra
// de editar); ver é de quem vê a demanda (a regra de listarDemandas).
import "server-only";
import { randomUUID } from "node:crypto";
import type { UsuarioLogado } from "@/lib/auth/dal";
import { copiarObjeto, garantirBucket, infoDoObjeto, remover, urlDeEnvio, urlDeLeitura } from "@/lib/armazenamento";
import { listaUuid, sql } from "@/lib/db";
import { TETO_ANEXOS, TETO_NOME_ANEXO, TETO_TAMANHO_ANEXO, type AnexoDemanda } from "@/lib/demandas-tipos";
import { ehUuid } from "@/lib/validacao";

export const BUCKET_DEMANDAS = "crm-demandas";

/** A cópia "para todos" e as irmãs dela, com quem criou (lib/demandas.ts, copiasDe). */
export type Copias = { ids: string[]; criadoPor: string | null };

let bucketPronto = false;
async function garantir() {
  if (bucketPronto) return;
  // O teto vai no bucket: o upload é direto do navegador, e é a única trava de
  // tamanho que ele não contorna.
  await garantirBucket(BUCKET_DEMANDAS, TETO_TAMANHO_ANEXO);
  bucketPronto = true;
}

/** O nome como veio do navegador, sem barra nem caractere de controle. */
function nomeLimpo(bruto: unknown): string {
  const nome = typeof bruto === "string" ? bruto.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim() : "";
  return nome.slice(-TETO_NOME_ANEXO) || "arquivo";
}

/** "foto.webp" já existe na demanda → "foto (2).webp". */
function nomeLivre(nome: string, usados: Set<string>): string {
  const ponto = nome.lastIndexOf(".");
  const [base, ext] = ponto > 0 ? [nome.slice(0, ponto), nome.slice(ponto)] : [nome, ""];
  let candidato = nome;
  for (let n = 2; usados.has(candidato.toLowerCase()); n++) candidato = `${base} (${n})${ext}`;
  usados.add(candidato.toLowerCase());
  return candidato;
}

// ── Envio ───────────────────────────────────────────────────────────────────

/** Passo 1: o id do anexo e a URL assinada para o navegador subir o arquivo. */
export async function prepararEnvio(tamanho: unknown): Promise<{ id: string; url: string } | { erro: string }> {
  const bytes = Number(tamanho);
  if (!Number.isFinite(bytes) || bytes <= 0) return { erro: "O arquivo está vazio." };
  if (bytes > TETO_TAMANHO_ANEXO) return { erro: `Cada anexo vai até ${TETO_TAMANHO_ANEXO / 1048576} MB.` };
  await garantir();
  const id = randomUUID();
  return { id, url: await urlDeEnvio(BUCKET_DEMANDAS, id) };
}

/**
 * Passo 3, conferência: os anexos que vieram do navegador têm formato certo,
 * cabem no teto e o arquivo de cada um está mesmo no Storage.
 */
export async function conferirEnviados(
  bruto: unknown,
  jaTem: string[] = [],
): Promise<{ anexos: AnexoDemanda[] } | { erro: string }> {
  if (bruto === undefined || bruto === null) return { anexos: [] };
  if (!Array.isArray(bruto)) return { erro: "Anexos inválidos." };
  if (bruto.length + jaTem.length > TETO_ANEXOS) return { erro: `Até ${TETO_ANEXOS} anexos por demanda.` };
  const lista = bruto as Array<{ id?: unknown; nome?: unknown }>;
  if (!lista.every((a) => ehUuid(a?.id))) return { erro: "Anexo inválido." };
  // Id que já é anexo de alguma demanda não entra: além de não ser um envio
  // novo, a limpeza de uma criação que falhe (descartarEnvios) apagaria o
  // arquivo daquela outra demanda.
  const emUso = await sql`
    SELECT 1 FROM demanda_anexos
     WHERE id = ANY(string_to_array(${listaUuid(lista.map((a) => a.id as string))}, ',')::uuid[])
     LIMIT 1`;
  if (emUso.length) return { erro: "Anexo inválido." };
  const usados = new Set(jaTem.map((n) => n.toLowerCase()));
  const anexos: AnexoDemanda[] = [];
  for (const a of lista) {
    if (!ehUuid(a?.id)) return { erro: "Anexo inválido." };
    const nome = nomeLimpo(a.nome);
    if (!(await infoDoObjeto(BUCKET_DEMANDAS, a.id))) {
      return { erro: `O arquivo "${nome}" não chegou ao servidor. Anexe de novo.` };
    }
    anexos.push({ id: a.id, nome: nomeLivre(nome, usados) });
  }
  return { anexos };
}

/** Objetos enviados que não viraram anexo (a demanda não nasceu): saem do bucket. */
export async function descartarEnvios(anexos: AnexoDemanda[]): Promise<void> {
  await Promise.all(anexos.map((a) => remover(BUCKET_DEMANDAS, a.id)));
}

/**
 * Liga os anexos às demandas, na ordem: a primeira fica com o objeto enviado,
 * cada cópia seguinte ganha o seu (copiado no Storage, de dez em dez).
 */
export async function vincular(demandaIds: string[], anexos: AnexoDemanda[]): Promise<void> {
  if (!demandaIds.length || !anexos.length) return;
  const linhas: Array<{ id: string; demanda_id: string; nome: string }> = [];
  const copias: Array<{ de: string; para: string }> = [];
  for (const a of anexos) {
    demandaIds.forEach((demandaId, i) => {
      const id = i === 0 ? a.id : randomUUID();
      if (i > 0) copias.push({ de: a.id, para: id });
      linhas.push({ id, demanda_id: demandaId, nome: a.nome });
    });
  }
  for (let i = 0; i < copias.length; i += 10) {
    await Promise.all(copias.slice(i, i + 10).map((c) => copiarObjeto(BUCKET_DEMANDAS, c.de, c.para)));
  }
  await sql`
    INSERT INTO demanda_anexos (id, demanda_id, nome)
    SELECT x.id, x.demanda_id, x.nome
      FROM jsonb_to_recordset(${sql.json(linhas)}) AS x(id uuid, demanda_id uuid, nome text)`;
}

// ── Depois de criada ────────────────────────────────────────────────────────

/** Anexa a uma demanda que já existe — em todas as cópias. Só quem criou. */
export async function anexarDepois(
  demandaId: string,
  copias: Copias | null,
  bruto: unknown,
  usuario: UsuarioLogado,
): Promise<{ anexos: AnexoDemanda[] } | { erro: string }> {
  if (!copias || copias.criadoPor !== usuario.id) return { erro: "Só quem criou a demanda anexa arquivos." };
  const atuais = await sql`SELECT nome FROM demanda_anexos WHERE demanda_id = ${demandaId}`;
  const conferidos = await conferirEnviados(bruto, atuais.map((a) => a.nome as string));
  if ("erro" in conferidos) return conferidos;
  // A demanda aberta primeiro: é ela que fica com o objeto enviado.
  await vincular([demandaId, ...copias.ids.filter((id) => id !== demandaId)], conferidos.anexos);
  return conferidos;
}

/** Tira o anexo de todas as cópias (pelo nome) e apaga os arquivos. Só quem criou. */
export async function tirarAnexo(nome: string, copias: Copias | null, usuario: UsuarioLogado): Promise<boolean> {
  if (!copias || copias.criadoPor !== usuario.id) return false;
  const apagados = await sql`
    DELETE FROM demanda_anexos
     WHERE nome = ${nome}
       AND demanda_id = ANY(string_to_array(${listaUuid(copias.ids)}, ',')::uuid[])
    RETURNING id`;
  await apagarObjetos(apagados.map((a) => a.id as string));
  return apagados.length > 0;
}

/** A demanda e o nome de um anexo — o que tirá-lo precisa saber. */
export async function anexoPorId(anexoId: string): Promise<{ demandaId: string; nome: string } | null> {
  if (!ehUuid(anexoId)) return null;
  const [a] = await sql`SELECT demanda_id, nome FROM demanda_anexos WHERE id = ${anexoId}`;
  return a ? { demandaId: a.demanda_id as string, nome: a.nome as string } : null;
}

// ── Ver ─────────────────────────────────────────────────────────────────────

/**
 * O anexo, se esta pessoa vê a demanda dele. A MESMA regra de listarDemandas
 * (lib/demandas.ts): Admin/TI veem todas; os outros, as delas, as do
 * departamento delas e as que criaram.
 */
export async function anexoVisivel(
  anexoId: string,
  usuario: UsuarioLogado,
  todas: boolean,
): Promise<{ nome: string } | null> {
  if (!ehUuid(anexoId)) return null;
  const departamento = usuario.departamento?.id ?? null;
  const [a] = await sql`
    SELECT a.nome
      FROM demanda_anexos a
      JOIN demandas d ON d.id = a.demanda_id
     WHERE a.id = ${anexoId}
       AND (${todas}::boolean
            OR d.responsavel_id  = ${usuario.id}
            OR d.departamento_id = ${departamento}
            OR d.criado_por      = ${usuario.id})`;
  return a ? { nome: a.nome as string } : null;
}

/** Link de leitura de 10 minutos; com `baixar`, o navegador salva com o nome do anexo. */
export async function linkDoAnexo(anexoId: string, nome: string, baixar: boolean): Promise<string> {
  const url = await urlDeLeitura(BUCKET_DEMANDAS, anexoId, 600);
  return baixar ? `${url}&download=${encodeURIComponent(nome)}` : url;
}

// ── Limpeza ─────────────────────────────────────────────────────────────────

/**
 * Os anexos das demandas que esta pessoa pode apagar — lidos ANTES do DELETE,
 * porque o CASCADE leva as linhas e, sem elas, não haveria como achar os
 * arquivos no bucket.
 */
export async function anexosDeQuemApaga(ids: string[], usuario: UsuarioLogado): Promise<string[]> {
  const linhas = await sql`
    SELECT a.id FROM demanda_anexos a
      JOIN demandas d ON d.id = a.demanda_id
     WHERE d.id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
       AND d.criado_por = ${usuario.id}`.catch((e: { code?: string }) => {
    if (e?.code === "42P01") return [];
    throw e;
  });
  return linhas.map((l) => l.id as string);
}

export async function apagarObjetos(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => remover(BUCKET_DEMANDAS, id)));
}
