// O CUSTO das mensagens de template, como a Meta informa (pedido dele,
// 2026-10-28: "quero que metrifique gastos"). Só LÊ: as estatísticas de
// template da WABA (template_analytics, métricas COST e DELIVERED) dão, por
// template e por dia, o gasto e as entregas; o custo por entrega no período é o
// gasto somado ÷ as entregas somadas. Quem multiplica pelas entregas de uma
// campanha é lib/campanhas-metricas.ts.
//
//   GET /<WABA>/template_analytics?start=AAAA-MM-DD&end=AAAA-MM-DD
//       &granularity=DAILY&metric_types=["COST","DELIVERED"]&template_ids=[id,…]
//
// · Até 10 templates por pedido (lotes), e só os últimos 90 dias: o começo é
//   recortado em hoje − 89 dias (UTC), e o fim é amanhã à meia-noite UTC, que a
//   Meta usa como limite (ela ajusta start/end à meia-noite UTC).
// · O id do template sai da listagem da Graph (message_templates, campos
//   id,name,language), casado por nome + idioma, como a campanha guarda.
// · SEM ESTATÍSTICAS: a WABA que não confirmou as estatísticas de template
//   (is_enabled_for_insights) faz a Graph recusar. Ligar é um POST na WABA,
//   escrita na Meta e sem volta: NUNCA é feito daqui. SEM CUSTO: conta que
//   divide a linha de crédito de um parceiro recebe os pontos sem `cost`.
// · Guardado 1 h por WABA + ids + período (lembrar, de lib/meta.ts): a Meta
//   consolida o custo com atraso de horas, e a tela abre várias vezes.
// · Falha da Graph não lança: volta como situação, com o aviso para a tela.
import "server-only";
import { ErroMeta, lembrar, listarGuardado, listarMeta, MINUTO, requisicao, VALIDADE_CADASTRO, wabasMeta, type Validade } from "@/lib/meta";

export const DIAS_DE_CUSTO = 90;
const TEMPLATES_POR_PEDIDO = 10;
const DIA_MS = 24 * 60 * MINUTO;
const VALIDADE_CUSTO: Validade = { fresco: 60 * MINUTO, velho: 60 * MINUTO };

export type TemplateDoCusto = { nome: string; idioma: string };

export type CustoDosTemplates = {
  situacao: "ok" | "sem_estatisticas" | "sem_custo" | "erro";
  moeda: string | null;
  /** `nome|idioma` → custo por entrega no período; null quando a Meta não tem o dado daquele template. */
  custoPorEntrega: Map<string, number | null>;
  aviso: string | null;
  /** Quando os números saíram da Meta (ms). */
  em: number;
};

export const chaveDoTemplate = (t: TemplateDoCusto) => `${t.nome}|${t.idioma}`;

const dataUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** O período pedido à Meta: de `desde` (no máximo 90 dias para trás) até amanhã, em datas UTC. */
export function periodoDoCusto(desde: Date, agora = new Date()): { start: string; end: string } {
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  const limite = hoje - (DIAS_DE_CUSTO - 1) * DIA_MS;
  const inicio = Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate());
  return { start: dataUtc(Math.min(Math.max(inicio, limite), hoje)), end: dataUtc(hoje + DIA_MS) };
}

// ── Graph ───────────────────────────────────────────────────────────────────

type PontoMeta = {
  template_id?: string;
  delivered?: number;
  cost?: Array<{ type?: string; value?: number | string }>;
};

/** O que a Meta devolveu para os ids, somado no período. */
type LidoDaMeta = {
  /** Algum ponto trouxe `cost`: a conta recebe custo. */
  temCusto: boolean;
  entregues: number;
  porId: Record<string, number | null>;
  /** Quando a leitura terminou (ms). Guardado junto: o `em` do lembrar muda entre a 1ª leitura e as guardadas. */
  em: number;
};

/** id → nome|idioma dos templates da conta. Guardado como o cadastro: o id de um nome+idioma não muda. */
async function idsDosTemplates(wabaId: string): Promise<Map<string, string>> {
  const { valor } = await listarGuardado<{ id?: string; name?: string; language?: string }>(
    `${wabaId}/message_templates`,
    { fields: "id,name,language", limit: "250" },
    VALIDADE_CADASTRO,
  );
  const porChave = new Map<string, string>();
  for (const t of valor) {
    if (t.id && /^\d+$/.test(t.id) && t.name && t.language) porChave.set(chaveDoTemplate({ nome: t.name, idioma: t.language }), t.id);
  }
  return porChave;
}

const numero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Por template: gasto somado ÷ entregas somadas. Sem `amount_spent` (ou sem
 * entrega), o `cost_per_delivered` da Meta, ponderado pelas entregas de cada dia.
 */
function somarPontos(pontos: PontoMeta[]): Omit<LidoDaMeta, "em"> {
  const acumulado = new Map<string, { entregues: number; gasto: number | null; cpd: Array<{ valor: number; entregues: number }> }>();
  let temCusto = false;
  let entregues = 0;
  for (const p of pontos) {
    if (!p.template_id) continue;
    const a = acumulado.get(p.template_id) ?? { entregues: 0, gasto: null, cpd: [] };
    const d = numero(p.delivered) ?? 0;
    a.entregues += d;
    entregues += d;
    if (p.cost?.length) temCusto = true;
    for (const c of p.cost ?? []) {
      const v = numero(c.value);
      if (v === null) continue;
      if (c.type === "amount_spent") a.gasto = (a.gasto ?? 0) + v;
      if (c.type === "cost_per_delivered") a.cpd.push({ valor: v, entregues: d });
    }
    acumulado.set(p.template_id, a);
  }
  const porId: Record<string, number | null> = {};
  for (const [id, a] of acumulado) {
    const pesos = a.cpd.reduce((s, x) => s + x.entregues, 0);
    porId[id] =
      a.gasto !== null && a.entregues > 0
        ? a.gasto / a.entregues
        : a.cpd.length
          ? pesos > 0
            ? a.cpd.reduce((s, x) => s + x.valor * x.entregues, 0) / pesos
            : a.cpd.reduce((s, x) => s + x.valor, 0) / a.cpd.length
          : null;
  }
  return { temCusto, entregues, porId };
}

async function lerDaMeta(wabaId: string, ids: string[], periodo: { start: string; end: string }): Promise<LidoDaMeta> {
  const pontos: PontoMeta[] = [];
  for (let i = 0; i < ids.length; i += TEMPLATES_POR_PEDIDO) {
    const lote = ids.slice(i, i + TEMPLATES_POR_PEDIDO);
    const paginas = await listarMeta<{ data_points?: PontoMeta[] }>(`${wabaId}/template_analytics`, {
      start: periodo.start,
      end: periodo.end,
      granularity: "DAILY",
      metric_types: '["COST","DELIVERED"]',
      // Os ids conferidos como dígitos; em texto, sem passar por Number (passam de 2^53).
      template_ids: `[${lote.join(",")}]`,
    });
    for (const p of paginas) pontos.push(...(p.data_points ?? []));
  }
  return { ...somarPontos(pontos), em: Date.now() };
}

/** O campo da WABA que diz se as estatísticas de template estão confirmadas. Só leitura; null quando não deu para ler. */
async function estatisticasLigadas(wabaId: string): Promise<boolean | null> {
  try {
    const r = await requisicao<{ is_enabled_for_insights?: boolean }>(wabaId, { params: { fields: "is_enabled_for_insights" } });
    return typeof r.is_enabled_for_insights === "boolean" ? r.is_enabled_for_insights : null;
  } catch (e) {
    console.error("[whatsapp-custo] não li is_enabled_for_insights da conta", wabaId, e instanceof Error ? e.message : e);
    return null;
  }
}

const SEM_ESTATISTICAS_NA_MENSAGEM = /is_enabled_for_insights|(insights|analytics).{0,40}(not|n[aã]o).{0,20}(enabled|habilitad|ativad)/i;

// ── Entrada ─────────────────────────────────────────────────────────────────

/**
 * O custo por entrega de cada template, na conta `wabaId`, de `desde` até
 * hoje (no máximo 90 dias). Não lança por causa da Meta: a falha volta na
 * situação, com o aviso.
 */
export async function custoDosTemplates(e: { wabaId: string; templates: TemplateDoCusto[]; desde: Date; agora?: Date }): Promise<CustoDosTemplates> {
  const custoPorEntrega = new Map<string, number | null>(e.templates.map((t) => [chaveDoTemplate(t), null]));
  const resposta = (situacao: CustoDosTemplates["situacao"], aviso: string | null, moeda: string | null = null, em = Date.now()): CustoDosTemplates => ({
    situacao,
    moeda,
    custoPorEntrega,
    aviso,
    em,
  });
  // O id entra no CAMINHO da Graph, assinado com o token de sistema.
  if (!/^\d+$/.test(e.wabaId)) return resposta("erro", "A campanha não tem uma conta do WhatsApp válida.");

  let moeda: string | null = null;
  // Só a recusa do template_analytics pode ser "sem estatísticas"; a da listagem é erro comum.
  let pedindoCusto = false;
  try {
    const wabas = await wabasMeta();
    moeda = wabas.find((w) => w.id === e.wabaId)?.currency ?? null;
    const ids = await idsDosTemplates(e.wabaId);
    const idDe = new Map<string, string>();
    for (const t of e.templates) {
      const id = ids.get(chaveDoTemplate(t));
      if (id) idDe.set(chaveDoTemplate(t), id);
    }
    if (!idDe.size) return resposta("sem_custo", "Os templates desta campanha não estão mais na conta do WhatsApp.", moeda);

    const lista = [...new Set(idDe.values())].sort();
    const periodo = periodoDoCusto(e.desde, e.agora);
    const chave = `whatsapp/${e.wabaId}/custo?ids=${lista.join(",")}&start=${periodo.start}&end=${periodo.end}`;
    pedindoCusto = true;
    const { valor } = await lembrar(chave, VALIDADE_CUSTO, () => lerDaMeta(e.wabaId, lista, periodo));
    const em = valor.em;

    if (!valor.temCusto) {
      return resposta(
        "sem_custo",
        valor.entregues > 0
          ? "A Meta não informa o custo desta conta (linha de crédito de um parceiro)."
          : "A Meta ainda não consolidou o custo destes envios; volte em algumas horas.",
        moeda,
        em,
      );
    }
    for (const [chaveTemplate, id] of idDe) custoPorEntrega.set(chaveTemplate, valor.porId[id] ?? null);
    return resposta("ok", null, moeda, em);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error("[whatsapp-custo] não li o custo da conta", e.wabaId, mensagem);
    if (
      pedindoCusto &&
      erro instanceof ErroMeta &&
      (SEM_ESTATISTICAS_NA_MENSAGEM.test(mensagem) || (await estatisticasLigadas(e.wabaId)) === false)
    ) {
      return resposta(
        "sem_estatisticas",
        "A conta do WhatsApp não tem as estatísticas de template ligadas no Gerenciador do WhatsApp.",
        moeda,
      );
    }
    return resposta(
      "erro",
      erro instanceof ErroMeta ? `A Meta recusou a leitura do custo: ${mensagem}`.slice(0, 300) : "A Meta não respondeu à leitura do custo.",
      moeda,
    );
  }
}
