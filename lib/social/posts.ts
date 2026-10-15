// Os posts das redes: criar, consultar, editar, cancelar e publicar.
//
// O CICLO: criarPost copia a mídia e grava a linha em `posts_sociais`
// (migration-posts-sociais.sql) como 'agendado'. Post "para agora" começa a
// publicar logo depois da resposta (after); o agendado espera o agendador do
// n8n, que chama publicarVencidos a cada minuto (lib/social/agendador.ts).
//
// QUEM PUBLICA PEGA O POST ANTES (UPDATE … estado = 'publicando' com SKIP
// LOCKED): o after e o agendador podem chegar ao mesmo post ao mesmo tempo, e
// só um deles sai com ele. Cada rede grava o próprio progresso em
// resultado.<rede>; post que ficou 'publicando' por mais de 6 minutos (a função
// caiu ou o vídeo ainda processava) é retomado pela rodada seguinte, de onde
// parou — ver o topo de lib/social/meta-publicar.ts para o porquê de retomar
// não duplicar post.
import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { apagarCopias, copiarMidia, ErroPost, linkParaPublicar, type Midia } from "./midia";
import {
  AindaProcessando,
  publicarNoFacebook,
  publicarNoInstagram,
  type PostParaPublicar,
  type TipoPost,
} from "./meta-publicar";
import { perfilPorChave } from "./perfis";

export { ErroPost };

export type Rede = "instagram" | "facebook";
type Estado = "agendado" | "publicando" | "publicado" | "erro" | "cancelado";

type Linha = {
  id: string;
  perfil: string;
  redes: Rede[];
  tipo: TipoPost;
  legenda: string;
  midias: Midia[];
  capa_url: string | null;
  primeiro_comentario: string | null;
  publicar_em: Date | null;
  estado: Estado;
  resultado: Record<string, Record<string, unknown>>;
  data_criacao: Date;
};

// redes chega como texto '{instagram,facebook}' (fetch_types:false, lib/db.ts):
// to_jsonb devolve a lista de verdade. Função e não constante: `sql` no topo
// do módulo roda no import e quebra o build.
const colunas = () => sql`
  id, perfil, to_jsonb(redes) AS redes, tipo, legenda, midias, capa_url, primeiro_comentario,
  publicar_em, estado, resultado, data_criacao`;

const MAX_TENTATIVAS = 3;
const PARADO_HA = "6 minutes";
const LIMITE_LEGENDA = 2200;
const LIMITE_HASHTAGS = 30;
const DIAS_A_FRENTE = 180;

// ── Datas ───────────────────────────────────────────────────────────────────

const RELOGIO = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const br = (d: Date | string | null) => (d ? RELOGIO.format(new Date(d)) : null);

/**
 * "2026-10-16 11:00", "2026-10-16T11:00:00-03:00"… → instante. Sem fuso é
 * horário de Brasília (sem horário de verão desde 2019, então -03:00 fixo).
 * Vazio ou até 2 minutos no passado = agora (null).
 */
export function interpretarData(texto: string | undefined | null): Date | null {
  const t = texto?.trim();
  if (!t || /^agora$/i.test(t)) return null;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) throw new ErroPost(`Data em formato desconhecido: "${t}". Use AAAA-MM-DD HH:MM (horário de Brasília).`);
  const fuso = m[4] ? (m[4].toUpperCase() === "Z" ? "Z" : m[4].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "-03:00";
  const d = new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${fuso}`);
  if (Number.isNaN(d.getTime())) throw new ErroPost(`Data inválida: "${t}".`);
  const agora = Date.now();
  if (d.getTime() < agora - 2 * 60_000) throw new ErroPost(`A data ${br(d)} já passou (agora são ${br(new Date())} em Brasília).`);
  if (d.getTime() > agora + DIAS_A_FRENTE * 86_400_000) throw new ErroPost(`Agendamento limitado a ${DIAS_A_FRENTE} dias.`);
  return d.getTime() <= agora + 60_000 ? null : d;
}

// ── O que o modelo lê ───────────────────────────────────────────────────────

function resumo(l: Linha) {
  const redes = Object.fromEntries(
    l.redes.map((r) => {
      const x = l.resultado[r] ?? {};
      return [r, x.id ? { publicado: true, link: x.link ?? null, ...(x.aviso ? { aviso: x.aviso } : {}) } : x.erro ? { erro: x.erro } : { publicado: false }];
    }),
  );
  return {
    id: l.id,
    perfil: l.perfil,
    tipo: l.tipo,
    estado: l.estado,
    publicar_em: l.publicar_em ? br(l.publicar_em) : "assim que possível",
    legenda: l.legenda.length > 160 ? `${l.legenda.slice(0, 160)}…` : l.legenda,
    midias: l.midias.length,
    redes,
    criado_em: br(l.data_criacao),
  };
}

// ── Criar ───────────────────────────────────────────────────────────────────

export type NovoPost = {
  perfil: string;
  redes: Rede[];
  tipo: TipoPost;
  legenda: string;
  midias: string[];
  capaUrl?: string;
  primeiroComentario?: string;
  publicarEm?: string;
};

export async function criarPost(d: NovoPost) {
  const perfil = perfilPorChave(d.perfil);
  if (!perfil) throw new ErroPost(`Perfil desconhecido: ${d.perfil}.`);
  const redes = [...new Set(d.redes)];
  const quando = interpretarData(d.publicarEm);
  const legenda = d.legenda.trim();
  const avisos: string[] = [];

  // A quantidade de mídia de cada tipo, antes de baixar qualquer coisa.
  const n = d.midias.length;
  const soFacebook = redes.length === 1 && redes[0] === "facebook";
  if (d.tipo === "reels" && n !== 1) throw new ErroPost("Reels leva exatamente 1 vídeo.");
  if (d.tipo === "story" && n !== 1) throw new ErroPost("Story leva exatamente 1 imagem ou vídeo.");
  if (d.tipo === "carrossel" && (n < 2 || n > 10)) throw new ErroPost("Carrossel leva de 2 a 10 mídias.");
  if (d.tipo === "feed" && n > 1) throw new ErroPost("Feed leva 1 imagem; para mais de uma, use carrossel.");
  if (d.tipo === "feed" && n === 0 && !soFacebook) throw new ErroPost("Post sem mídia só existe no Facebook: tire o Instagram das redes ou mande uma imagem.");
  if (d.tipo !== "story" && redes.includes("instagram")) {
    if (legenda.length > LIMITE_LEGENDA) throw new ErroPost(`A legenda do Instagram vai até ${LIMITE_LEGENDA} caracteres (esta tem ${legenda.length}).`);
    if ((legenda.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > LIMITE_HASHTAGS) throw new ErroPost(`O Instagram aceita até ${LIMITE_HASHTAGS} hashtags.`);
  }
  if (d.tipo === "story" && legenda) avisos.push("Story não tem legenda pela API: o texto foi guardado, mas não aparece no story.");
  if (d.tipo === "story" && d.primeiroComentario) avisos.push("Story não aceita comentário: o primeiro comentário foi ignorado.");

  const id = randomUUID();
  const mes = new Date().toISOString().slice(0, 7);
  const midias: Midia[] = [];
  try {
    for (const [i, link] of d.midias.entries()) {
      const c = await copiarMidia(link, `${perfil.chave}/${mes}/${id}-${i + 1}`);
      midias.push(c.midia);
      avisos.push(...c.avisos);
    }
    // O tipo de cada arquivo só se sabe depois de baixar.
    if (d.tipo === "reels" && midias[0].tipo !== "video") throw new ErroPost("Reels precisa de vídeo; para imagem, use feed.");
    if (d.tipo === "feed" && midias[0] && midias[0].tipo !== "imagem") throw new ErroPost("Feed leva imagem; para vídeo, use reels.");
    if (d.tipo === "carrossel" && redes.includes("facebook") && midias.some((m) => m.tipo === "video")) {
      throw new ErroPost("O carrossel do Facebook só aceita imagens: tire o vídeo ou publique só no Instagram.");
    }
  } catch (e) {
    await apagarCopias(midias);
    throw e;
  }

  const [linha] = (await sql`
    INSERT INTO posts_sociais
      (id, perfil, redes, tipo, legenda, midias, capa_url, primeiro_comentario, publicar_em, criado_por)
    -- A lista vai como texto e o Postgres monta o array (mesma razão de
    -- listaUuid, lib/db.ts); as redes já passaram pelo enum, sem vírgula.
    VALUES (${id}, ${perfil.chave}, string_to_array(${redes.join(",")}, ',')::text[], ${d.tipo}, ${legenda},
            ${sql.json(midias)}, ${d.capaUrl?.trim() || null}, ${d.primeiroComentario?.trim() || null},
            ${quando?.toISOString() ?? null}::timestamptz, 'mcp')
    RETURNING ${colunas()}`) as unknown as Linha[];

  if (!quando) after(() => publicarPost(id));
  return { ...resumo(linha), avisos };
}

// ── Consultar ───────────────────────────────────────────────────────────────

export async function listarPosts(f: { perfil?: string; estado?: Estado; limite: number }) {
  const linhas = (await sql`
    SELECT ${colunas()} FROM posts_sociais
     WHERE (${f.perfil ?? null}::text IS NULL OR perfil = ${f.perfil ?? null})
       AND (${f.estado ?? null}::text IS NULL OR estado = ${f.estado ?? null})
     ORDER BY COALESCE(publicar_em, data_criacao) DESC
     LIMIT ${f.limite}`) as unknown as Linha[];
  return linhas.map(resumo);
}

export async function verPost(id: string) {
  const [l] = (await sql`SELECT ${colunas()} FROM posts_sociais WHERE id = ${id}`) as unknown as Linha[];
  if (!l) throw new ErroPost(`Post não encontrado: ${id}.`);
  return {
    ...resumo(l),
    legenda: l.legenda,
    redes_pedidas: l.redes,
    midias: l.midias.map((m) => ({ tipo: m.tipo, mime: m.mime, tamanho_mb: Math.round((m.tamanho / 1048576) * 10) / 10, origem: m.origem })),
    capa_url: l.capa_url,
    primeiro_comentario: l.primeiro_comentario,
  };
}

// ── Editar e cancelar (só enquanto agendado) ────────────────────────────────

async function exigirAgendado(id: string): Promise<void> {
  const [l] = await sql`SELECT estado FROM posts_sociais WHERE id = ${id}`;
  if (!l) throw new ErroPost(`Post não encontrado: ${id}.`);
  if (l.estado !== "agendado") throw new ErroPost(`O post está "${l.estado}": só dá para mexer enquanto está agendado.`);
}

export async function editarPost(id: string, d: { legenda?: string; publicarEm?: string; primeiroComentario?: string }) {
  await exigirAgendado(id);
  const novaData = d.publicarEm !== undefined;
  const quando = novaData ? interpretarData(d.publicarEm) : null;
  const [l] = (await sql`
    UPDATE posts_sociais SET
      legenda = COALESCE(${d.legenda?.trim() ?? null}, legenda),
      primeiro_comentario = CASE WHEN ${d.primeiroComentario !== undefined} THEN ${d.primeiroComentario?.trim() || null} ELSE primeiro_comentario END,
      publicar_em = CASE WHEN ${novaData} THEN ${quando?.toISOString() ?? null}::timestamptz ELSE publicar_em END,
      data_atualizacao = now()
     WHERE id = ${id} AND estado = 'agendado'
    RETURNING ${colunas()}`) as unknown as Linha[];
  // Entre a conferência e o UPDATE o agendador pode ter pegado o post.
  if (!l) throw new ErroPost("O post começou a publicar agora há pouco e não pode mais ser editado.");
  if (novaData && !quando) after(() => publicarPost(id));
  return resumo(l);
}

export async function cancelarPost(id: string) {
  await exigirAgendado(id);
  const [l] = (await sql`
    UPDATE posts_sociais SET estado = 'cancelado', data_atualizacao = now()
     WHERE id = ${id} AND estado = 'agendado'
    RETURNING ${colunas()}`) as unknown as Linha[];
  if (!l) throw new ErroPost("O post começou a publicar agora há pouco e não pode mais ser cancelado.");
  await apagarCopias(l.midias);
  return resumo(l);
}

/**
 * Tenta de novo um post que terminou em erro, SÓ nas redes que falharam: a que
 * já publicou guarda o id e é pulada (executar), então repetir não duplica
 * post onde ele já saiu. Publica em seguida, como um post "para agora".
 */
export async function repetirPost(id: string) {
  const [atual] = (await sql`SELECT ${colunas()} FROM posts_sociais WHERE id = ${id}`) as unknown as Linha[];
  if (!atual) throw new ErroPost(`Post não encontrado: ${id}.`);
  if (atual.estado !== "erro") throw new ErroPost(`O post está "${atual.estado}": só dá para repetir o que terminou em erro.`);
  const falharam = atual.redes.filter((r) => !atual.resultado[r]?.id);
  const [l] = (await sql`
    UPDATE posts_sociais SET
      estado = 'agendado',
      publicar_em = NULL,
      resultado = resultado - string_to_array(${[...falharam, "_tentativas", "_erro"].join(",")}, ',')::text[],
      data_atualizacao = now()
     WHERE id = ${id} AND estado = 'erro'
    RETURNING ${colunas()}`) as unknown as Linha[];
  if (!l) throw new ErroPost("O post mudou de estado agora há pouco; confira com ver_post.");
  after(() => publicarPost(id));
  return { ...resumo(l), repetindo_em: falharam };
}

// ── Publicar ────────────────────────────────────────────────────────────────

async function salvarRede(id: string, rede: Rede, parcial: Record<string, unknown>) {
  await sql`
    UPDATE posts_sociais
       SET resultado = jsonb_set(resultado, ARRAY[${rede}]::text[], COALESCE(resultado -> ${rede}, '{}'::jsonb) || ${sql.json(parcial)}),
           data_atualizacao = now()
     WHERE id = ${id}`;
}

const textoDoErro = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Publica um post já pego (estado 'publicando'). `ate` é o relógio da rodada. */
async function executar(l: Linha, ate: number): Promise<Estado> {
  const tentativas = Number(l.resultado._tentativas ?? 0);
  const perfil = perfilPorChave(l.perfil);
  if (!perfil || tentativas > MAX_TENTATIVAS) {
    const motivo = perfil ? `desisti depois de ${MAX_TENTATIVAS} tentativas` : `perfil ${l.perfil} saiu da lista`;
    await sql`UPDATE posts_sociais SET estado = 'erro', resultado = resultado || ${sql.json({ _erro: motivo })}, data_atualizacao = now() WHERE id = ${l.id}`;
    return "erro";
  }

  const post: PostParaPublicar = {
    tipo: l.tipo,
    legenda: l.legenda,
    midias: await Promise.all(l.midias.map(async (m) => ({ url: await linkParaPublicar(m), tipo: m.tipo }))),
    capaUrl: l.capa_url,
    primeiroComentario: l.primeiro_comentario,
  };

  await Promise.all(
    l.redes.map(async (rede) => {
      const feito = l.resultado[rede] ?? {};
      if (feito.id) return;
      const salvar = (parcial: Record<string, unknown>) => salvarRede(l.id, rede, parcial);
      try {
        if (rede === "facebook") {
          if (feito.iniciado) throw new Error("A publicação foi interrompida no meio e pode ter saído: confira a página antes de repetir.");
          const r = await publicarNoFacebook(perfil, post, salvar);
          await salvar({ id: r.id, link: r.link, em: new Date().toISOString(), ...(r.aviso ? { aviso: r.aviso } : {}) });
        } else {
          const r = await publicarNoInstagram(perfil, post, { conteiner: feito.conteiner as string | undefined }, salvar, ate);
          await salvar({ id: r.id, link: r.link, em: new Date().toISOString(), ...(r.aviso ? { aviso: r.aviso } : {}) });
        }
      } catch (e) {
        // Vídeo ainda processando: fica 'publicando' e a rodada seguinte retoma.
        if (e instanceof AindaProcessando) return;
        console.error(`[social] ${rede} do post ${l.id} falhou:`, e);
        await salvar({ erro: textoDoErro(e), em: new Date().toISOString() });
      }
    }),
  );

  const [{ resultado }] = await sql`SELECT resultado FROM posts_sociais WHERE id = ${l.id}`;
  const porRede = l.redes.map((r) => (resultado as Linha["resultado"])[r] ?? {});
  const estado: Estado = porRede.every((x) => x.id)
    ? "publicado"
    : porRede.some((x) => !x.id && !x.erro)
      ? "publicando"
      : "erro";
  await sql`UPDATE posts_sociais SET estado = ${estado}, data_atualizacao = now() WHERE id = ${l.id}`;
  // A cópia só sai quando todas as redes publicaram: com erro, ela fica para
  // uma nova tentativa.
  if (estado === "publicado") await apagarCopias(l.midias);
  return estado;
}

/** Pega o post (ou o próximo vencido) para esta rodada. null = nada a fazer. */
async function pegar(id: string | null): Promise<Linha | null> {
  const [l] = (await sql`
    UPDATE posts_sociais SET
      estado = 'publicando',
      resultado = jsonb_set(resultado, '{_tentativas}', to_jsonb(COALESCE((resultado ->> '_tentativas')::int, 0) + 1)),
      data_atualizacao = now()
     WHERE id = (
       SELECT id FROM posts_sociais
        WHERE (${id}::uuid IS NULL OR id = ${id}::uuid)
          AND ((estado = 'agendado' AND (publicar_em IS NULL OR publicar_em <= now()))
               OR (estado = 'publicando' AND data_atualizacao < now() - ${PARADO_HA}::interval))
        ORDER BY publicar_em NULLS FIRST
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING ${colunas()}`) as unknown as Linha[];
  return l ?? null;
}

/** O post "para agora", logo depois de criado. */
export async function publicarPost(id: string): Promise<void> {
  try {
    const l = await pegar(id);
    if (l) await executar(l, Date.now() + 240_000);
  } catch (e) {
    console.error(`[social] publicar ${id} falhou:`, e);
  }
}

/** A rodada do agendador: publica o que venceu, até o tempo da rodada acabar. */
export async function publicarVencidos(): Promise<{ publicados: number; erros: number; pendentes: number }> {
  const ate = Date.now() + 240_000;
  const soma = { publicados: 0, erros: 0, pendentes: 0 };
  // Deixa folga para um vídeo inteiro: sem ela, o último post pego ficaria
  // sempre para a rodada seguinte esperando os 6 minutos de parado.
  while (Date.now() < ate - 90_000) {
    const l = await pegar(null);
    if (!l) break;
    try {
      const estado = await executar(l, ate);
      if (estado === "publicado") soma.publicados++;
      else if (estado === "erro") soma.erros++;
      else soma.pendentes++;
    } catch (e) {
      console.error(`[social] post ${l.id} falhou:`, e);
      soma.erros++;
    }
  }
  return soma;
}
