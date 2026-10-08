import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { administraDemandas } from "@/lib/demandas";
import { carregarMetricasDemandas } from "./demandas";
import TelaMetricas, { type PeriodoId, type Visao } from "./tela";

export const metadata: Metadata = {
  title: "Métricas · Chroma",
};

export const dynamic = "force-dynamic";

// "Hoje" no fuso de Brasília, calculado no servidor: é dele que saem o dia, a
// semana e o mês de cada número, e o navegador não pode discordar disso perto
// da meia-noite.
function hojeEmBrasilia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const VISOES: readonly Visao[] = ["dia", "semana", "mes"];
const PERIODOS: readonly PeriodoId[] = ["hoje", "semana", "mes"];

export default async function MetricasPage({
  searchParams,
}: {
  // ?pessoa=<id> — a ficha aberta; ?ver=dia|semana|mes — o gráfico;
  // ?periodo=hoje|semana|mes — a tabela por pessoa. Vivem na URL para o link
  // abrir no mesmo lugar; a tela troca sem ida ao servidor (ver tela.tsx).
  searchParams: Promise<{ pessoa?: string | string[]; ver?: string | string[]; periodo?: string | string[] }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  const { usuario } = await exigirModulo("metricas");

  // Quem vê a equipe e filtra por pessoa: Admin e TI (pedido dele,
  // 2026-10-07) — a mesma regra das Demandas, pelo departamento, e não pelo
  // escopo de Acessos. Os demais veem só os próprios números, e é a consulta
  // que corta: o resto nem sobe do banco.
  const veEquipe = administraDemandas(usuario);

  const { pessoa, ver, periodo } = await searchParams;
  const metricas = await carregarMetricasDemandas(veEquipe, usuario.id, hojeEmBrasilia());

  // ?pessoa só vale para quem vê a equipe, e para alguém da lista: um id
  // qualquer da URL não pode abrir a tela num recorte vazio e mudo.
  const pessoaInicial =
    veEquipe && typeof pessoa === "string" && metricas.pessoas.some((p) => p.id === pessoa) ? pessoa : null;
  const visaoInicial = VISOES.find((v) => v === ver) ?? "dia";
  // A semana é o padrão da tabela: hoje ainda está pela metade, e o mês
  // esconde quem parou nos últimos dias.
  const periodoInicial = PERIODOS.find((p) => p === periodo) ?? "semana";

  return (
    <TelaMetricas
      metricas={metricas}
      veEquipe={veEquipe}
      nome={usuario.nome}
      pessoaInicial={pessoaInicial}
      visaoInicial={visaoInicial}
      periodoInicial={periodoInicial}
    />
  );
}
