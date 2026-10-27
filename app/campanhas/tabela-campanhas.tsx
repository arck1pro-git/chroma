"use client";

// A aba Campanhas do Meta Ads (redesenho de 2026-10-23): todas as campanhas,
// com as métricas em VISÕES como as do Gerenciador — Desempenho, Funil do CRM,
// Entrega, Cliques, Vídeo, Engajamento. Uma visão por vez cabe na tela; todas
// juntas são as 40 métricas do catálogo (lib/meta-ads-metricas.ts), que vão
// inteiras para o CSV.
//
// O NOME FICA PRESO à esquerda quando a visão tem mais colunas do que a tela:
// a tabela rola de lado sem perder de vista de qual campanha é cada número.
// Cada cabeçalho ordena (custo começa do menor; o resto, do maior) e explica,
// no title, o que mede. A última linha é a CONTA, lida da Meta — alcance e
// frequência não somam campanhas.
import { useMemo, useState } from "react";
import { formatarMetrica, linhasCsv, metrica, teveResultado, VISOES, type ContextoMetrica, type LinhaMetricas } from "@/lib/meta-ads-metricas";
import type { RelatorioAds } from "@/lib/meta-ads-tipos";
import { ArrowDown, ArrowDownToLine, ArrowUp, Megaphone } from "@/app/components/icones";
import { CampoBusca } from "../components/filtros-ui";
import { Segmentado } from "./metricas-ui";
import { Vazio, botaoAds, entregaLegivel, objetivos } from "./pecas";

export default function TabelaCampanhas({ r, ctx, selecionada, aoAbrir }: {
  r: RelatorioAds; ctx: ContextoMetrica; selecionada: string; aoAbrir: (id: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState(VISOES[0].id);
  const [ordem, setOrdem] = useState<{ chave: string; desc: boolean }>({ chave: "gasto", desc: true });
  const [verTodas, setVerTodas] = useState(false);
  const colunas = (VISOES.find((v) => v.id === visao) ?? VISOES[0]).colunas.map(metrica)
    // Sem acesso ao funil, coluna do CRM seria uma fileira de "—".
    .filter((d) => !d.crm || r.total.crm);

  const { linhas, ocultas } = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase();
    const todas = r.campanhas.filter((l) => l.name.toLocaleLowerCase().includes(termo));
    // Buscando, aparece o que casar — inclusive a campanha parada.
    const visiveis = verTodas || termo ? todas : todas.filter(teveResultado);
    const def = metrica(ordem.chave);
    const sentido = ordem.desc ? -1 : 1;
    const ordenadas = [...visiveis].sort((a, b) => {
      const x = def.valor(a, ctx), y = def.valor(b, ctx);
      // Sem valor (custo sem lead, CRM sem acesso) vai para o fim nos dois sentidos.
      if (x === null || y === null) return x === y ? b.metricas.gasto - a.metricas.gasto : x === null ? 1 : -1;
      return x === y ? b.metricas.gasto - a.metricas.gasto : (x - y) * sentido;
    });
    return { linhas: ordenadas, ocultas: todas.length - visiveis.length };
  }, [r, busca, ordem, verTodas, ctx]);
  const maiorGasto = Math.max(...linhas.map((l) => l.metricas.gasto), 1);
  const total: LinhaMetricas = { metricas: r.total.metricas, crm: r.total.crm };

  function ordenarPor(chave: string) {
    const doMenor = metrica(chave).melhor === "menor";
    setOrdem((atual) => (atual.chave === chave ? { chave, desc: !atual.desc } : { chave, desc: !doMenor }));
  }

  function exportar() {
    const escapar = (v: unknown) => { const texto = String(v ?? ""); return `"${(/^[=+@\-\t\r]/.test(texto) ? "'" : "") + texto.replaceAll('"', '""')}"`; };
    const dados = linhasCsv(linhas, ctx, (l) => [entregaLegivel(l.effective_status), objetivos[l.objective ?? ""] ?? "", ctx.moeda, r.periodo.inicio, r.periodo.fim],
      ["Entrega", "Objetivo", "Moeda", "Início", "Fim"]);
    const url = URL.createObjectURL(new Blob(["﻿" + dados.map((l) => l.map(escapar).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `meta-ads-campanhas-${r.periodo.inicio}-${r.periodo.fim}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-60"><CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar campanha" /></div>
        <button className={botaoAds} disabled={!linhas.length} onClick={exportar} title="Todas as métricas das campanhas listadas, para planilha">
          <ArrowDownToLine className="size-3.5" aria-hidden="true" />Exportar CSV
        </button>
      </div>
      <Segmentado rotulo="Visão das colunas" valor={visao} aoMudar={setVisao} opcoes={VISOES.filter((v) => v.id !== "funil" || r.total.crm).map((v) => ({ valor: v.id, rotulo: v.rotulo }))} />

      {linhas.length ? (
        <section aria-label="Campanhas" className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 min-w-[16rem] border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
                    Campanha
                  </th>
                  {colunas.map((d) => {
                    const ativa = ordem.chave === d.chave;
                    const Direcao = ordem.desc ? ArrowDown : ArrowUp;
                    return (
                      <th key={d.chave} scope="col" aria-sort={ativa ? (ordem.desc ? "descending" : "ascending") : undefined}
                        className="whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-3 py-2.5 text-right dark:border-zinc-800 dark:bg-zinc-900">
                        <button type="button" onClick={() => ordenarPor(d.chave)} title={`${d.rotulo}: ${d.descricao}`}
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition hover:text-zinc-700 dark:hover:text-zinc-200 ${ativa ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-400 dark:text-zinc-500"}`}>
                          {ativa && <Direcao className="size-3" aria-hidden="true" />}{d.curto}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const marcada = l.id === selecionada;
                  return (
                    <tr key={l.id} onClick={() => aoAbrir(l.id)} className={`group cursor-pointer ${marcada ? "bg-zinc-50 dark:bg-zinc-900/60" : ""}`}>
                      <th scope="row" className={`sticky left-0 z-[1] border-b border-zinc-100 px-4 py-2.5 text-left font-normal transition dark:border-zinc-900 ${marcada ? "bg-zinc-50 dark:bg-zinc-900" : "bg-white group-hover:bg-zinc-50 dark:bg-zinc-950 dark:group-hover:bg-zinc-900"}`}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); aoAbrir(l.id); }} aria-label={`Abrir ${l.name}`} className="block w-full text-left outline-none focus-visible:underline">
                          {/* Até duas linhas: os nomes desta conta carregam a estrutura entre
                              colchetes ([LEADS][CBO][LP1]), e cortar em uma escondia
                              justamente a parte que distingue uma campanha da outra. */}
                          <span className="flex items-start gap-1.5 font-medium leading-snug text-zinc-900 dark:text-zinc-50" title={l.name}>
                            <span className="line-clamp-2 max-w-[22rem] break-words">{l.name}</span>
                            {l.effective_status === "ACTIVE" && <span role="img" aria-label="Em veiculação" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-400" />}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                            {objetivos[l.objective ?? ""] ?? "Campanha"}{l.effective_status !== "ACTIVE" && ` · ${entregaLegivel(l.effective_status)}`}
                          </span>
                          {/* participação no investimento: o olho compara as barras antes de ler os números */}
                          <span className="mt-1.5 block h-1 w-full max-w-48 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <span className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-600" style={{ width: `${(l.metricas.gasto / maiorGasto) * 100}%` }} />
                          </span>
                        </button>
                      </th>
                      {colunas.map((d) => (
                        <td key={d.chave} className="whitespace-nowrap border-b border-zinc-100 px-3 py-2.5 text-right tabular-nums text-zinc-900 transition group-hover:bg-zinc-50 dark:border-zinc-900 dark:text-zinc-100 dark:group-hover:bg-zinc-900/60">
                          {formatarMetrica(d.valor(l, ctx), d.formato, ctx.moeda)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="sticky left-0 z-[1] bg-zinc-50 px-4 py-2.5 text-left text-[12px] font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                    Conta inteira
                  </th>
                  {colunas.map((d) => (
                    <td key={d.chave} className="whitespace-nowrap bg-zinc-50 px-3 py-2.5 text-right text-[12.5px] font-semibold tabular-nums text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50">
                      {formatarMetrica(d.valor(total, ctx), d.formato, ctx.moeda)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          {ocultas > 0 && (
            <button type="button" onClick={() => setVerTodas(true)}
              className="w-full border-t border-zinc-200 px-4 py-2 text-left text-[11.5px] text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-zinc-50">
              +{ocultas} {ocultas === 1 ? "campanha" : "campanhas"} sem investimento nem lead no período
            </button>
          )}
        </section>
      ) : <Vazio Icone={Megaphone} texto={busca ? "Nenhuma campanha com esse nome." : "Nenhuma campanha veiculou neste período."} />}
    </div>
  );
}