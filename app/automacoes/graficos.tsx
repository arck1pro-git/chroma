"use client";

import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import type { ExecucaoNoDia } from "./dados";

// ── Execuções por dia: duas linhas num eixo só ──────────────────────────────
// Um eixo, nunca dois: erro é ordem de grandeza menor que sucesso, e é isso
// mesmo que a linha colada na base deve comunicar. O desenho é o de
// app/components/grafico-linhas.tsx, que nasceu aqui.

const SERIES: SerieLinha<ExecucaoNoDia>[] = [
  { nome: "Sucesso", cor: "var(--serie-ok)", valor: (d) => d.sucesso },
  { nome: "Erro", cor: "var(--serie-erro)", valor: (d) => d.erro },
];

export function ExecucoesPorDia({ dados }: { dados: ExecucaoNoDia[] }) {
  const total = dados.reduce((s, d) => s + d.sucesso + d.erro, 0);
  return (
    <LinhasPorDia
      dados={dados}
      series={SERIES}
      resumo={`${total} execuções em 14 dias`}
      vazio="Nenhuma execução no período"
      titulo="Execuções por dia"
    />
  );
}
