"use client";

// As demandas em CALENDÁRIO, pelo prazo (pedido dele de 2026-10-08): a outra
// visão do mesmo quadro — mesmas abas (Minhas, Enviadas) e mesmos filtros; só
// muda o eixo, do status para o dia.
//
// O DESENHO É O DA VISÃO MÊS DA AGENDA (app/agenda/grade-mes.tsx): seis
// semanas, segunda a domingo, até três por dia e "+N" para o resto. Cada
// demanda tem o ponto da cor da coluna em que estaria no quadro (atrasada,
// hoje, a fazer, em andamento, feita), e a legenda no topo diz qual é qual.
//
// O QUE NÃO TEM PRAZO fica na bandeja "Sem prazo", ao lado — num calendário por
// prazo, ela é a única forma de essas demandas não sumirem.
//
// ARRASTAR MUDA O PRAZO (decisão dele, 2026-10-08): de um dia para outro, da
// bandeja para um dia (ganha prazo) ou de um dia para a bandeja (perde). Só
// para quem criou a demanda — a regra de editar; o servidor confere de novo
// (mudarPrazo, em lib/demandas.ts). Os outros só clicam e abrem a gaveta.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarOff, ChevronLeft, ChevronRight, Flag } from "lucide-react";
import type { Prioridade } from "@/lib/demandas-tipos";
import { ehMinha, primeiroNome, siglaDe, type Eu, type Item } from "./cartao";
import { COLUNAS, definicaoDe, type ColunaId, type Quadro } from "./colunas";
import { somarDias } from "./datas";

export type ItemDoCalendario = { item: Item; coluna: ColunaId };

const POR_DIA = 3;
const CABECALHO = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEM_PRAZO = "sem-prazo";

/** Os 42 dias da grade do mês ("2026-10"): da segunda da 1ª semana em diante. */
function diasDaGrade(mes: string) {
  const primeiro = `${mes}-01`;
  const semana = new Date(`${primeiro}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const inicio = somarDias(primeiro, -((semana + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
}

function mesVizinho(mes: string, n: number) {
  const d = new Date(`${mes}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

const ORDEM_COLUNA = new Map(COLUNAS.map((c, i) => [c.id, i]));
const PESO: Record<Prioridade, number> = { alta: 0, normal: 1, baixa: 2 };

/** No dia: o que falta antes do feito, na ordem das colunas; depois a prioridade. */
function ordemNoDia(a: ItemDoCalendario, b: ItemDoCalendario) {
  const c = (ORDEM_COLUNA.get(a.coluna) ?? 0) - (ORDEM_COLUNA.get(b.coluna) ?? 0);
  if (c) return c;
  return PESO[a.item.demandas[0].prioridade] - PESO[b.item.demandas[0].prioridade];
}

const botaoMes =
  "flex size-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";
const sobreAlvo = "bg-sky-50 ring-2 ring-inset ring-sky-400 dark:bg-sky-500/10 dark:ring-sky-500/60";

export default function Calendario({
  itens,
  quadro,
  eu,
  hoje,
  aoAbrir,
  aoMudarPrazo,
}: {
  itens: ItemDoCalendario[];
  quadro: Quadro;
  eu: Eu;
  hoje: string;
  aoAbrir: (id: string) => void;
  aoMudarPrazo: (ids: string[], prazo: string | null) => void;
}) {
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  const dias = useMemo(() => diasDaGrade(mes), [mes]);
  const { porDia, semPrazo, porChave } = useMemo(() => {
    const porDia = new Map<string, ItemDoCalendario[]>();
    const semPrazo: ItemDoCalendario[] = [];
    const porChave = new Map<string, ItemDoCalendario>();
    for (const c of itens) {
      porChave.set(c.item.chave, c);
      const prazo = c.item.demandas[0].prazo;
      // Feita sem prazo não tem dia nem fila: só aparece no quadro.
      if (!prazo) {
        if (c.coluna !== "feitas") semPrazo.push(c);
        continue;
      }
      const doDia = porDia.get(prazo);
      if (doDia) doDia.push(c);
      else porDia.set(prazo, [c]);
    }
    for (const l of porDia.values()) l.sort(ordemNoDia);
    semPrazo.sort(ordemNoDia);
    return { porDia, semPrazo, porChave };
  }, [itens]);

  const sensores = useSensors(
    // 6px de folga: sem isto todo clique viraria arraste e a gaveta nunca abria.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const emArraste = arrastando ? (porChave.get(arrastando) ?? null) : null;

  function aoIniciar({ active }: DragStartEvent) {
    setArrastando(String(active.id));
  }

  function aoSoltar({ active, over }: DragEndEvent) {
    setArrastando(null);
    setDiaAberto(null);
    const c = porChave.get(String(active.id));
    if (!over || !c) return;
    const destino = String(over.id);
    const novo = destino === SEM_PRAZO ? null : destino.slice(4);
    if (novo === (c.item.demandas[0].prazo ?? null)) return;
    aoMudarPrazo(c.item.lote.map((x) => x.id), novo);
  }

  const [ano, mesNum] = mes.split("-");
  const titulo = `${MESES[Number(mesNum) - 1].replace(/^./, (l) => l.toUpperCase())} de ${ano}`;
  const propsChip = { quadro, eu, aoAbrir };

  return (
    <DndContext
      // id fixo: sem ele o dnd-kit gera os ids de acessibilidade em runtime e
      // eles não batem com o SSR (erro de hidratação no console).
      id="calendario-demandas"
      sensors={sensores}
      collisionDetection={pointerWithin}
      onDragStart={aoIniciar}
      onDragEnd={aoSoltar}
      onDragCancel={() => setArrastando(null)}
    >
      <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-3 @md:px-5 @4xl:flex-row">
        <section
          aria-label={`Calendário de ${titulo}`}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        >
          <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setMes((m) => mesVizinho(m, -1))} aria-label="Mês anterior" className={botaoMes}>
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setMes((m) => mesVizinho(m, 1))} aria-label="Próximo mês" className={botaoMes}>
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
            <h2 className="text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{titulo}</h2>
            {mes !== hoje.slice(0, 7) && (
              <button
                type="button"
                onClick={() => setMes(hoje.slice(0, 7))}
                className="rounded-lg px-2 py-1 text-[12px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-900"
              >
                Hoje
              </button>
            )}
            {/* A legenda: a cor é a da coluna em que a demanda estaria no quadro. */}
            <ul className="ml-auto hidden flex-wrap items-center gap-x-3 gap-y-1 @3xl:flex" aria-label="Legenda">
              {COLUNAS.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className={`size-2 rounded-full ${c.faixa}`} aria-hidden="true" />
                  {c.rotulo[quadro]}
                </li>
              ))}
            </ul>
          </header>

          {/* Rola de lado no celular, como a visão Mês da Agenda: sete colunas
              espremidas em 360px não deixariam ler título nenhum. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
            <div className="flex min-h-0 min-w-[42rem] flex-1 flex-col">
              <div className="grid shrink-0 grid-cols-7 border-b border-zinc-200 dark:border-zinc-800">
                {CABECALHO.map((d) => (
                  <span key={d} className="py-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
                {dias.map((d, i) => (
                  <Dia
                    key={d}
                    dia={d}
                    indice={i}
                    foraDoMes={!d.startsWith(mes)}
                    hoje={hoje}
                    itens={porDia.get(d) ?? []}
                    aberto={diaAberto === d}
                    aoAbrirDia={() => setDiaAberto(d)}
                    aoFecharDia={() => setDiaAberto(null)}
                    {...propsChip}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <BandejaSemPrazo itens={semPrazo} {...propsChip} />
      </main>

      {/* A cópia que segue o cursor; o original fica esmaecido. */}
      <DragOverlay dropAnimation={null}>
        {emArraste && (
          <div className="w-48 rotate-2 cursor-grabbing rounded-md bg-white shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
            <CorpoChip c={emArraste} {...propsChip} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────────

type PropsChip = { quadro: Quadro; eu: Eu; aoAbrir: (id: string) => void };

function Dia({
  dia,
  indice,
  foraDoMes,
  hoje,
  itens,
  aberto,
  aoAbrirDia,
  aoFecharDia,
  ...propsChip
}: PropsChip & {
  dia: string;
  indice: number;
  foraDoMes: boolean;
  hoje: string;
  itens: ItemDoCalendario[];
  aberto: boolean;
  aoAbrirDia: () => void;
  aoFecharDia: () => void;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `dia:${dia}` });
  const visiveis = itens.slice(0, POR_DIA);
  const resto = itens.length - visiveis.length;
  const ehHoje = dia === hoje;

  return (
    <div
      ref={setNodeRef}
      className={`relative flex min-h-[6.5rem] min-w-0 flex-col gap-0.5 border-zinc-200 p-1 transition-colors dark:border-zinc-800 ${
        indice % 7 ? "border-l" : ""
      } ${indice >= 7 ? "border-t" : ""} ${
        isOver && active ? sobreAlvo : foraDoMes ? "bg-zinc-50/70 dark:bg-zinc-900/30" : ""
      }`}
    >
      {/* Hoje em preto, e não no vermelho da Agenda: aqui vermelho é atraso. */}
      <span
        className={`mb-0.5 flex size-6 shrink-0 items-center justify-center self-center rounded-full text-[12px] font-semibold tabular-nums ${
          ehHoje
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : foraDoMes
              ? "text-zinc-400 dark:text-zinc-600"
              : dia < hoje
                ? "text-zinc-500 dark:text-zinc-400"
                : "text-zinc-800 dark:text-zinc-200"
        }`}
      >
        {Number(dia.slice(8))}
      </span>

      {visiveis.map((c) => (
        <Chip key={c.item.chave} c={c} {...propsChip} />
      ))}
      {resto > 0 && (
        <button
          type="button"
          onClick={aoAbrirDia}
          className="rounded px-1 text-left text-[11px] font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          +{resto} {resto === 1 ? "outra" : "outras"}
        </button>
      )}

      {aberto && (
        <DiaInteiro
          dia={dia}
          itens={itens}
          // Sábado e domingo abrem para a esquerda; a última semana, para cima —
          // senão a lista sai da grade e é cortada.
          direita={indice % 7 >= 5}
          embaixo={indice >= 28}
          aoFechar={aoFecharDia}
          {...propsChip}
        />
      )}
    </div>
  );
}

/** O "+N" aberto: o dia inteiro por cima da célula. Fecha no Esc e no clique fora. */
function DiaInteiro({
  dia,
  itens,
  direita,
  embaixo,
  aoFechar,
  ...propsChip
}: PropsChip & { dia: string; itens: ItemDoCalendario[]; direita: boolean; embaixo: boolean; aoFechar: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function fora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) aoFechar();
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aoFechar]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Demandas do dia ${dia.slice(8, 10)}/${dia.slice(5, 7)}`}
      className={`surge absolute z-30 flex max-h-72 min-h-full w-full min-w-52 flex-col gap-0.5 overflow-y-auto rounded-lg bg-white p-1.5 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700 ${
        direita ? "right-0" : "left-0"
      } ${embaixo ? "bottom-0" : "top-0"}`}
    >
      <p className="px-1 pb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
        {dia.slice(8, 10)}/{dia.slice(5, 7)} · {itens.length}
      </p>
      {itens.map((c) => (
        <Chip key={c.item.chave} c={c} {...propsChip} />
      ))}
    </div>
  );
}

function BandejaSemPrazo({ itens, ...propsChip }: PropsChip & { itens: ItemDoCalendario[] }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: SEM_PRAZO });
  return (
    <aside
      ref={setNodeRef}
      aria-label="Sem prazo"
      className={`flex max-h-56 shrink-0 flex-col rounded-xl transition-colors @4xl:max-h-none @4xl:w-60 ${
        isOver && active ? sobreAlvo : "bg-zinc-100/70 dark:bg-zinc-900/50"
      }`}
    >
      <header className="flex shrink-0 items-center gap-2 px-3.5 pb-2 pt-3">
        <CalendarOff className="size-3.5 text-zinc-400" aria-hidden="true" />
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Sem prazo</h2>
        <span className="rounded-full bg-white px-1.5 text-[11px] font-medium leading-[18px] tabular-nums text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
          {itens.length}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {itens.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
            {active ? "Solte aqui para tirar o prazo." : "Tudo o que está a fazer tem prazo."}
          </p>
        ) : (
          itens.map((c) => (
            <div key={c.item.chave} className="rounded-md bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <Chip c={c} {...propsChip} />
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

/** Uma demanda no calendário. Arrastável só para quem criou. */
function Chip({ c, ...propsChip }: PropsChip & { c: ItemDoCalendario }) {
  const podeArrastar = c.item.demandas[0].criadoPor === propsChip.eu.id;
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: c.item.chave, disabled: !podeArrastar });
  return (
    <div ref={setNodeRef} {...listeners} className={isDragging ? "opacity-30" : ""}>
      <CorpoChip c={c} {...propsChip} />
    </div>
  );
}

function CorpoChip({ c, quadro, eu, aoAbrir }: PropsChip & { c: ItemDoCalendario }) {
  const d = c.item.demandas[0];
  const feita = c.coluna === "feitas";
  const def = definicaoDe(c.coluna);
  const emLote = c.item.lote.length > 1;
  // Em "Enviadas" (ou na equipe, para o Admin): com quem ela está — as
  // iniciais no chip, o nome inteiro no title.
  const outro = !ehMinha(d, eu);
  const sigla = emLote ? `${c.item.lote.length}` : d.departamentoId ? siglaDe(d.departamento) : (d.responsavelIniciais ?? "?");
  const para = emLote ? `${c.item.lote.length} pessoas` : d.departamentoId ? d.departamento : d.responsavel;
  const dica = [
    d.titulo,
    def.rotulo[quadro],
    outro ? `para ${para ?? "alguém que saiu"}` : d.criadoPor !== eu.id ? `de ${primeiroNome(d.autor)}` : null,
    d.criadoPor === eu.id ? "arraste para mudar o prazo" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => aoAbrir(d.id)}
      title={dica}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-[3px] text-left text-[11px] leading-[1.15rem] transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <span className={`size-2 shrink-0 rounded-full ${def.faixa}`} aria-hidden="true" />
      <span
        className={`min-w-0 flex-1 truncate ${
          feita
            ? "text-zinc-400 line-through decoration-zinc-300 dark:text-zinc-500 dark:decoration-zinc-600"
            : "font-medium text-zinc-800 dark:text-zinc-100"
        }`}
      >
        {d.titulo}
      </span>
      {d.prioridade === "alta" && !feita && (
        <Flag className="size-2.5 shrink-0 fill-current text-red-500" aria-label="Prioridade alta" />
      )}
      {outro && (
        <span className="shrink-0 rounded bg-zinc-100 px-1 text-[9px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {sigla}
        </span>
      )}
    </button>
  );
}
