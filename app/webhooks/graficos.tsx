"use client";

// O gráfico da aba Métricas. Mesmo gráfico das Automações e do dashboard
// (app/components/grafico-linhas.tsx): legenda sempre presente, tooltip com o
// dia sob o cursor, grade em hairline e tabela sr-only com os números.
//
// LINHA COM SOMBRA, e não mais barra empilhada: pedido dele (2026-10-05), o
// mesmo tipo em todos os gráficos por dia do app. A barra respondia "quantos
// entraram neste dia" pela altura total; na linha, cada série tem a sua.
//
// DUAS SÉRIES, não três. 'recusado' e 'erro' viram uma linha só ("não
// entrou") porque o par azul/vermelho de --serie-* é o que já passou nos
// testes de daltonismo (ver globals.css); uma terceira cor exigiria revalidar
// o conjunto para separar dois estados que, no gráfico, respondem a mesma
// coisa. Qual dos dois foi está nos totais acima e no log abaixo.
import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import type { RecebimentoNoDia } from "./dados";

const SERIES: SerieLinha<RecebimentoNoDia>[] = [
  { nome: "Virou lead", cor: "var(--serie-ok)", valor: (d) => d.ok },
  { nome: "Não entrou", cor: "var(--serie-erro)", valor: (d) => d.falha },
];

export function RecebimentosPorDia({ dados }: { dados: RecebimentoNoDia[] }) {
  const total = dados.reduce((s, d) => s + d.ok + d.falha, 0);
  return (
    <LinhasPorDia
      dados={dados}
      series={SERIES}
      resumo={`${total} em 14 dias`}
      vazio="Nenhum recebimento nos últimos 14 dias"
      titulo="Recebimentos por dia"
    />
  );
}
