// Dias da semana e janelas de tempo em texto, para os blocos de 2026-10-28
// (Horário de envio e Permissão de passagem): o resumo do cartão, a revisão e
// os chips do painel. Puro, sem React. Fora de ./grafo.ts, que já passa de
// 600 linhas.

const NOMES_DOS_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** A semana a partir da segunda, como se lê; os dias do contrato são 0 = domingo … 6 = sábado. */
export const DIAS_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0].map((dia) => ({ dia, rotulo: NOMES_DOS_DIAS[dia] }));

/** "Todos os dias", "Seg a Sex", "Seg, Qua, Sex", "Sáb, Dom": sequência de três ou mais vira "a". */
export function diasEmTexto(dias: number[]): string {
  const ordem = DIAS_DA_SEMANA.filter((d) => dias.includes(d.dia));
  if (ordem.length === 7) return "Todos os dias";
  const posicao = (d: (typeof DIAS_DA_SEMANA)[number]) => DIAS_DA_SEMANA.indexOf(d);
  const trechos: string[] = [];
  let i = 0;
  while (i < ordem.length) {
    let j = i;
    while (j + 1 < ordem.length && posicao(ordem[j + 1]) === posicao(ordem[j]) + 1) j++;
    if (j - i >= 2) trechos.push(`${ordem[i].rotulo} a ${ordem[j].rotulo}`);
    else for (let k = i; k <= j; k++) trechos.push(ordem[k].rotulo);
    i = j + 1;
  }
  return trechos.join(", ");
}

const UNIDADES_DA_JANELA = [
  { segundos: 86_400, um: "dia", varios: "dias" },
  { segundos: 3600, um: "hora", varios: "horas" },
  { segundos: 60, um: "minuto", varios: "minutos" },
  { segundos: 1, um: "segundo", varios: "segundos" },
];

/** "1 hora", "30 minutos", "2 dias", "45 segundos": a maior unidade que divide sem resto. */
export function janelaEmTexto(segundos: number): string {
  const u = UNIDADES_DA_JANELA.find((x) => segundos >= x.segundos && segundos % x.segundos === 0) ?? UNIDADES_DA_JANELA[3];
  const n = segundos / u.segundos;
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? u.um : u.varios}`;
}
