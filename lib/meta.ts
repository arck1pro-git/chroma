import "server-only";
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
  insights?: { data?: Array<{
    spend?: string; impressions?: string; reach?: string; clicks?: string;
    ctr?: string; cpc?: string; cpm?: string;
    actions?: Array<{ action_type: string; value: string }>;
  }> };
};

export async function permissoesMeta() {
  const r = await requisicao<{ data: Array<{ permission: string; status: string }> }>("me/permissions");
  return r.data.filter((p) => p.status === "granted").map((p) => p.permission);
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

export async function contasDeAnuncios(): Promise<ContaAnunciosMeta[]> {
  return listarMeta("me/adaccounts", { fields: "id,name,account_status,currency,timezone_name,business", limit: "100" });
}

export async function campanhasDeAnuncios(contaId: string): Promise<CampanhaAdsMeta[]> {
  if (!/^act_\d+$/.test(contaId)) throw new ErroMeta("Conta de anúncios inválida.", undefined, 400);
  return listarMeta(`${contaId}/campaigns`, {
    fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,insights.date_preset(last_30d){spend,impressions,reach,clicks,ctr,cpc,cpm,actions}", limit: "100",
  });
}

// A navegação do filtro usa o cadastro completo, inclusive anúncios sem
// veiculação recente, em vez de depender dos insights dos últimos 30 dias.
export async function estruturaCampanhaAds(id: string) {
  if (!/^\d+$/.test(id)) throw new ErroMeta("Campanha inválida.", undefined, 400);
  const [conjuntos, anuncios] = await Promise.all([
    listarMeta<{id:string;name:string}>(`${id}/adsets`, {fields:"id,name",limit:"100"}),
    listarMeta<{id:string;name:string;adset_id:string}>(`${id}/ads`, {fields:"id,name,adset_id",limit:"100"}),
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
  const r = await requisicao<{ data: TelefoneMeta[] }>(`${wabaId}/phone_numbers`, {
    params: { fields: "id,display_phone_number,verified_name,quality_rating", limit: "100" },
  });
  return r.data;
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
