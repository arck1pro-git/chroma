"use client";

// A aba Desempenho: o site no Google (Search Console) e como os artigos do blog
// estão indo nele.
//
// DE CIMA PARA BAIXO, do geral para o artigo:
//   1. os quatro números do site no período, contra o período anterior — e,
//      embaixo de cada um, quanto disso é do blog;
//   2. o dia a dia do número escolhido (clicar num cartão troca a linha, como
//      no próprio Search Console);
//   3. as consultas que trazem gente e as páginas mais vistas;
//   4. cada artigo postado, com os seus números, do que mais aparece ao que
//      ainda não apareceu.
//
// Os números vêm da tela do blog (tela-blog.tsx), que os busca uma vez e os
// divide com os cartões do quadro. Antes de conectar, quem responde é
// ./conectar-google.tsx.
import { useMemo, useState } from "react";
import { urlDoArtigo, type Artigo } from "@/lib/artigo";
import {
  PERIODOS_GOOGLE,
  numeroCurto,
  porcento,
  posicao,
  urlComparavel,
  type DesempenhoDoBlog,
  type DiaGoogle,
  type GoogleDoBlog,
  type MetricasGoogle,
  type PeriodoGoogle,
} from "@/lib/blog-google-tipos";
import { dataCurta } from "@/lib/formato";
import { LinhasPorDia, mesCurto, type EscalaLinha } from "@/app/components/grafico-linhas";
import { ArrowUpRight, Eye, Hash, MousePointerClick, RefreshCw, Search, TrendingUp } from "@/app/components/icones";
import { Segmentos, Variacao, tempoAtras } from "../pecas";
import ConectarGoogle from "./conectar-google";

type IdMetrica = keyof MetricasGoogle;

const METRICAS: {
  id: IdMetrica;
  rotulo: string;
  ajuda: string;
  formatar: (v: number) => string;
  menorEMelhor?: boolean;
  Icone: typeof Eye;
}[] = [
  { id: "cliques", rotulo: "Cliques", ajuda: "Vezes que alguém veio do Google para o site", formatar: numeroCurto, Icone: MousePointerClick },
  { id: "impressoes", rotulo: "Impressões", ajuda: "Vezes que o site apareceu numa busca", formatar: numeroCurto, Icone: Eye },
  { id: "ctr", rotulo: "CTR médio", ajuda: "Cliques divididos pelas impressões", formatar: porcento, Icone: TrendingUp },
  { id: "posicao", rotulo: "Posição média", ajuda: "Lugar médio nos resultados; 1 é o topo", formatar: posicao, menorEMelhor: true, Icone: Hash },
];

const ROTULO_PERIODO: Record<PeriodoGoogle, string> = { 7: "7 dias", 28: "28 dias", 90: "3 meses" };

export default function Desempenho({
  google,
  artigos,
  blog,
  periodo,
  atualizando,
  podeEditar,
  aoMudarPeriodo,
  aoAtualizar,
  aoAbrirArtigo,
  aoConfigurar,
}: {
  google: GoogleDoBlog | null;
  artigos: Artigo[];
  blog: { url_base: string };
  periodo: PeriodoGoogle;
  atualizando: boolean;
  podeEditar: boolean;
  aoMudarPeriodo: (p: PeriodoGoogle) => void;
  aoAtualizar: () => void;
  aoAbrirArtigo: (a: Artigo) => void;
  aoConfigurar: () => void;
}) {
  if (!google) return <Esqueleto />;
  if (google.estado !== "ok") {
    return (
      <ConectarGoogle
        estado={google}
        verificando={atualizando}
        podeEditar={podeEditar}
        aoVerificar={aoAtualizar}
        aoConfigurar={aoConfigurar}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-10 @md:px-6">
        {/* ── Barra: de onde vem, de quando é ─────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 text-[12px] text-zinc-500 dark:text-zinc-400">
            Search Console ·{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{google.propriedade.replace(/^sc-domain:/, "")}</span>
            <span className="text-zinc-400 dark:text-zinc-500">
              {" "}
              · {dataCurta(google.periodo.inicio)} a {dataCurta(google.periodo.fim)}
            </span>
          </p>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">atualizado {tempoAtras(google.lidoEm)}</span>
            <button
              type="button"
              onClick={aoAtualizar}
              disabled={atualizando}
              aria-label="Buscar de novo no Google"
              title="Buscar de novo no Google"
              className="flex size-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <RefreshCw className={`size-3.5 ${atualizando ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
            <Segmentos
              opcoes={PERIODOS_GOOGLE.map((p) => ({ id: p, rotulo: ROTULO_PERIODO[p] }))}
              valor={periodo}
              aoMudar={aoMudarPeriodo}
              rotulo="Período"
            />
          </div>
        </div>

        <Painel dados={google} />

        <div className="grid gap-4 @4xl:grid-cols-2">
          <Ranking
            titulo="Consultas que trazem gente"
            Icone={Search}
            vazio="Nenhuma busca levou ao site no período."
            linhas={google.consultas.map((c) => ({ chave: c.termo, rotulo: c.termo, m: c }))}
          />
          <Ranking
            titulo="Páginas mais vistas"
            Icone={ArrowUpRight}
            vazio="Nenhuma página apareceu no Google no período."
            linhas={google.paginas.map((p) => {
              const artigo = p.artigoId ? artigos.find((a) => a.id === p.artigoId) : undefined;
              return {
                chave: p.url,
                rotulo: artigo?.titulo ?? (urlComparavel(p.url).replace(/^[^/]+/, "") || "/"),
                dica: p.url,
                marca: artigo ? "Artigo" : undefined,
                aoClicar: artigo ? () => aoAbrirArtigo(artigo) : undefined,
                m: p,
              };
            })}
          />
        </div>

        <ArtigosNoGoogle dados={google} artigos={artigos} blog={blog} aoAbrir={aoAbrirArtigo} />
      </div>
    </div>
  );
}

// ── Os quatro números e o gráfico ───────────────────────────────────────────

function Painel({ dados }: { dados: DesempenhoDoBlog }) {
  const [escolhida, setEscolhida] = useState<IdMetrica>("cliques");
  const def = METRICAS.find((m) => m.id === escolhida)!;

  // O último dia é ontem no Pacífico, que o Google ainda está somando: o trecho
  // até ele sai tracejado, senão a queda do fim parece tendência.
  const escala = useMemo<EscalaLinha>(
    () => ({
      eixo: (dia, i) => (i === 0 || dia.endsWith("-01") ? mesCurto(dia) : dia.slice(8, 10)),
      dica: (dia) => (dia === dados.periodo.fim ? `${dataCurta(dia)} · ainda subindo` : dataCurta(dia)),
      ultimoParcial: true,
    }),
    [dados.periodo.fim],
  );

  const serie = useMemo(
    () => [
      {
        nome: def.rotulo,
        cor: "var(--serie-ok)",
        valor: (d: DiaGoogle) => (def.id === "ctr" ? d.ctr * 100 : d[def.id]),
        formatar: def.id === "ctr" ? (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : def.id === "posicao" ? posicao : undefined,
      },
    ],
    [def],
  );

  return (
    <section className="viz overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* gap-px sobre o fundo cinza: a linha fina entre os cartões, igual em 2×2 e em 1×4. */}
      <div className="grid grid-cols-2 gap-px bg-zinc-200 dark:bg-zinc-800 @3xl:grid-cols-4">
        {METRICAS.map((m, i) => {
          const ativa = m.id === escolhida;
          const doBlog = dados.blog[m.id];
          const fatia = m.id === "cliques" || m.id === "impressoes" ? (dados.site[m.id] ? doBlog / dados.site[m.id] : 0) : null;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setEscolhida(m.id)}
              aria-pressed={ativa}
              title={m.ajuda}
              style={{ animationDelay: `${i * 26}ms` }}
              className={`surge relative px-4 pb-3.5 pt-4 text-left transition ${
                ativa ? "bg-zinc-50 dark:bg-zinc-800" : "bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/70"
              }`}
            >
              {ativa && <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--serie-ok)]" aria-hidden="true" />}
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                <m.Icone className="size-3" aria-hidden="true" />
                {m.rotulo}
              </span>
              <span className="mt-1.5 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 tela-baixa:text-xl dark:text-zinc-50">
                  {m.formatar(dados.site[m.id])}
                </span>
                <Variacao atual={dados.site[m.id]} anterior={dados.siteAnterior[m.id]} menorEMelhor={m.menorEMelhor} />
              </span>
              <span className="mt-1 block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                Blog: {m.formatar(doBlog)}
                {fatia !== null && fatia > 0 && ` · ${porcento(fatia)} do site`}
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-zinc-200 px-4 pb-3 pt-4 dark:border-zinc-800">
        <LinhasPorDia
          dados={dados.porDia}
          series={serie}
          resumo={`${def.rotulo} por dia`}
          vazio="O Google não registrou nada no período."
          titulo={`${def.rotulo} por dia no Google`}
          altura="h-44 tela-baixa:h-36"
          escala={escala}
        />
      </div>
    </section>
  );
}

// ── Rankings ────────────────────────────────────────────────────────────────

type LinhaRanking = {
  chave: string;
  rotulo: string;
  dica?: string;
  marca?: string;
  aoClicar?: () => void;
  m: MetricasGoogle;
};

function Ranking({
  titulo,
  Icone,
  linhas,
  vazio,
}: {
  titulo: string;
  Icone: typeof Eye;
  linhas: LinhaRanking[];
  vazio: string;
}) {
  // A barra atrás da linha é a proporção de cliques; sem clique nenhum na
  // lista, vale a de impressões — o topo sempre tem barra cheia.
  const base: IdMetrica = linhas.some((l) => l.m.cliques > 0) ? "cliques" : "impressoes";
  const maximo = Math.max(1, ...linhas.map((l) => l.m[base]));

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <Icone className="size-3.5 text-zinc-400" aria-hidden="true" />
        <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h3>
      </header>
      {linhas.length === 0 ? (
        <p className="px-4 pb-5 pt-2 text-[12px] text-zinc-400 dark:text-zinc-500">{vazio}</p>
      ) : (
        <div className="pb-2">
          <div className="flex items-center gap-3 px-4 pb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            <span className="flex-1" />
            <span className="w-14 text-right">Cliques</span>
            <span className="w-16 text-right">Impr.</span>
            <span className="w-11 text-right">Pos.</span>
          </div>
          <ol>
            {linhas.map((l) => {
              const conteudo = (
                <>
                  <span
                    className="absolute inset-y-0.5 left-2 rounded-md bg-sky-500/10 dark:bg-sky-400/10"
                    style={{ width: `calc(${(l.m[base] / maximo) * 100}% - 1rem)` }}
                    aria-hidden="true"
                  />
                  <span className="relative flex min-w-0 flex-1 items-center gap-1.5" title={l.dica ?? l.rotulo}>
                    <span className="truncate text-zinc-800 dark:text-zinc-200">{l.rotulo}</span>
                    {l.marca && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        {l.marca}
                      </span>
                    )}
                  </span>
                  <span className="relative w-14 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-50">{numeroCurto(l.m.cliques)}</span>
                  <span className="relative w-16 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{numeroCurto(l.m.impressoes)}</span>
                  <span className="relative w-11 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{posicao(l.m.posicao)}</span>
                </>
              );
              const classe = "relative flex w-full items-center gap-3 px-4 py-1.5 text-left text-[12px]";
              return (
                <li key={l.chave}>
                  {l.aoClicar ? (
                    <button type="button" onClick={l.aoClicar} className={`${classe} transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50`}>
                      {conteudo}
                    </button>
                  ) : (
                    <div className={classe}>{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

// ── Os artigos ──────────────────────────────────────────────────────────────

function ArtigosNoGoogle({
  dados,
  artigos,
  blog,
  aoAbrir,
}: {
  dados: DesempenhoDoBlog;
  artigos: Artigo[];
  blog: { url_base: string };
  aoAbrir: (a: Artigo) => void;
}) {
  const postados = artigos
    .filter((a) => a.status === "aprovado")
    .map((a) => ({ a, m: dados.artigos[String(a.id)] }))
    .sort((x, y) => (y.m?.impressoes ?? -1) - (x.m?.impressoes ?? -1) || (y.m?.cliques ?? 0) - (x.m?.cliques ?? 0));
  const semAparicao = postados.filter((p) => !p.m).length;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pb-2 pt-3.5">
        <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Os artigos no Google</h3>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {postados.length} postado{postados.length === 1 ? "" : "s"}
          {semAparicao > 0 && ` · ${semAparicao} ainda sem aparições`}
        </span>
      </header>

      {postados.length === 0 ? (
        <p className="px-4 pb-5 pt-1 text-[12px] text-zinc-400 dark:text-zinc-500">
          Quando um artigo for postado, os números dele no Google aparecem aqui.
        </p>
      ) : (
        <div className="overflow-x-auto pb-2">
          <table className="w-full min-w-[34rem] text-[12px]">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <th className="px-4 pb-1 text-left font-medium">Artigo</th>
                <th className="w-20 pb-1 pl-3 text-right font-medium">Cliques</th>
                <th className="w-24 pb-1 pl-3 text-right font-medium">Impressões</th>
                <th className="w-16 pb-1 pl-3 text-right font-medium">CTR</th>
                <th className="w-20 pb-1 pl-3 pr-4 text-right font-medium">Posição</th>
              </tr>
            </thead>
            <tbody>
              {postados.map(({ a, m }) => (
                <tr
                  key={a.id}
                  // O clique na linha é do mouse; o botão do título é o caminho do teclado.
                  onClick={() => aoAbrir(a)}
                  className="surge-suave cursor-pointer border-t border-zinc-100 transition hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-800/40"
                >
                  <td className="max-w-0 px-4 py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        aoAbrir(a);
                      }}
                      className="block w-full truncate text-left text-zinc-800 dark:text-zinc-200">
                      {a.titulo}
                    </button>
                    <span className="block truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                      {urlComparavel(urlDoArtigo(blog, a)) || `/${a.slug}`}
                    </span>
                  </td>
                  {m ? (
                    <>
                      <td className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-50">{numeroCurto(m.cliques)}</td>
                      <td className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{numeroCurto(m.impressoes)}</td>
                      <td className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{porcento(m.ctr)}</td>
                      <td className="pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{posicao(m.posicao)}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="pr-4 text-right text-[11px] text-zinc-400 dark:text-zinc-500">
                      Sem aparições ainda · veja a indexação
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────────

function Esqueleto() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 @md:px-6" aria-label="Buscando no Google">
      <div className="h-6 w-72 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-72 animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800" />
      <div className="grid gap-4 @4xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800" />
        <div className="h-64 animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800" />
      </div>
    </div>
  );
}
