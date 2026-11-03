"use client";

// Os gráficos da aba Ponto, no desenho comum do app (LinhasPorDia). Os números
// chegam prontos do servidor (lib/ponto.ts, montados em ./painel.tsx); aqui
// ficam só as séries, que são funções e por isso não atravessam do servidor
// para o navegador.
//
// Um eixo só, sempre em horas: a pessoa contra a média da equipe é a mesma
// grandeza. O total da equipe não divide gráfico com a média por pessoa (uma
// é dez vezes a outra); a média vai no tooltip. Por mês, a equipe aparece em
// média por pessoa: o total sobe e desce com quem entrou e saiu, e passa de
// mil horas, que o eixo não comporta.
import { LinhasPorDia, type EscalaLinha, type SerieLinha } from "@/app/components/grafico-linhas";

/** Horas em decimal → "7h32". */
function horas(v: number): string {
  const m = Math.round(v * 60);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeDoMes = (dia: string) => MESES[Number(dia.slice(5, 7)) - 1];

function porMes(atual: string): EscalaLinha {
  return {
    // O ano só no primeiro ponto e na virada: "jul 26", "ago", "set".
    eixo: (dia, i) => `${nomeDoMes(dia).slice(0, 3)}${i === 0 || dia.slice(5, 7) === "01" ? ` ${dia.slice(2, 4)}` : ""}`,
    dica: (dia) => `${nomeDoMes(dia)} de ${dia.slice(0, 4)}${dia === atual ? " · em andamento" : ""}`,
    ultimoParcial: true,
  };
}

/** Um ponto do gráfico da equipe: `dia` é AAAA-MM-DD (por dia) ou AAAA-MM-01 (por mês). */
export type PontoEquipe = { dia: string; horas: number; pessoas: number };
/** Um ponto do gráfico de uma pessoa, com a média da equipe no mesmo período. */
export type PontoPessoa = { dia: string; pessoa: number; media: number };

const notaPessoas = (d: PontoEquipe) =>
  d.pessoas ? `${d.pessoas} ${d.pessoas === 1 ? "pessoa" : "pessoas"} · ${horas(d.horas / d.pessoas)} por pessoa` : null;

const SERIE_EQUIPE: SerieLinha<PontoEquipe>[] = [{ nome: "Horas da equipe", cor: "var(--serie-ok)", valor: (d) => d.horas, formatar: horas }];

export function EquipePorDia({ dados }: { dados: PontoEquipe[] }) {
  return (
    <LinhasPorDia
      dados={dados}
      series={SERIE_EQUIPE}
      totais
      resumo="no mês"
      notaNoDia={notaPessoas}
      altura="h-40"
      vazio="Ninguém bateu ponto neste mês."
      titulo="Horas da equipe por dia no mês"
    />
  );
}

const SERIE_MEDIA: SerieLinha<PontoEquipe>[] = [
  { nome: "Horas por pessoa", cor: "var(--serie-ok)", valor: (d) => (d.pessoas ? d.horas / d.pessoas : 0), formatar: horas },
];

export function EquipePorMes({ dados, atual }: { dados: PontoEquipe[]; atual: string }) {
  return (
    <LinhasPorDia
      dados={dados}
      series={SERIE_MEDIA}
      resumo={`${dados.length} ${dados.length === 1 ? "mês" : "meses"}`}
      notaNoDia={(d) => `${horas(d.horas)} da equipe · ${d.pessoas} ${d.pessoas === 1 ? "pessoa" : "pessoas"}`}
      escala={porMes(atual)}
      altura="h-40"
      vazio="Sem batidas registradas."
      titulo="Média de horas por pessoa, por mês"
    />
  );
}

function seriesDaPessoa(nome: string): SerieLinha<PontoPessoa>[] {
  return [
    { nome, cor: "var(--serie-ok)", valor: (d) => d.pessoa, formatar: horas },
    { nome: "Média da equipe", cor: "var(--serie-neutra)", valor: (d) => d.media, formatar: horas },
  ];
}

export function PessoaPorDia({ dados, nome }: { dados: PontoPessoa[]; nome: string }) {
  const total = dados.reduce((s, d) => s + d.pessoa, 0);
  return (
    <LinhasPorDia
      dados={dados}
      series={seriesDaPessoa(nome)}
      resumo={`${horas(total)} no mês`}
      altura="h-40"
      vazio="Sem batidas neste mês."
      titulo={`Horas por dia de ${nome} e a média da equipe`}
    />
  );
}

export function PessoaPorMes({ dados, nome, atual }: { dados: PontoPessoa[]; nome: string; atual: string }) {
  return (
    <LinhasPorDia
      dados={dados}
      series={seriesDaPessoa(nome)}
      resumo={`${dados.length} ${dados.length === 1 ? "mês" : "meses"}`}
      escala={porMes(atual)}
      altura="h-40"
      vazio="Sem batidas registradas."
      titulo={`Horas por mês de ${nome} e a média da equipe por pessoa`}
    />
  );
}
