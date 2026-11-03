// A aba Folha do Financeiro: o que pagar a cada profissional no mês, agrupado
// por setor, com o total do setor e o total dos pagamentos do pessoal.
//
// Em cada linha: o profissional com a atividade principal e o PIX embaixo (em
// coluna própria, a atividade empurrava o valor total para fora da tela), o
// tipo, valor hora, valor mês, a REFERÊNCIA (as horas do mês, do ponto), o
// adicional e os descontos lançados
// no mês e o total do profissional (lib/financeiro-tipos.ts, contaDoMes). Quem
// não tem cadastro de pagamento aparece sem total e fica fora das somas.
//
// Aparece quem bateu ponto no mês OU tem cadastro na folha (o fixo recebe mesmo
// sem batida). Os demais cadastros do app de ponto ficam numa linha embaixo,
// para cadastrar. Editar (clicar no nome, ?pessoa=<id>) pede a permissão de
// editar no Financeiro.
import Link from "next/link";
import type { Folha } from "@/lib/financeiro-pagamentos";
import { contaDoMes, reais, SEM_LANCAMENTO, type CadastroPagamento, type LancamentoMes } from "@/lib/financeiro-tipos";
import type { DadosPonto, PessoaPonto } from "@/lib/ponto";
import { AlertTriangle, Pencil } from "@/app/components/icones";
import { cartao, endereco, horas, Indicador, NavegacaoDoMes, nomeDoMes } from "./comum";
import EditarFolha, { CopiarPix } from "./editar-folha";

const SEM_SETOR = "Sem setor";

type Linha = {
  pessoa: PessoaPonto;
  cadastro: CadastroPagamento | null;
  lancamento: LancamentoMes;
  minutos: number;
  pendencias: number;
  conta: ReturnType<typeof contaDoMes>;
};

const valorOuTraco = (v: number | null, apagado = false) => (
  <span className={apagado ? "text-zinc-400 dark:text-zinc-500" : undefined}>{v === null || v === 0 ? "—" : reais(v)}</span>
);

export default function AbaFolha({
  dados,
  folha,
  pessoaId,
  podeEditar,
}: {
  dados: DadosPonto;
  folha: Folha | null;
  pessoaId: string | null;
  podeEditar: boolean;
}) {
  const { mes } = dados;
  const navegacao = (
    <NavegacaoDoMes aba="folha" mes={mes} meses={dados.meses} pessoaId={null} legenda="Referência: as horas do app de ponto · valores guardados no CRM" />
  );
  if (!folha) {
    return (
      <>
        {navegacao}
        <p className={`${cartao} flex items-start gap-2 px-4 py-3 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300`}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          As tabelas da folha ainda não existem neste banco: rode a migration-financeiro-colaboradores.sql.
        </p>
      </>
    );
  }

  const resumo = new Map(dados.resumos.map((r) => [r.pessoaId, r]));
  const linhas: Linha[] = dados.pessoas
    .filter((p) => resumo.has(p.id) || folha.cadastros.has(p.id))
    .map((p) => {
      const cadastro = folha.cadastros.get(p.id) ?? null;
      const lancamento = folha.lancamentos.get(p.id) ?? SEM_LANCAMENTO;
      const minutos = resumo.get(p.id)?.minutos ?? 0;
      return { pessoa: p, cadastro, lancamento, minutos, pendencias: resumo.get(p.id)?.pendencias ?? 0, conta: contaDoMes(cadastro, minutos, lancamento) };
    });
  const fora = dados.pessoas.filter((p) => !resumo.has(p.id) && !folha.cadastros.has(p.id));

  // Por setor, em ordem alfabética, com o "Sem setor" por último.
  const porSetor = new Map<string, Linha[]>();
  for (const l of linhas) {
    const s = l.cadastro?.setor ?? SEM_SETOR;
    porSetor.set(s, [...(porSetor.get(s) ?? []), l]);
  }
  const setores = [...porSetor.keys()].sort((a, b) => (a === SEM_SETOR ? 1 : b === SEM_SETOR ? -1 : a.localeCompare(b, "pt-BR")));
  const soma = (ls: Linha[], f: (l: Linha) => number | null) => ls.reduce((s, l) => s + (f(l) ?? 0), 0);
  const comTotal = linhas.filter((l) => l.conta.total !== null);
  const semValor = linhas.length - comTotal.length;
  const totalGeral = soma(comTotal, (l) => l.conta.total);

  const selecionada = pessoaId ? dados.pessoas.find((p) => p.id === pessoaId) : undefined;
  const nomesDeSetor = [...new Set([...folha.cadastros.values()].map((c) => c.setor).filter((s): s is string => Boolean(s)))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const colunas = 8;

  return (
    <>
      {navegacao}

      {selecionada && podeEditar && (
        <EditarFolha
          key={`${selecionada.id}|${mes}`}
          mes={mes}
          mesNome={nomeDoMes(mes)}
          pessoa={{ id: selecionada.id, nome: selecionada.nome, email: selecionada.email }}
          minutos={resumo.get(selecionada.id)?.minutos ?? 0}
          horasTexto={horas(resumo.get(selecionada.id)?.minutos ?? 0)}
          cadastro={folha.cadastros.get(selecionada.id) ?? null}
          lancamento={folha.lancamentos.get(selecionada.id) ?? SEM_LANCAMENTO}
          setores={nomesDeSetor}
          fecharHref={endereco("folha", mes)}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Indicador
          rotulo="Total dos pagamentos do pessoal"
          valor={reais(totalGeral)}
          detalhe={semValor ? `${semValor} sem valor cadastrado, fora da soma` : `${comTotal.length} profissionais`}
        />
        <Indicador rotulo="Base (horas e fixos)" valor={reais(soma(comTotal, (l) => l.conta.base))} />
        <Indicador rotulo="Adicionais" valor={reais(soma(comTotal, (l) => l.conta.adicional))} detalhe="deslocamento e ajuda de custo" />
        <Indicador rotulo="Descontos" valor={reais(soma(comTotal, (l) => l.conta.descontos))} />
      </div>

      <section className={cartao}>
        <h2 className="border-b border-zinc-100 px-4 py-3 text-[13px] font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
          Folha de {nomeDoMes(mes).toLowerCase()}
          {podeEditar && <span className="font-normal text-zinc-400 dark:text-zinc-500"> · clique no profissional para editar</span>}
        </h2>
        {linhas.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-zinc-500 dark:text-zinc-400">Ninguém bateu ponto nem tem cadastro na folha neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Profissional · atividade principal</th>
                  <th className="px-2.5 py-2 font-medium">Tipo</th>
                  <th className="px-2.5 py-2 text-right font-medium">Valor hora</th>
                  <th className="px-2.5 py-2 text-right font-medium">Valor mês</th>
                  <th className="px-2.5 py-2 text-right font-medium">Referência</th>
                  <th className="px-2.5 py-2 text-right font-medium">Adicional</th>
                  <th className="px-2.5 py-2 text-right font-medium">Descontos</th>
                  <th className="px-4 py-2 text-right font-medium">Valor total</th>
                </tr>
              </thead>
              {setores.map((setor) => {
                const doSetor = porSetor.get(setor)!.sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));
                return (
                  <tbody key={setor} className="divide-y divide-zinc-100 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                      <th colSpan={colunas - 1} scope="rowgroup" className="px-4 py-2 text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
                        {setor} <span className="font-normal text-zinc-400 dark:text-zinc-500">· {doSetor.length}</span>
                      </th>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-[12px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                        <span className="mr-1.5 font-normal text-zinc-400 dark:text-zinc-500">total do setor</span>
                        {reais(soma(doSetor.filter((l) => l.conta.total !== null), (l) => l.conta.total))}
                      </td>
                    </tr>
                    {doSetor.map((l) => {
                      const c = l.cadastro;
                      const nome = (
                        <>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{l.pessoa.nome}</span>
                          {podeEditar && <Pencil className="ml-1.5 inline size-2.5 text-zinc-400" aria-hidden="true" />}
                        </>
                      );
                      return (
                        <tr key={l.pessoa.id} className={l.pessoa.id === pessoaId ? "bg-zinc-50 dark:bg-zinc-800/60" : undefined}>
                          <td className="max-w-56 px-4 py-2">
                            {podeEditar ? (
                              <Link href={endereco("folha", mes, l.pessoa.id)} className="block hover:underline">
                                {nome}
                              </Link>
                            ) : (
                              <span className="block">{nome}</span>
                            )}
                            {c?.atividade && <span className="block text-[12px] text-zinc-600 dark:text-zinc-400">{c.atividade}</span>}
                            {c?.pix ? <CopiarPix pix={c.pix} /> : <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">sem PIX</span>}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-zinc-700 dark:text-zinc-300">
                            {c ? (c.tipo === "hora" ? "Por hora" : "Fixo") : <span className="text-amber-700 dark:text-amber-400">Sem cadastro</span>}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {valorOuTraco(c?.valorHora ?? null, c?.tipo === "fixo")}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {valorOuTraco(c?.valorMes ?? null, c?.tipo === "hora")}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {horas(l.minutos)}
                            {l.pendencias > 0 && (
                              <span className="block text-[11px] text-amber-700 dark:text-amber-400" title="Dias com batida faltando: as horas deles não entram">
                                {l.pendencias} {l.pendencias === 1 ? "pendência" : "pendências"}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{valorOuTraco(l.lancamento.adicional)}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                            {l.lancamento.descontos ? `− ${reais(l.lancamento.descontos)}` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                            {l.conta.total === null ? <span className="font-normal text-zinc-400 dark:text-zinc-500">sem valor</span> : reais(l.conta.total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
              <tfoot className="border-t-2 border-zinc-200 dark:border-zinc-700">
                <tr>
                  <th colSpan={colunas - 1} scope="row" className="px-4 py-3 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                    Valor total dos pagamentos do pessoal
                  </th>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-[14px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{reais(totalGeral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {fora.length > 0 && (
          <p className="border-t border-zinc-100 px-4 py-3 text-[12px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Sem ponto no mês e sem cadastro na folha:{" "}
            {fora.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                {podeEditar ? (
                  <Link href={endereco("folha", mes, p.id)} className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">
                    {p.nome}
                  </Link>
                ) : (
                  p.nome
                )}
              </span>
            ))}
          </p>
        )}
      </section>
    </>
  );
}
