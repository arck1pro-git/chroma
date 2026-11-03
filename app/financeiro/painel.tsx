// A tela do Financeiro: a faixa de abas (hoje só o Ponto) e, na aba Ponto, o
// mês de todo mundo. Duas visões na mesma aba:
//   · a equipe: os números do mês, as horas por dia e por mês, a tabela por
//     pessoa com o mês de cada um em barrinhas, e o dia a dia;
//   · um colaborador (clicar na pessoa, ?pessoa=<id>): os números dele contra a
//     média da equipe, os mesmos gráficos com a média ao lado e o dia a dia dele.
// Componente de servidor: os filtros são links, sem estado no navegador; só os
// gráficos são do cliente (./graficos.tsx).
import type { ReactNode } from "react";
import Link from "next/link";
import { horaCurta } from "@/lib/formato";
import { mesAtual, type DadosPonto, type DiaPonto, type Modalidade, type PessoaPonto, type ResumoPonto, type SituacaoDia } from "@/lib/ponto";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, X } from "@/app/components/icones";
import { EquipePorDia, EquipePorMes, PessoaPorDia, PessoaPorMes } from "./graficos";

type Problema = "sem_base" | "sem_resposta";

const SITUACAO: Record<SituacaoDia, { rotulo: string; classe: string; barra: string }> = {
  completo: {
    rotulo: "Ok",
    classe: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20",
    barra: "fill-zinc-400 dark:fill-zinc-500",
  },
  em_andamento: {
    rotulo: "Em andamento",
    classe: "bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-400/20",
    barra: "fill-sky-500 dark:fill-sky-400",
  },
  falta_saida: {
    rotulo: "Falta saída",
    classe: "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
    barra: "fill-amber-500 dark:fill-amber-400",
  },
  irregular: {
    rotulo: "Irregular",
    classe: "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
    barra: "fill-amber-500 dark:fill-amber-400",
  },
  sem_batida: {
    rotulo: "Sem batida",
    classe: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20",
    barra: "fill-red-500 dark:fill-red-400",
  },
};

const MODALIDADE: Record<Modalidade, string> = { presencial: "Presencial", home_office: "Home office" };

const selo = "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset";
const cartao = "rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

/** 452 → "7h32". */
function horas(minutos: number): string {
  const m = Math.round(minutos);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** 522 (minutos desde a meia-noite) → "08:42". */
function relogio(minutos: number | null): string {
  if (minutos === null) return "—";
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/** "2026-11" → "Novembro de 2026". */
function nomeDoMes(mes: string): string {
  const nome = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-01T12:00:00Z`));
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/** "2026-11-03" → "03/11 ter". */
function nomeDoDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const semana = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${semana}`;
}

function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function endereco(mes: string, pessoaId: string | null): string {
  const q = new URLSearchParams({ mes });
  if (pessoaId) q.set("pessoa", pessoaId);
  return `/financeiro?${q}`;
}

/** As batidas do dia: em pares (08:02 → 12:00) quando fecham, uma a uma quando não. */
function Batidas({ dia }: { dia: DiaPonto }) {
  if (dia.batidas.length === 0) return <span className="text-zinc-400 dark:text-zinc-500">nenhuma</span>;
  if (dia.situacao === "completo" || dia.situacao === "em_andamento") {
    const trechos: string[] = [];
    for (let i = 0; i < dia.batidas.length; i += 2) trechos.push(`${dia.batidas[i].hora} → ${dia.batidas[i + 1]?.hora ?? "…"}`);
    return <span className="tabular-nums">{trechos.join("  ·  ")}</span>;
  }
  return (
    <span className="tabular-nums">
      {dia.batidas.map((b, i) => (
        <span key={i} className="mr-2 whitespace-nowrap">
          <span className="text-zinc-400 dark:text-zinc-500">{b.tipo === "in" ? "entrada" : "saída"}</span> {b.hora}
        </span>
      ))}
    </span>
  );
}

/**
 * O mês de uma pessoa numa linha: uma barra por dia em que a equipe trabalhou,
 * da altura das horas (o teto é 10 h), na cor da situação. Dia sem batida dela
 * fica só no traço do chão: é a falta que aparece.
 */
function BarrasDoMes({ diasDaEquipe, diasDaPessoa }: { diasDaEquipe: string[]; diasDaPessoa: Map<string, DiaPonto> }) {
  const largura = 5;
  const altura = 22;
  return (
    <svg width={diasDaEquipe.length * largura} height={altura} role="img" aria-label="Horas por dia no mês" className="block">
      {diasDaEquipe.map((dia, i) => {
        const d = diasDaPessoa.get(dia);
        const h = d && d.minutos > 0 ? Math.max(3, Math.min(1, d.minutos / 600) * altura) : 0;
        return (
          <g key={dia}>
            <title>{`${nomeDoDia(dia)}: ${d ? `${horas(d.minutos)} · ${SITUACAO[d.situacao].rotulo.toLowerCase()}` : "sem batida"}`}</title>
            <rect x={i * largura} y={altura - 1.5} width={largura - 1.5} height={1.5} className="fill-zinc-200 dark:fill-zinc-800" />
            {d && h > 0 && <rect x={i * largura} y={altura - h} width={largura - 1.5} height={h} rx={1} className={SITUACAO[d.situacao].barra} />}
            {d && h === 0 && <rect x={i * largura} y={altura - 3} width={largura - 1.5} height={3} rx={1} className={SITUACAO[d.situacao].barra} />}
          </g>
        );
      })}
    </svg>
  );
}

function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className={`${cartao} px-4 py-3`}>
      <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{rotulo}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{valor}</p>
      {detalhe && <p className="text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{detalhe}</p>}
    </div>
  );
}

function CartaoGrafico({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className={`${cartao} px-4 pb-3 pt-3.5`}>
      <h2 className="mb-3 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h2>
      {children}
    </section>
  );
}

export default function PainelFinanceiro({
  mes,
  dados,
  pessoaId = null,
  problema,
}: {
  mes: string;
  dados?: DadosPonto;
  pessoaId?: string | null;
  problema?: Problema;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Financeiro</h1>
          <nav className="mt-3 flex gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-label="Abas do Financeiro">
            <Link
              href={endereco(mes, null)}
              aria-current="page"
              className="-mb-px flex items-center gap-1.5 border-b-2 border-zinc-900 px-3 py-2 text-[13px] font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
            >
              <Clock className="size-3.5" aria-hidden="true" />
              Ponto
            </Link>
          </nav>
        </header>

        {problema || !dados ? (
          <p className={`${cartao} flex items-start gap-2 px-4 py-3 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300`}>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
            {problema === "sem_base"
              ? "A base do app de ponto não está configurada neste ambiente (PONTO_DATABASE_URL)."
              : "A base do app de ponto não respondeu agora. Tente de novo em instantes."}
          </p>
        ) : (
          <AbaPonto dados={dados} pessoaId={pessoaId} />
        )}
      </div>
    </div>
  );
}

function AbaPonto({ dados, pessoaId }: { dados: DadosPonto; pessoaId: string | null }) {
  const { mes } = dados;
  const pessoa = new Map<string, PessoaPonto>(dados.pessoas.map((p) => [p.id, p]));
  const resumos = dados.resumos;
  const total = resumos.reduce(
    (s, r) => ({
      minutos: s.minutos + r.minutos,
      dias: s.dias + r.diasComBatida,
      presencial: s.presencial + r.presencial,
      homeOffice: s.homeOffice + r.homeOffice,
      pendencias: s.pendencias + r.pendencias,
    }),
    { minutos: 0, dias: 0, presencial: 0, homeOffice: 0, pendencias: 0 },
  );
  const comBatida = resumos.filter((r) => r.diasComBatida > 0).length;
  const dias = pessoaId ? dados.dias.filter((d) => d.pessoaId === pessoaId) : dados.dias;
  const maisVelho = dados.meses[dados.meses.length - 1] ?? mes;
  const anterior = mes > maisVelho ? somarMes(mes, -1) : null;
  const seguinte = dados.meses[0] && mes < dados.meses[0] ? somarMes(mes, 1) : null;
  const selecionada = pessoaId ? pessoa.get(pessoaId) : null;
  const resumoDela = pessoaId ? resumos.find((r) => r.pessoaId === pessoaId) : undefined;
  const atual = `${mesAtual()}-01`;
  const diasDaEquipe = dados.porDia.map((d) => d.dia);
  const diasPorPessoa = new Map<string, Map<string, DiaPonto>>();
  for (const d of dados.dias) {
    if (!diasPorPessoa.has(d.pessoaId)) diasPorPessoa.set(d.pessoaId, new Map());
    diasPorPessoa.get(d.pessoaId)!.set(d.dia, d);
  }
  const maiorMes = Math.max(1, ...resumos.map((r) => r.minutos));
  const botaoMes =
    "inline-flex size-8 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {anterior ? (
            <Link href={endereco(anterior, pessoaId)} className={botaoMes} aria-label="Mês anterior">
              <ChevronLeft className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <span className={`${botaoMes} pointer-events-none opacity-40`} aria-hidden="true">
              <ChevronLeft className="size-3.5" />
            </span>
          )}
          <p className="min-w-40 text-center text-[14px] font-medium text-zinc-900 dark:text-zinc-50">{nomeDoMes(mes)}</p>
          {seguinte ? (
            <Link href={endereco(seguinte, pessoaId)} className={botaoMes} aria-label="Mês seguinte">
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <span className={`${botaoMes} pointer-events-none opacity-40`} aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </span>
          )}
        </div>
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
          Lido do app de ponto às {horaCurta(dados.lidoEm)} · {dados.pessoas.length} cadastros, {resumos.length} com registro no mês
        </p>
      </div>

      {selecionada ? (
        <FichaDaPessoa
          dados={dados}
          pessoa={selecionada}
          resumo={resumoDela}
          mediaEquipe={comBatida ? total.minutos / comBatida : 0}
          mediaDiaEquipe={total.dias ? total.minutos / total.dias : 0}
          atual={atual}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Indicador rotulo="Horas no mês" valor={horas(total.minutos)} detalhe="pares entrada → saída; hoje, até agora" />
            <Indicador rotulo="Média por dia trabalhado" valor={total.dias ? horas(total.minutos / total.dias) : "—"} detalhe={`${total.dias} dias de trabalho somados`} />
            <Indicador rotulo="Presencial · home office" valor={`${total.presencial} · ${total.homeOffice}`} detalhe="dias no mês" />
            <Indicador rotulo="Dias com pendência" valor={String(total.pendencias)} detalhe="falta saída, irregular ou sem batida" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <CartaoGrafico titulo="Horas da equipe por dia">
              <EquipePorDia dados={dados.porDia.map((d) => ({ dia: d.dia, horas: d.minutos / 60, pessoas: d.pessoas }))} />
            </CartaoGrafico>
            <CartaoGrafico titulo="Média de horas por pessoa, por mês">
              <EquipePorMes atual={atual} dados={dados.porMes.map((m) => ({ dia: `${m.mes}-01`, horas: m.minutos / 60, pessoas: m.pessoas }))} />
            </CartaoGrafico>
          </div>
        </>
      )}

      <section className={cartao}>
        <h2 className="border-b border-zinc-100 px-4 py-3 text-[13px] font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
          Por colaborador <span className="font-normal text-zinc-400 dark:text-zinc-500">· clique para ver o andamento de cada um</span>
        </h2>
        {resumos.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-zinc-500 dark:text-zinc-400">Ninguém bateu ponto neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Pessoa</th>
                  <th className="px-3 py-2 font-medium">O mês, dia a dia</th>
                  <th className="px-3 py-2 text-right font-medium">Horas</th>
                  <th className="px-3 py-2 text-right font-medium">Dias</th>
                  <th className="px-3 py-2 text-right font-medium">Média/dia</th>
                  <th className="px-3 py-2 text-right font-medium">Chega · sai</th>
                  <th className="px-3 py-2 text-right font-medium">Pres. · home</th>
                  <th className="px-4 py-2 text-right font-medium">Pendências</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {resumos.map((r) => {
                  const p = pessoa.get(r.pessoaId);
                  const ativa = r.pessoaId === pessoaId;
                  return (
                    <tr key={r.pessoaId} className={ativa ? "bg-zinc-50 dark:bg-zinc-800/60" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"}>
                      <td className="px-4 py-2">
                        <Link href={endereco(mes, ativa ? null : r.pessoaId)} className="block min-w-0">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{p?.nome ?? "Cadastro removido"}</span>
                          {p?.admin && <span className="ml-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">admin</span>}
                          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{p?.email}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={endereco(mes, ativa ? null : r.pessoaId)} aria-label={`Ver o andamento de ${p?.nome ?? "esta pessoa"}`}>
                          <BarrasDoMes diasDaEquipe={diasDaEquipe} diasDaPessoa={diasPorPessoa.get(r.pessoaId) ?? new Map()} />
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{horas(r.minutos)}</span>
                        <span className="ml-auto mt-1 block h-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <span className="block h-1 rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ width: `${(r.minutos / maiorMes) * 100}%` }} />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{r.diasComBatida}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {r.diasComBatida ? horas(r.minutos / r.diasComBatida) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {relogio(r.entradaMedia)} · {relogio(r.saidaMedia)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {r.presencial} · {r.homeOffice}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${r.pendencias ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                        {r.pendencias}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Dia a dia</h2>
          {selecionada && (
            <Link
              href={endereco(mes, null)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-0.5 text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {selecionada.nome}
              <X className="size-3" aria-label="mostrar todas as pessoas" />
            </Link>
          )}
        </div>
        {dias.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-zinc-500 dark:text-zinc-400">Nenhum registro neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Dia</th>
                  {!pessoaId && <th className="px-3 py-2 font-medium">Pessoa</th>}
                  <th className="px-3 py-2 font-medium">Modalidade</th>
                  <th className="px-3 py-2 font-medium">Batidas</th>
                  <th className="px-3 py-2 text-right font-medium">Horas</th>
                  <th className="px-4 py-2 text-right font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {dias.map((d) => (
                  <tr key={`${d.pessoaId}|${d.dia}`}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-zinc-700 dark:text-zinc-300">{nomeDoDia(d.dia)}</td>
                    {!pessoaId && (
                      <td className="whitespace-nowrap px-3 py-2 text-zinc-900 dark:text-zinc-100">
                        <Link href={endereco(mes, d.pessoaId)} className="hover:underline">
                          {pessoa.get(d.pessoaId)?.nome ?? "Cadastro removido"}
                        </Link>
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{d.modalidade ? MODALIDADE[d.modalidade] : "—"}</td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      <Batidas dia={d} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{d.minutos ? horas(d.minutos) : "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`${selo} ${SITUACAO[d.situacao].classe}`}>{SITUACAO[d.situacao].rotulo}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** O andamento de um colaborador no mês: os números dele contra a média da equipe e os dois gráficos. */
function FichaDaPessoa({
  dados,
  pessoa,
  resumo,
  mediaEquipe,
  mediaDiaEquipe,
  atual,
}: {
  dados: DadosPonto;
  pessoa: PessoaPonto;
  resumo: ResumoPonto | undefined;
  mediaEquipe: number;
  mediaDiaEquipe: number;
  atual: string;
}) {
  const minutosNoDia = new Map(dados.dias.filter((d) => d.pessoaId === pessoa.id).map((d) => [d.dia, d.minutos]));
  const porDia = dados.porDia.map((e) => ({ dia: e.dia, pessoa: (minutosNoDia.get(e.dia) ?? 0) / 60, media: e.minutos / e.pessoas / 60 }));
  const porMes = dados.porMes.map((m) => ({ dia: `${m.mes}-01`, pessoa: (m.porPessoa[pessoa.id] ?? 0) / 60, media: m.minutos / m.pessoas / 60 }));
  const r = resumo;
  const mediaDia = r?.diasComBatida ? r.minutos / r.diasComBatida : 0;
  const diferenca = (valor: number, referencia: number) => {
    if (!referencia) return "";
    const pct = Math.round(((valor - referencia) / referencia) * 100);
    return pct === 0 ? "igual à média da equipe" : `${pct > 0 ? "+" : ""}${pct}% da média da equipe (${horas(referencia)})`;
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-50">
            {pessoa.nome}
            {pessoa.admin && <span className="ml-1.5 text-[12px] font-normal text-zinc-400 dark:text-zinc-500">admin</span>}
          </h2>
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{pessoa.email}</p>
        </div>
        <Link
          href={endereco(dados.mes, null)}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <X className="size-3" aria-hidden="true" />
          Ver a equipe
        </Link>
      </header>

      {!r ? (
        <p className={`${cartao} px-4 py-3 text-[13px] text-zinc-600 dark:text-zinc-400`}>Sem nenhum registro neste mês.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Indicador rotulo="Horas no mês" valor={horas(r.minutos)} detalhe={diferenca(r.minutos, mediaEquipe)} />
          <Indicador rotulo="Média por dia" valor={horas(mediaDia)} detalhe={diferenca(mediaDia, mediaDiaEquipe)} />
          <Indicador rotulo="Dias trabalhados" valor={String(r.diasComBatida)} detalhe={`de ${dados.porDia.length} dias com a equipe trabalhando`} />
          <Indicador rotulo="Chega · sai" valor={`${relogio(r.entradaMedia)} · ${relogio(r.saidaMedia)}`} detalhe="média da 1ª entrada e da última saída" />
          <Indicador rotulo="Presencial · home office" valor={`${r.presencial} · ${r.homeOffice}`} detalhe="dias no mês" />
          <Indicador rotulo="Pendências" valor={String(r.pendencias)} detalhe="falta saída, irregular ou sem batida" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <CartaoGrafico titulo="Horas por dia">
          <PessoaPorDia nome={pessoa.nome.split(" ")[0]} dados={porDia} />
        </CartaoGrafico>
        <CartaoGrafico titulo="Horas por mês">
          <PessoaPorMes nome={pessoa.nome.split(" ")[0]} atual={atual} dados={porMes} />
        </CartaoGrafico>
      </div>
    </section>
  );
}
