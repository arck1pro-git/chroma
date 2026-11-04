// A tela do Financeiro, de cima para baixo (2026-11-04, "essa página deve ser
// mais larga... um header no topo com o botão de adicionar colaborador e essa
// aba de ponto para baixo"):
//   · o cabeçalho, com o mês e o "Adicionar colaborador", e a folha do mês por
//     setor (./folha.tsx); editar abre a gaveta do pagamento por cima;
//   · o Ponto (#ponto). Na visão da equipe: os números do mês, as horas por dia
//     e a tabela por pessoa com o mês de cada um em barrinhas. Na de um
//     colaborador (?pessoa=<id>): os números dele contra a média da equipe e os
//     gráficos com a média ao lado. Os links do Ponto levam a âncora #ponto,
//     para a página abrir nele e não no topo.
// Componente de servidor: os filtros são links; a folha, a gaveta e os
// gráficos são do cliente.
import type { ReactNode } from "react";
import Link from "next/link";
import type { Folha } from "@/lib/financeiro-pagamentos";
import { horaCurta } from "@/lib/formato";
import { mesAtual, type DadosPonto, type DiaPonto, type PessoaPonto, type ResumoPonto, type SituacaoDia } from "@/lib/ponto";
import { AlertTriangle, X } from "@/app/components/icones";
import { CabecalhoFinanceiro, cartao, endereco, horas, Indicador, NavegacaoDoMes, PAGINA } from "./comum";
import FolhaDoMes from "./folha";
import { EquipePorDia, PessoaPorDia, PessoaPorMes } from "./graficos";

type Problema = "sem_base" | "sem_resposta";

/** A situação do dia nas barrinhas do mês: o nome (no título da barra) e a cor. */
const SITUACAO: Record<SituacaoDia, { rotulo: string; barra: string }> = {
  completo: { rotulo: "Ok", barra: "fill-zinc-400 dark:fill-zinc-500" },
  em_andamento: { rotulo: "Em andamento", barra: "fill-sky-500 dark:fill-sky-400" },
  falta_saida: { rotulo: "Falta saída", barra: "fill-amber-500 dark:fill-amber-400" },
  irregular: { rotulo: "Irregular", barra: "fill-amber-500 dark:fill-amber-400" },
  sem_batida: { rotulo: "Sem batida", barra: "fill-red-500 dark:fill-red-400" },
};

/** 522 (minutos desde a meia-noite) → "08:42". */
function relogio(minutos: number | null): string {
  if (minutos === null) return "—";
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/** "2026-11-03" → "03/11 ter". */
function nomeDoDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const semana = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${semana}`;
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

function CartaoGrafico({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className={`${cartao} px-4 pb-3 pt-3.5`}>
      <h3 className="mb-3 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h3>
      {children}
    </section>
  );
}

export default function PainelFinanceiro({
  mes,
  dados,
  folha,
  pessoaId = null,
  podeEditar = false,
  problema,
}: {
  mes: string;
  dados?: DadosPonto;
  /** null = as tabelas da folha ainda não existem neste banco. */
  folha?: Folha | null;
  pessoaId?: string | null;
  podeEditar?: boolean;
  problema?: Problema;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-8">
      <div className={PAGINA}>
        {problema || !dados ? (
          <>
            <CabecalhoFinanceiro />
            <p className={`${cartao} flex items-start gap-2 px-4 py-3 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300`}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
              {problema === "sem_base"
                ? "A base do app de ponto não está configurada neste ambiente (PONTO_DATABASE_URL)."
                : "A base do app de ponto não respondeu agora. Tente de novo em instantes."}
            </p>
          </>
        ) : (
          <>
            <FolhaDoMes
              dados={dados}
              folha={folha ?? null}
              podeEditar={podeEditar}
              legenda={`Folha e ponto da equipe · lido do app de ponto às ${horaCurta(dados.lidoEm)}, ${dados.pessoas.length} cadastros, ${dados.resumos.length} com registro no mês`}
              navegacao={<NavegacaoDoMes mes={mes} meses={dados.meses} pessoaId={pessoaId} />}
            />
            <SecaoPonto dados={dados} pessoaId={pessoaId} />
          </>
        )}
      </div>
    </div>
  );
}

function SecaoPonto({ dados, pessoaId }: { dados: DadosPonto; pessoaId: string | null }) {
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
  const selecionada = pessoaId ? pessoa.get(pessoaId) : null;
  const resumoDela = pessoaId ? resumos.find((r) => r.pessoaId === pessoaId) : undefined;
  const diasDaEquipe = dados.porDia.map((d) => d.dia);
  const diasPorPessoa = new Map<string, Map<string, DiaPonto>>();
  for (const d of dados.dias) {
    if (!diasPorPessoa.has(d.pessoaId)) diasPorPessoa.set(d.pessoaId, new Map());
    diasPorPessoa.get(d.pessoaId)!.set(d.dia, d);
  }
  const maiorMes = Math.max(1, ...resumos.map((r) => r.minutos));

  return (
    <section id="ponto" aria-labelledby="titulo-ponto" className="flex scroll-mt-6 flex-col gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 id="titulo-ponto" className="text-[16px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Ponto <span className="text-[12.5px] font-normal text-zinc-500 dark:text-zinc-400">· as horas da equipe no mês, lidas do app de ponto</span>
      </h2>

      {selecionada ? (
        <FichaDaPessoa
          dados={dados}
          pessoa={selecionada}
          resumo={resumoDela}
          mediaEquipe={comBatida ? total.minutos / comBatida : 0}
          mediaDiaEquipe={total.dias ? total.minutos / total.dias : 0}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Indicador rotulo="Horas no mês" valor={horas(total.minutos)} detalhe="pares entrada → saída; hoje, até agora" />
            <Indicador rotulo="Média por dia trabalhado" valor={total.dias ? horas(total.minutos / total.dias) : "—"} detalhe={`${total.dias} dias de trabalho somados`} />
            <Indicador rotulo="Presencial · home office" valor={`${total.presencial} · ${total.homeOffice}`} detalhe="dias no mês" />
            <Indicador rotulo="Dias com pendência" valor={String(total.pendencias)} detalhe="falta saída, irregular ou sem batida" />
          </div>
          <CartaoGrafico titulo="Horas da equipe por dia">
            <EquipePorDia dados={dados.porDia.map((d) => ({ dia: d.dia, horas: d.minutos / 60, pessoas: d.pessoas }))} />
          </CartaoGrafico>
        </>
      )}

      <section className={cartao}>
        <h3 className="border-b border-zinc-100 px-4 py-3 text-[13px] font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
          Por colaborador <span className="font-normal text-zinc-400 dark:text-zinc-500">· clique para ver o andamento de cada um</span>
        </h3>
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
                  const link = `${endereco(mes, ativa ? null : r.pessoaId)}#ponto`;
                  return (
                    <tr key={r.pessoaId} className={ativa ? "bg-zinc-50 dark:bg-zinc-800/60" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"}>
                      <td className="px-4 py-2">
                        <Link href={link} className="block min-w-0">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{p?.nome ?? "Cadastro removido"}</span>
                          {p?.admin && <span className="ml-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">admin</span>}
                          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{p?.email}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={link} aria-label={`Ver o andamento de ${p?.nome ?? "esta pessoa"}`}>
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
    </section>
  );
}

/** O andamento de um colaborador no mês: os números dele contra a média da equipe e os dois gráficos. */
function FichaDaPessoa({
  dados,
  pessoa,
  resumo,
  mediaEquipe,
  mediaDiaEquipe,
}: {
  dados: DadosPonto;
  pessoa: PessoaPonto;
  resumo: ResumoPonto | undefined;
  mediaEquipe: number;
  mediaDiaEquipe: number;
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
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">
            {pessoa.nome}
            {pessoa.admin && <span className="ml-1.5 text-[12px] font-normal text-zinc-400 dark:text-zinc-500">admin</span>}
          </h3>
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{pessoa.email}</p>
        </div>
        <Link
          href={`${endereco(dados.mes)}#ponto`}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-[12px] text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <X className="size-3" aria-hidden="true" />
          Ver a equipe
        </Link>
      </header>

      {!r ? (
        <p className={`${cartao} px-4 py-3 text-[13px] text-zinc-600 dark:text-zinc-400`}>Sem nenhum registro de ponto neste mês.</p>
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
          <PessoaPorMes nome={pessoa.nome.split(" ")[0]} atual={`${mesAtual()}-01`} dados={porMes} />
        </CartaoGrafico>
      </div>
    </div>
  );
}
