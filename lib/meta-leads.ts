// Leads dos formulários instantâneos da Meta (Lead Ads) entrando no CRM.
//
// PEDIDO DELE (2026-10-08): "integrar os formulários da Meta de campanhas de
// anúncio — formulários da AMAAN", e depois, no mesmo dia, o fluxo: "escolher o
// formulário, mapear os campos e escolher o que vira no lead, definir se entra
// em uma etapa, se entra em um segmento — e que seja um módulo à parte"
// (app/formularios).
//
// O DESENHO, sem tabela nova (escolha dele):
//
// · CADA FORMULÁRIO CONFIGURADO é uma webhook do mesmo motor da captação do
//   site, com o slug `formularios-meta-<id do formulário>`
//   (slugDoFormulario). Os campos dela dizem o que cada pergunta vira; a ação
//   "criar lead", em que funil e etapa o card nasce e de quem ele é; a ação de
//   segmento, onde o contato entra. O lead passa pela MESMA máquina do lead do
//   site (processarLead), então herda o resto: contato sem duplicar, cadência
//   da etapa, evento da Meta da etapa. Essas webhooks não aparecem no módulo
//   Webhooks — são do módulo Formulários Meta.
//
// · FORMULÁRIO SEM CONFIGURAÇÃO (ou pausado) NÃO TRAZ LEAD — e não perde: o
//   lead fica na Meta, e o "Buscar leads agora" do módulo o traz depois.
//
// · DOIS CAMINHOS de chegada, porque lead perdido é dinheiro perdido:
//   1. o webhook `leadgen` da Meta (app/api/meta/leads/webhook), na hora;
//   2. a VARREDURA (varrerLeadsDaMeta), de 5 em 5 minutos pelo n8n, que lê
//      os leads recentes de cada formulário configurado pela API. Ela cobre o
//      webhook que falhou e também o app que ainda está em modo de
//      desenvolvimento na Meta (que não entrega webhook de lead real), porque
//      só depende da permissão leads_retrieval do token do CRM.
//
// · O MESMO LEAD NÃO ENTRA DUAS VEZES: o `leadgen_id` vai no payload, e o
//   payload fica gravado em webhook_recebimentos. Antes de processar, confere
//   se já há recebimento com ele. A varredura ainda deixa de fora o lead dos
//   últimos 2 minutos, que é a janela do webhook.
//
// · ATRIBUIÇÃO EXATA: o lead da Meta traz campanha, conjunto e anúncio. Vão
//   para os campos do contato como campaign_id/adset_id/ad_id — as chaves que
//   o painel de campanhas e o filtro do quadro já leem pelo ID
//   (lib/meta-ads-calculos.ts). Nada de deduzir pelo nome.
//
// · Pergunta marcada como "só guardar na ficha" não tem linha de campo: vai
//   para os campos do contato com a chave dela (guardarNaoMapeados). É o que a
//   IA mostra como "Respostas do formulário" (respostasDoLead em
//   lib/ia/atendente.ts).
import "server-only";
import { sql } from "./db";
import { ErroMeta, listarMeta, requisicao } from "./meta";
import { processarLead, type ResultadoRecepcao } from "./webhooks-recepcao";
import {
  acharWorkflowPorNome,
  ativarWorkflow,
  criarWorkflow,
  type WorkflowMotor,
} from "./automacoes/motores/n8n/adaptador";
import { garantirCredencialDoCrm } from "./campanhas-workflow";

/** O começo do slug das webhooks de formulário da Meta. */
export const PREFIXO_FORMULARIO = "formularios-meta-";

export function slugDoFormulario(formId: string): string {
  return `${PREFIXO_FORMULARIO}${formId}`;
}

/** O id do formulário dentro do slug, ou null se o slug não é de formulário. */
export function formularioDoSlug(slug: string): string | null {
  return slug.startsWith(PREFIXO_FORMULARIO) ? slug.slice(PREFIXO_FORMULARIO.length) : null;
}

/** O que se pede à Meta de cada lead. */
const CAMPOS_DO_LEAD =
  "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic";

/** A janela que a varredura deixa para o webhook. */
const JANELA_DO_WEBHOOK_MS = 2 * 60_000;

type Pagina = { id: string; name: string; access_token?: string };
type FormularioBruto = {
  id: string;
  name: string;
  status: string;
  leads_count?: number;
  created_time?: string;
  questions?: Array<{ key: string; label?: string; type?: string; options?: Array<{ key?: string; value?: string }> }>;
};
export type LeadMeta = {
  id: string;
  created_time?: string;
  field_data?: Array<{ name: string; values?: unknown[] }>;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
};

// ── A configuração de cada formulário ───────────────────────────────────────

export type ConfiguracaoDoFormulario = { webhookId: string; ativo: boolean };

/** Os formulários configurados no CRM, pelo id do formulário. */
export async function configuracoesDosFormularios(): Promise<Map<string, ConfiguracaoDoFormulario>> {
  const linhas = await sql`
    SELECT id, slug, ativo FROM webhooks WHERE slug LIKE ${PREFIXO_FORMULARIO + "%"}`;
  const mapa = new Map<string, ConfiguracaoDoFormulario>();
  for (const l of linhas) {
    const formId = formularioDoSlug(l.slug as string);
    if (formId) mapa.set(formId, { webhookId: l.id as string, ativo: l.ativo as boolean });
  }
  return mapa;
}

async function configuracaoDoFormulario(formId: string): Promise<ConfiguracaoDoFormulario | null> {
  const [w] = await sql`SELECT id, ativo FROM webhooks WHERE slug = ${slugDoFormulario(formId)}`;
  return w ? { webhookId: w.id as string, ativo: w.ativo as boolean } : null;
}

async function jaRecebido(leadgenId: string): Promise<boolean> {
  const [r] = await sql`
    SELECT 1 FROM webhook_recebimentos
     WHERE payload->>'leadgen_id' = ${leadgenId} LIMIT 1`;
  return Boolean(r);
}

// ── Páginas e formulários na Meta ───────────────────────────────────────────

/** As páginas que o token do CRM gerencia, já com o token de cada uma. */
async function paginas(): Promise<Pagina[]> {
  return listarMeta<Pagina>("me/accounts", { fields: "id,name,access_token", limit: "100" });
}

async function tokenDaPagina(paginaId: string): Promise<{ token: string; nome: string }> {
  const p = await requisicao<{ access_token?: string; name?: string }>(paginaId, {
    params: { fields: "access_token,name" },
  });
  if (!p.access_token) throw new ErroMeta("A Meta não devolveu o token da página.");
  return { token: p.access_token, nome: p.name ?? "" };
}

export type FormularioMeta = {
  id: string;
  nome: string;
  status: string;
  /** Quantos leads a Meta diz que o formulário já recebeu. */
  leads: number | null;
  criadoEm: string | null;
  pagina: { id: string; nome: string };
};

/** Todos os formulários instantâneos das páginas do token, do mais novo ao mais velho. */
export async function formulariosDaMeta(): Promise<FormularioMeta[]> {
  const todos: FormularioMeta[] = [];
  for (const p of await paginas()) {
    if (!p.access_token) continue;
    const forms = await listarMeta<FormularioBruto>(
      `${p.id}/leadgen_forms`,
      { fields: "id,name,status,leads_count,created_time", limit: "100" },
      p.access_token,
    );
    for (const f of forms) {
      todos.push({
        id: f.id,
        nome: f.name,
        status: f.status,
        leads: f.leads_count ?? null,
        criadoEm: f.created_time ?? null,
        pagina: { id: p.id, nome: p.name },
      });
    }
  }
  return todos.sort((a, b) => (b.criadoEm ?? "").localeCompare(a.criadoEm ?? ""));
}

export type PerguntaMeta = {
  /** A chave como chega no lead, já normalizada (chaveDaPergunta). */
  chave: string;
  /** O texto da pergunta, como o lead viu. */
  rotulo: string;
  /** FULL_NAME, EMAIL, PHONE, CITY, CUSTOM… */
  tipo: string;
  /** As alternativas, quando a pergunta é de múltipla escolha. */
  opcoes: string[];
};

/** Um formulário com as perguntas dele. Procura em cada página do token. */
export async function formularioComPerguntas(
  formId: string,
): Promise<(FormularioMeta & { perguntas: PerguntaMeta[] }) | null> {
  if (!/^\d+$/.test(formId)) return null;
  for (const p of await paginas()) {
    if (!p.access_token) continue;
    const f = await requisicao<FormularioBruto>(formId, {
      params: { fields: "id,name,status,leads_count,created_time,questions" },
      accessToken: p.access_token,
    }).catch(() => null);
    if (!f?.id) continue;
    const perguntas: PerguntaMeta[] = (f.questions ?? []).map((q) => ({
      chave: chaveDaPergunta(q.key),
      rotulo: q.label?.trim() || q.key,
      tipo: q.type ?? "CUSTOM",
      opcoes: (q.options ?? []).map((o) => o.value ?? o.key ?? "").filter(Boolean),
    }));
    // Nome e sobrenome separados: o lead chega também com `full_name` montado
    // (payloadDoLead), e é ESSE que dá para mandar para o nome do contato.
    const chaves = new Set(perguntas.map((q) => q.chave));
    if (!chaves.has("full_name") && (chaves.has("first_name") || chaves.has("last_name"))) {
      perguntas.unshift({ chave: "full_name", rotulo: "Nome completo (nome + sobrenome)", tipo: "FULL_NAME", opcoes: [] });
    }
    return {
      id: f.id,
      nome: f.name,
      status: f.status,
      leads: f.leads_count ?? null,
      criadoEm: f.created_time ?? null,
      pagina: { id: p.id, nome: p.name },
      perguntas,
    };
  }
  return null;
}

/**
 * Pergunta (chave já normalizada) → chave da opção → texto da opção.
 *
 * POR QUE EXISTE: na múltipla escolha, a Meta entrega a CHAVE da opção que a
 * pessoa marcou ("entre_r$_100_mil_e_r$_200_mil", "em_até_3_meses"), e não o
 * texto que ela viu. Foi o que o lead de teste de 2026-10-08 mostrou. Sem a
 * tradução, isso ia para a ficha e para a IA.
 */
export type OpcoesDoFormulario = Map<string, Map<string, string>>;

// Nome e opções do formulário vêm numa chamada à parte; guardados por
// instância, porque uma campanha manda dezenas de leads do mesmo formulário.
// Formulário editado na Meta depois disso: a instância nova (ou o deploy)
// relê. Opção nova sem tradução cai no fallback — a chave como veio.
const infoDeFormulario = new Map<string, { nome: string | null; opcoes: OpcoesDoFormulario }>();

async function infoDoFormulario(
  formId: string,
  token: string,
): Promise<{ nome: string | null; opcoes: OpcoesDoFormulario }> {
  const guardado = infoDeFormulario.get(formId);
  if (guardado) return guardado;
  const f = await requisicao<FormularioBruto>(formId, { params: { fields: "name,questions" }, accessToken: token }).catch(
    () => null,
  );
  const opcoes: OpcoesDoFormulario = new Map();
  for (const q of f?.questions ?? []) {
    const mapa = new Map<string, string>();
    for (const o of q.options ?? []) if (o.key && o.value) mapa.set(o.key, o.value);
    if (mapa.size) opcoes.set(chaveDaPergunta(q.key), mapa);
  }
  const info = { nome: f?.name ?? null, opcoes };
  if (f) infoDeFormulario.set(formId, info);
  return info;
}

// ── O lead como payload ─────────────────────────────────────────────────────

/**
 * A chave de uma pergunta do formulário, no formato que um campo de webhook
 * aceita (letras sem acento, números e _). A Meta gera chaves como
 * "qual_valor_você_pretende_investir?" para as perguntas personalizadas.
 */
export function chaveDaPergunta(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * O lead da Meta achatado no mesmo formato de um envio do site: uma chave por
 * pergunta (full_name, phone_number, email e as personalizadas) e, ao lado, a
 * origem — campanha, conjunto, anúncio e formulário, por ID e por nome.
 */
export function payloadDoLead(
  lead: LeadMeta,
  extras: { formulario?: string | null; pagina?: string | null; opcoes?: OpcoesDoFormulario } = {},
): Record<string, unknown> {
  const respostas: Record<string, string> = {};
  for (const campo of lead.field_data ?? []) {
    const chave = chaveDaPergunta(campo.name);
    const textos = extras.opcoes?.get(chave);
    const valor = (campo.values ?? [])
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      // A chave da opção vira o texto dela; o que não for opção fica como veio.
      .map((v) => textos?.get(v) ?? v)
      .join(", ");
    if (chave && valor) respostas[chave] = valor;
  }
  // Formulário com nome e sobrenome separados: o CRM tem um nome só.
  if (!respostas.full_name && (respostas.first_name || respostas.last_name)) {
    respostas.full_name = [respostas.first_name, respostas.last_name].filter(Boolean).join(" ");
  }

  const origem: Record<string, unknown> = {
    leadgen_id: lead.id,
    form_id: lead.form_id,
    form_name: extras.formulario ?? undefined,
    page_name: extras.pagina ?? undefined,
    campaign_id: lead.campaign_id,
    campaign_name: lead.campaign_name,
    adset_id: lead.adset_id,
    adset_name: lead.adset_name,
    ad_id: lead.ad_id,
    ad_name: lead.ad_name,
    // "fb" ou "ig": de qual das duas redes o formulário foi enviado.
    platform: lead.platform,
    is_organic: lead.is_organic,
    created_time: lead.created_time,
  };
  for (const k of Object.keys(origem)) if (origem[k] === undefined || origem[k] === "") delete origem[k];

  return { ...respostas, ...origem };
}

// ── Receber um lead ─────────────────────────────────────────────────────────

export type ResultadoLeadMeta =
  | { estado: "sem_recepcao" }
  | { estado: "repetido" }
  | { estado: "recebido"; recepcao: ResultadoRecepcao };

/**
 * Um lead, pelo id. `lead` já lido (a varredura lê em lote) evita ir à Meta de
 * novo; sem ele, busca pelo token da página. `formId` conhecido de antemão (o
 * aviso da Meta traz) permite desistir antes de ler o lead, se o formulário não
 * está configurado.
 */
export async function receberLeadDaMeta(
  leadgenId: string,
  origem: {
    paginaId?: string;
    formId?: string;
    lead?: LeadMeta;
    formulario?: string | null;
    pagina?: string | null;
    opcoes?: OpcoesDoFormulario;
  } = {},
): Promise<ResultadoLeadMeta> {
  let formId = origem.formId ?? origem.lead?.form_id;
  // Sem configuração (ou pausado), NÃO consome o lead: ele continua na Meta e
  // o "Buscar leads agora" o traz quando o formulário for configurado.
  if (formId) {
    const cfg = await configuracaoDoFormulario(formId);
    if (!cfg?.ativo) return { estado: "sem_recepcao" };
  }
  if (await jaRecebido(leadgenId)) return { estado: "repetido" };

  let lead = origem.lead;
  let formulario = origem.formulario ?? null;
  let pagina = origem.pagina ?? null;
  let opcoes = origem.opcoes;
  if (!lead) {
    if (!origem.paginaId) throw new ErroMeta("Lead sem página: não há como ler na Meta.");
    const { token, nome } = await tokenDaPagina(origem.paginaId);
    pagina = nome || pagina;
    lead = await requisicao<LeadMeta>(leadgenId, { params: { fields: CAMPOS_DO_LEAD }, accessToken: token });
    if (lead.form_id) {
      const info = await infoDoFormulario(lead.form_id, token);
      formulario = formulario ?? info.nome;
      opcoes = opcoes ?? info.opcoes;
    }
  }

  formId = formId ?? lead.form_id;
  const cfg = formId ? await configuracaoDoFormulario(formId) : null;
  if (!cfg?.ativo) return { estado: "sem_recepcao" };

  const recepcao = await processarLead(cfg.webhookId, payloadDoLead(lead, { formulario, pagina, opcoes }), {
    guardarNaoMapeados: true,
  });
  return { estado: "recebido", recepcao };
}

// ── Varredura ───────────────────────────────────────────────────────────────

export type ResultadoVarredura = {
  formularios: number;
  encontrados: number;
  novos: number;
  repetidos: number;
  erros: string[];
};

/**
 * Lê os leads das últimas `horas` dos formulários CONFIGURADOS e ligados e
 * recebe os que ainda não entraram. É a rede de segurança do webhook — e o
 * botão "Buscar leads agora" do módulo (com `soFormulario`, só um).
 */
export async function varrerLeadsDaMeta(horas = 24, soFormulario?: string): Promise<ResultadoVarredura> {
  const r: ResultadoVarredura = { formularios: 0, encontrados: 0, novos: 0, repetidos: 0, erros: [] };
  const configs = await configuracoesDosFormularios();
  const ligados = new Set([...configs].filter(([, c]) => c.ativo).map(([id]) => id));
  if (soFormulario) for (const id of [...ligados]) if (id !== soFormulario) ligados.delete(id);
  if (ligados.size === 0) return r;

  const desde = Math.floor(Date.now() / 1000) - horas * 3600;
  const recenteDemais = Date.now() - JANELA_DO_WEBHOOK_MS;

  for (const pagina of await paginas()) {
    if (!pagina.access_token) continue;
    let formularios: FormularioBruto[] = [];
    try {
      formularios = await listarMeta<FormularioBruto>(
        `${pagina.id}/leadgen_forms`,
        { fields: "id,name,status", limit: "100" },
        pagina.access_token,
      );
    } catch (e) {
      r.erros.push(`${pagina.name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    for (const f of formularios.filter((f) => ligados.has(f.id))) {
      r.formularios++;
      const { opcoes } = await infoDoFormulario(f.id, pagina.access_token);
      let leads: LeadMeta[] = [];
      try {
        leads = await listarMeta<LeadMeta>(
          `${f.id}/leads`,
          {
            fields: CAMPOS_DO_LEAD,
            limit: "100",
            filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desde }]),
          },
          pagina.access_token,
        );
      } catch (e) {
        r.erros.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const lead of leads) {
        if (lead.created_time && Date.parse(lead.created_time) > recenteDemais) continue;
        r.encontrados++;
        try {
          const feito = await receberLeadDaMeta(lead.id, {
            lead,
            formId: f.id,
            formulario: f.name,
            pagina: pagina.name,
            opcoes,
          });
          if (feito.estado === "recebido") r.novos++;
          else if (feito.estado === "repetido") r.repetidos++;
        } catch (e) {
          r.erros.push(`lead ${lead.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  return r;
}

// ── Estado da integração ────────────────────────────────────────────────────

export type EstadoIntegracaoMeta = {
  appId: string | null;
  /** O app tem a assinatura "page → leadgen" apontando para este CRM. */
  webhookDoApp: { ligado: boolean; callback: string | null };
  /** Cada página e se o app está inscrito nela para o campo leadgen. */
  paginas: Array<{ id: string; nome: string; inscrita: boolean }>;
  /** O agendador da varredura existe e está ligado no n8n. null = não deu para saber. */
  varredura: boolean | null;
  erros: string[];
};

async function appDoToken(): Promise<string | null> {
  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!token) return null;
  const r = await requisicao<{ data?: { app_id?: string } }>("debug_token", { params: { input_token: token } });
  return r.data?.app_id ?? null;
}

function tokenDoApp(appId: string): string {
  const segredo = process.env.META_APP_SECRET?.trim();
  if (!segredo) throw new ErroMeta("META_APP_SECRET não configurado.", undefined, 503);
  return `${appId}|${segredo}`;
}

type AssinaturaApp = { object: string; callback_url: string; active: boolean; fields: Array<{ name: string }> };

async function assinaturaDePagina(appId: string): Promise<AssinaturaApp | null> {
  const r = await requisicao<{ data: AssinaturaApp[] }>(`${appId}/subscriptions`, { accessToken: tokenDoApp(appId) });
  return r.data.find((s) => s.object === "page") ?? null;
}

export async function estadoDaIntegracao(): Promise<EstadoIntegracaoMeta> {
  const estado: EstadoIntegracaoMeta = {
    appId: null,
    webhookDoApp: { ligado: false, callback: null },
    paginas: [],
    varredura: null,
    erros: [],
  };

  try {
    estado.appId = await appDoToken();
  } catch (e) {
    estado.erros.push(`App da Meta: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (estado.appId) {
    try {
      const a = await assinaturaDePagina(estado.appId);
      estado.webhookDoApp = {
        ligado: Boolean(a?.active && a.fields.some((f) => f.name === "leadgen")),
        callback: a?.callback_url ?? null,
      };
    } catch (e) {
      estado.erros.push(`Webhook do app: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    for (const p of await paginas()) {
      if (!p.access_token) {
        estado.erros.push(`${p.name}: sem token da página`);
        continue;
      }
      const apps = await requisicao<{ data: Array<{ id: string; subscribed_fields?: string[] }> }>(
        `${p.id}/subscribed_apps`,
        { accessToken: p.access_token },
      ).catch(() => ({ data: [] }));
      estado.paginas.push({
        id: p.id,
        nome: p.name,
        inscrita: apps.data.some((a) => a.id === estado.appId && (a.subscribed_fields ?? []).includes("leadgen")),
      });
    }
  } catch (e) {
    estado.erros.push(`Páginas: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const wf = await acharWorkflowPorNome(NOME_AGENDADOR_LEADS);
    estado.varredura = wf ? wf.active : false;
  } catch {
    estado.varredura = null; // n8n fora do ar: não dá para saber, não é "desligado"
  }

  return estado;
}

// ── Ligar o recebimento ─────────────────────────────────────────────────────

/** Nome fixo: é a chave de "já existe?" (acharWorkflowPorNome). */
export const NOME_AGENDADOR_LEADS = "[Chroma] Meta · buscar leads dos formulários";

function montarAgendador(crmBaseUrl: string, credencialId: string): WorkflowMotor {
  const gatilho = "De 5 em 5 minutos";
  const chamar = "Buscar leads da Meta";
  return {
    name: NOME_AGENDADOR_LEADS,
    settings: { executionOrder: "v1" },
    nodes: [
      {
        id: "gatilho",
        name: gatilho,
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } },
      },
      {
        id: "buscar",
        name: chamar,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          method: "POST",
          url: `${crmBaseUrl.replace(/\/+$/, "")}/api/meta/leads/varrer`,
          authentication: "genericCredentialType",
          genericAuthType: "httpHeaderAuth",
          options: { timeout: 300000, response: { response: { neverError: true } } },
        },
        credentials: { httpHeaderAuth: { id: credencialId, name: "Chroma · CRM (token de serviço)" } },
      },
    ],
    connections: { [gatilho]: { main: [[{ node: chamar, type: "main", index: 0 }]] } },
  };
}

/**
 * Liga as três peças, nesta ordem, e é idempotente (clicar de novo só refaz o
 * que faltar):
 *   1. a assinatura do APP no objeto "page", campo "leadgen", com o callback
 *      deste CRM — a Meta confere o callback na hora (GET com o desafio), então
 *      a rota precisa estar no ar neste endereço;
 *   2. a inscrição do app em cada PÁGINA, campo "leadgen";
 *   3. o agendador da varredura no n8n.
 *
 * Só pelo endereço público: o callback e o agendador apontam para ele, e um
 * "localhost" lá dentro não chega a lugar nenhum. Recusa também trocar uma
 * assinatura "page" que já aponte para OUTRO endereço — ela pode ser de outro
 * sistema, e sobrescrever derrubaria o de lá sem aviso.
 */
export async function ligarRecebimento(crmBaseUrl: string, publico: boolean): Promise<string[]> {
  if (!publico) {
    throw new ErroMeta(
      "Ligue pelo endereço de produção: o webhook e a varredura apontam para o endereço desta tela.",
      undefined,
      400,
    );
  }
  const base = crmBaseUrl.replace(/\/+$/, "");
  const callback = `${base}/api/meta/leads/webhook`;
  const feito: string[] = [];

  const appId = await appDoToken();
  if (!appId) throw new ErroMeta("Não achei o app da Meta do token do CRM.");
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!verifyToken) throw new ErroMeta("META_WEBHOOK_VERIFY_TOKEN não configurado.", undefined, 503);

  const atual = await assinaturaDePagina(appId);
  if (atual && atual.callback_url !== callback) {
    throw new ErroMeta(
      `O app já recebe eventos de página em outro endereço (${atual.callback_url}). Não troquei para não derrubar quem usa esse.`,
      undefined,
      409,
    );
  }
  if (!atual?.active || !atual.fields.some((f) => f.name === "leadgen")) {
    await requisicao(`${appId}/subscriptions`, {
      method: "POST",
      accessToken: tokenDoApp(appId),
      params: {
        object: "page",
        callback_url: callback,
        fields: "leadgen",
        verify_token: verifyToken,
        include_values: "true",
      },
    });
    feito.push("aviso de lead assinado no app da Meta");
  }

  for (const p of await paginas()) {
    if (!p.access_token) continue;
    const apps = await requisicao<{ data: Array<{ id: string; subscribed_fields?: string[] }> }>(
      `${p.id}/subscribed_apps`,
      { accessToken: p.access_token },
    );
    const meu = apps.data.find((a) => a.id === appId);
    if (meu?.subscribed_fields?.includes("leadgen")) continue;
    // Mantém os campos que o app já tivesse nesta página e acrescenta leadgen.
    const campos = [...new Set([...(meu?.subscribed_fields ?? []), "leadgen"])].join(",");
    await requisicao(`${p.id}/subscribed_apps`, {
      method: "POST",
      accessToken: p.access_token,
      params: { subscribed_fields: campos },
    });
    feito.push(`página ${p.name} inscrita`);
  }

  const wf = await acharWorkflowPorNome(NOME_AGENDADOR_LEADS);
  if (wf) {
    if (!wf.active) {
      await ativarWorkflow(wf.id);
      feito.push("varredura religada no n8n");
    }
  } else {
    const credencial = await garantirCredencialDoCrm();
    const id = await criarWorkflow(montarAgendador(base, credencial.id));
    await ativarWorkflow(id);
    feito.push("varredura criada no n8n (de 5 em 5 minutos)");
  }

  return feito;
}
