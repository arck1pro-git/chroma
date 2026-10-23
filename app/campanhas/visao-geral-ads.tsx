"use client";

// A aba de abertura do Meta Ads (redesenho de 2026-10-23): a conta inteira no
// período, para quem quer saber em 10 segundos se está indo bem.
//
// DE CIMA PARA BAIXO, do resumo ao detalhe:
//   1. os cinco números que respondem "está bom?", cada um com a seta contra o
//      período anterior do mesmo tamanho;
//   2. o dia a dia (com a métrica trocável) ao lado do funil da impressão à
//      venda — onde o lead se perde;
//   3. o pódio: melhores campanhas e melhores criativos;
//   4. todas as métricas do Gerenciador, por grupo, com a variação de cada uma.
//
// Meta × CRM no mesmo par de cores do módulo inteiro: a ponta clara do azul é a
// Meta (onde o lead nasce), a escura é o CRM (onde ele fica).
import { useState } from "react";
import {
  BadgeDollarSign, Contact, Eye, Handshake, Image as IconeImagem, Megaphone, MousePointerClick, Trophy, Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatarMetrica, metrica, teveResultado, type ContextoMetrica, type LinhaMetricas } from "@/lib/meta-ads-metricas";
import type { CriativosAds, LeadsCrm, RelatorioAds } from "@/lib/meta-ads-tipos";
import { dividir } from "@/lib/meta-ads-calculos";
import { LinhasPorDia, type SerieLinha } from "../components/grafico-linhas";
import CartaoRanking, { campanhaComoItem, criativoComoItem } from "./ranking-ads";
import { CartaoKpi, GradeMetricas, Segmentado, Variacao, periodoCurto } from "./metricas-ui";
import { Aviso } from "./pecas";

const TOM = "blue";
const COR_META = "var(--serie-tom-claro)";
const COR_CRM = "var(--serie-tom-escuro)";
type Dia = RelatorioAds["diario"][number];
type MetricaGrafico = "leads" | "gasto" | "impressoes" | "cliques";

export default function VisaoGeralAds({ r, criativos, carregandoCriativos, erroCriativos, ctx, aoAbrirCampanha, aoAbrirCriativo, aoVerAba }: {
  r: RelatorioAds; criativos: CriativosAds | null; carregandoCriativos: boolean; erroCriativos: string; ctx: ContextoMetrica;
  aoAbrirCampanha: (id: string) => void; aoAbrirCriativo: (chave: string) => void; aoVerAba: (aba: "campanhas" | "criativos") => void;
}) {
  const temCrm = Boolean(r.total.crm);
  const linha: LinhaMetricas = { metricas: r.total.metricas, crm: r.total.crm };
  // Só compara com período que veiculou: contra uma conta parada, toda seta
  // seria "—" e a faixa viraria ruído (o caso dos primeiros 30 dias da conta).
  const comparavel = Boolean(r.anterior && (r.anterior.metricas.impressoes > 0 || r.anterior.metricas.gasto > 0));
  const anterior: LinhaMetricas | null = r.anterior && comparavel ? { metricas: r.anterior.metricas, crm: r.anterior.crm } : null;
  const rotuloAnterior = r.anterior ? periodoCurto(r.anterior.periodo) : undefined;
  // "Datas" pode terminar hoje: aí o último dia está pela metade (os períodos prontos vão até ontem).
  const incluiHoje = r.periodo.fim === new Intl.DateTimeFormat("en-CA", { timeZone: r.conta.timezone_name || "America/Sao_Paulo" }).format(new Date());
  const fmt = (chave: string, l: LinhaMetricas = linha) => { const d = metrica(chave); return formatarMetrica(d.valor(l, ctx), d.formato, ctx.moeda); };
  const seta = (chave: string) => {
    if (!anterior) return undefined;
    const d = metrica(chave);
    return <Variacao atual={d.valor(linha, ctx)} anterior={d.valor(anterior, ctx)} melhor={d.melhor} rotuloAnterior={rotuloAnterior} />;
  };
  const crm = r.total.crm;
  const m = r.total.metricas;

  // O detalhe de cada cartão é curto de propósito: na tela com as duas barras
  // laterais o cartão tem ~150 px de texto, e o resto está na grade de baixo.
  const kpis: Array<{ chave: string; Icone: LucideIcon; rotulo?: string; detalhe: string; destaque?: boolean }> = crm ? [
    { chave: "gasto", Icone: Wallet, detalhe: `CPM ${fmt("cpm")}` },
    { chave: "leadsCrm", Icone: Contact, destaque: true, detalhe: `de ${fmt("leads")} na Meta (${fmt("aproveitamento")})` },
    { chave: "custoLeadCrm", Icone: BadgeDollarSign, destaque: true, detalhe: `Na Meta: ${fmt("custoPorLead")}` },
    { chave: "oportunidades", Icone: Handshake, detalhe: crm.oportunidades > 0 ? `${fmt("custoOportunidade")} cada` : "Nenhuma no período" },
    { chave: "ganhas", Icone: Trophy, rotulo: "Vendas", detalhe: crm.ganhas > 0 ? `${fmt("valorGanho")} · ${fmt("retorno")}` : "Nenhuma no período" },
  ] : [
    { chave: "gasto", Icone: Wallet, detalhe: `CPM ${fmt("cpm")}` },
    { chave: "leads", Icone: Megaphone, destaque: true, detalhe: `${fmt("conversas")} conversas iniciadas` },
    { chave: "custoPorLead", Icone: BadgeDollarSign, destaque: true, detalhe: `${fmt("leads")} leads no período` },
    { chave: "cliquesLink", Icone: MousePointerClick, detalhe: `CPC ${fmt("cpcLink")}` },
    { chave: "ctrLink", Icone: Eye, detalhe: `${fmt("alcance")} alcançadas` },
  ];

  const campanhasRanking = r.campanhas.filter(teveResultado).map(campanhaComoItem);
  const criativosRanking = (criativos?.criativos ?? []).map(criativoComoItem);

  return (
    <div className="space-y-4">
      {r.avisos.map((a) => <Aviso key={a} texto={a} />)}

      <section aria-label="Resumo do período">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k, i) => (
            <CartaoKpi key={k.chave} ordem={i} Icone={k.Icone} rotulo={k.rotulo ?? metrica(k.chave).rotulo} valor={fmt(k.chave)}
              variacao={seta(k.chave)} detalhe={k.detalhe} destaque={k.destaque} />
          ))}
        </div>
        {rotuloAnterior && (
          <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            {comparavel ? `As setas comparam com ${rotuloAnterior}, o período anterior de mesmo tamanho.` : `Sem comparação: a conta não veiculou de ${rotuloAnterior}.`}
            {incluiHoje && " Hoje ainda está em andamento: as contagens de hoje estão incompletas."}
          </p>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <DiaADia r={r} ctx={ctx} temCrm={temCrm} />
        <Funil linha={linha} ctx={ctx} />
      </div>

      {r.leadsCrm && <Origem leads={r.leadsCrm} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <CartaoRanking titulo="Melhores campanhas" Icone={Megaphone} itens={campanhasRanking} ctx={ctx} temCrm={temCrm} comVideo={m.video3s > 0}
          vazioSemDados="Nenhuma campanha veiculou neste período." aoAbrir={aoAbrirCampanha} aoVerTodos={() => aoVerAba("campanhas")} rotuloVerTodos="Todas as campanhas" />
        {erroCriativos ? (
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><Aviso erro texto={erroCriativos} /></div>
        ) : (
          <CartaoRanking titulo="Melhores criativos" Icone={IconeImagem} itens={criativosRanking} ctx={ctx} temCrm={temCrm} comVideo={m.video3s > 0}
            carregando={carregandoCriativos && (!criativos || criativos.periodo.inicio !== r.periodo.inicio || criativos.periodo.fim !== r.periodo.fim)} vazioSemDados="Nenhum criativo veiculou neste período."
            aoAbrir={aoAbrirCriativo} aoVerTodos={() => aoVerAba("criativos")} rotuloVerTodos="Todos os criativos" />
        )}
      </div>

      <section aria-label="Todas as métricas do período" className="rounded-xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Todas as métricas do período</h2>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">A conta inteira, como no Gerenciador. Passe o mouse num nome para ver o que ele mede.</p>
        </div>
        <GradeMetricas linha={linha} anterior={comparavel ? anterior : undefined} ctx={ctx} colunas="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" rotuloAnterior={rotuloAnterior} />
      </section>
    </div>
  );
}

// ── O dia a dia ─────────────────────────────────────────────────────────────

function DiaADia({ r, ctx, temCrm }: { r: RelatorioAds; ctx: ContextoMetrica; temCrm: boolean }) {
  const [qual, setQual] = useState<MetricaGrafico>("leads");
  const dinheiro = (v: number) => formatarMetrica(v, "moeda", ctx.moeda);
  const series: Record<MetricaGrafico, SerieLinha<Dia>[]> = {
    leads: [
      { nome: "Leads na Meta", cor: COR_META, Icone: Megaphone, valor: (d) => d.leadsMeta },
      ...(temCrm ? [{ nome: "Leads no CRM", cor: COR_CRM, Icone: Contact, valor: (d: Dia) => d.leadsCrm }] : []),
    ],
    gasto: [{ nome: "Investido", cor: COR_CRM, Icone: Wallet, valor: (d) => d.gasto, formatar: dinheiro }],
    impressoes: [{ nome: "Impressões", cor: COR_META, Icone: Eye, valor: (d) => d.impressoes }],
    cliques: [{ nome: "Cliques no link", cor: COR_META, Icone: MousePointerClick, valor: (d) => d.cliquesLink }],
  };
  return (
    <section aria-label="Dia a dia" className="min-w-0 rounded-xl border border-zinc-200 bg-white px-4 pb-3 pt-3.5 xl:col-span-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Dia a dia</h2>
        <Segmentado rotulo="Métrica do gráfico" tamanho="sm" valor={qual} aoMudar={setQual} opcoes={[
          { valor: "leads", rotulo: "Leads" }, { valor: "gasto", rotulo: "Investido" },
          { valor: "impressoes", rotulo: "Impressões" }, { valor: "cliques", rotulo: "Cliques no link" },
        ]} />
      </div>
      <LinhasPorDia
        key={qual}
        dados={r.diario}
        series={series[qual]}
        tom={TOM}
        altura="h-60"
        totais
        resumo={periodoCurto(r.periodo)}
        notaNoDia={qual === "leads" ? (d) => (d.gasto > 0 ? `${dinheiro(d.gasto)} investidos` : null) : undefined}
        vazio="Nada para mostrar neste período."
        titulo={`${series[qual].map((s) => s.nome).join(" e ")} por dia, ${periodoCurto(r.periodo)}`}
      />
    </section>
  );
}

// ── O funil ─────────────────────────────────────────────────────────────────

// Da impressão à venda, na conta inteira: quanto de cada degrau passa para o
// próximo e quanto custa cada unidade. A barra é a passagem (% do degrau
// anterior), não o volume — 761 mil impressões contra 144 leads numa escala só
// apagariam tudo depois do primeiro degrau.
function Funil({ linha, ctx }: { linha: LinhaMetricas; ctx: ContextoMetrica }) {
  const m = linha.metricas, crm = linha.crm;
  const degraus = [
    { rotulo: "Impressões", valor: m.impressoes },
    { rotulo: "Cliques no link", valor: m.cliquesLink },
    { rotulo: "Visualizações da página", valor: m.visualizacoesPagina },
    { rotulo: "Leads na Meta", valor: m.leads },
    ...(crm ? [
      { rotulo: "Leads no CRM", valor: crm.leads },
      { rotulo: "Oportunidades", valor: crm.oportunidades },
      { rotulo: "Vendas", valor: crm.ganhas },
    ] : []),
  ];
  const inteiro = (v: number) => formatarMetrica(v, "inteiro", ctx.moeda);
  return (
    <section aria-label="Do anúncio à venda" data-tom={TOM} className="viz min-w-0 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Do anúncio à venda</h2>
      <p className="mb-3 mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
        Quanto de cada degrau passa para o próximo.
        {/* Formulário instantâneo da Meta não passa pela página: aí há mais leads que visualizações. */}
        {m.leads > m.visualizacoesPagina && " Há mais leads que visualizações: parte veio do formulário da própria Meta, que não abre página."}
      </p>
      <ol className="space-y-2.5">
        {degraus.map((d, i) => {
          const antes = i > 0 ? degraus[i - 1].valor : null;
          const passagem = antes === null ? null : dividir(d.valor * 100, antes);
          const custo = i > 0 ? dividir(m.gasto, d.valor) : null;
          return (
            <li key={d.rotulo}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] text-zinc-600 dark:text-zinc-300">{d.rotulo}</span>
                <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{inteiro(d.valor)}</span>
              </div>
              {i > 0 && (
                <>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-[var(--serie-tom-escuro)] opacity-70" style={{ width: `${passagem === null ? 0 : Math.max(Math.min(passagem, 100), passagem > 0 ? 2 : 0)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500">
                    {passagem === null ? "—" : `${formatarMetrica(passagem, "porcento", ctx.moeda)} do anterior`}
                    {custo !== null ? ` · ${formatarMetrica(custo, "moeda", ctx.moeda)} cada` : ""}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// De onde vieram os leads do CRM no período. Sem esta linha, "62 no CRM contra
// 80 na Meta" pareceria perda — quando parte da diferença é lead que chegou sem
// UTM ou por outra porta. Os números somam o total, sem sobra.
function Origem({ leads }: { leads: LeadsCrm }) {
  const inteiro = (v: number) => v.toLocaleString("pt-BR");
  const partes = [
    { n: leads.semOrigem, texto: "sem origem (WhatsApp direto, cadastro à mão)" },
    { n: leads.semCorrespondencia, texto: "de outra origem (outra conta, Google, nome antigo)" },
    { n: leads.ambiguas, texto: "com nome que bate em duas campanhas" },
  ].filter((p) => p.n > 0);
  return (
    <p className="rounded-xl bg-zinc-50 px-4 py-2.5 text-[11.5px] leading-relaxed text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
      No período o CRM recebeu <strong className="font-semibold text-zinc-700 dark:text-zinc-200">{inteiro(leads.total)} {leads.total === 1 ? "lead" : "leads"}</strong>:
      {" "}{inteiro(leads.atribuidos)} de campanhas desta conta{partes.map((p) => `, ${inteiro(p.n)} ${p.texto}`).join("")}.
      <span className="text-zinc-400 dark:text-zinc-500"> Lead é pessoa: o contato que entrou ou voltou com uma oportunidade nova, contado uma vez.</span>
    </p>
  );
}