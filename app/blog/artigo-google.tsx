"use client";

// A aba Google do artigo postado: como a página dele está indo na busca.
//
// TRÊS RESPOSTAS, nesta ordem: os números do período (cliques, impressões,
// CTR, posição) com o dia a dia; se o Google indexou a URL (e com qual
// canônica, por quais sitemaps); e as buscas que trouxeram gente. Quando não há
// número nenhum, a indexação é a resposta: "ninguém procurou" e "o Google nem
// sabe que existe" são problemas diferentes.
//
// Busca ao abrir a aba, não ao abrir o artigo: a inspeção de indexação gasta
// cota do Search Console (lib/blog-google.ts guarda por 6 h).
import { useEffect, useMemo, useState } from "react";
import {
  numeroCurto,
  porcento,
  posicao,
  type DesempenhoDoArtigo,
  type DiaGoogle,
  type GoogleDoArtigo,
  type IndexacaoArtigo,
} from "@/lib/blog-google-tipos";
import { dataCurta, dataHora } from "@/lib/formato";
import { LinhasPorDia, mesCurto, type EscalaLinha } from "@/app/components/grafico-linhas";
import { AlertTriangle, CheckCircle2, CircleX, Search } from "@/app/components/icones";
import { Segmentos, mensagemDeErro, tempoAtras } from "./pecas";

export default function ArtigoNoGoogle({ artigoId, inicial }: { artigoId: number; inicial?: GoogleDoArtigo }) {
  const [dados, setDados] = useState<GoogleDoArtigo | null>(inicial ?? null);

  useEffect(() => {
    if (inicial) return;
    let vivo = true;
    fetch(`/api/artigos/${artigoId}/google?dias=28`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(mensagemDeErro(d, "Não foi possível falar com o Google agora."));
        return d as GoogleDoArtigo;
      })
      .then((d) => vivo && setDados(d))
      .catch((e: Error) => vivo && setDados({ estado: "erro", mensagem: e.message }));
    return () => {
      vivo = false;
    };
  }, [artigoId, inicial]);

  if (!dados) {
    return (
      <div className="flex flex-col gap-3" aria-label="Buscando no Google">
        <div className="h-20 animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800" />
        <div className="h-40 animate-pulse rounded-2xl border border-zinc-200 dark:border-zinc-800" />
      </div>
    );
  }
  if (dados.estado !== "ok") return <SemDados dados={dados} />;
  return <ComDados dados={dados} />;
}

function SemDados({ dados }: { dados: Exclude<GoogleDoArtigo, { estado: "ok" }> }) {
  const texto =
    dados.estado === "sem-url"
      ? "O artigo precisa estar postado e o blog ter endereço para o Google medir a página."
      : dados.estado === "sem-acesso"
        ? `O CRM ainda não enxerga ${dados.host} no Search Console. O passo a passo está na aba Desempenho do blog.`
        : dados.estado === "sem-endereco"
          ? "O blog não tem endereço configurado: sem ele não há página para medir."
          : dados.estado === "sem-credencial"
            ? "O Google não está configurado neste servidor."
            : dados.mensagem;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-zinc-300 px-4 py-4 dark:border-zinc-700">
      <Search className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
      <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{texto}</p>
    </div>
  );
}

function ComDados({ dados }: { dados: DesempenhoDoArtigo & { propriedade: string } }) {
  const [serie, setSerie] = useState<"impressoes" | "cliques">("impressoes");
  const m = dados.metricas;
  const escala = useMemo<EscalaLinha>(
    () => ({
      eixo: (dia, i) => (i === 0 || dia.endsWith("-01") ? mesCurto(dia) : dia.slice(8, 10)),
      dica: (dia) => (dia === dados.periodo.fim ? `${dataCurta(dia)} · ainda subindo` : dataCurta(dia)),
      ultimoParcial: true,
    }),
    [dados.periodo.fim],
  );
  const series = useMemo(
    () => [
      {
        nome: serie === "impressoes" ? "Impressões" : "Cliques",
        cor: "var(--serie-ok)",
        valor: (d: DiaGoogle) => d[serie],
      },
    ],
    [serie],
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        Últimos {dados.periodo.dias} dias ({dataCurta(dados.periodo.inicio)} a {dataCurta(dados.periodo.fim)}) · atualizado{" "}
        {tempoAtras(dados.lidoEm)}
      </p>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-4">
        {(
          [
            ["Cliques", numeroCurto(m.cliques)],
            ["Impressões", numeroCurto(m.impressoes)],
            ["CTR", m.impressoes ? porcento(m.ctr) : "—"],
            ["Posição média", posicao(m.posicao)],
          ] as const
        ).map(([rotulo, valor]) => (
          <div key={rotulo} className="bg-white px-4 py-3 dark:bg-zinc-900">
            <dt className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{rotulo}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{valor}</dd>
          </div>
        ))}
      </dl>

      {m.impressoes > 0 && (
        <section className="viz rounded-2xl border border-zinc-200 px-4 pb-3 pt-3.5 dark:border-zinc-800">
          <div className="mb-2 flex items-center">
            <h3 className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">Dia a dia</h3>
            <span className="ml-auto">
              <Segmentos
                rotulo="Série do gráfico"
                valor={serie}
                aoMudar={setSerie}
                opcoes={[
                  { id: "impressoes", rotulo: "Impressões" },
                  { id: "cliques", rotulo: "Cliques" },
                ]}
              />
            </span>
          </div>
          <LinhasPorDia
            dados={dados.porDia}
            series={series}
            resumo=""
            vazio="Nenhum clique no período."
            titulo={`${series[0].nome} por dia`}
            altura="h-32"
            escala={escala}
          />
        </section>
      )}

      <Indexacao indexacao={dados.indexacao} semImpressoes={m.impressoes === 0} />

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <h3 className="px-4 pb-1 pt-3.5 text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">Buscas que trouxeram a página</h3>
        {dados.consultas.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-[12px] text-zinc-400 dark:text-zinc-500">Nenhuma busca no período.</p>
        ) : (
          <table className="mb-2 w-full text-[12px]">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <th className="px-4 py-1 text-left font-medium">Busca</th>
                <th className="w-20 py-1 pl-3 text-right font-medium">Cliques</th>
                <th className="w-24 py-1 pl-3 text-right font-medium">Impressões</th>
                <th className="w-20 py-1 pl-3 pr-4 text-right font-medium">Posição</th>
              </tr>
            </thead>
            <tbody>
              {dados.consultas.map((c) => (
                <tr key={c.termo} className="border-t border-zinc-100 dark:border-zinc-800/70">
                  <td className="max-w-0 truncate px-4 py-1.5 text-zinc-800 dark:text-zinc-200">{c.termo}</td>
                  <td className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-50">{numeroCurto(c.cliques)}</td>
                  <td className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{numeroCurto(c.impressoes)}</td>
                  <td className="pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{posicao(c.posicao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Indexacao({ indexacao, semImpressoes }: { indexacao: IndexacaoArtigo | null; semImpressoes: boolean }) {
  if (!indexacao) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-4 py-3 text-[12px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        A inspeção de indexação não respondeu agora (cota do dia do Search Console, ou a URL fora da propriedade).
      </p>
    );
  }
  const [Icone, titulo, tom] =
    indexacao.situacao === "indexada"
      ? [CheckCircle2, "Indexada no Google", "text-emerald-600 dark:text-emerald-400"]
      : indexacao.situacao === "problema"
        ? [CircleX, "O Google encontrou um problema", "text-red-600 dark:text-red-400"]
        : [AlertTriangle, "Ainda fora do índice do Google", "text-amber-600 dark:text-amber-400"];
  const canonicaDiferente =
    indexacao.canonicaGoogle && indexacao.canonicaSite && indexacao.canonicaGoogle !== indexacao.canonicaSite;

  return (
    <section className="rounded-2xl border border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
      <div className="flex items-start gap-2.5">
        <Icone className={`mt-0.5 size-4 shrink-0 ${tom}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h3>
          {indexacao.cobertura && <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{indexacao.cobertura}</p>}
          {indexacao.situacao !== "indexada" && semImpressoes && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">
              É por isso que a página ainda não aparece nas buscas. Artigo novo costuma levar de alguns dias a duas semanas;
              estar no sitemap do site acelera.
            </p>
          )}
        </div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
        <Item rotulo="Último rastreio" valor={indexacao.ultimoRastreio ? dataHora(indexacao.ultimoRastreio) : "nunca rastreada"} />
        <Item
          rotulo="Sitemaps"
          valor={indexacao.sitemaps.length ? indexacao.sitemaps.map((s) => s.replace(/^https?:\/\/[^/]+/, "")).join(", ") : "em nenhum sitemap"}
          alerta={indexacao.sitemaps.length === 0}
        />
        {canonicaDiferente && (
          <Item rotulo="Canônica escolhida pelo Google" valor={indexacao.canonicaGoogle} alerta />
        )}
      </dl>
      <p className="mt-3 text-[10px] text-zinc-400 dark:text-zinc-500">Inspecionado {tempoAtras(indexacao.lidoEm)}</p>
    </section>
  );
}

function Item({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-zinc-400 dark:text-zinc-500">{rotulo}</dt>
      <dd className={`truncate ${alerta ? "text-amber-700 dark:text-amber-400" : "text-zinc-700 dark:text-zinc-200"}`} title={valor}>
        {valor}
      </dd>
    </div>
  );
}
