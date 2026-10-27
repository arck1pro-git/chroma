// O webhook do Instagram (object = "instagram") entrando no CRM. A rota é
// app/api/meta/instagram/webhook/route.ts; tudo o que ela faz mora aqui, para
// o teste (scripts/testar-instagram.ts) passar pelo mesmo caminho.
//
// CONTRATO DA META (Instagram Platform, Webhooks; conferido em 2026-10-26):
//   { object: "instagram", entry: [{ id: <id da conta>, time,
//       messaging: [{ sender:{id}, recipient:{id}, timestamp,
//                     message:{ mid, text?, is_echo?, is_deleted?, attachments? } }],
//       changes:   [{ field: "comments", value: { id, text, parent_id?,
//                     from:{id, username}, media:{id, media_product_type} } }] }] }
//   · DM do contato: sender = IGSID, recipient = a conta.
//   · Eco (is_echo): o que a conta mandou (pelo CRM, pelo celular ou por outro
//     robô): sender = a conta, recipient = IGSID.
//
// TRAVAS (revisão de segurança, 2026-10-26, item 11):
//   · assinatura X-Hub-Signature-256 sobre o corpo bruto (lib/meta-assinatura.ts);
//   · só object = "instagram" e entry.id que seja uma das contas de PERFIS;
//   · validação por item (zod) e try/catch por item; inválidos e ignorados
//     recebem 200; falha de persistência recebe 503 para a Meta reenviar;
//   · o corpo NUNCA vai para o log (texto e IGSID de cliente, LGPD);
//   · eco que não casa com a nossa pendente pelo mid espera alguns segundos e
//     tenta de novo antes de virar 'aparelho' (o envio pode ainda não ter
//     gravado o mid); a palavra da IA só vale em eco que não casou.
//
// O PESADO VAI DEPOIS da resposta (`depois`, que a rota passa a `after`):
// perfil de quem escreveu, mídia, a IA do direct e a IA de comentário. `after`
// não é fila: o que falhar ali fica no log, e o comentário/mensagem já está
// gravado.
import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { assinaturaMetaConfere } from "@/lib/meta-assinatura";
import {
  COMENTARIO_RECENTE_MS,
  ehContaNossa,
  ehIdMeta,
  hostDeAnexoPermitido,
  motivoDoErro as motivo,
  perfilDaConta,
  usuarioValido,
} from "@/lib/instagram";
import { atualizarPerfilDoContato, contatoDoInstagram, conversaDoInstagram } from "@/lib/instagram-conversa";
import { baixarPendentes, type TipoMensagem } from "@/lib/midia";
import { alternarIaPelaPalavra, responderComIa } from "@/lib/ia/atendente";
import { responderComentarioComIa } from "@/lib/ia/comentarios";
import type { Perfil } from "@/lib/social/perfis";

/** Quanto o eco não casado espera o envio gravar o mid antes de virar 'aparelho'. */
const ESPERA_ECO_MS = 5_000;

/**
 * Lote (ou entrada) fora do formato ou dos limites: no log, só QUANTOS itens
 * e o motivo do zod (código e caminho, sem valor), nunca o corpo.
 */
function registrarRecusa(onde: string, quantos: number, erro: z.ZodError): void {
  const primeiro = erro.issues[0];
  const porque = primeiro ? `${primeiro.code} em ${primeiro.path.join(".") || "(raiz)"}` : "formato";
  console.warn(`[instagram webhook] ${onde} recusado (${quantos} item(ns)): ${porque}`);
}

/** Quantos itens há num valor que deveria ser lista (para o log, sem o conteúdo). */
const quantosEm = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

// ── Formato ─────────────────────────────────────────────────────────────────

const IdMeta = z.string().regex(/^\d{1,32}$/);

const Corpo = z.object({ object: z.string().max(40), entry: z.array(z.unknown()).max(200) });

const Entrada = z.object({
  id: z.string().max(64),
  time: z.number().optional(),
  messaging: z.array(z.unknown()).max(500).optional(),
  changes: z.array(z.object({ field: z.string().max(60), value: z.unknown() })).max(500).optional(),
});

const Anexo = z.object({
  type: z.string().max(40),
  payload: z.object({ url: z.string().max(4000).optional() }).optional(),
});

const MensagemDireta = z.object({
  sender: z.object({ id: z.string().max(64) }),
  recipient: z.object({ id: z.string().max(64) }),
  timestamp: z.number().optional(),
  message: z.object({
    mid: z.string().min(1).max(600),
    text: z.string().max(20_000).optional(),
    is_echo: z.boolean().optional(),
    is_deleted: z.boolean().optional(),
    attachments: z.array(Anexo).max(20).optional(),
  }),
});

const Comentario = z.object({
  id: IdMeta,
  text: z.string().max(20_000).optional(),
  parent_id: IdMeta.optional(),
  from: z.object({ id: IdMeta, username: z.string().max(100).optional() }),
  media: z.object({ id: IdMeta, media_product_type: z.string().max(30).optional() }),
});

type ValorComentario = z.infer<typeof Comentario>;

/** O instante do evento: a Meta manda segundos em `entry.time` e milissegundos em `timestamp`. */
function quandoDoEvento(t: number | undefined): Date | null {
  if (!t || !Number.isFinite(t) || t <= 0) return null;
  const d = new Date(t > 1e12 ? t : t * 1000);
  // Relógio adiantado não vira "comentário do futuro".
  return d.getTime() > Date.now() ? new Date() : d;
}

// ── Conteúdo do direct ──────────────────────────────────────────────────────

export type ConteudoDireto = { texto: string; tipo: TipoMensagem; origem: string | null };

const TIPO_DO_ANEXO: Record<string, TipoMensagem> = { image: "imagem", video: "video", audio: "audio" };
const ANEXO_GENERICO = "[anexo do Instagram]";

/**
 * O que a mensagem diz, nas nossas colunas. Só imagem, vídeo e áudio de host
 * da Meta entram na fila de mídia ('ig:<url>', lib/midia.ts); o resto
 * (compartilhamento, story, reel, fallback) vira o texto ANEXO_GENERICO.
 */
export function conteudoDoDirect(m: { text?: string; attachments?: Array<{ type: string; payload?: { url?: string } }> }): ConteudoDireto {
  const texto = (m.text ?? "").slice(0, 4000);
  const anexo = m.attachments?.[0];
  if (anexo) {
    const tipo = TIPO_DO_ANEXO[anexo.type];
    const url = anexo.payload?.url;
    if (tipo && url && hostDeAnexoPermitido(url)) return { texto, tipo, origem: `ig:${url}` };
    return { texto: texto ? `${texto}\n${ANEXO_GENERICO}` : ANEXO_GENERICO, tipo: "texto", origem: null };
  }
  if (!texto.trim()) return { texto: "[mensagem não suportada pelo CRM: veja no Instagram]", tipo: "texto", origem: null };
  return { texto, tipo: "texto", origem: null };
}

// ── O que fica para depois da resposta ──────────────────────────────────────

type EcoDireto = { perfil: Perfil; igsid: string; mid: string; conteudo: ConteudoDireto; quando: Date };
type EcoComentario = { perfil: Perfil; v: ValorComentario; texto: string; midiaTipo: string | null; quando: Date };

type Trabalho = {
  /** Mensagens do contato que entraram AGORA: é a elas que a IA do direct pode responder. */
  novas: Array<{ atendimentoId: string; mensagemId: string }>;
  /** Contatos que nasceram agora: o nome vem do perfil do Instagram. */
  perfis: Array<{ contatoId: string; perfil: Perfil; igsid: string }>;
  comMidia: number;
  ecosDiretos: EcoDireto[];
  ecosComentarios: EcoComentario[];
  /** Comentários raiz de terceiros gravados AGORA, de evento recente: candidatos à IA. */
  comentariosParaIa: string[];
};

const vazio = (): Trabalho => ({ novas: [], perfis: [], comMidia: 0, ecosDiretos: [], ecosComentarios: [], comentariosParaIa: [] });

const temTrabalho = (t: Trabalho) =>
  t.novas.length + t.perfis.length + t.comMidia + t.ecosDiretos.length + t.ecosComentarios.length + t.comentariosParaIa.length > 0;

// ── Entrada ─────────────────────────────────────────────────────────────────

export type RespostaWebhook = { status: number; corpo: Record<string, unknown>; depois: (() => Promise<void>) | null };

/**
 * O POST inteiro: assinatura, leitura e gravação. `depois` é o trabalho que a
 * rota agenda com `after` (null quando não há nada a fazer).
 */
export async function receberWebhookInstagram(bytes: Uint8Array, assinatura: string | null, segredo: string): Promise<RespostaWebhook> {
  if (!segredo) return { status: 503, corpo: { erro: "META_APP_SECRET ausente" }, depois: null };
  if (!assinaturaMetaConfere(bytes, assinatura, segredo)) return { status: 401, corpo: { erro: "assinatura inválida" }, depois: null };

  // Payload inválido ou ignorável é confirmado; falha ao gravar pede reentrega.
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return { status: 200, corpo: { ok: true }, depois: null };
  }
  // O acumulador pertence ao recebimento: uma falha posterior não pode apagar
  // perfis, IA, mídia ou ecos já coletados dos itens anteriores.
  const t = vazio();
  let falhou = false;
  try {
    falhou = await processarWebhookInstagram(json, t);
  } catch (e) {
    falhou = true;
    console.error("[instagram webhook] falhou:", motivo(e));
  }
  return {
    status: falhou ? 503 : 200,
    corpo: falhou ? { erro: "falha ao persistir webhook" } : { ok: true },
    // Também no 503: os inserts confirmados não entram de novo na fila de IA
    // na reentrega (ON CONFLICT + RETURNING), portanto seu trabalho roda agora.
    depois: temTrabalho(t) ? () => trabalhoDepois(t) : null,
  };
}

/** Continua o lote após falha isolada e informa se é necessária reentrega. */
async function processarWebhookInstagram(json: unknown, t: Trabalho): Promise<boolean> {
  let falhou = false;
  const corpo = Corpo.safeParse(json);
  if (!corpo.success) {
    registrarRecusa("lote", quantosEm((json as { entry?: unknown } | null)?.entry), corpo.error);
    return false;
  }
  if (corpo.data.object !== "instagram") return false;

  for (const bruta of corpo.data.entry) {
    const entrada = Entrada.safeParse(bruta);
    if (!entrada.success) {
      const b = bruta as { messaging?: unknown; changes?: unknown } | null;
      registrarRecusa("entrada", quantosEm(b?.messaging) + quantosEm(b?.changes), entrada.error);
      continue;
    }
    // Conta que não é uma das três: ignorada (o app pode estar em outras).
    const perfil = perfilDaConta(entrada.data.id);
    if (!perfil) continue;
    const quando = quandoDoEvento(entrada.data.time);

    for (const item of entrada.data.messaging ?? []) {
      try {
        await registrarMensagemDireta(item, perfil, t);
      } catch (e) {
        falhou = true;
        console.error("[instagram webhook] não gravei uma mensagem:", motivo(e));
      }
    }
    for (const mudanca of entrada.data.changes ?? []) {
      if (mudanca.field !== "comments") continue;
      try {
        await registrarComentario(mudanca.value, perfil, quando, t);
      } catch (e) {
        falhou = true;
        console.error("[instagram webhook] não gravei um comentário:", motivo(e));
      }
    }
  }
  return falhou;
}

// ── Direct ──────────────────────────────────────────────────────────────────

/** O eco é de uma mensagem que o CRM já registrou com este mid? */
async function casarEcoDireto(mid: string): Promise<boolean> {
  const r = await sql`
    UPDATE mensagens SET status = CASE WHEN status = 'pendente' THEN 'enviado' ELSE status END
     WHERE id_externo = ${mid} AND origem = 'agente'
    RETURNING id`;
  return r.length > 0;
}

async function registrarMensagemDireta(bruto: unknown, perfil: Perfil, t: Trabalho): Promise<void> {
  const m = MensagemDireta.safeParse(bruto);
  if (!m.success) return;
  const { sender, recipient, message, timestamp } = m.data;
  if (message.is_deleted) return;
  const eco = message.is_echo === true;
  const conta = eco ? sender.id : recipient.id;
  const pessoa = eco ? recipient.id : sender.id;
  // A conta do evento tem de ser a da entrada; conversa entre as nossas contas não entra.
  if (conta !== perfil.instagramId || !ehIdMeta(pessoa) || ehContaNossa(pessoa)) return;
  const conteudo = conteudoDoDirect(message);
  const quando = quandoDoEvento(timestamp) ?? new Date();

  if (eco) {
    if (!(await casarEcoDireto(message.mid))) {
      t.ecosDiretos.push({ perfil, igsid: pessoa, mid: message.mid, conteudo, quando });
    }
    return;
  }

  const contato = await contatoDoInstagram({ igsid: pessoa, usuario: null });
  if (contato.criado) t.perfis.push({ contatoId: contato.id, perfil, igsid: pessoa });
  const atendimentoId = await conversaDoInstagram(contato.id, perfil.instagramId, "contato");
  // A data é a da Meta: é ela que abre a janela de 24h.
  const inseridas = await sql`
    INSERT INTO mensagens (
      atendimento_id, origem, texto, status, id_externo, tipo, midia_url_origem, midia_estado, data_criacao)
    VALUES (
      ${atendimentoId}, 'contato', ${conteudo.texto}, 'recebido', ${message.mid}, ${conteudo.tipo},
      ${conteudo.origem}, ${conteudo.origem ? "pendente" : "ausente"}, ${quando})
    ON CONFLICT (id_externo) WHERE id_externo IS NOT NULL DO NOTHING
    RETURNING id`;
  if (inseridas.length === 0) return;
  t.novas.push({ atendimentoId, mensagemId: inseridas[0].id as string });
  if (conteudo.origem) t.comMidia += 1;
}

/**
 * O eco que não casou, alguns segundos depois: casou agora (o envio gravou o
 * mid), nada a fazer; senão foi alguém pelo celular (ou outro robô) e vira
 * 'aparelho' — que é o que cala a IA por uma hora. Só aqui vale a palavra da IA.
 * Devolve se gravou anexo para baixar.
 */
async function registrarEcoDireto(e: EcoDireto): Promise<boolean> {
  if (await casarEcoDireto(e.mid)) return false;
  const contato = await contatoDoInstagram({ igsid: e.igsid, usuario: null });
  if (contato.criado) await atualizarPerfilDoContato(contato.id, e.perfil, e.igsid);
  const atendimentoId = await conversaDoInstagram(contato.id, e.perfil.instagramId, "nos");
  const inseridas = await sql`
    INSERT INTO mensagens (
      atendimento_id, origem, enviada_por, texto, status, id_externo, tipo, midia_url_origem, midia_estado, data_criacao)
    VALUES (
      ${atendimentoId}, 'agente', 'aparelho', ${e.conteudo.texto}, 'enviado', ${e.mid}, ${e.conteudo.tipo},
      ${e.conteudo.origem}, ${e.conteudo.origem ? "pendente" : "ausente"}, ${e.quando})
    ON CONFLICT (id_externo) WHERE id_externo IS NOT NULL DO NOTHING
    RETURNING id`;
  if (inseridas.length === 0) return false;
  if (e.conteudo.tipo === "texto" && e.conteudo.texto.trim()) await alternarIaPelaPalavra(atendimentoId, e.conteudo.texto);
  return Boolean(e.conteudo.origem);
}

// ── Comentários ─────────────────────────────────────────────────────────────

/**
 * O eco da nossa resposta pública: a linha que o CRM gravou ('pendente' ou
 * 'erro' por tempo esgotado) para o mesmo comentário e com o mesmo texto
 * recebe o id. Já registrada com este id, também casou.
 */
async function casarEcoDeComentario(contaId: string, v: ValorComentario, texto: string): Promise<boolean> {
  const [ja] = await sql`SELECT 1 FROM instagram_comentarios WHERE comentario_id = ${v.id}`;
  if (ja) return true;
  if (!v.parent_id) return false;
  const r = await sql`
    UPDATE instagram_comentarios
       SET comentario_id = ${v.id}, envio = 'enviado', erro = NULL, data_registro = now()
     WHERE id = (
       SELECT id FROM instagram_comentarios
        WHERE conta_id = ${contaId} AND da_conta AND comentario_id IS NULL
          AND envio IN ('pendente', 'erro') AND pai_id = ${v.parent_id} AND texto = ${texto}
        ORDER BY data_registro DESC LIMIT 1)
    RETURNING id`;
  return r.length > 0;
}

async function registrarComentario(bruto: unknown, perfil: Perfil, quando: Date | null, t: Trabalho): Promise<void> {
  const c = Comentario.safeParse(bruto);
  if (!c.success) return;
  const v = c.data;
  const texto = (v.text ?? "").slice(0, 2200);
  const midiaTipo = v.media.media_product_type ? v.media.media_product_type.toUpperCase() : null;

  // Feito por QUALQUER uma das três contas: é nosso, nunca dispara a IA.
  if (ehContaNossa(v.from.id)) {
    if (!(await casarEcoDeComentario(perfil.instagramId, v, texto))) {
      t.ecosComentarios.push({ perfil, v, texto, midiaTipo, quando: quando ?? new Date() });
    }
    return;
  }

  // O contato só é LIGADO se já existir: comentário não cria contato.
  const [nova] = await sql`
    INSERT INTO instagram_comentarios
      (conta_id, midia_id, midia_tipo, comentario_id, pai_id, autor_id, autor_usuario, texto, da_conta,
       contato_id, data_criacao)
    VALUES
      (${perfil.instagramId}, ${v.media.id}, ${midiaTipo}, ${v.id}, ${v.parent_id ?? null}, ${v.from.id},
       ${usuarioValido(v.from.username)}, ${texto}, false,
       (SELECT id FROM contatos WHERE campos ? 'instagram_id' AND campos->>'instagram_id' = ${v.from.id}),
       ${quando ?? new Date()})
    ON CONFLICT (comentario_id) DO NOTHING
    RETURNING id`;
  // Só o que inseriu AGORA, raiz e de evento recente (sem a hora do evento, não).
  // Evento mais velho que COMENTARIO_RECENTE_MS nem chega à IA (ela confere de novo, pela hora da Meta).
  if (nova && !v.parent_id && quando && Date.now() - quando.getTime() <= COMENTARIO_RECENTE_MS) {
    t.comentariosParaIa.push(nova.id as string);
  }
}

/** O comentário de uma das nossas contas que não casou com resposta do CRM: foi pelo app. */
async function registrarEcoDeComentario(e: EcoComentario): Promise<void> {
  if (await casarEcoDeComentario(e.perfil.instagramId, e.v, e.texto)) return;
  await sql`
    INSERT INTO instagram_comentarios
      (conta_id, midia_id, midia_tipo, comentario_id, pai_id, autor_id, autor_usuario, texto, da_conta,
       enviada_por, lido_em, data_criacao)
    VALUES
      (${e.perfil.instagramId}, ${e.v.media.id}, ${e.midiaTipo}, ${e.v.id}, ${e.v.parent_id ?? null}, ${e.v.from.id},
       ${usuarioValido(e.v.from.username)}, ${e.texto}, true, 'aparelho', now(), ${e.quando})
    ON CONFLICT (comentario_id) DO NOTHING`;
}

// ── Depois da resposta ──────────────────────────────────────────────────────

/**
 * Os ecos esperam o envio gravar o mid; em paralelo, nesta ordem: o perfil de
 * quem escreveu (a IA chama pelo nome), a mídia (o áudio sai transcrito antes
 * da IA) e as IAs. Nunca lança.
 */
async function trabalhoDepois(t: Trabalho): Promise<void> {
  let midiaDeEco = false;
  const ecos = async () => {
    if (!t.ecosDiretos.length && !t.ecosComentarios.length) return;
    await new Promise((r) => setTimeout(r, ESPERA_ECO_MS));
    for (const e of t.ecosDiretos) {
      const comMidia = await registrarEcoDireto(e).catch((erro) => {
        console.error("[instagram webhook] eco do direct:", motivo(erro));
        return false;
      });
      midiaDeEco ||= comMidia;
    }
    for (const e of t.ecosComentarios) {
      await registrarEcoDeComentario(e).catch((erro) => console.error("[instagram webhook] eco de comentário:", motivo(erro)));
    }
  };
  const resto = async () => {
    for (const p of t.perfis) await atualizarPerfilDoContato(p.contatoId, p.perfil, p.igsid);
    if (t.comMidia > 0) await baixarPendentes();
    await Promise.all([
      ...t.novas.map((n) => responderComIa(n.atendimentoId, n.mensagemId)),
      ...t.comentariosParaIa.map((id) => responderComentarioComIa(id)),
    ]);
  };
  await Promise.all([ecos(), resto()]);
  // Mídia de eco (foto mandada pelo celular), descoberta só agora.
  if (midiaDeEco) await baixarPendentes();
}
