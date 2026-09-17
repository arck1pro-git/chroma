import Link from "next/link";
import { brl } from "../formato";
import { PERIODOS, type DadosMetricas, type MetricaPessoa } from "./dados";
import type { Escopo } from "@/lib/auth/modulos";

// Server component, sem "use client": tudo aqui é leitura, e o único controle
// da tela (o período) é um <Link> que troca a querystring. Sem estado, sem
// hidratação, sem JavaScript enviado pra isso.

function Cartao({
  rotulo,
  valor,
  nota,
}: {
  rotulo: string;
  valor: string;
  nota: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </p>
      {/* tabular-nums: sem isso os números dançam de largura entre um card e
          outro, e a linha de cima deixa de se alinhar com a de baixo. */}
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
        {valor}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{nota}</p>
    </div>
  );
}

const celula = "px-3 py-2.5 text-[13px] tabular-nums text-zinc-700 dark:text-zinc-300";
const cabecalho =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";

function Linha({ pessoa }: { pessoa: MetricaPessoa }) {
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800/70">
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            {pessoa.iniciais}
          </span>
          <span className="truncate text-[13px] text-zinc-900 dark:text-zinc-50">
            {pessoa.nome}
          </span>
        </span>
      </td>
      <td className={celula}>{pessoa.carteira}</td>
      <td className={celula}>{brl(pessoa.valorAberto)}</td>
      <td className={celula}>{brl(pessoa.ticketMedio)}</td>
      <td className={celula}>{pessoa.diasMedio}d</td>
      <td className={celula}>{pessoa.criadasNoPeriodo}</td>
      <td className={celula}>
        {pessoa.atendimentosAbertos}
        <span className="text-zinc-400 dark:text-zinc-500">
          {" "}
          / {pessoa.atendimentosEncerrados}
        </span>
      </td>
      <td className={celula}>{pessoa.mensagensEnviadas}</td>
    </tr>
  );
}

export default function TelaMetricas({
  dados,
  escopo,
  nome,
}: {
  dados: DadosMetricas;
  escopo: Escopo;
  nome: string;
}) {
  const { total, pessoas, dias } = dados;
  const soMinhas = escopo === "proprio";

  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-6 py-6 xl:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Métricas
            </h1>
            {/* Diz na cara de quem é o número. Sem esta linha, o comercial que
                vê 12 oportunidades não sabe se são as dele ou as da casa — e a
                diferença entre as duas leituras é o sentido inteiro da tela. */}
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {soMinhas
                ? `Carteira e atividade de ${nome}.`
                : "Carteira e atividade de todo o time."}
            </p>
          </div>

          <nav
            aria-label="Período"
            className="flex items-center gap-1 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800"
          >
            {PERIODOS.map((p) => {
              const ativo = p === dias;
              return (
                <Link
                  key={p}
                  href={`/metricas?dias=${p}`}
                  aria-current={ativo ? "page" : undefined}
                  className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                    ativo
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"
                  }`}
                >
                  {p} dias
                </Link>
              );
            })}
          </nav>
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Cartao
            rotulo="Carteira"
            valor={String(total.carteira)}
            nota="oportunidades em aberto"
          />
          <Cartao
            rotulo="Valor em aberto"
            valor={brl(total.valorAberto)}
            nota={`ticket médio ${brl(total.ticketMedio)}`}
          />
          <Cartao
            rotulo="Novas"
            valor={String(total.criadasNoPeriodo)}
            nota={`criadas nos últimos ${dias} dias`}
          />
          <Cartao
            rotulo="Mensagens"
            valor={String(total.mensagensEnviadas)}
            nota={`enviadas nos últimos ${dias} dias`}
          />
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Cartao
            rotulo="Idade média da carteira"
            valor={`${total.diasMedio} dias`}
            nota="desde a criação da oportunidade"
          />
          <Cartao
            rotulo="Atendimentos"
            valor={`${total.atendimentosAbertos} / ${total.atendimentosEncerrados}`}
            nota="abertos / encerrados"
          />
        </section>

        {/* A tabela por pessoa só faz sentido com escopo 'todos'. Com 'proprio'
            ela teria uma linha só, repetindo os cartões de cima. */}
        {!soMinhas && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
              Por pessoa
            </h2>

            {pessoas.length === 0 ? (
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                Nenhum usuário ativo.
              </p>
            ) : (
              // overflow-x-auto: são 8 colunas de número, e num notebook estreito
              // a tabela tem que rolar sozinha em vez de empurrar a página toda.
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr>
                      <th className={cabecalho}>Pessoa</th>
                      <th className={cabecalho}>Carteira</th>
                      <th className={cabecalho}>Em aberto</th>
                      <th className={cabecalho}>Ticket</th>
                      <th className={cabecalho}>Idade</th>
                      <th className={cabecalho}>Novas</th>
                      <th className={cabecalho}>Atend.</th>
                      <th className={cabecalho}>Msgs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pessoas.map((p) => (
                      <Linha key={p.usuarioId} pessoa={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* O rodapé honesto. A tela não tem "ganhas", "perdidas" nem taxa de
            conversão, e quem abre esperando isso merece saber por quê em vez de
            concluir que o número sumiu. */}
        <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
          Não há ganhas, perdidas nem taxa de conversão aqui: nada no CRM escreve
          esses estados hoje — toda oportunidade fica como <code>aberta</code> — e
          não existe registro de quando ela mudou de etapa. Os números acima são
          os que o banco responde de verdade.
        </p>
      </div>
    </div>
  );
}
