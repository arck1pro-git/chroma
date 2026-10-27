// O canal de Instagram do /chat (2026-10-26) contra o banco DEV, pelas funções
// reais, SEM falar com a Meta nem com a Anthropic: o globalThis.fetch vira uma
// Graph e um modelo falsos (rede de verdade é recusada; só o DNS dos hosts de
// anexo da Meta é consultado pela peneira de SSRF, na última parte).
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-instagram.ts
//
// O que confere: assinatura e filtros do webhook (object, conta fora de
// PERFIS, ids não numéricos), DM com idempotência, eco casado e não casado,
// trava de desenvolvimento (INSTAGRAM_SO_PARA), janela de 24h, áudio recusado,
// IA de comentário só em comentário raiz, novo, recente e com regra, reserva
// única (inclusive com duas chamadas ao mesmo tempo), uma resposta da IA por
// autor por postagem, filtro de saída do direct, IA no contato só com ia NULL,
// a IA não entra onde já há gente (IA desligada, conversa com dono ou com a
// equipe na última hora, comentário já respondido), teto por hora contando as
// descartadas, resposta pública nunca fora da produção, aviso à equipe por
// DEMANDA no Instagram (pedido de atendimento e reunião), resposta da equipe,
// busca de comentários sem IA, identidade do Instagram fora da captação
// pública, a leitura da tela e o download de anexo só de host da Meta.
//
// MARCA: todo id inventado começa com 9900 (mídias, comentários, IGSIDs); os
// contatos nascem com campos.instagram_id 9900…. Tudo é apagado no finally, só
// pela marca (as demandas de aviso, pelo link exato da conversa de teste). As
// contas são as reais de lib/social/perfis.ts (é o que o código aceita); regra
// de IA só é criada em mídia de teste, nunca na conta inteira.
//
// A resposta PÚBLICA não sai fora da produção (trava de lib/instagram.ts). Para
// conferir o caminho dela inteiro, alguns trechos rodam com VERCEL_ENV =
// 'production' (emProducao): a rede é falsa, nada sai daqui.
//
// Os imports vão pelo alias "@/": é por ele que o código importa, e o runner
// (scripts/jiti.mjs) carregaria uma SEGUNDA cópia de cada módulo pelo caminho
// relativo (outra conexão com o banco, outro cache de token).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sql } from "@/lib/db";
import { PERFIS } from "@/lib/social/perfis";
import { paginaDeComentarios } from "@/lib/instagram-leitura";
import {
  baixarAnexoInstagram,
  conferirDestinoInstagram,
  enviarDirect,
  hostDeAnexoPermitido,
  perfilDaConta,
  responderEmPublico,
  temLink,
} from "@/lib/instagram";
import { receberWebhookInstagram, conteudoDoDirect } from "@/lib/instagram-webhook";
import {
  assinaturaDosComentarios,
  falaPelaMarca,
  naoLidosPorConta,
  marcarComentariosLidos,
  responderComentarioPelaEquipe,
  salvarRegraIa,
  sincronizarComentarios,
} from "@/lib/instagram-comentarios";
import { ABERTURA_FIXA, aberturaSegura, motivoNoTexto, regraQueVale, responderComentarioComIa } from "@/lib/ia/comentarios";
import { nomeParaAviso } from "@/lib/ia/aviso-demanda";
import { paraTesteAvisos, situacao } from "@/lib/ia/atendente";
import { semIdentidadeDoInstagram } from "@/lib/webhooks-recepcao";
import { pessoasParaDemanda } from "@/lib/demandas";
import { enviarAudioNaConversa, enviarTextoNaConversa } from "@/lib/conversa-envio";
import { Recusa } from "@/lib/resultado-acao";
import { carregarChat, carregarComentariosDaConta } from "@/app/chat/dados";

// ── Cenário ─────────────────────────────────────────────────────────────────

const PERFIL = PERFIS[1];
const CONTA = PERFIL.instagramId;
const OUTRA_CONTA = PERFIS[0].instagramId;
const CONTA_ALHEIA = "17840000000000000";
const SEGREDO = "segredo-de-teste-instagram";

const ig = (n: number) => `9900000000${String(n).padStart(5, "0")}`;
const LIBERADO = ig(1);
const BLOQUEADO = ig(2);
const VELHO = ig(3);
const AUTOR_IA = ig(5);
const AUTOR_3 = ig(6);
const AUTOR_4 = ig(7);
const AUTOR_5 = ig(8);
const BLOQ_2 = ig(9);
const AUTOR_6 = ig(10);
const AUTOR_7 = ig(11);
const AUTOR_8 = ig(12);
const AUTOR_9 = ig(13);
const AUTOR_DEV = ig(17); // IA de comentário fora da produção: direct sai, frase pública não
const COM_DONO = ig(18); // conversa do direct com responsável
const COM_EQUIPE = ig(19); // alguém da equipe falou no direct na última hora
const RESPONDIDO = ig(24); // comentário que uma das nossas contas já respondeu
const NO_TETO = ig(25); // comentário depois do teto por hora
const LIBERADOS = [LIBERADO, AUTOR_IA, AUTOR_3, AUTOR_4, AUTOR_5, AUTOR_6, AUTOR_7, AUTOR_8, AUTOR_9, AUTOR_DEV, COM_DONO, COM_EQUIPE, RESPONDIDO, NO_TETO];
const TITULO_PEDIDO = "Pediu atendimento no Instagram";
const TITULO_REUNIAO = "Reunião marcada pela IA no Instagram";

const MIDIA_1 = ig(101); // regra ligada
const MIDIA_2 = ig(102); // sem regra (e a da busca de comentários)
const MIDIA_3 = ig(103); // regra ligada (reserva concorrente)
const MIDIA_FORA = ig(199); // não é da conta
const MIDIAS_DA_CONTA = new Set([MIDIA_1, MIDIA_2, MIDIA_3]);
const com = (n: number) => ig(200 + n);

// ── Rede falsa ──────────────────────────────────────────────────────────────

type Chamada = { metodo: string; url: URL; corpo: Record<string, unknown> | null };
const graph: Chamada[] = [];
const modelo: Array<Record<string, unknown>> = [];
const ocultos = new Set<string>();
/** Comentários que a Meta diz serem antigos (o evento chega agora, como numa reentrega). */
const antigosNaMeta = new Set<string>();
const autorDoComentario = new Map<string, string>();
let seq = 0;
let paginarBusca = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const COMENTARIOS_DA_BUSCA = [
  { id: com(80), text: "Comentário antigo", timestamp: "2026-10-20T10:00:00+0000", from: { id: ig(14), username: "antigo_um" },
    replies: { data: [
      { id: com(81), text: "Resposta antiga", timestamp: "2026-10-20T11:00:00+0000", from: { id: ig(15), username: "antigo_dois" }, parent_id: com(80) },
      { id: com(83), text: "Respondemos pelo app", timestamp: "2026-10-20T12:00:00+0000", from: { id: CONTA, username: PERFIL.instagram }, parent_id: com(80) },
    ] } },
  { id: com(82), text: "Oculto pela Meta", timestamp: "2026-10-20T10:30:00+0000", from: { id: ig(16), username: "oculto" }, hidden: true },
];

function graphFalsa(metodo: string, url: URL, corpo: Record<string, unknown> | null): Response {
  const [, alvo, aresta] = url.pathname.split("/").filter(Boolean);
  const campos = url.searchParams.get("fields") ?? "";
  if (metodo === "GET" && !aresta && campos === "access_token") return json({ access_token: "token-da-pagina-de-teste" });
  if (metodo === "POST" && aresta === "messages") {
    seq += 1;
    const r = (corpo?.recipient ?? {}) as { id?: string; comment_id?: string };
    return json({ recipient_id: r.id ?? autorDoComentario.get(r.comment_id ?? "") ?? null, message_id: `mid.9900.enviada.${seq}` });
  }
  if (metodo === "POST" && aresta === "replies") {
    seq += 1;
    return json({ id: `99009${String(seq).padStart(8, "0")}` });
  }
  if (metodo === "GET" && aresta === "media") {
    return json({ data: [...MIDIAS_DA_CONTA].map((id, i) => ({
      id, caption: `Postagem de teste ${i + 1}`, media_type: "IMAGE", media_url: "https://exemplo.invalid/m.jpg",
      permalink: "https://www.instagram.com/p/teste/", timestamp: "2026-10-25T12:00:00+0000", comments_count: 3,
    })) });
  }
  if (metodo === "GET" && aresta === "comments") {
    if (!paginarBusca || alvo !== MIDIA_2) return json({ data: alvo === MIDIA_2 ? COMENTARIOS_DA_BUSCA : [] });
    if (url.searchParams.get("after") === "raizes-2") return json({ data: [{ id: com(84), text: "Raiz da segunda página", from: { id: ig(14), username: "antigo_um" } }] });
    return json({ data: [{ ...COMENTARIOS_DA_BUSCA[0], replies: { ...COMENTARIOS_DA_BUSCA[0].replies,
      paging: { next: "https://graph.facebook.com/ignorar-url", cursors: { after: "respostas-2" } } } }],
      paging: { next: "https://graph.facebook.com/ignorar-url", cursors: { after: "raizes-2" } } });
  }
  if (metodo === "GET" && aresta === "replies" && alvo === com(80) && url.searchParams.get("after") === "respostas-2") {
    return json({ data: [{ id: com(85), text: "Resposta da segunda página", from: { id: ig(15), username: "antigo_dois" }, parent_id: com(80) }] });
  }
  if (metodo === "GET" && campos.startsWith("owner")) return json({ owner: { id: MIDIAS_DA_CONTA.has(alvo) ? CONTA : CONTA_ALHEIA } });
  if (metodo === "GET" && campos === "caption") return json({ caption: "Legenda de teste" });
  if (metodo === "GET" && campos === "name,username") return json({ name: `Pessoa Teste ${alvo.slice(-3)}`, username: `teste_${alvo.slice(-3)}` });
  if (metodo === "GET" && campos.includes("hidden")) {
    return json({
      id: alvo, text: "x", hidden: ocultos.has(alvo), from: { id: autorDoComentario.get(alvo) ?? "" },
      timestamp: antigosNaMeta.has(alvo) ? "2026-10-20T10:00:00+0000" : new Date().toISOString(),
    });
  }
  if (metodo === "GET" && campos === "profile_picture_url") return json({});
  return json({ error: { message: `Graph falsa não conhece ${metodo} ${url.pathname}?fields=${campos}` } }, 400);
}

function respostaDoModelo(corpo: Record<string, unknown>): Response {
  modelo.push(corpo);
  const mensagem = (content: unknown[], stop: string) =>
    json({ id: "msg_teste", type: "message", role: "assistant", model: corpo.model, content, stop_reason: stop,
      stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  const ferramentas = (corpo.tools ?? []) as Array<{ name: string }>;
  if (ferramentas.some((t) => t.name === "responder_comentario")) {
    const pedido = JSON.stringify(corpo.messages);
    const frase = pedido.includes("ofensa") ? "nao_responder" : pedido.includes("detalhes") ? "detalhes_no_direct" : "chamei_no_direct";
    const abertura = pedido.includes("abertura-ruim")
      ? "Me chama no 47 99999-0000 ou em www.site.com"
      : "Oi! Que bom te ver por aqui. Me conta o que você procura?";
    return mensagem([{ type: "tool_use", id: "toolu_teste", name: "responder_comentario", input: { frase, abertura_do_direct: abertura } }], "tool_use");
  }
  // A IA de atendimento: quem pede uma pessoa recebe avisar_equipe (e, na volta
  // sem ferramentas, o texto). O resto, só texto.
  const semFerramentas = (corpo.tool_choice as { type?: string } | undefined)?.type === "none";
  if (!semFerramentas && ferramentas.some((t) => t.name === "avisar_equipe") && JSON.stringify(corpo.messages).includes("quero falar com alguém")) {
    return mensagem([{ type: "tool_use", id: "toolu_aviso", name: "avisar_equipe", input: { motivo: "quer falar com uma pessoa", valor: 0 } }], "tool_use");
  }
  return mensagem([{ type: "text", text: "Oi! Como posso te ajudar?" }], "end_turn");
}

const fetchOriginal = globalThis.fetch;
async function fetchFalso(entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const corpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  if (url.hostname === "api.anthropic.com") return respostaDoModelo(corpo ?? {});
  if (url.hostname === "graph.facebook.com") {
    graph.push({ metodo, url, corpo });
    return graphFalsa(metodo, url, corpo);
  }
  if (url.hostname === "lookaside.fbsbx.com") {
    const destino = url.searchParams.get("asset_id") === "fora" ? "https://evil.example.com/x.jpg" : "https://scontent.cdninstagram.com/v/9900.jpg";
    return new Response(null, { status: 302, headers: { location: destino } });
  }
  if (url.hostname.endsWith("cdninstagram.com")) {
    const grande = url.pathname.includes("grande");
    return new Response(new Uint8Array(grande ? 4096 : 3), { status: 200, headers: { "content-type": url.pathname.includes("pdf") ? "application/pdf" : "image/jpeg" } });
  }
  throw new Error(`rede bloqueada no teste: ${url.hostname}`);
}

// ── Ajudantes ───────────────────────────────────────────────────────────────

const agoraS = () => Math.floor(Date.now() / 1000);

async function webhook(corpo: unknown, opcoes: { assinatura?: string; segredo?: string; rodarDepois?: boolean } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(corpo));
  const segredo = opcoes.segredo ?? SEGREDO;
  const assinatura = opcoes.assinatura ?? `sha256=${createHmac("sha256", SEGREDO).update(bytes).digest("hex")}`;
  const r = await receberWebhookInstagram(bytes, assinatura, segredo);
  if (r.depois && opcoes.rodarDepois !== false) await r.depois();
  return r;
}

function dm(de: string, mid: string, texto: string, ts = Date.now(), conta = CONTA) {
  return { object: "instagram", entry: [{ id: conta, time: ts, messaging: [
    { sender: { id: de }, recipient: { id: conta }, timestamp: ts, message: { mid, text: texto } }] }] };
}

function eco(para: string, mid: string, texto: string) {
  return { object: "instagram", entry: [{ id: CONTA, time: Date.now(), messaging: [
    { sender: { id: CONTA }, recipient: { id: para }, timestamp: Date.now(), message: { mid, text: texto, is_echo: true } }] }] };
}

function comentario(c: { id: string; midia: string; autor: string; usuario: string; texto: string; pai?: string; tipo?: string; time?: number; conta?: string }) {
  autorDoComentario.set(c.id, c.autor);
  return { object: "instagram", entry: [{ id: c.conta ?? CONTA, time: c.time ?? agoraS(), changes: [{ field: "comments", value: {
    id: c.id, text: c.texto, from: { id: c.autor, username: c.usuario },
    media: { id: c.midia, media_product_type: c.tipo ?? "FEED" }, ...(c.pai ? { parent_id: c.pai } : {}) } }] }] };
}

async function linha(comentarioId: string) {
  const [l] = await sql`SELECT * FROM instagram_comentarios WHERE comentario_id = ${comentarioId}`;
  return l;
}
async function respostasDaIa(paiId: string) {
  return sql`SELECT * FROM instagram_comentarios WHERE pai_id = ${paiId} AND enviada_por = 'ia'`;
}
async function contato(igsid: string) {
  const [c] = await sql`SELECT * FROM contatos WHERE campos ? 'instagram_id' AND campos->>'instagram_id' = ${igsid}`;
  return c;
}
async function conversa(igsid: string) {
  const [a] = await sql`
    SELECT a.* FROM atendimentos a JOIN contatos c ON c.id = a.contato_id
     WHERE c.campos->>'instagram_id' = ${igsid} AND a.canal = 'instagram' AND a.numero_instancia = ${CONTA}`;
  return a;
}
const mensagensDe = (atendimentoId: string) =>
  sql`SELECT * FROM mensagens WHERE atendimento_id = ${atendimentoId} ORDER BY data_criacao, id`;
const postsGraph = (aresta: string) => graph.filter((c) => c.metodo === "POST" && c.url.pathname.endsWith(`/${aresta}`));

async function recusa(promessa: Promise<unknown>, trecho: RegExp) {
  try {
    await promessa;
  } catch (e) {
    assert.ok(e instanceof Recusa, `devia ser Recusa: ${String(e)}`);
    assert.match(e.message, trecho);
    return;
  }
  assert.fail(`devia ter recusado (${trecho})`);
}

/** As demandas de aviso vistas no teste: conferidas como apagadas no fim. */
const demandasCriadas = new Set<string>();

/** As demandas de aviso criadas para uma conversa de teste (pelo link exato dela). */
async function demandasDe(atendimentoId: string) {
  const linhas = await sql`
    SELECT id, titulo, descricao, to_char(prazo, 'YYYY-MM-DD') AS prazo, prioridade, responsavel_id, criado_por
      FROM demandas WHERE criado_por IS NULL AND descricao LIKE ${`%atendimento=${atendimentoId}%`}`;
  for (const l of linhas) demandasCriadas.add(l.id as string);
  return linhas;
}

async function limpar() {
  // As demandas de aviso apontam para as conversas de teste: saem antes delas,
  // uma a uma pelo link exato, só as criadas pelo sistema.
  const conversas = await sql`
    SELECT a.id FROM atendimentos a JOIN contatos c ON c.id = a.contato_id
     WHERE c.campos ? 'instagram_id' AND c.campos->>'instagram_id' LIKE '9900%'`;
  for (const a of conversas) {
    await sql`DELETE FROM demandas WHERE criado_por IS NULL AND descricao LIKE ${`%atendimento=${a.id}%`}`;
  }
  await sql`DELETE FROM instagram_comentarios WHERE midia_id LIKE '9900%'`;
  await sql`DELETE FROM instagram_ia_regras WHERE midia_id LIKE '9900%'`;
  // Conversas, mensagens e histórico saem junto (ON DELETE CASCADE).
  await sql`DELETE FROM contatos WHERE campos ? 'instagram_id' AND campos->>'instagram_id' LIKE '9900%'`;
}

/** Roda `fazer` como na produção (sem a trava do dev). A rede continua falsa. */
async function emProducao<T>(fazer: () => Promise<T>): Promise<T> {
  process.env.VERCEL_ENV = "production";
  try {
    return await fazer();
  } finally {
    delete process.env.VERCEL_ENV;
  }
}

const hojeEmBrasilia = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const passo = (t: string) => console.log(`· ${t}`);

// ── As partes ───────────────────────────────────────────────────────────────

function partePura() {
  passo("regras, filtros e trava (sem banco)");
  const regra = (midia_id: string | null, ligada: boolean, ia_id = "ia-x") => ({ midia_id, ia_id, ligada });
  assert.deepEqual(regraQueVale([regra(MIDIA_1, true)], MIDIA_1, "FEED"), { iaId: "ia-x" });
  assert.equal(regraQueVale([regra(MIDIA_1, false), regra(null, true)], MIDIA_1, "FEED"), null, "a da postagem desligada cala a da conta");
  assert.deepEqual(regraQueVale([regra(null, true, "ia-conta")], MIDIA_2, "REELS"), { iaId: "ia-conta" });
  assert.equal(regraQueVale([regra(null, true)], MIDIA_2, "AD"), null, "regra da conta não vale em anúncio");
  assert.equal(regraQueVale([regra(null, true)], MIDIA_2, null), null, "tipo desconhecido conta como anúncio");
  assert.deepEqual(regraQueVale([regra(MIDIA_2, true)], MIDIA_2, "AD"), { iaId: "ia-x" }, "a da postagem vale até em anúncio");
  assert.equal(regraQueVale([], MIDIA_1, "FEED"), null);

  assert.equal(motivoNoTexto("😍🔥"), "só emoji ou símbolo");
  assert.equal(motivoNoTexto("veja www.golpe.com"), "comentário com link");
  assert.equal(motivoNoTexto("@amigo olha isso"), "menciona outra conta");
  assert.equal(motivoNoTexto(`@${PERFIL.instagram} que lindo`), null, "mencionar a própria conta pode");
  assert.equal(motivoNoTexto("Quero saber mais"), null);
  assert.equal(motivoNoTexto("entra em golpe.xyz"), "comentário com link", "domínio qualquer, sem www");
  assert.equal(motivoNoTexto("me acha em site . com"), "comentário com link", "espaço antes do ponto");
  assert.equal(motivoNoTexto("me acha em site. net"), "comentário com link");
  assert.equal(temLink("Gostei. Com certeza quero"), false, "fim de frase não é link");
  assert.equal(temLink("Quero saber mais. Me chama"), false);
  assert.equal(temLink("Maria A. Souza"), false, "inicial no nome não é link");

  assert.equal(aberturaSegura("Oi @fulano, me conta o que procura?", "fulano"), "Oi @fulano, me conta o que procura?");
  assert.equal(aberturaSegura("Veja https://x.com", "fulano"), ABERTURA_FIXA, "link");
  assert.equal(aberturaSegura("Fala com @outro", "fulano"), ABERTURA_FIXA, "@ de outra conta");
  assert.equal(aberturaSegura("Rende 120 por mês", "fulano"), ABERTURA_FIXA, "3+ dígitos");
  assert.equal(aberturaSegura("Me chama no 47 9 99", "fulano"), ABERTURA_FIXA, "dígitos separados por espaço");
  assert.equal(aberturaSegura("A partir de 1.5-0", "fulano"), ABERTURA_FIXA, "dígitos separados por ponto e traço");
  assert.equal(aberturaSegura("Te respondo em 2 ou 3 minutos!", "fulano"), "Te respondo em 2 ou 3 minutos!", "números soltos podem");
  assert.equal(aberturaSegura("Veja em golpe . xyz", "fulano"), ABERTURA_FIXA, "domínio disfarçado");
  assert.equal(aberturaSegura("Mande para a@b.com", "fulano"), ABERTURA_FIXA, "e-mail");
  assert.equal(aberturaSegura("a".repeat(301), "fulano"), ABERTURA_FIXA, "mais de 300");
  assert.equal(aberturaSegura("Oi​ tudo bem?", "fulano"), ABERTURA_FIXA, "caractere invisível");

  assert.equal(perfilDaConta("abc"), null, "conta não numérica");
  assert.equal(perfilDaConta(CONTA_ALHEIA), null, "conta fora de PERFIS");
  assert.equal(perfilDaConta(CONTA)?.paginaId, PERFIL.paginaId);

  assert.equal(hostDeAnexoPermitido("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1"), true);
  assert.equal(hostDeAnexoPermitido("https://scontent-gru1-1.cdninstagram.com/v/a.jpg"), true);
  assert.equal(hostDeAnexoPermitido("http://lookaside.fbsbx.com/x"), false, "sem https");
  assert.equal(hostDeAnexoPermitido("https://fbcdn.net.evil.com/x"), false);
  const img = conteudoDoDirect({ attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" } }] });
  assert.equal(img.tipo, "imagem");
  assert.match(img.origem ?? "", /^ig:https:\/\/lookaside/);
  assert.deepEqual(conteudoDoDirect({ attachments: [{ type: "image", payload: { url: "https://evil.example.com/a.jpg" } }] }).tipo, "texto");
  assert.equal(conteudoDoDirect({ text: "olha", attachments: [{ type: "share", payload: { url: "https://www.instagram.com/p/x" } }] }).texto, "olha\n[anexo do Instagram]");

  assert.equal(nomeParaAviso("Maria\n  Souza​"), "Maria Souza", "uma linha, sem invisível");
  assert.equal(nomeParaAviso("Promo em www.golpe.com"), "nome omitido (tinha um link)");
  assert.equal(nomeParaAviso("x".repeat(200)).length, 80, "teto de caracteres");
  assert.equal(nomeParaAviso("Contato do Instagram"), "nome não informado");
  assert.equal(nomeParaAviso(null), "nome não informado");

  assert.deepEqual(
    semIdentidadeDoInstagram({ instagram_id: "990000000000001", " Instagram_Usuario ": "x", cidade: "Itajaí" }),
    { cidade: "Itajaí" },
    "captação pública não traz identidade do Instagram",
  );
  const usuarioCom = (modulo: string) => ({ modulos: new Map([[modulo, "todos"]]), permissoes: { [modulo]: { criar: true, editar: true, excluir: false } } }) as unknown as Parameters<typeof falaPelaMarca>[0];
  assert.equal(falaPelaMarca(usuarioCom("meta")), true);
  assert.equal(falaPelaMarca(usuarioCom("chat")), false);
  assert.equal(falaPelaMarca(null), false);
  const leituraMeta = { modulos: new Map([["meta", "todos"]]), permissoes: {} } as unknown as Parameters<typeof falaPelaMarca>[0];
  assert.equal(falaPelaMarca(leituraMeta), false, "Meta em leitura não configura a IA");
  assert.equal(falaPelaMarca(leituraMeta, "criar"), false, "Meta em leitura não publica respostas");

  assert.throws(() => conferirDestinoInstagram(BLOQUEADO), /bloqueado/);
  conferirDestinoInstagram(LIBERADO);
  assert.throws(() => conferirDestinoInstagram(LIBERADO, true), /público.*bloqueado/, "resposta pública nunca fora da produção");
  const lista = process.env.INSTAGRAM_SO_PARA;
  delete process.env.INSTAGRAM_SO_PARA;
  assert.throws(() => conferirDestinoInstagram(LIBERADO), /bloqueado/, "sem a variável, o dev não envia nada");
  process.env.VERCEL_ENV = "production";
  conferirDestinoInstagram(BLOQUEADO); // na produção a trava não existe
  conferirDestinoInstagram(BLOQUEADO, true);
  delete process.env.VERCEL_ENV;
  process.env.INSTAGRAM_SO_PARA = lista;
}

async function parteEntrada() {
  passo("webhook: assinatura, object, conta fora de PERFIS, ids não numéricos");
  const corpo = dm(LIBERADO, "mid.9900.x", "oi");
  assert.equal((await webhook(corpo, { assinatura: "sha256=errada" })).status, 401);
  assert.equal((await webhook(corpo, { segredo: "" })).status, 503);
  assert.equal((await webhook({ ...corpo, object: "page" })).status, 200);
  assert.equal((await webhook(dm(LIBERADO, "mid.9900.y", "oi", Date.now(), CONTA_ALHEIA))).status, 200);
  assert.equal((await webhook(dm("abc", "mid.9900.z", "oi"))).status, 200);
  assert.equal((await webhook(comentario({ id: "abc", midia: MIDIA_1, autor: AUTOR_4, usuario: "x", texto: "oi" }))).status, 200);
  assert.equal((await webhook(comentario({ id: com(99), midia: "12ab", autor: AUTOR_4, usuario: "x", texto: "oi" }))).status, 200);
  // Lote acima do limite do zod: 200, nada gravado (e no log só a contagem).
  assert.equal((await webhook({ object: "instagram", entry: Array.from({ length: 201 }, () => ({ id: CONTA })) })).status, 200);
  assert.equal(await contato(LIBERADO), undefined, "nada disso pode ter criado contato");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM instagram_comentarios WHERE midia_id LIKE '9900%' OR comentario_id = ${com(99)}`;
  assert.equal(n, 0, "nem comentário");
  assert.equal(graph.length, 0, "nem chamada à Meta");
}

async function parteDirect() {
  passo("direct: contato pelo IGSID, idempotência, envio, eco, trava, janela, áudio");
  await webhook(dm(LIBERADO, "mid.9900.1", "Olá, vi o post"));
  await webhook(dm(LIBERADO, "mid.9900.1", "Olá, vi o post"));
  const c = await contato(LIBERADO);
  assert.ok(c, "contato criado pelo IGSID");
  assert.equal(c.nome, "Pessoa Teste 001", "nome veio do perfil do Instagram");
  assert.equal(c.campos.instagram_usuario, "teste_001");
  assert.equal(c.ia, null, "contato do Instagram nasce sem IA");
  const at = await conversa(LIBERADO);
  assert.equal(at.status, "na_fila");
  let msgs = await mensagensDe(at.id);
  assert.equal(msgs.length, 1, "o mesmo evento duas vezes vira UMA mensagem");
  assert.equal(modelo.length, 0, "sem IA no contato, nenhum modelo chamado");

  const enviada = await enviarTextoNaConversa({ atendimentoId: at.id, texto: "Resposta de teste", autorId: null, enviadaPor: "crm" });
  assert.equal(enviada.erro, undefined, enviada.erro);
  const envio = postsGraph("messages").at(-1)!;
  assert.equal(envio.url.pathname.split("/")[2], PERFIL.paginaId, "sai pela página da conta");
  assert.deepEqual(envio.corpo, { recipient: { id: LIBERADO }, message: { text: "Resposta de teste" } });
  assert.equal(envio.url.search, "", "o texto vai no corpo, nunca na URL");
  msgs = await mensagensDe(at.id);
  const nossa = msgs.find((m) => m.id === enviada.mensagemId)!;
  assert.equal(nossa.status, "enviado");

  await webhook(eco(LIBERADO, nossa.id_externo, "Resposta de teste"));
  assert.equal((await mensagensDe(at.id)).length, 2, "eco casado pelo mid não duplica");
  await webhook(eco(LIBERADO, "mid.9900.celular", "mandei pelo celular"));
  const celular = (await mensagensDe(at.id)).find((m) => m.id_externo === "mid.9900.celular");
  assert.equal(celular?.enviada_por, "aparelho", "eco sem par vira 'aparelho' depois da espera");

  assert.equal((await enviarTextoNaConversa({ atendimentoId: at.id, texto: "x".repeat(1001), autorId: null, enviadaPor: "crm" })).erro?.includes("1.000"), true);
  const audio = await enviarAudioNaConversa({ atendimentoId: at.id, texto: "oi", enviadaPor: "ia" });
  assert.match(audio.erro ?? "", /áudio/);
  assert.equal(audio.registrada, undefined, "áudio recusado antes de gravar");

  await webhook(dm(BLOQUEADO, "mid.9900.2", "oi"));
  const atBloq = await conversa(BLOQUEADO);
  const antes = postsGraph("messages").length;
  const bloq = await enviarTextoNaConversa({ atendimentoId: atBloq.id, texto: "não pode sair", autorId: null, enviadaPor: "crm" });
  assert.match(bloq.erro ?? "", /bloqueado/);
  assert.equal(bloq.registrada, true);
  assert.equal(postsGraph("messages").length, antes, "a trava barra antes da Meta");
  await assert.rejects(enviarDirect(PERFIL, "abc", "x"), /inválido/, "IGSID não numérico");

  await webhook(dm(VELHO, "mid.9900.3", "oi de ontem", Date.now() - 25 * 3600_000));
  const atVelho = await conversa(VELHO);
  const fechada = await enviarTextoNaConversa({ atendimentoId: atVelho.id, texto: "oi", autorId: null, enviadaPor: "crm" });
  assert.match(fechada.erro ?? "", /janela de 24h/);
  assert.equal(fechada.registrada, undefined);
}

async function parteComentarios(iaId: string) {
  passo("IA de comentário: regra, raiz, recente, reserva, ordem direct → público");
  await recusa(salvarRegraIa(CONTA_ALHEIA, MIDIA_1, iaId, true), /Conta/);
  await recusa(salvarRegraIa(CONTA, "12ab", iaId, true), /Postagem inválida/);
  await recusa(salvarRegraIa(CONTA, MIDIA_FORA, iaId, true), /desta conta/);
  await recusa(salvarRegraIa(CONTA, MIDIA_1, "nao-e-uuid", true), /IA inválida/);
  await salvarRegraIa(CONTA, MIDIA_1, iaId, true);
  await salvarRegraIa(CONTA, MIDIA_3, iaId, true);

  // C1: raiz, novo, recente, com regra → responde (como na produção, para a frase pública sair).
  await emProducao(() => webhook(comentario({ id: com(1), midia: MIDIA_1, autor: AUTOR_IA, usuario: "autor_ia", texto: "Quero saber mais!" })));
  const c1 = await linha(com(1));
  const [reserva] = await respostasDaIa(com(1));
  assert.equal(reserva?.envio, "enviado", reserva?.erro);
  assert.equal(reserva.texto, "Oi @autor_ia, te chamei no direct! 😉", "frase aprovada, escolhida pelo modelo");
  assert.ok(reserva.comentario_id && /^\d+$/.test(reserva.comentario_id));
  assert.equal(c1.direct_por, "ia");
  const pedidoIa = modelo.at(-1)!;
  assert.match(JSON.stringify(pedidoIa.messages), /<<<dado_do_cliente>>>Quero saber mais!/, "comentário vai como dado");
  assert.equal((pedidoIa.tools as unknown[]).length, 1, "sem outra ferramenta");
  const iDirect = graph.findIndex((g) => g.metodo === "POST" && (g.corpo?.recipient as { comment_id?: string })?.comment_id === com(1));
  const iPublico = graph.findIndex((g) => g.metodo === "POST" && g.url.pathname.endsWith(`/${com(1)}/replies`));
  assert.ok(iDirect >= 0 && iPublico > iDirect, "o direct sai antes da frase pública");
  assert.equal(graph[iPublico].url.searchParams.has("message"), false, "texto público no corpo");
  assert.equal(graph[iPublico].corpo?.message, reserva.texto);
  const cIa = await contato(AUTOR_IA);
  assert.ok(cIa, "contato nasce do direct, com o IGSID que a Meta devolveu");
  assert.equal(cIa.ia, true);
  assert.equal(cIa.ia_id, iaId, "IA da regra no contato nascido do Instagram");
  assert.equal(c1.contato_id, cIa.id);
  const atIa = await conversa(AUTOR_IA);
  const abertura = (await mensagensDe(atIa.id))[0];
  assert.equal(abertura.enviada_por, "ia");
  assert.equal(abertura.texto, "Oi! Que bom te ver por aqui. Me conta o que você procura?");

  // O mesmo evento de novo: nada (o INSERT não inseriu).
  const [m0, g0] = [modelo.length, graph.length];
  await webhook(comentario({ id: com(1), midia: MIDIA_1, autor: AUTOR_IA, usuario: "autor_ia", texto: "Quero saber mais!" }));
  assert.equal(modelo.length, m0, "evento repetido não chama o modelo");
  assert.equal(graph.length, g0, "nem a Meta");
  assert.equal((await respostasDaIa(com(1))).length, 1);

  // Resposta (não raiz), comentário velho, segunda vez do mesmo autor na postagem.
  await webhook(comentario({ id: com(2), midia: MIDIA_1, autor: AUTOR_IA, usuario: "autor_ia", texto: "Mais uma dúvida", pai: com(1) }));
  await webhook(comentario({ id: com(3), midia: MIDIA_1, autor: AUTOR_3, usuario: "autor_tres", texto: "Quero também", time: agoraS() - 20 * 60 }));
  await webhook(comentario({ id: com(5), midia: MIDIA_1, autor: AUTOR_IA, usuario: "autor_ia", texto: "Outro comentário meu" }));
  assert.equal(modelo.length, m0, "resposta, comentário velho e 2º do mesmo autor não chamam o modelo");
  assert.ok(await linha(com(3)), "o velho é gravado");
  assert.equal((await respostasDaIa(com(5))).length, 0, "uma resposta da IA por autor por postagem");

  // Comentário de uma das NOSSAS contas: da_conta, 'aparelho', sem IA.
  await webhook(comentario({ id: com(4), midia: MIDIA_1, autor: OUTRA_CONTA, usuario: PERFIS[0].instagram, texto: "Que lindo!" }));
  const c4 = await linha(com(4));
  assert.equal(c4.da_conta, true);
  assert.equal(c4.enviada_por, "aparelho");

  // Link, menção, só emoji, postagem sem regra, oculto pela Meta.
  await webhook(comentario({ id: com(6), midia: MIDIA_1, autor: AUTOR_4, usuario: "autor_quatro", texto: "veja www.golpe.com" }));
  await webhook(comentario({ id: com(7), midia: MIDIA_1, autor: ig(20), usuario: "x", texto: "@amigo olha isso" }));
  await webhook(comentario({ id: com(8), midia: MIDIA_1, autor: ig(21), usuario: "y", texto: "😍🔥" }));
  await webhook(comentario({ id: com(9), midia: MIDIA_2, autor: ig(22), usuario: "z", texto: "Quero saber" }));
  ocultos.add(com(11));
  await webhook(comentario({ id: com(11), midia: MIDIA_1, autor: AUTOR_5, usuario: "autor_cinco", texto: "Quero saber" }));
  // Evento novo de comentário que a Meta diz ser de dias atrás (reentrega): gravado, sem IA.
  antigosNaMeta.add(com(70));
  await webhook(comentario({ id: com(70), midia: MIDIA_1, autor: ig(23), usuario: "antigo_na_meta", texto: "Quero saber" }));
  assert.equal(modelo.length, m0, "nenhum desses chama o modelo");
  for (const n of [6, 7, 8, 9]) assert.equal((await respostasDaIa(com(n))).length, 0, `sem reserva em ${com(n)}`);
  // Oculto e antigo na Meta: a leitura na Meta vem DEPOIS da reserva (conta no
  // teto), e a reserva termina descartada, sem modelo e sem envio.
  for (const [n, porque] of [[11, /oculto/], [70, /antigo/]] as const) {
    const r = await respostasDaIa(com(n));
    assert.equal(r.length, 1, `uma reserva em ${com(n)}`);
    assert.equal(r[0].envio, "descartado");
    assert.match(r[0].erro, porque);
  }

  passo("IA de comentário: não responder, trava no direct, filtro de saída, ia já definida");
  await webhook(comentario({ id: com(12), midia: MIDIA_1, autor: AUTOR_6, usuario: "autor_seis", texto: "isso é uma ofensa" }));
  const [descartada] = await respostasDaIa(com(12));
  assert.equal(descartada.envio, "descartado");
  assert.equal(graph.some((g) => g.metodo === "POST" && (g.url.pathname.includes(com(12)) || (g.corpo?.recipient as { comment_id?: string })?.comment_id === com(12))), false);

  await webhook(comentario({ id: com(13), midia: MIDIA_1, autor: BLOQ_2, usuario: "bloqueado", texto: "Quero" }));
  const [travada] = await respostasDaIa(com(13));
  assert.equal(travada.envio, "erro");
  assert.match(travada.erro, /bloqueado/);
  assert.equal((await linha(com(13))).direct_em, null, "reserva do direct desfeita");
  assert.equal(postsGraph("replies").some((g) => g.url.pathname.includes(com(13))), false, "sem direct, sem frase pública");
  assert.equal(await contato(BLOQ_2), undefined, "contato só nasce com direct");

  await emProducao(() =>
    webhook(comentario({ id: com(14), midia: MIDIA_1, autor: AUTOR_7, usuario: "autor_sete", texto: "quero detalhes abertura-ruim" })),
  );
  const [frase14] = await respostasDaIa(com(14));
  assert.equal(frase14.texto, "Oi @autor_sete! Te mandei os detalhes no direct.");
  const at7 = await conversa(AUTOR_7);
  assert.equal((await mensagensDe(at7.id))[0].texto, ABERTURA_FIXA, "abertura reprovada no filtro vira a fixa");

  passo("fora da produção: o direct sai (INSTAGRAM_SO_PARA), a frase pública não");
  const [p0, d0] = [postsGraph("replies").length, postsGraph("messages").length];
  await webhook(comentario({ id: com(18), midia: MIDIA_1, autor: AUTOR_DEV, usuario: "autor_dev", texto: "Quero saber mais" }));
  const [dev] = await respostasDaIa(com(18));
  assert.equal(dev.envio, "erro");
  assert.match(dev.erro, /público.*bloqueado/);
  assert.equal(postsGraph("messages").length, d0 + 1, "o direct saiu para quem está na lista");
  assert.equal(postsGraph("replies").length, p0, "nenhuma resposta pública no dev");
  await assert.rejects(responderEmPublico(PERFIL, com(18), AUTOR_DEV, "oi"), /público.*bloqueado/, "nem para IGSID liberado");

  passo("gente primeiro: IA desligada, conversa com dono ou com a equipe, comentário já respondido");
  const m2 = modelo.length;
  await webhook(dm(AUTOR_9, "mid.9900.9", "oi antes"));
  await sql`UPDATE contatos SET ia = false WHERE campos ? 'instagram_id' AND campos->>'instagram_id' = ${AUTOR_9}`;
  await webhook(comentario({ id: com(16), midia: MIDIA_1, autor: AUTOR_9, usuario: "autor_nove", texto: "Quero saber" }));
  assert.equal((await respostasDaIa(com(16))).length, 0, "IA desligada à mão: nem reserva");
  assert.equal((await contato(AUTOR_9)).ia, false);

  await webhook(dm(COM_DONO, "mid.9900.dono", "oi"));
  const [usuarioDono] = await sql`SELECT id FROM usuarios WHERE ativo ORDER BY data_criacao LIMIT 1`;
  await sql`UPDATE atendimentos SET responsavel_id = ${usuarioDono.id} WHERE id = ${(await conversa(COM_DONO)).id}`;
  await webhook(comentario({ id: com(19), midia: MIDIA_1, autor: COM_DONO, usuario: "com_dono", texto: "Quero saber" }));
  assert.equal((await respostasDaIa(com(19))).length, 0, "conversa com dono: a IA não entra");

  await webhook(dm(COM_EQUIPE, "mid.9900.equipe", "oi"));
  const falou = await enviarTextoNaConversa({ atendimentoId: (await conversa(COM_EQUIPE)).id, texto: "Oi, aqui é a equipe", autorId: null, enviadaPor: "crm" });
  assert.equal(falou.erro, undefined, falou.erro);
  await webhook(comentario({ id: com(20), midia: MIDIA_1, autor: COM_EQUIPE, usuario: "com_equipe", texto: "Quero saber" }));
  assert.equal((await respostasDaIa(com(20))).length, 0, "equipe falou na última hora: a IA não entra");

  // Uma das nossas contas responde antes de a IA rodar (o eco espera 5 s).
  await webhook(comentario({ id: com(21), midia: MIDIA_1, autor: RESPONDIDO, usuario: "respondido", texto: "Quero saber" }), { rodarDepois: false });
  await webhook(comentario({ id: com(22), midia: MIDIA_1, autor: OUTRA_CONTA, usuario: PERFIS[0].instagram, texto: "Te chamei!", pai: com(21) }));
  await responderComentarioComIa((await linha(com(21))).id);
  assert.equal((await respostasDaIa(com(21))).length, 0, "já respondido por uma das nossas contas: a IA não entra");
  assert.equal(modelo.length, m2, "nenhum desses chamou o modelo");

  passo("IA de comentário: duas chamadas ao mesmo tempo, uma reserva");
  await webhook(comentario({ id: com(15), midia: MIDIA_3, autor: AUTOR_8, usuario: "autor_oito", texto: "Quero saber mais" }), { rodarDepois: false });
  const c15 = await linha(com(15));
  const [m1, d1, p1] = [modelo.length, postsGraph("messages").length, postsGraph("replies").length];
  await emProducao(() =>
    Promise.all([responderComentarioComIa(c15.id), responderComentarioComIa(c15.id), responderComentarioComIa(c15.id)]),
  );
  assert.equal((await respostasDaIa(com(15))).length, 1, "uma reserva");
  assert.equal(modelo.length, m1 + 1, "um modelo");
  assert.equal(postsGraph("messages").length, d1 + 1, "um direct");
  assert.equal(postsGraph("replies").length, p1 + 1, "uma frase pública");

  passo("teto por hora conta as reservas descartadas, e a Meta só é lida depois da reserva");
  // 20 = TETO_POR_HORA de lib/ia/comentarios.ts. Enchimento descartado, numa mídia de teste.
  await sql`
    INSERT INTO instagram_comentarios
      (conta_id, midia_id, pai_id, autor_id, autor_usuario, texto, da_conta, enviada_por, envio, para_autor_id, lido_em, erro)
    SELECT ${CONTA}, ${ig(150)}, ${"99000000"} || lpad(g::text, 7, '0'), ${CONTA}, ${PERFIL.instagram}, '', true,
           'ia', 'descartado', ${ig(26)}, now(), 'enchimento do teste'
      FROM generate_series(1, 20) g`;
  const [m3, g3] = [modelo.length, graph.length];
  await webhook(comentario({ id: com(23), midia: MIDIA_1, autor: NO_TETO, usuario: "no_teto", texto: "Quero saber" }));
  assert.equal((await respostasDaIa(com(23))).length, 0, "acima do teto: sem reserva");
  assert.equal(modelo.length, m3, "sem modelo");
  assert.equal(graph.length, g3, "nem leitura na Meta");
  await sql`DELETE FROM instagram_comentarios WHERE midia_id = ${ig(150)}`;
}

async function parteDirectComIa() {
  passo("IA de atendimento segue no direct (espera ~8 s)");
  const antes = postsGraph("messages").length;
  await webhook(dm(AUTOR_IA, "mid.9900.ia-1", "Quanto custa?"));
  const pedido = modelo.at(-1)!;
  const sistema = JSON.stringify(pedido.system);
  assert.match(sistema, /DIRECT DO INSTAGRAM/);
  assert.match(sistema, /CONTEÚDO NÃO CONFIÁVEL/);
  const conteudo = JSON.stringify(pedido.messages);
  assert.match(conteudo, /Canal: Instagram \(direct\)/);
  assert.match(conteudo, /<<<dado_do_cliente>>>Quanto custa\?/);
  assert.equal(postsGraph("messages").length, antes + 1, "a IA respondeu pelo direct");
  const ultima = (await mensagensDe((await conversa(AUTOR_IA)).id)).at(-1)!;
  assert.equal(ultima.enviada_por, "ia");
  assert.equal(ultima.texto, "Oi! Como posso te ajudar?");
}

async function parteAvisos(fabricio: string) {
  passo("aviso à equipe no Instagram vira DEMANDA: pediu atendimento (espera ~8 s) e reunião");
  // AUTOR_7 está com a IA ligada (direct aberto pela IA de comentário), sem
  // oportunidade e sem dono na conversa: o aviso vai para a lista da reunião.
  const at7 = await conversa(AUTOR_7);
  await webhook(dm(AUTOR_7, "mid.9900.pede", "quero falar com alguém"));
  const pedidos = (await demandasDe(at7.id)).filter((d) => d.titulo === TITULO_PEDIDO);
  assert.ok(pedidos.length >= 1, "demanda do pedido de atendimento criada");
  const pedido = pedidos.find((d) => d.responsavel_id === fabricio) ?? pedidos[0];
  assert.match(pedido.descricao, /^Nome no Instagram: Pessoa Teste 011\nQuando: .+\(horário de Brasília\)\nConversa: https:\/\/.+\/chat\?atendimento=/);
  assert.equal(pedido.prazo, hojeEmBrasilia(), "prazo hoje (Brasília)");
  assert.equal(pedido.prioridade, "alta");
  assert.equal(pedido.criado_por, null, "criada pelo sistema");
  assert.equal((await contato(AUTOR_7)).ia, false, "passou para humano: a IA sai do contato");
  const [h] = await sql`
    SELECT descricao FROM historico WHERE contato_id = ${(await contato(AUTOR_7)).id}
       AND descricao LIKE 'IA passou o atendimento para a equipe%' ORDER BY data_criacao DESC LIMIT 1`;
  assert.match(h.descricao, /demanda criada para/);

  const atIa = await conversa(AUTOR_IA);
  const inicio = new Date(Date.now() + 26 * 3600_000);
  await paraTesteAvisos.avisarReuniao(atIa.id, (await situacao(atIa.id))!, { inicio, meet: null }, null);
  const reunioes = (await demandasDe(atIa.id)).filter((d) => d.titulo === TITULO_REUNIAO);
  assert.ok(reunioes.some((d) => d.responsavel_id === fabricio), "demanda da reunião para quem está em AVISAR_REUNIAO");
  assert.match(reunioes[0].descricao, /Quando: .+\(horário de Brasília\)\nConversa: https:\/\/.+\/chat\?atendimento=/);
  assert.equal(reunioes[0].prazo, hojeEmBrasilia());
  const [hr] = await sql`
    SELECT descricao FROM historico WHERE contato_id = ${(await contato(AUTOR_IA)).id}
       AND descricao LIKE 'Aviso da reunião à equipe%' ORDER BY data_criacao DESC LIMIT 1`;
  assert.match(hr.descricao, /demanda criada para/);
}

async function parteEquipe(usuarioId: string) {
  passo("equipe: resposta pública (só na produção), direct, segundo direct recusado, trava");
  const c3 = await linha(com(3));
  await recusa(responderComentarioPelaEquipe(c3.id, "Obrigado!", "publico", usuarioId), /público.*bloqueado/);
  await emProducao(() => responderComentarioPelaEquipe(c3.id, "Obrigado pelo comentário!", "publico", usuarioId));
  const publica = postsGraph("replies").at(-1)!;
  assert.ok(publica.url.pathname.endsWith(`/${com(3)}/replies`));
  const nossas = await sql`SELECT envio FROM instagram_comentarios WHERE pai_id = ${com(3)} AND enviada_por = 'crm' ORDER BY data_criacao`;
  assert.deepEqual(nossas.map((n) => n.envio), ["erro", "enviado"], "a do dev ficou com erro; a da produção saiu");

  await responderComentarioPelaEquipe(c3.id, "Oi! Te chamei aqui.", "direct", usuarioId);
  const at3 = await conversa(AUTOR_3);
  assert.equal(at3.responsavel_id, usuarioId, "chamar no direct é assumir");
  assert.equal((await mensagensDe(at3.id))[0].enviada_por, "crm");

  await webhook(comentario({ id: com(17), midia: MIDIA_1, autor: AUTOR_3, usuario: "autor_tres", texto: "Outra pergunta", time: agoraS() - 20 * 60 }));
  await recusa(responderComentarioPelaEquipe((await linha(com(17))).id, "Oi de novo", "direct", usuarioId), /já foi chamada/);

  const c2 = await linha(com(2));
  await emProducao(() => responderComentarioPelaEquipe(c2.id, "Respondendo a resposta", "publico", usuarioId));
  assert.ok(postsGraph("replies").at(-1)!.url.pathname.endsWith(`/${com(1)}/replies`), "resposta a resposta vai ao comentário de cima");

  await recusa(responderComentarioPelaEquipe((await linha(com(13))).id, "Oi", "publico", usuarioId), /bloqueado/);
  await recusa(responderComentarioPelaEquipe("00000000-0000-0000-0000-000000000000", "Oi", "publico", usuarioId), /não encontrado/);
}

async function parteBuscaETela() {
  passo("busca de comentários (sem IA), leitura da tela, contagens");
  const m0 = modelo.length;
  assert.deepEqual(await sincronizarComentarios(CONTA, MIDIA_2), { novos: 3 }, "dois visíveis + um nosso; o oculto fica de fora");
  assert.deepEqual(await sincronizarComentarios(CONTA, MIDIA_2), { novos: 0 });
  paginarBusca = true;
  assert.deepEqual(await sincronizarComentarios(CONTA, MIDIA_2), { novos: 2 }, "percorre páginas de raízes e respostas");
  assert.equal((await linha(com(85))).pai_id, com(80));
  assert.deepEqual(await sincronizarComentarios(CONTA, MIDIA_2), { novos: 0 }, "paginação é idempotente");
  paginarBusca = false;
  assert.equal(modelo.length, m0, "busca não chama a IA");
  assert.equal((await linha(com(83))).enviada_por, "aparelho");
  assert.equal(await linha(com(82)), undefined);
  await recusa(sincronizarComentarios(CONTA, MIDIA_FORA), /desta conta/);

  const tela = await carregarComentariosDaConta(PERFIL, MIDIA_1, true);
  assert.equal(tela.podeAdministrar, true);
  assert.equal(tela.erro, null);
  const post1 = tela.postagens.find((p) => p.id === MIDIA_1)!;
  assert.ok(post1.naoLidos > 0);
  assert.ok(tela.regras.some((r) => r.midiaId === MIDIA_1 && r.ligada));
  const ids = tela.comentarios.map((c) => c.comentarioId);
  assert.ok(ids.includes(com(1)) && ids.includes(com(3)));
  const daIa = tela.comentarios.filter((c) => c.enviadaPor === "ia");
  assert.ok(daIa.length >= 1 && daIa.every((c) => c.daConta && c.lido));
  assert.equal(tela.comentarios.some((c) => c.paiId === com(12) && c.enviadaPor === "ia"), false, "descartada não aparece");
  assert.equal(tela.comentarios.some((c) => c.paiId === com(13) && c.enviadaPor === "ia"), false, "com erro não aparece");
  assert.ok(tela.comentarios.find((c) => c.comentarioId === com(1))!.atendimentoId, "link para o direct do autor");

  const naoLidos = (await naoLidosPorConta()).get(CONTA) ?? 0;
  const assinatura = await assinaturaDosComentarios();
  await marcarComentariosLidos(CONTA, MIDIA_1, tela.comentarios.map((c) => c.id));
  assert.equal((await carregarComentariosDaConta(PERFIL, null, false)).postagens.find((p) => p.id === MIDIA_1)!.naoLidos, 0);
  assert.ok(((await naoLidosPorConta()).get(CONTA) ?? 0) < naoLidos);
  assert.notEqual(await assinaturaDosComentarios(), assinatura, "a assinatura do /api/chat/versao muda");

  await salvarRegraIa(CONTA, MIDIA_3, null, false);
  assert.equal((await carregarComentariosDaConta(PERFIL, null, true)).regras.some((r) => r.midiaId === MIDIA_3), false, "iaId null apaga");

  // A carga do /chat na aba Direct (a de comentários lê a sessão, e é a de cima).
  const chat = await carregarChat({ canal: CONTA, atendimentoId: (await conversa(AUTOR_IA)).id, aba: "direct", postagemId: null });
  assert.equal(chat.aba, "direct");
  assert.equal(chat.instagram, null);
  assert.ok(chat.conversas.length >= 5 && chat.conversas.every((c) => c.canal === "instagram" && c.numero_instancia === CONTA),
    "conta do Instagram filtra por igualdade exata de numero_instancia");
  assert.equal(chat.aberta?.resumo.canal, "instagram");
  const canalIg = chat.canais.find((c) => c.chave === CONTA)!;
  assert.equal(canalIg.tipo, "instagram");
  assert.equal(canalIg.numero, `@${PERFIL.instagram}`);
  assert.ok(canalIg.naoLidas > 0 && typeof canalIg.comentariosNaoLidos === "number");
  assert.equal(chat.canais.filter((c) => c.tipo === "instagram").length, PERFIS.length);
  const outro = await carregarChat({ canal: `55479${CONTA.slice(-8)}`, atendimentoId: null });
  assert.equal(outro.conversas.some((c) => c.canal === "instagram"), false, "telefone com o mesmo fim não puxa o Instagram");
}

async function partePaginacao() {
  passo("histórico paginado: raízes preservadas, leitura somente do que foi exibido");
  const midia = ig(104);
  const raiz = com(900);
  const filho = com(901);
  await sql`
    INSERT INTO instagram_comentarios (conta_id, midia_id, comentario_id, autor_id, texto, data_criacao)
    VALUES (${CONTA}, ${midia}, ${raiz}, ${ig(14)}, 'Raiz antiga', now() - interval '10 days')`;
  await sql`
    INSERT INTO instagram_comentarios (conta_id, midia_id, comentario_id, pai_id, autor_id, texto, data_criacao)
    VALUES (${CONTA}, ${midia}, ${filho}, ${raiz}, ${ig(15)}, 'Resposta recente', now())`;
  await sql`
    INSERT INTO instagram_comentarios (conta_id, midia_id, comentario_id, autor_id, texto, data_criacao)
    SELECT ${CONTA}, ${midia}, '990088' || n::text, ${ig(14)}, 'Histórico ' || n::text,
           now() - n * interval '1 minute'
      FROM generate_series(1, 140) n`;
  const primeira = await paginaDeComentarios(CONTA, midia);
  assert.equal(primeira.temMais, true);
  assert.equal(primeira.comentarios.length, 101, "100 recentes e o ancestral fora da página");
  assert.ok(primeira.comentarios.some((c) => c.comentarioId === raiz));
  assert.ok(primeira.comentarios.some((c) => c.comentarioId === filho && c.paiId === raiz));
  await marcarComentariosLidos(CONTA, midia, primeira.comentarios.map((c) => c.id));
  const [{ restantes }] = await sql`SELECT count(*)::int AS restantes FROM instagram_comentarios
    WHERE conta_id = ${CONTA} AND midia_id = ${midia} AND lido_em IS NULL`;
  assert.equal(restantes, 41, "não marca os comentários não carregados");
  const segunda = await paginaDeComentarios(CONTA, midia, primeira.antes);
  assert.equal(segunda.temMais, false);
  const todos = new Set([...primeira.comentarios, ...segunda.comentarios].map((c) => c.id));
  assert.equal(todos.size, 142, "histórico completo sem perder a raiz");
  assert.equal((await paginaDeComentarios(PERFIS.find((p) => p.instagramId !== CONTA)!.instagramId, midia, primeira.antes)).comentarios.length, 0,
    "cursor de outra conta não abre dados");
  const alheio = await linha(com(1));
  await sql`UPDATE instagram_comentarios SET lido_em = NULL WHERE id = ${alheio.id}`;
  await marcarComentariosLidos(CONTA, midia, [alheio.id]);
  assert.equal((await linha(com(1))).lido_em, null, "leitura não atravessa a postagem");
}

async function parteAnexo() {
  passo("anexo do direct: só host da Meta, redirecionamento conferido, teto");
  try {
    const ok = await baixarAnexoInstagram("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=9900", 1024);
    assert.equal(ok.bytes.byteLength, 3);
    assert.equal(ok.mime, "image/jpeg");
    await assert.rejects(baixarAnexoInstagram("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=fora", 1024), /fora dos endereços/);
    await assert.rejects(baixarAnexoInstagram("https://scontent.cdninstagram.com/v/grande.jpg", 1024), /teto/);
    await assert.rejects(baixarAnexoInstagram("https://scontent.cdninstagram.com/v/a.pdf", 1024), /tipo não aceito/);
    await assert.rejects(baixarAnexoInstagram("https://evil.example.com/x.jpg", 1024), /fora dos endereços/);
  } catch (e) {
    if (/Não encontrei o endereço/.test(String(e))) {
      console.log("  (pulado: sem DNS para conferir os hosts da Meta)");
      return;
    }
    throw e;
  }
}

// ── Principal ───────────────────────────────────────────────────────────────

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  // Nada de credencial real: a rede é falsa, mas nem o token de verdade sai daqui.
  process.env.META_SYSTEM_USER_TOKEN = "token-de-teste";
  process.env.ANTHROPIC_API_KEY = "chave-de-teste";
  process.env.IA_COMENTARIOS_MODELO = "modelo-de-teste";
  delete process.env.VERCEL_ENV;
  process.env.INSTAGRAM_SO_PARA = LIBERADOS.join(",");
  globalThis.fetch = fetchFalso as typeof fetch;

  const [ia] = await sql`SELECT id FROM ias ORDER BY data_criacao LIMIT 1`;
  const [usuario] = await sql`SELECT id FROM usuarios WHERE ativo ORDER BY data_criacao LIMIT 1`;
  if (!ia || !usuario) throw new Error("o DEV precisa ter ao menos uma IA e um usuário ativo");
  // O aviso por demanda vai para AVISAR_REUNIAO (lib/ia/atendente.ts); no DEV, o Fabrício recebe.
  const FABRICIO = "79003fab-577d-467c-a71e-13f198d73a82";
  if (!(await pessoasParaDemanda()).some((p) => p.id === FABRICIO)) {
    throw new Error("o DEV precisa do usuário de AVISAR_REUNIAO com o módulo Demandas para conferir o aviso");
  }

  await limpar(); // sobra de uma rodada que caiu no meio
  try {
    partePura();
    await parteEntrada();
    await parteDirect();
    await parteComentarios(ia.id as string);
    await parteDirectComIa();
    await parteAvisos(FABRICIO);
    await parteEquipe(usuario.id as string);
    await parteBuscaETela();
    await partePaginacao();
    await parteAnexo();
    console.log(`\nOK: canal de Instagram conferido (${graph.length} chamadas à Graph falsa, ${modelo.length} ao modelo falso).`);
  } finally {
    await limpar();
    const [{ n }] = await sql`
      SELECT (SELECT count(*) FROM instagram_comentarios WHERE midia_id LIKE '9900%')
           + (SELECT count(*) FROM instagram_ia_regras WHERE midia_id LIKE '9900%')
           + (SELECT count(*) FROM contatos WHERE campos ? 'instagram_id' AND campos->>'instagram_id' LIKE '9900%') AS n`;
    const [{ d }] = await sql`
      SELECT count(*)::int AS d FROM demandas WHERE id = ANY(string_to_array(${[...demandasCriadas].join(",")}, ',')::uuid[])`;
    console.log(`limpeza: ${n} linha(s) de teste restando; ${d} de ${demandasCriadas.size} demanda(s) de aviso restando`);
    globalThis.fetch = fetchOriginal;
    await sql.end();
  }
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
