import type { Etapa, Oportunidade } from "../data";

// Contas do painel de desempenho da tela inicial. Funções puras, sem React:
// entram as etapas de UM funil (já na ordem) e as oportunidades da base, saem
// os números que os gráficos desenham.

export type MetricaEtapa = {
  etapaId: string;
  nome: string;
  leads: number;
  // Leads nesta etapa OU em qualquer etapa posterior. É a base da conversão:
  // quem está em "Proposta" já passou por "Qualificação".
  acumulado: number;
  valorTotal: number;
  ticketMedio: number;
  diasMedio: number;
};

export type Conversao = {
  id: string;
  // Rótulo curto = nome da etapa de ORIGEM, para o eixo bater com os outros
  // gráficos. O par completo ("de → para") aparece no tooltip.
  origem: string;
  destino: string;
  taxa: number; // 0–100
  entraram: number;
  seguiram: number;
};

export type MetricasFunil = {
  etapas: MetricaEtapa[];
  conversoes: Conversao[];
  leads: number;
  valorTotal: number;
  ticketMedio: number;
  diasMedio: number;
  // Da primeira etapa até a última, pelo acumulado.
  conversaoTotal: number;
  // Passo com a menor taxa — o furo do funil. Null com menos de 2 etapas.
  piorPasso: Conversao | null;
};

function media(total: number, quantidade: number) {
  return quantidade > 0 ? Math.round(total / quantidade) : 0;
}

// ATENÇÃO À NATUREZA DO DADO: isto é um retrato do agora, não um histórico.
// Não existe registro de quando um lead mudou de etapa (mesma limitação que o
// `dias_na_etapa` carrega, ver migration-front.sql), então a conversão é
// deduzida da ocupação atual: dos que chegaram até a etapa X, quantos estão em
// X+1 ou além. Serve para achar o gargalo; não serve como taxa histórica.
export function metricasDoFunil(
  etapas: Etapa[],
  oportunidades: Oportunidade[],
): MetricasFunil {
  const porEtapa = new Map<string, Oportunidade[]>();
  for (const o of oportunidades) {
    const atual = porEtapa.get(o.etapa_id);
    if (atual) atual.push(o);
    else porEtapa.set(o.etapa_id, [o]);
  }

  const base = etapas.map((etapa) => {
    const doEtapa = porEtapa.get(etapa.id) ?? [];
    const valorTotal = doEtapa.reduce((s, o) => s + o.valor, 0);
    const diasTotal = doEtapa.reduce((s, o) => s + o.dias_na_etapa, 0);

    return {
      etapaId: etapa.id,
      nome: etapa.nome,
      leads: doEtapa.length,
      acumulado: 0, // preenchido abaixo, de trás pra frente
      valorTotal,
      ticketMedio: media(valorTotal, doEtapa.length),
      diasMedio: media(diasTotal, doEtapa.length),
    };
  });

  // Uma varredura da última etapa para a primeira: o acumulado de cada uma é o
  // que tem nela mais tudo que já passou dela.
  let corrente = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    corrente += base[i].leads;
    base[i].acumulado = corrente;
  }

  const conversoes: Conversao[] = [];
  for (let i = 0; i < base.length - 1; i++) {
    const entraram = base[i].acumulado;
    const seguiram = base[i + 1].acumulado;
    conversoes.push({
      id: `${base[i].etapaId}->${base[i + 1].etapaId}`,
      origem: base[i].nome,
      destino: base[i + 1].nome,
      // Sem ninguém na origem não há taxa — 0 e não NaN, que quebraria o eixo.
      taxa: entraram > 0 ? Math.round((seguiram / entraram) * 100) : 0,
      entraram,
      seguiram,
    });
  }

  const leads = base.reduce((s, e) => s + e.leads, 0);
  const valorTotal = base.reduce((s, e) => s + e.valorTotal, 0);
  const diasPonderado = base.reduce((s, e) => s + e.diasMedio * e.leads, 0);
  const primeiro = base[0]?.acumulado ?? 0;
  const ultimo = base[base.length - 1]?.acumulado ?? 0;

  return {
    etapas: base,
    conversoes,
    leads,
    valorTotal,
    ticketMedio: media(valorTotal, leads),
    diasMedio: media(diasPonderado, leads),
    conversaoTotal: primeiro > 0 ? Math.round((ultimo / primeiro) * 100) : 0,
    piorPasso: conversoes.length
      ? conversoes.reduce((pior, c) => (c.taxa < pior.taxa ? c : pior))
      : null,
  };
}
