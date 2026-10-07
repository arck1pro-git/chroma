import "server-only";
import { after } from "next/server";
import { conferirDestino } from "@/lib/destino-permitido";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class ErroMeta extends Error {
  constructor(
    message: string,
    public readonly codigo?: number,
    public readonly status = 502,
  ) {
    super(message);
  }
}

function token(): string {
  const valor = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!valor) throw new ErroMeta("META_SYSTEM_USER_TOKEN não configurado.", undefined, 503);
  return valor;
}

export async function requisicao<T>(
  caminho: string,
  opcoes: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, string>; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const url = new URL(`${GRAPH}/${caminho.replace(/^\//, "")}`);
  for (const [chave, valor] of Object.entries(opcoes.params ?? {})) {
    if (valor) url.searchParams.set(chave, valor);
  }
  const resposta = await fetch(url, {
    method: opcoes.method ?? "GET",
    headers: {
      Authorization: `Bearer ${opcoes.accessToken || token()}`,
      ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await resposta.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_user_msg?: string };
  } & T;
  if (!resposta.ok || json.error) {
    const mensagem = json.error?.error_user_msg || json.error?.message || `Meta respondeu ${resposta.status}.`;
    throw new ErroMeta(mensagem, json.error?.code, resposta.status >= 500 ? 502 : resposta.status);
  }
  return json;
}

export type ContaAnunciosMeta = {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
  business?: { id: string; name: string };
};

export type CampanhaAdsMeta = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
};

/**
 * Guardadas como as contas para LER (mostrar ou esconder um botão). Antes de
 * uma ESCRITA, `fresca`: permissão revogada há cinco minutos não pode passar
 * na conferência só porque estava guardada.
 */
export async function permissoesMeta(fresca = false) {
  const { valor } = await lembrar("me/permissions", VALIDADE_CADASTRO, async () => {
    const r = await requisicao<{ data: Array<{ permission: string; status: string }> }>("me/permissions");
    return r.data.filter((p) => p.status === "granted").map((p) => p.permission);
  }, fresca);
  return valor;
}

export async function listarMeta<T>(caminho: string, params: Record<string,string>, accessToken?: string): Promise<T[]> {
  const dados: T[] = [];
  let after: string | undefined;
  const cursores = new Set<string>();
  do {
    const pagina = await requisicao<{data:T[];paging?:{next?:string;cursors?:{after?:string}}}>(caminho, {params:{...params,...(after?{after}:{})}, accessToken});
    dados.push(...pagina.data);
    after = pagina.paging?.next ? pagina.paging.cursors?.after : undefined;
    if (after && cursores.has(after)) throw new ErroMeta("A Meta repetiu a página de resultados.");
    if (after) cursores.add(after);
  } while(after);
  return dados;
}

// ── Leituras guardadas ──────────────────────────────────────────────────────
//
// POR QUE EXISTE: até 2026-10-07 a tela de Campanhas ia à Meta em cascata e sem
// guardar nada — o status (contas, permissões, WhatsApp, templates) e depois
// mais dez chamadas do relatório. Eram 8 a 10 s até o primeiro número, a cada
// abertura e a cada troca de período.
//
// COMO FUNCIONA: guarda a PROMESSA, não só o resultado, então duas telas pedindo
// a mesma leitura no mesmo instante esperam UMA ida à Meta. Dentro de
// `fresco`, devolve o guardado. Depois disso, até `velho`, devolve o guardado
// NA HORA e busca de novo por trás — quem pediu não espera, e o próximo já
// recebe o novo. Passado `velho`, espera a Meta. Falha não fica guardada.
// `forcar` (o botão Atualizar) vai à Meta e espera.
//
// EM MEMÓRIA, POR INSTÂNCIA: na Vercel cada instância quente tem o seu, e uma
// fria começa vazia. O cache de `fetch` do Next não serve aqui — as rotas são
// `force-dynamic`, que desliga esse cache, e o substituto (Cache Components)
// mudaria a renderização do app inteiro. É o mesmo arranjo de
// lib/campanha-do-lead.ts e lib/meta-eventos.ts.

export const MINUTO = 60_000;
export type Validade = { fresco: number; velho: number };

/** Contas, permissões e WhatsApp: muda quando alguém mexe no Business Manager. */
export const VALIDADE_CADASTRO: Validade = { fresco: 10 * MINUTO, velho: 60 * MINUTO };

type Guardado = { em: number; valor: Promise<unknown>; renovando: boolean };
const guardados = new Map<string, Guardado>();
// Teto de chaves: cada período escolhido na tela é uma chave nova, e sem teto a
// memória da instância cresceria a cada combinação de datas.
const TETO_GUARDADOS = 300;

function guardar(chave: string, valor: Promise<unknown>) {
  guardados.delete(chave); // reinserir põe no fim: o Map vira fila do mais velho ao mais novo
  guardados.set(chave, { em: Date.now(), valor, renovando: false });
  while (guardados.size > TETO_GUARDADOS) guardados.delete(guardados.keys().next().value!);
  valor.catch(() => {
    if (guardados.get(chave)?.valor === valor) guardados.delete(chave);
  });
}

/**
 * A leitura `buscar`, guardada sob `chave`. Devolve também QUANDO o valor saiu
 * da Meta — é o "atualizado há 3 min" da tela.
 */
export async function lembrar<T>(
  chave: string,
  validade: Validade,
  buscar: () => Promise<T>,
  forcar = false,
): Promise<{ valor: T; em: number }> {
  const atual = guardados.get(chave);
  const idade = atual ? Date.now() - atual.em : Infinity;

  if (!forcar && atual && idade < validade.velho) {
    if (idade >= validade.fresco && !atual.renovando) {
      atual.renovando = true;
      // Por trás: só troca o guardado quando o novo chegar inteiro. O after()
      // segura a instância viva até lá; fora de uma requisição (script) roda solto.
      const renovacao = buscar().then(
        (v) => guardar(chave, Promise.resolve(v)),
        () => { atual.renovando = false; },
      );
      try { after(renovacao); } catch { void renovacao; }
    }
    return { valor: (await atual.valor) as T, em: atual.em };
  }

  const valor = buscar();
  guardar(chave, valor);
  return { valor: await valor, em: Date.now() };
}

/** listarMeta guardado. A chave é o caminho mais os parâmetros, em ordem. */
export async function listarGuardado<T>(
  caminho: string,
  params: Record<string, string>,
  validade: Validade,
  forcar = false,
): Promise<{ valor: T[]; em: number }> {
  const chave = `${caminho}?${new URLSearchParams(Object.entries(params).sort()).toString()}`;
  return lembrar(chave, validade, () => listarMeta<T>(caminho, params), forcar);
}

export async function contasDeAnuncios(): Promise<ContaAnunciosMeta[]> {
  return (await listarGuardado<ContaAnunciosMeta>("me/adaccounts", { fields: "id,name,account_status,currency,timezone_name,business", limit: "100" }, VALIDADE_CADASTRO)).valor;
}

// As pílulas de campanha do Dashboard: só nome e situação. Até 2026-10-07 isto
// trazia junto os insights de 30 dias de cada campanha, que ninguém lia — e
// era a parte lenta da chamada.
export async function campanhasDeAnuncios(contaId: string): Promise<CampanhaAdsMeta[]> {
  if (!/^act_\d+$/.test(contaId)) throw new ErroMeta("Conta de anúncios inválida.", undefined, 400);
  return (await listarGuardado<CampanhaAdsMeta>(`${contaId}/campaigns`, { fields: "id,name,status,effective_status", limit: "100" }, VALIDADE_CADASTRO)).valor;
}

// A navegação do filtro usa o cadastro completo, inclusive anúncios sem
// veiculação recente, em vez de depender dos insights dos últimos 30 dias.
export async function estruturaCampanhaAds(id: string) {
  if (!/^\d+$/.test(id)) throw new ErroMeta("Campanha inválida.", undefined, 400);
  const [{ valor: conjuntos }, { valor: anuncios }] = await Promise.all([
    listarGuardado<{id:string;name:string}>(`${id}/adsets`, {fields:"id,name",limit:"100"}, VALIDADE_CADASTRO),
    listarGuardado<{id:string;name:string;adset_id:string}>(`${id}/ads`, {fields:"id,name,adset_id",limit:"100"}, VALIDADE_CADASTRO),
  ]);
  return {grupos:conjuntos.map(c=>({id:c.id,nome:c.name,anuncios:anuncios.filter(a=>a.adset_id===c.id).map(a=>({id:a.id,nome:a.name}))}))};
}

type InsightAds = {
  date_start?:string; ad_id?:string; ad_name?:string; adset_id?:string; adset_name?:string;
  spend?:string; clicks?:string; ctr?:string; actions?:Array<{action_type:string;value:string}>;
};
const leadsDoInsight = (i: InsightAds) => Number(i.actions?.find(a=>a.action_type === "lead")?.value ?? 0);
const linhaDoInsight = (i: InsightAds, id: string, nome: string) => ({id,nome,gasto:Number(i.spend??0),cliques:Number(i.clicks??0),ctr:Number(i.ctr??0),leads:leadsDoInsight(i)});

export async function detalhesCampanhaAds(id:string) {
  if (!/^\d+$/.test(id)) throw new ErroMeta("Campanha inválida.", undefined, 400);
  const params = {date_preset:"last_30d",limit:"100"};
  const [dias, conjuntos, anuncios] = await Promise.all([
    listarMeta<InsightAds>(`${id}/insights`, {...params,fields:"date_start,actions",time_increment:"1"}),
    listarMeta<InsightAds>(`${id}/insights`, {...params,level:"adset",fields:"adset_id,adset_name,spend,clicks,ctr,actions"}),
    listarMeta<InsightAds>(`${id}/insights`, {...params,level:"ad",fields:"ad_id,ad_name,adset_id,spend,clicks,ctr,actions"}),
  ]);
  return {
    leads:dias.map(i=>({dia:(i.date_start??"").split("-").reverse().slice(0,2).join("/"),leads:leadsDoInsight(i)})),
    grupos:conjuntos.map(i=>({...linhaDoInsight(i,i.adset_id!,i.adset_name!),anuncios:anuncios.filter(a=>a.adset_id===i.adset_id).map(a=>linhaDoInsight(a,a.ad_id!,a.ad_name!))})),
  };
}

export type WabaMeta = { id: string; name: string; currency?: string; timezone_id?: string };
export type TelefoneMeta = { id: string; display_phone_number: string; verified_name: string; quality_rating?: string };
export type TemplateMeta = {
  id: string; name: string; language: string; status: string; category: string;
  quality_score?: { score?: string };
  components: Array<Record<string, unknown>>;
};

export async function wabasMeta(): Promise<WabaMeta[]> {
  return (await lembrar("whatsapp/wabas", VALIDADE_CADASTRO, buscarWabas)).valor;
}

async function buscarWabas(): Promise<WabaMeta[]> {
  const r = await requisicao<{ data: WabaMeta[] }>("me/assigned_whatsapp_business_accounts", {
    params: { fields: "id,name,currency,timezone_id", limit: "100" },
  });
  if (r.data.length > 0) return r.data;

  // Usuários de sistema administradores podem enxergar a WABA como ativo do
  // Business Manager sem que o atalho /me/assigned_* devolva a relação. Nesse
  // caso o negócio ainda aparece na conta de anúncios atribuída. Descobrir por
  // essa aresta evita exigir META_BUSINESS_ID manual e reflete o que o painel
  // da Meta mostra em “ativos atribuídos”.
  const contas = await contasDeAnuncios();
  const negocios = [...new Set(contas.map((c) => c.business?.id).filter((id): id is string => Boolean(id)))];
  const porNegocio = await Promise.all(
    negocios.map(async (negocioId) => {
      const [proprias, clientes] = await Promise.all([
        requisicao<{ data: WabaMeta[] }>(`${negocioId}/owned_whatsapp_business_accounts`, {
          params: { fields: "id,name,currency,timezone_id", limit: "100" },
        }),
        requisicao<{ data: WabaMeta[] }>(`${negocioId}/client_whatsapp_business_accounts`, {
          params: { fields: "id,name,currency,timezone_id", limit: "100" },
        }),
      ]);
      return [...proprias.data, ...clientes.data];
    }),
  );
  return [...new Map(porNegocio.flat().map((w) => [w.id, w])).values()];
}

export async function telefonesMeta(wabaId: string): Promise<TelefoneMeta[]> {
  const { valor } = await lembrar(`whatsapp/${wabaId}/telefones`, VALIDADE_CADASTRO, async () => {
    const r = await requisicao<{ data: TelefoneMeta[] }>(`${wabaId}/phone_numbers`, {
      params: { fields: "id,display_phone_number,verified_name,quality_rating", limit: "100" },
    });
    return r.data;
  });
  return valor;
}

export async function templatesMeta(wabaId: string): Promise<TemplateMeta[]> {
  const r = await requisicao<{ data: TemplateMeta[] }>(`${wabaId}/message_templates`, {
    params: { fields: "id,name,language,status,category,quality_score,components", limit: "250" },
  });
  return r.data;
}

export async function criarTemplateMeta(wabaId: string, entrada: {
  name: string; language: string; category: "MARKETING" | "UTILITY";
  components: Array<Record<string, unknown>>;
}) {
  return requisicao<{ id: string; status: string; category: string }>(`${wabaId}/message_templates`, {
    method: "POST", body: entrada,
  });
}

export async function enviarTemplateMeta(telefoneId: string, entrada: {
  to: string; name: string; language: string;
  components?: Array<Record<string, unknown>>;
}) {
  // No dev, só para os números liberados (lib/destino-permitido.ts).
  conferirDestino(entrada.to);
  return requisicao<{ messages?: Array<{ id: string }> }>(`${telefoneId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: entrada.to.replace(/\D/g, ""),
      type: "template",
      template: {
        name: entrada.name,
        language: { code: entrada.language },
        ...(entrada.components?.length ? { components: entrada.components } : {}),
      },
    },
  });
}

// ── Conversa pela API oficial (o /chat) ─────────────────────────────────────
//
// Texto livre só vale DENTRO da janela de 24h aberta pela última mensagem do
// contato; fora dela a Meta recusa com 131047 e o único caminho é template.
// Quem confere a janela antes de chamar é app/chat/actions.ts — aqui é só o
// transporte.

export async function enviarTextoMeta(telefoneId: string, para: string, corpo: string) {
  conferirDestino(para);
  return requisicao<{ messages?: Array<{ id: string }> }>(`${telefoneId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: para.replace(/\D/g, ""),
      type: "text",
      text: { body: corpo, preview_url: true },
    },
  });
}

export type TipoMidiaMeta = "image" | "video" | "audio" | "document";

/**
 * Sobe o arquivo para a Meta e devolve o id da mídia. É por id, e não por link,
 * que o anexo da biblioteca sai: o link exigiria deixar o documento público
 * para a Meta baixar, e a biblioteca é acervo atrás de login.
 */
export async function subirMidiaMeta(
  telefoneId: string,
  bytes: Uint8Array,
  mime: string,
  arquivoNome: string,
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([new Uint8Array(bytes)] as BlobPart[], { type: mime }), arquivoNome);
  const resposta = await fetch(`${GRAPH}/${telefoneId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}` },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await resposta.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string; code?: number; error_user_msg?: string };
  };
  if (!resposta.ok || json.error || !json.id) {
    throw new ErroMeta(
      json.error?.error_user_msg || json.error?.message || `Upload na Meta respondeu ${resposta.status}.`,
      json.error?.code,
    );
  }
  return json.id;
}

export async function enviarMidiaMeta(
  telefoneId: string,
  para: string,
  tipo: TipoMidiaMeta,
  midiaId: string,
  opcoes: { legenda?: string; arquivoNome?: string } = {},
) {
  conferirDestino(para);
  const midia: Record<string, string> = { id: midiaId };
  // Áudio não aceita legenda na Cloud API — mandar derruba o envio inteiro.
  if (opcoes.legenda && tipo !== "audio") midia.caption = opcoes.legenda;
  if (tipo === "document" && opcoes.arquivoNome) midia.filename = opcoes.arquivoNome;
  return requisicao<{ messages?: Array<{ id: string }> }>(`${telefoneId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: para.replace(/\D/g, ""),
      type: tipo,
      [tipo]: midia,
    },
  });
}

/**
 * Bytes de uma mídia RECEBIDA. O webhook traz só o id; a URL sai de GET /{id},
 * vale poucos minutos e também exige o token — não dá para guardar a URL e
 * baixar depois, como se faz com a da uazapi.
 */
export async function baixarMidiaMeta(midiaId: string): Promise<{ bytes: Uint8Array; mime: string | null }> {
  const info = await requisicao<{ url?: string; mime_type?: string }>(midiaId);
  if (!info.url) throw new ErroMeta("A Meta não devolveu a URL da mídia.");
  const resposta = await fetch(info.url, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!resposta.ok) throw new ErroMeta(`O download da mídia na Meta respondeu ${resposta.status}.`);
  return {
    bytes: new Uint8Array(await resposta.arrayBuffer()),
    mime: info.mime_type ?? resposta.headers.get("content-type"),
  };
}

/** A foto de perfil do número (a que o cliente vê). URL assinada: expira. */
export async function fotoDoTelefoneMeta(telefoneId: string): Promise<string | null> {
  const r = await requisicao<{ data?: Array<{ profile_picture_url?: string }> }>(
    `${telefoneId}/whatsapp_business_profile`,
    { params: { fields: "profile_picture_url" } },
  );
  return r.data?.[0]?.profile_picture_url || null;
}

export function respostaErroMeta(e: unknown): Response {
  const erro = e instanceof ErroMeta ? e : new ErroMeta(e instanceof Error ? e.message : "Falha ao falar com a Meta.");
  return Response.json({ erro: erro.message, codigo: erro.codigo }, { status: erro.status });
}
