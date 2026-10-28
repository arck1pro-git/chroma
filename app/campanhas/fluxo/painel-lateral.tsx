"use client";

// O painel da direita do construtor. Com um bloco selecionado: cabeçalho
// (tipo, descrição, apagar), as pendências dele, os números (campanha no ar ou
// pausada) e o editor (painel-bloco.tsx). Com o início: o painel que quem usa
// o canvas passa (segmentos). Sem nada: a lista de pendências, clicável, ou —
// na leitura — o que a tela quiser mostrar (as falhas).
//
// Coluna quando o CONSTRUTOR tem 70rem ou mais (container query do canvas,
// desde 2026-10-28; antes era a janela, a partir de 1280px). Pela janela, a
// 1366px com as colunas da esquerda abertas a coluna fixa deixava ~150px de
// canvas, e nada com o chat da IA aberto. Mais estreito, abre por cima do
// canvas só quando há o que mostrar (o canvas desliza para o bloco escolhido
// ficar à vista, ver `mostrar` em ../fluxo-campanha.tsx).
import { CATALOGO_CAMPANHA, NO_INICIO, type BlocoCampanha, type FluxoCampanha, type ProblemaDoFluxo } from "@/lib/campanhas-fluxo";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { BotaoIcone } from "@/app/components/gaveta";
import { CheckCircle2, LogIn, MousePointerClick, Trash2, TriangleAlert, X } from "@/app/components/icones";
import { COR_DO_GRUPO, ICONE_DO_BLOCO } from "./aparencia";
import { resumoDoBloco, type MetricasFluxo, type OpcoesFluxo } from "./grafo";
import PainelDoBloco from "./painel-bloco";

const numero = (n: number | undefined) => (n ?? 0).toLocaleString("pt-BR");

export default function PainelLateral({
  ref,
  aberto,
  atual,
  fluxo,
  editavel,
  templates,
  opcoes,
  problemas,
  metricas,
  painelDoInicio,
  semSelecao,
  fechar,
  irPara,
  apagar,
  mudarBloco,
  ligar,
}: {
  aberto: boolean;
  /** O bloco selecionado, NO_INICIO ou null. */
  atual: string | null;
  fluxo: FluxoCampanha;
  editavel: boolean;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  problemas: ProblemaDoFluxo[];
  metricas: MetricasFluxo | null;
  painelDoInicio: React.ReactNode;
  semSelecao?: React.ReactNode;
  fechar: () => void;
  irPara: (blocoId: string | null) => void;
  apagar: (id: string) => void;
  mudarBloco: (id: string, b: BlocoCampanha) => void;
  ligar: (origem: string, saidaId: string, destino: string | null) => void;
  /** O canvas mede o painel para saber se ele cobre a direita (sobreposto) ou não (coluna). */
  ref?: React.Ref<HTMLElement>;
}) {
  return (
    <aside
      ref={ref}
      aria-label="Configuração do bloco"
      className={`${aberto ? "flex" : "hidden @min-[70rem]:flex"} absolute inset-y-0 right-0 z-10 w-80 max-w-[90%] flex-col border-l border-zinc-200 bg-white shadow-xl @min-[70rem]:static @min-[70rem]:max-w-none @min-[70rem]:shadow-none dark:border-zinc-800 dark:bg-zinc-950`}
    >
      {atual ? (
        <Selecionado
          atual={atual}
          fluxo={fluxo}
          editavel={editavel}
          templates={templates}
          opcoes={opcoes}
          problemas={problemas}
          metricas={metricas}
          painelDoInicio={painelDoInicio}
          fechar={fechar}
          apagar={apagar}
          mudarBloco={mudarBloco}
          ligar={ligar}
        />
      ) : editavel ? (
        <Pendencias problemas={problemas} fluxo={fluxo} opcoes={opcoes} irPara={irPara} fechar={fechar} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-20 pt-4">
          {semSelecao ?? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <MousePointerClick className="size-5 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
              <p className="text-[12px] text-zinc-400 dark:text-zinc-500">Clique num bloco para ver o que ele faz e quantos passaram.</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function Selecionado({
  atual,
  fluxo,
  editavel,
  templates,
  opcoes,
  problemas,
  metricas,
  painelDoInicio,
  fechar,
  apagar,
  mudarBloco,
  ligar,
}: {
  atual: string;
  fluxo: FluxoCampanha;
  editavel: boolean;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  problemas: ProblemaDoFluxo[];
  metricas: MetricasFluxo | null;
  painelDoInicio: React.ReactNode;
  fechar: () => void;
  apagar: (id: string) => void;
  mudarBloco: (id: string, b: BlocoCampanha) => void;
  ligar: (origem: string, saidaId: string, destino: string | null) => void;
}) {
  const bloco = atual === NO_INICIO ? null : fluxo.blocos[atual];
  // Problema sem bloco ("ligue o início…") é do início, como no canvas.
  const doAtual = problemas.filter((p) => (p.blocoId && fluxo.blocos[p.blocoId] ? p.blocoId : NO_INICIO) === atual);
  const Icone = bloco ? ICONE_DO_BLOCO[bloco.tipo] : LogIn;
  const cor = bloco ? `ring-1 ring-inset ${COR_DO_GRUPO[CATALOGO_CAMPANHA[bloco.tipo].grupo]}` : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900";
  const agora = metricas?.porBloco[atual]?.agora ?? 0;

  return (
    <>
      <div className="flex items-start gap-2.5 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${cor}`}>
          <Icone className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{bloco ? CATALOGO_CAMPANHA[bloco.tipo].rotulo : "Início · segmentos"}</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            {bloco ? CATALOGO_CAMPANHA[bloco.tipo].descricao : "Quem entra na campanha: os contatos com WhatsApp dos segmentos."}
          </p>
        </div>
        {editavel && bloco && <BotaoIcone Icone={Trash2} rotulo="Apagar bloco" onClick={() => apagar(atual)} className="hover:!text-rose-600" />}
        <BotaoIcone Icone={X} rotulo="Fechar painel" onClick={fechar} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-20 pt-3">
        {doAtual.length > 0 && (
          <ul className="mb-4 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {doAtual.map((p, i) => (
              <li key={i} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                {p.mensagem}
              </li>
            ))}
          </ul>
        )}
        {metricas && bloco && (
          <p className="mb-4 flex gap-4 text-[12px] text-zinc-500 dark:text-zinc-400">
            <span>
              Agora aqui <b className="tabular-nums text-zinc-900 dark:text-zinc-50">{numero(agora)}</b>
            </span>
            <span>
              Passaram <b className="tabular-nums text-zinc-900 dark:text-zinc-50">{numero(metricas.porBloco[atual]?.passaram)}</b>
            </span>
          </p>
        )}
        {/* Editando a campanha pausada: apagar um bloco com gente nele encerra a campanha para essas pessoas. */}
        {editavel && bloco && agora > 0 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Há contatos neste bloco agora. Apagá-lo encerra a campanha para eles.
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

function Pendencias({
  problemas,
  fluxo,
  opcoes,
  irPara,
  fechar,
}: {
  problemas: ProblemaDoFluxo[];
  fluxo: FluxoCampanha;
  opcoes: OpcoesFluxo;
  irPara: (blocoId: string | null) => void;
  fechar: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{problemas.length ? "Pendências" : "Sem pendências"}</h3>
        <BotaoIcone Icone={X} rotulo="Fechar painel" onClick={fechar} className="@min-[70rem]:hidden" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-20 pt-2">
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
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        {b ? `${CATALOGO_CAMPANHA[b.tipo].rotulo} · ${resumoDoBloco(b, opcoes)}` : "Início"}
                      </span>
                      <span className="block text-[12px] leading-snug text-zinc-800 dark:text-zinc-100">{p.mensagem}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Nada pendente. Clique num bloco para editar.</p>
          </div>
        )}
      </div>
    </>
  );
}
