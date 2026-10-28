"use client";

// O painel do construtor, FLUTUANDO sobre a direita do canvas (desde
// 2026-10-28, pedido dele: "o canvas fica espremido"): não encolhe o canvas,
// aparece só quando há o que mostrar e fecha no X, no clique no canvas ou no
// Esc (../fluxo-campanha.tsx). O canvas desliza para o bloco escolhido ficar à
// vista ao lado dele (`mostrar`). Antes era uma coluna fixa a partir de 70rem.
//
// Com um bloco selecionado: o nome (com o selo "depois de uma resposta" no
// texto e no arquivo, e o ponto âmbar com a pendência no title), os números
// (campanha no ar ou pausada) e o editor (painel-bloco.tsx). Com o início: o
// painel que quem usa o canvas passa (segmentos). Pela pílula de pendências: a
// lista, clicável — é o único lugar com as frases; o cartão tem o ponto.
import { CATALOGO_CAMPANHA, NO_INICIO, type BlocoCampanha, type FluxoCampanha, type ProblemaDoFluxo } from "@/lib/campanhas-fluxo";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { BotaoIcone } from "@/app/components/gaveta";
import { CheckCircle2, LogIn, Trash2, TriangleAlert, X } from "@/app/components/icones";
import { COR_DO_GRUPO, ICONE_DO_BLOCO, PEDE_RESPOSTA } from "./aparencia";
import { SeloResposta } from "./campos";
import { resumoDoBloco, type MetricasFluxo, type OpcoesFluxo } from "./grafo";
import PainelDoBloco from "./painel-bloco";

const numero = (n: number | null | undefined) => (n ?? 0).toLocaleString("pt-BR");

type Props = {
  /** O bloco selecionado, NO_INICIO ou null (null com `aberto`: a lista de pendências). */
  atual: string | null;
  fluxo: FluxoCampanha;
  editavel: boolean;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  problemas: ProblemaDoFluxo[];
  metricas: MetricasFluxo | null;
  painelDoInicio: React.ReactNode;
  fechar: () => void;
  irPara: (blocoId: string | null) => void;
  apagar: (id: string) => void;
  mudarBloco: (id: string, b: BlocoCampanha) => void;
  ligar: (origem: string, saidaId: string, destino: string | null) => void;
};

export default function PainelLateral({
  ref,
  aberto,
  ...p
}: Props & {
  aberto: boolean;
  /** O canvas mede o painel para o bloco escolhido não ficar embaixo dele. */
  ref?: React.Ref<HTMLElement>;
}) {
  if (!aberto) return null;
  return (
    <aside
      ref={ref}
      aria-label={p.atual ? "Configuração do bloco" : "Pendências"}
      className="absolute bottom-3 right-3 top-3 z-10 flex w-80 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl tela-baixa:bottom-2 tela-baixa:top-2 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40"
    >
      {p.atual ? <Selecionado {...p} atual={p.atual} /> : <Pendencias {...p} />}
    </aside>
  );
}

function Selecionado({ atual, fluxo, editavel, templates, opcoes, problemas, metricas, painelDoInicio, fechar, apagar, mudarBloco, ligar }: Props & { atual: string }) {
  const bloco = atual === NO_INICIO ? null : fluxo.blocos[atual];
  // Problema sem bloco ("ligue o início…") é do início, como no canvas.
  const pendencia = problemas.find((p) => (p.blocoId && fluxo.blocos[p.blocoId] ? p.blocoId : NO_INICIO) === atual);
  const Icone = bloco ? ICONE_DO_BLOCO[bloco.tipo] : LogIn;
  const cor = bloco ? `ring-1 ring-inset ${COR_DO_GRUPO[CATALOGO_CAMPANHA[bloco.tipo].grupo]}` : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900";
  const numeros = bloco && metricas ? (metricas.porBloco[atual] ?? { agora: 0, passaram: 0 }) : undefined;
  const agora = numeros?.agora ?? 0;

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-zinc-200 py-2.5 pl-4 pr-2 dark:border-zinc-800">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${cor}`}>
          <Icone className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <span className="truncate">{bloco ? CATALOGO_CAMPANHA[bloco.tipo].rotulo : "Início"}</span>
            {pendencia && (
              <span title={pendencia.mensagem} className="size-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400">
                <span className="sr-only">Pendência: {pendencia.mensagem}</span>
              </span>
            )}
          </h3>
          {bloco && PEDE_RESPOSTA.has(bloco.tipo) && (
            <span className="mt-0.5 flex">
              <SeloResposta />
            </span>
          )}
        </div>
        {editavel && bloco && <BotaoIcone Icone={Trash2} rotulo="Apagar bloco" onClick={() => apagar(atual)} className="hover:!text-rose-600" />}
        <BotaoIcone Icone={X} rotulo="Fechar painel" onClick={fechar} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        {numeros && (
          <dl className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            {(
              [
                ["Agora aqui", numeros.agora],
                ["Passaram", numeros.passaram],
                ["Entregues", numeros.entregues],
                ["Lidos", numeros.lidos],
              ] as const
            )
              .filter(([, n]) => n != null)
              .map(([rotulo, n]) => (
                <div key={rotulo} className="flex gap-1">
                  <dt>{rotulo}</dt>
                  <dd className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{numero(n)}</dd>
                </div>
              ))}
          </dl>
        )}
        {/* Editando a campanha pausada: apagar um bloco com gente nele encerra a campanha para essas pessoas. */}
        {editavel && bloco && agora > 0 && (
          <p className="mb-4 flex gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Apagar este bloco encerra a campanha para quem está nele.
          </p>
        )}
        {bloco ? (
          <fieldset disabled={!editavel} className="min-w-0">
            <PainelDoBloco
              id={atual}
              bloco={bloco}
              fluxo={fluxo}
              templates={templates}
              opcoes={opcoes}
              metricas={metricas}
              mudar={(b) => mudarBloco(atual, b)}
              ligar={(saida, destino) => ligar(atual, saida, destino)}
            />
          </fieldset>
        ) : (
          painelDoInicio
        )}
      </div>
    </>
  );
}

function Pendencias({ problemas, fluxo, opcoes, irPara, fechar }: Props) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 py-2.5 pl-4 pr-2 dark:border-zinc-800">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Pendências</h3>
        <BotaoIcone Icone={X} rotulo="Fechar painel" onClick={fechar} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-2">
        {problemas.length ? (
          <ul className="space-y-0.5">
            {problemas.map((p, i) => {
              const b = p.blocoId ? fluxo.blocos[p.blocoId] : undefined;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => irPara(p.blocoId)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100/20"
                  >
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        {b ? `${CATALOGO_CAMPANHA[b.tipo].rotulo} · ${resumoDoBloco(b, opcoes)}` : "Início"}
                      </span>
                      <span className="block text-[13px] leading-snug text-zinc-800 dark:text-zinc-100">{p.mensagem}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Nada pendente.</p>
          </div>
        )}
      </div>
    </>
  );
}
