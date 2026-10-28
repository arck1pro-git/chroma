// As MÉTRICAS de UMA campanha de WhatsApp oficial (pedido dele, 2026-10-28:
// "quero que metrifique gastos e métricas"). O contrato com a tela está em
// lib/campanhas-metricas-tipos.ts; a rota é GET /api/meta/whatsapp/campanhas/[id]/metricas.
//
// ENTREGUES E LIDOS são das mensagens de TEMPLATE: o envio grava o wamid no
// evento 'bloco' (e em mensagem_id_meta; a execução do formato antigo só lá, e
// conta no bloco ID_ENVIO_ANTIGO), e o webhook da Meta grava o status na linha
// da conversa com aquele id_externo (lib/whatsapp-oficial.ts), um status que só
// avança. Lido conta também como entregue.
//
// DESCADASTRO: a resposta que saiu do Aguardar por "descadastro"
// (resposta_saida) ou a execução encerrada pelo "sair" mandado a outra campanha
// do mesmo número (evento 'descadastro', encerrarPorDescadastro).
//
// GASTO: entregues da campanha com cada template × o custo por entrega que a
// Meta informa para o template no período (lib/whatsapp-custo.ts). O template
// de cada entrega é o do bloco no fluxo de hoje; entrega de bloco apagado
// depois conta no funil, mas não no gasto (a definição não guarda o que ele era).
//
// FALHAS POR MOTIVO: o `erro` das execuções 'falhou'. A coluna
// campanhas_whatsapp.falhas é do formato de antes e ninguém mais a escreve.
import "server-only";
import { sql } from "@/lib/db";
// Direto do arquivo dos números: pela fachada (lib/campanhas-whatsapp.ts) a rota carregaria o motor inteiro.
import { metricasDasCampanhas } from "@/lib/campanhas-whatsapp-totais";
import { fluxoGravado } from "@/lib/campanhas-fluxo-entrada";
import { ID_ENVIO_ANTIGO, LIMITES_FLUXO } from "@/lib/campanhas-fluxo";
import { chaveDoTemplate, custoDosTemplates, type TemplateDoCusto } from "@/lib/whatsapp-custo";
import type { CustoCampanha, CustoPorTemplate, FunilCampanha, MetricasCampanha, MetricasDoBloco } from "@/lib/campanhas-metricas-tipos";

const TETO_MOTIVOS = 20;
const TAMANHO_DO_MOTIVO = 300;
// Folga sobre o teto de blocos: entrega de bloco apagado e o ID_ENVIO_ANTIGO.
const TETO_BLOCOS = LIMITES_FLUXO.blocos * 2;

type Campanha = {
  id: string;
  status: string;
  definicao: unknown;
  template_nome: string;
  template_idioma: string;
  waba_id: string;
  desde: Date | string;
};

// bloco null é a linha do total: contatos (como "enviados"), não mensagens.
type Entregas = { bloco: string | null; entregues: number; lidos: number; contatos_entregues: number; contatos_lidos: number };

const proprio = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);
/** Seis casas: tira o resto da conta em ponto flutuante (0,055 × 4 = 0,22000000000000003) sem perder centavo de dólar. */
const dinheiro = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6);

/** As métricas da campanha; null quando ela não existe. */
export async function metricasDaCampanha(campanhaId: string): Promise<MetricasCampanha | null> {
  const [c] = (await sql`
    SELECT id::text AS id, status, definicao, template_nome, template_idioma, waba_id,
           COALESCE(ativada_em, data_criacao) AS desde
      FROM campanhas_whatsapp
     WHERE id = ${campanhaId}::uuid
     LIMIT 1`) as unknown as Campanha[];
  if (!c) return null;
  const fluxo = fluxoGravado(c);

  const [[contagem], [saidas], entregas, motivos, doFluxo] = (await Promise.all([
    sql`SELECT count(*)::int AS entraram,
               count(*) FILTER (WHERE enviado_em IS NOT NULL)::int AS enviados,
               count(*) FILTER (WHERE respondeu_em IS NOT NULL)::int AS responderam,
               count(*) FILTER (WHERE conversao)::int AS conversoes,
               count(*) FILTER (WHERE estado = 'falhou')::int AS falhas
          FROM campanha_whatsapp_execucoes
         WHERE campanha_id = ${c.id}::uuid`,
    sql`SELECT count(*)::int AS descadastros FROM (
          SELECT id FROM campanha_whatsapp_execucoes
           WHERE campanha_id = ${c.id}::uuid AND resposta_saida = 'descadastro'
          UNION
          SELECT execucao_id FROM campanha_whatsapp_eventos
           WHERE campanha_id = ${c.id}::uuid AND tipo = 'descadastro' AND execucao_id IS NOT NULL
        ) d`,
    // UNION tira o wamid repetido: o do evento e o da execução são o mesmo envio.
    // O bloco conta mensagens (é o que a Meta cobra); a linha do total (bloco
    // null, GROUPING SETS) conta contatos, a mesma unidade de "enviados": com
    // dois templates no caminho, o funil não passa de 100%.
    sql`WITH envios AS (
          SELECT ev.detalhe->>'bloco' AS bloco, ev.detalhe->>'wamid' AS wamid, ev.execucao_id AS execucao
            FROM campanha_whatsapp_eventos ev
           WHERE ev.campanha_id = ${c.id}::uuid AND ev.tipo = 'bloco'
             AND ev.detalhe->>'tipo' = 'enviar_template' AND ev.detalhe->>'wamid' IS NOT NULL
          UNION
          SELECT ${ID_ENVIO_ANTIGO}::text, e.mensagem_id_meta, e.id
            FROM campanha_whatsapp_execucoes e
           WHERE e.campanha_id = ${c.id}::uuid AND e.mensagem_id_meta IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM campanha_whatsapp_eventos ev
                              WHERE ev.execucao_id = e.id AND ev.tipo = 'bloco'
                                AND ev.detalhe->>'wamid' = e.mensagem_id_meta))
        SELECT envios.bloco,
               count(*) FILTER (WHERE m.status IN ('entregue', 'lido'))::int AS entregues,
               count(*) FILTER (WHERE m.status = 'lido')::int AS lidos,
               count(DISTINCT envios.execucao) FILTER (WHERE m.status IN ('entregue', 'lido'))::int AS contatos_entregues,
               count(DISTINCT envios.execucao) FILTER (WHERE m.status = 'lido')::int AS contatos_lidos
          FROM envios
          JOIN mensagens m ON m.id_externo = envios.wamid AND m.id_externo IS NOT NULL
         GROUP BY GROUPING SETS ((envios.bloco), ())
         ORDER BY envios.bloco NULLS FIRST
         LIMIT ${TETO_BLOCOS + 1}`,
    sql`SELECT left(COALESCE(NULLIF(btrim(erro), ''), 'Sem motivo registrado.'), ${TAMANHO_DO_MOTIVO}) AS motivo,
               count(*)::int AS n
          FROM campanha_whatsapp_execucoes
         WHERE campanha_id = ${c.id}::uuid AND estado = 'falhou'
         GROUP BY 1
         ORDER BY n DESC, motivo
         LIMIT ${TETO_MOTIVOS}`,
    metricasDasCampanhas([{ id: c.id, definicao: fluxo }]),
  ])) as unknown as [
    [Omit<FunilCampanha, "entregues" | "lidos" | "descadastros">],
    [{ descadastros: number }],
    Entregas[],
    Array<{ motivo: string; n: number }>,
    Awaited<ReturnType<typeof metricasDasCampanhas>>,
  ];

  const total = entregas.find((l) => l.bloco === null);
  const porEntrega = new Map(entregas.flatMap((l) => (l.bloco === null ? [] : [[l.bloco, l] as const])));
  const funil: FunilCampanha = {
    ...contagem,
    entregues: total?.contatos_entregues ?? 0,
    lidos: total?.contatos_lidos ?? 0,
    descadastros: saidas.descadastros,
  };

  // Os blocos do fluxo e os que só aparecem nos eventos (apagados, formato antigo).
  const base = doFluxo.get(c.id)?.porBloco ?? {};
  const ids = new Set([...Object.keys(fluxo.blocos), ...Object.keys(base), ...porEntrega.keys()]);
  const porBloco: Record<string, MetricasDoBloco> = Object.fromEntries(
    [...ids].map((id) => {
      const ehTemplate = proprio(fluxo.blocos, id)?.tipo === "enviar_template";
      const e = porEntrega.get(id);
      const b = proprio(base, id);
      return [id, { agora: b?.agora ?? 0, passaram: b?.passaram ?? 0, entregues: ehTemplate ? (e?.entregues ?? 0) : null, lidos: ehTemplate ? (e?.lidos ?? 0) : null }];
    }),
  );

  // Entregues por template, pelo template de cada bloco no fluxo.
  const porTemplate = new Map<string, { t: TemplateDoCusto; entregues: number }>();
  for (const [id, b] of Object.entries(fluxo.blocos)) {
    const n = porEntrega.get(id)?.entregues ?? 0;
    if (b.tipo !== "enviar_template" || !n) continue;
    const t = { nome: b.template_nome, idioma: b.template_idioma };
    const x = porTemplate.get(chaveDoTemplate(t)) ?? { t, entregues: 0 };
    x.entregues += n;
    porTemplate.set(chaveDoTemplate(t), x);
  }

  return {
    funil,
    porBloco,
    falhasPorMotivo: motivos.map(({ motivo, n }) => ({ motivo, n })),
    custo: await custoDaCampanha(c, [...porTemplate.values()], funil),
  };
}

async function custoDaCampanha(c: Campanha, entregas: Array<{ t: TemplateDoCusto; entregues: number }>, funil: FunilCampanha): Promise<CustoCampanha> {
  if (!entregas.length) {
    return {
      situacao: "sem_envio",
      moeda: null,
      total: null,
      porTemplate: [],
      porResposta: null,
      porConversao: null,
      aviso: "Nenhuma mensagem de template entregue ainda.",
      atualizadoEm: new Date().toISOString(),
    };
  }
  const r = await custoDosTemplates({ wabaId: c.waba_id, templates: entregas.map((x) => x.t), desde: new Date(c.desde) });
  const porTemplate: CustoPorTemplate[] = entregas.map(({ t, entregues }) => {
    const custoPorEntrega = r.situacao === "ok" ? (r.custoPorEntrega.get(chaveDoTemplate(t)) ?? null) : null;
    return {
      template: t.nome,
      idioma: t.idioma,
      entregues,
      custoPorEntrega: dinheiro(custoPorEntrega),
      total: dinheiro(custoPorEntrega === null ? null : entregues * custoPorEntrega),
    };
  });
  const conhecidos = porTemplate.filter((p) => p.total !== null);
  const total = dinheiro(conhecidos.length ? conhecidos.reduce((s, p) => s + (p.total ?? 0), 0) : null);
  // Situação ok com template sem número: a Meta ainda não consolidou aquele (o total é parcial).
  const faltam = r.situacao === "ok" ? porTemplate.filter((p) => p.total === null).map((p) => p.template) : [];
  return {
    situacao: r.situacao,
    moeda: r.moeda,
    total,
    porTemplate,
    porResposta: dinheiro(total !== null && funil.responderam > 0 ? total / funil.responderam : null),
    porConversao: dinheiro(total !== null && funil.conversoes > 0 ? total / funil.conversoes : null),
    aviso: faltam.length ? `A Meta ainda não informou o custo de: ${faltam.join(", ")}.` : r.aviso,
    atualizadoEm: new Date(r.em).toISOString(),
  };
}
