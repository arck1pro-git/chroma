"use client";

// O cartão de uma demanda no quadro.
//
// EM REPOUSO ELE MOSTRA SÓ O QUE DECIDE O DIA: o check, o título, duas linhas
// de descrição, o progresso do checklist e uma linha de sinais (prazo,
// prioridade, chamado) com a pessoa do outro lado — quem mandou, no quadro
// "Minhas"; para quem foi, no "Enviadas". O resto (descrição inteira,
// checklist, datas, editar e excluir) mora na gaveta (./detalhe.tsx), que abre
// no clique: numa coluna de quadro, abrir o cartão no lugar empurrava a coluna
// inteira e espremia o checklist.
//
// PRIORIDADE ALTA É UMA BARRA VERMELHA na borda esquerda, além do selo escrito:
// a barra é o que o olho pega descendo a coluna; o texto é o que garante a
// leitura para quem não distingue a cor.
//
// A DEMANDA "PARA TODOS" vira UM cartão (ver `Item`): sem isso, uma demanda
// para dez pessoas eram dez cartões iguais empurrando o resto para baixo. O
// cartão mostra quem ainda falta e o progresso somado do checklist.
//
// ARRASTAR: o cartão que eu posso marcar vai para "Feitas" arrastando, e volta
// de lá do mesmo jeito — é o gesto do quadro do Dashboard. O círculo do check
// continua sendo o caminho do teclado e do toque.
import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ArrowDown, CalendarClock, Check, Flag, LifeBuoy } from "lucide-react";
import type { Demanda } from "@/lib/demandas-tipos";
import { tintaDe } from "../components/tinta";
import type { ColunaId, Quadro } from "./colunas";
import { haQuanto, horaDe, prazoEmTexto, TOM_PRAZO } from "./datas";

export type Eu = { id: string; nome: string; departamentoId: string | null };

/**
 * O que vira um cartão. `demandas` são as do cartão nesta coluna (nas
 * pendentes, as que ainda faltam); `lote` são todas as irmãs no recorte, feitas
 * ou não — é delas que sai o "2 de 5". Fora da demanda "para todos", os dois
 * têm uma linha só.
 */
export type Item = { chave: string; demandas: Demanda[]; lote: Demanda[] };

export function ehMinha(d: Demanda, eu: Eu) {
  return (
    d.responsavelId === eu.id ||
    (d.departamentoId !== null && d.departamentoId === eu.departamentoId)
  );
}

/** A linha que o MEU check mexe: a minha dentre as do cartão — ou nenhuma. */
export function alvoDo(item: Item, eu: Eu) {
  return item.demandas.find((x) => ehMinha(x, eu)) ?? null;
}

/** As iniciais do departamento do chamado: "TI". */
export function siglaDe(nome: string | null) {
  return (nome ?? "?").slice(0, 2).toUpperCase();
}

export function primeiroNome(nome: string | null) {
  return (nome ?? "").trim().split(/\s+/)[0] || "Alguém";
}

function iniciaisDe(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return ((partes[0][0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

/** A pessoa (ou o departamento), na tinta dela — a mesma das Configurações. */
export function Avatar({
  nome,
  texto,
  tamanho = "sm",
  apagado = false,
  titulo,
}: {
  nome: string;
  /** As iniciais, quando já vêm prontas do banco. */
  texto?: string | null;
  tamanho?: "xs" | "sm" | "md";
  /** Quem já fez, na lista da demanda "para todos". */
  apagado?: boolean;
  titulo?: string;
}) {
  const medida = tamanho === "xs" ? "size-5 text-[8px]" : tamanho === "sm" ? "size-6 text-[9px]" : "size-8 text-[11px]";
  return (
    <span
      title={titulo}
      aria-hidden={titulo ? undefined : true}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white dark:ring-zinc-900 ${medida} ${
        apagado ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500" : tintaDe(nome)
      }`}
    >
      {texto || iniciaisDe(nome)}
    </span>
  );
}

/** As pessoas de uma demanda "para todos" que ainda faltam, empilhadas. */
export function Pilha({ demandas, limite = 3 }: { demandas: Demanda[]; limite?: number }) {
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {demandas.slice(0, limite).map((x) => (
        <Avatar
          key={x.id}
          nome={x.responsavel ?? "?"}
          texto={x.responsavelIniciais}
          tamanho="xs"
          titulo={`Falta: ${x.responsavel ?? "alguém que saiu"}`}
        />
      ))}
      {demandas.length > limite && (
        <span className="flex size-5 items-center justify-center rounded-full bg-zinc-200 text-[8px] font-semibold text-zinc-600 ring-2 ring-white dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-900">
          +{demandas.length - limite}
        </span>
      )}
    </span>
  );
}

type Props = {
  item: Item;
  coluna: ColunaId;
  quadro: Quadro;
  eu: Eu;
  hoje: string;
  agora: string;
  aoMarcar: (id: string, feita: boolean) => void;
  aoAbrir: (id: string) => void;
};

/** O cartão no quadro: arrastável quando o check é meu. */
export default function Cartao(props: Props) {
  const { item, coluna, eu } = props;
  const alvo = alvoDo(item, eu);
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: item.chave,
    data: { coluna, alvo: alvo?.id ?? null },
    disabled: !alvo,
  });

  return (
    <li ref={setNodeRef} {...listeners} className={`list-none ${isDragging ? "opacity-30" : ""}`}>
      <CorpoCartao {...props} />
    </li>
  );
}

/** O desenho do cartão — também a cópia que segue o cursor no arraste. */
export function CorpoCartao({
  item,
  quadro,
  eu,
  hoje,
  agora,
  aoMarcar,
  aoAbrir,
  flutuando = false,
}: Props & { flutuando?: boolean }) {
  // O instante entre o clique e a ida para Feitas: o círculo enche e o título
  // é riscado AQUI, onde a pessoa está olhando. Sem essa pausa o cartão sumia
  // no mesmo quadro do clique, e o check parecia não ter acontecido.
  //
  // Guarda QUAL demanda está indo, e não um sim/não: no cartão "para todos" ele
  // continua na coluna depois que a minha sai, e não pode ficar marcado para as
  // dos outros.
  const [concluindo, setConcluindo] = useState<string | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (espera.current) clearTimeout(espera.current);
  }, []);

  const d = item.demandas[0];
  const feita = d.feitaEm !== null;
  const emLote = item.lote.length > 1;
  const chamado = d.departamentoId !== null;
  const alta = d.prioridade === "alta" && !feita;
  const alvo = alvoDo(item, eu);
  const marcada = feita || (concluindo !== null && concluindo === alvo?.id);
  const prazo = d.prazo && !feita ? prazoEmTexto(d.prazo, hoje, false) : null;

  // O progresso do checklist: o da MINHA cópia quando ela está no cartão; no
  // cartão "para todos" de quem mandou, a soma de todas as cópias — é o "quanto
  // a equipe já andou".
  const base = alvo ?? (emLote ? null : d);
  const passos = base
    ? { feitos: base.itens.filter((i) => i.feitoEm).length, total: base.itens.length }
    : {
        feitos: item.lote.reduce((n, x) => n + x.itens.filter((i) => i.feitoEm).length, 0),
        total: item.lote.reduce((n, x) => n + x.itens.length, 0),
      };
  const feitasNoLote = item.lote.filter((x) => x.feitaEm).length;

  function clicarCheck() {
    if (!alvo || marcada !== feita) return;
    if (feita) return aoMarcar(alvo.id, false);
    setConcluindo(alvo.id);
    espera.current = setTimeout(() => aoMarcar(alvo.id, true), 280);
  }

  // Quem aparece no canto: o outro lado da demanda.
  //   · "para todos": quem ainda falta;
  //   · não é minha (Enviadas, ou o Admin vendo a equipe): para quem foi;
  //   · minha, mandada por outra pessoa: quem mandou;
  //   · minha, criada por mim: ninguém — só há quanto tempo.
  const autor = d.autor ?? "alguém que saiu";
  let pessoa: React.ReactNode = null;
  if (emLote) {
    pessoa = feita ? null : <Pilha demandas={item.demandas} />;
  } else if (!ehMinha(d, eu)) {
    const nome = chamado ? (d.departamento ?? "?") : (d.responsavel ?? "Alguém que saiu");
    pessoa = (
      <span className="flex min-w-0 items-center gap-1.5" title={`Para ${nome}`}>
        <Avatar nome={nome} texto={chamado ? siglaDe(d.departamento) : d.responsavelIniciais} tamanho="xs" />
        <span className="truncate text-zinc-600 dark:text-zinc-300">{chamado ? nome : primeiroNome(nome)}</span>
      </span>
    );
  } else if (d.criadoPor !== eu.id) {
    pessoa = (
      <span className="flex min-w-0 items-center gap-1.5" title={`De ${autor}`}>
        <Avatar nome={autor} tamanho="xs" />
        <span className="truncate text-zinc-500 dark:text-zinc-400">de {primeiroNome(autor)}</span>
      </span>
    );
  }

  return (
    <article
      className={`group relative rounded-xl border text-left transition-[border-color,box-shadow,background-color] ${
        flutuando
          ? "rotate-2 cursor-grabbing border-zinc-300 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
          : feita
            ? "border-zinc-200/80 bg-white/70 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-zinc-700"
            : "border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-zinc-300 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none dark:hover:border-zinc-700"
      }`}
    >
      {alta && (
        <span aria-hidden="true" className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-red-500" />
      )}

      <div className={`flex items-start gap-2.5 px-3 ${feita ? "pt-2.5" : "pt-3"}`}>
        {/* O check fica ACIMA do botão que cobre o cartão (z-10). Sem `alvo`,
            a demanda é de outra pessoa: o círculo fica tracejado — dá para ver
            o estado, não para mudá-lo. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={marcada}
          disabled={!alvo}
          onClick={clicarCheck}
          aria-label={feita ? `Desmarcar “${d.titulo}”` : `Marcar “${d.titulo}” como feita`}
          title={alvo ? (feita ? "Desmarcar" : "Marcar como feita") : feita ? "Feita" : "Só quem recebeu dá o check"}
          className={`relative z-10 mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition duration-150 active:scale-90 disabled:cursor-default disabled:active:scale-100 ${
            marcada
              ? "border-emerald-500 bg-emerald-500 text-white dark:text-zinc-950"
              : alvo
                ? "border-zinc-300 text-transparent hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-500 dark:border-zinc-600 dark:hover:bg-emerald-500/10"
                : "border-dashed border-zinc-300 text-transparent dark:border-zinc-600"
          }`}
        >
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          {/* O título é o botão que abre a gaveta — e o ::after estica o clique
              para o cartão inteiro, sem botão dentro de botão. */}
          <button
            type="button"
            onClick={() => aoAbrir(d.id)}
            className={`block w-full break-words text-left text-[13px] leading-snug outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-zinc-900/15 dark:focus-visible:after:ring-zinc-100/20 ${
              marcada
                ? "text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-500 dark:decoration-zinc-600"
                : "font-medium text-zinc-900 dark:text-zinc-50"
            }`}
          >
            <span className="line-clamp-3">{d.titulo}</span>
          </button>
          {d.descricao && !feita && (
            <p className="mt-1 line-clamp-2 break-words text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {d.descricao}
            </p>
          )}
        </div>
      </div>

      {/* O checklist em uma barra: o quanto andou, sem abrir. */}
      {passos.total > 0 && !feita && (
        <div className="flex items-center gap-2 pl-[42px] pr-3 pt-2.5" title="Passos do checklist">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
            <span
              className={`block h-full rounded-full transition-[width] duration-300 ${
                passos.feitos === passos.total ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-500"
              }`}
              style={{ width: `${(passos.feitos / passos.total) * 100}%` }}
            />
          </span>
          <span
            className={`text-[10px] tabular-nums ${
              passos.feitos === passos.total ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {passos.feitos}/{passos.total}
          </span>
        </div>
      )}

      <div
        className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 pl-[42px] pr-3 text-[11px] text-zinc-500 dark:text-zinc-400 ${
          feita ? "pb-2.5 pt-1" : "pb-3 pt-2.5"
        }`}
      >
        {feita ? (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} aria-hidden="true" />
            {horaDe(d.feitaEm!)}
            {d.feitaPor && d.feitaPor !== eu.nome && quadro === "minhas" && (
              <span className="truncate"> · {primeiroNome(d.feitaPor)}</span>
            )}
          </span>
        ) : (
          <>
            {chamado && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700 ring-1 ring-inset ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20">
                <LifeBuoy className="size-3" aria-hidden="true" />
                Chamado
              </span>
            )}
            {prazo && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ring-1 ring-inset ${TOM_PRAZO[prazo.tom]}`}
              >
                <CalendarClock className="size-3" aria-hidden="true" />
                {prazo.texto}
              </span>
            )}
            {d.prioridade === "alta" && (
              <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-red-600 dark:text-red-400" title="Prioridade alta">
                <Flag className="size-3 fill-current" aria-hidden="true" />
                Alta
              </span>
            )}
            {d.prioridade === "baixa" && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-zinc-400 dark:text-zinc-500" title="Prioridade baixa">
                <ArrowDown className="size-3" aria-hidden="true" />
                Baixa
              </span>
            )}
            {emLote && (
              <span className="shrink-0 tabular-nums" title="Pessoas que já fizeram">
                {feitasNoLote}/{item.lote.length} feitas
              </span>
            )}
            {!prazo && !chamado && !emLote && d.prioridade === "normal" && (
              <span className="truncate text-zinc-400 dark:text-zinc-500">{haQuanto(d.dataCriacao, agora, hoje)}</span>
            )}
          </>
        )}
        {/* Sem espaço ao lado dos sinais, a pessoa desce para a linha de baixo
            — o nome não some. */}
        {pessoa && <span className="ml-auto flex min-w-0 max-w-full items-center pl-1">{pessoa}</span>}
      </div>
    </article>
  );
}
