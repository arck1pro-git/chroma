"use client";

// O checklist na gaveta de uma demanda (./detalhe.tsx).
//
// QUEM FAZ O QUÊ (decisão dele, 2026-10-07): quem CRIOU a demanda monta —
// acrescenta, renomeia (clicando no texto) e tira passos; quem RECEBEU marca.
// Quem não é nenhum dos dois vê o checklist sem mexer.
//
// O CHECK DA DEMANDA CONTINUA MANUAL: marcar o último passo não fecha nada
// sozinho, só oferece fechar — às vezes falta o que não estava na lista.
//
// NA DEMANDA "PARA TODOS" cada pessoa tem a sua cópia dos passos. O cartão
// agrupado mostra os passos da MINHA cópia (quando eu também recebi) e, ao lado
// de cada um, quantas pessoas já o fizeram.
import { useRef, useState, useTransition } from "react";
import { Check, CircleCheck, Plus, X } from "lucide-react";
import { TETO_ITENS, TETO_TEXTO_ITEM, type Demanda, type ItemDemanda, type ResultadoDemanda } from "@/lib/demandas-tipos";
import { horaDe } from "./datas";

export type MontarChecklist = {
  adicionar: (demandaId: string, texto: string) => Promise<ResultadoDemanda>;
  renomear: (itemId: string, texto: string) => Promise<ResultadoDemanda>;
  remover: (itemId: string) => Promise<ResultadoDemanda>;
};

export default function Checklist({
  base,
  lote,
  podeMarcar,
  podeMontar,
  demandaPendente,
  eu,
  aoMarcarItem,
  montar,
  aoFecharDemanda,
  aoAvisar,
}: {
  /** A demanda cujos passos aparecem: a minha cópia, ou a do cartão. */
  base: Demanda;
  /** As cópias da demanda "para todos" (uma só fora dela): o "2 de 5" de cada passo. */
  lote: Demanda[];
  podeMarcar: boolean;
  podeMontar: boolean;
  /** A demanda base ainda está a fazer — é quando faz sentido sugerir fechar. */
  demandaPendente: boolean;
  eu: { nome: string };
  aoMarcarItem: (itemId: string, feito: boolean) => void;
  montar: MontarChecklist;
  aoFecharDemanda: () => void;
  aoAvisar: (texto: string) => void;
}) {
  const itens = base.itens;
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [salvando, iniciar] = useTransition();
  const campoNovo = useRef<HTMLInputElement | null>(null);
  // Esc desiste da edição. Marca antes de fechar: tirar o campo da tela pode
  // disparar o "saiu do campo", e ele não pode salvar o que foi desistido.
  const desistiu = useRef(false);

  if (!itens.length && !podeMontar) return null;

  const feitos = itens.filter((i) => i.feitoEm).length;
  const completo = itens.length > 0 && feitos === itens.length;
  const emLote = lote.length > 1;
  // Quantas cópias têm o passo desta posição feito.
  const feitosNoLote = (ordem: number) =>
    lote.filter((d) => d.itens.some((i) => i.ordem === ordem && i.feitoEm)).length;

  function rodar(p: Promise<ResultadoDemanda>, depois?: () => void) {
    iniciar(async () => {
      const r = await p;
      if (!r.ok) aoAvisar(r.mensagem);
      else depois?.();
    });
  }

  function acrescentar() {
    const texto = novo.trim();
    if (!texto || salvando) return;
    rodar(montar.adicionar(base.id, texto), () => {
      setNovo("");
      // O foco fica no campo: quem monta uma lista digita os passos em sequência.
      campoNovo.current?.focus();
    });
  }

  function salvarEdicao(item: ItemDemanda) {
    if (desistiu.current) {
      desistiu.current = false;
      return;
    }
    const texto = rascunho.trim();
    setEditando(null);
    if (!texto || texto === item.texto) return;
    rodar(montar.renomear(item.id, texto));
  }

  return (
    <section aria-label="Checklist" className="space-y-1.5">
      <header className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Checklist
        {itens.length > 0 && (
          <>
            <span className="tabular-nums text-zinc-400 dark:text-zinc-500">
              {feitos}/{itens.length}
            </span>
            <span className="h-1 w-16 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
              <span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${(feitos / itens.length) * 100}%` }} />
            </span>
          </>
        )}
      </header>

      {itens.length > 0 && (
        <ul className="space-y-0.5">
          {itens.map((i) => {
            const feito = i.feitoEm !== null;
            return (
              <li key={i.id} className="group/item flex items-start gap-2 rounded-md py-0.5 pr-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={feito}
                  disabled={!podeMarcar}
                  onClick={() => aoMarcarItem(i.id, !feito)}
                  aria-label={feito ? `Desmarcar “${i.texto}”` : `Marcar “${i.texto}”`}
                  title={podeMarcar ? undefined : "Só quem recebeu marca os passos"}
                  className={`mt-[2px] flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition active:scale-90 disabled:cursor-default disabled:active:scale-100 ${
                    feito
                      ? "border-emerald-500 bg-emerald-500 text-white dark:text-zinc-950"
                      : podeMarcar
                        ? "border-zinc-300 text-transparent hover:border-emerald-500 dark:border-zinc-600"
                        : "border-dashed border-zinc-300 text-transparent dark:border-zinc-700"
                  }`}
                >
                  <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" />
                </button>

                {editando === i.id ? (
                  <input
                    autoFocus
                    value={rascunho}
                    maxLength={TETO_TEXTO_ITEM}
                    onChange={(e) => setRascunho(e.target.value)}
                    onBlur={() => salvarEdicao(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        desistiu.current = true;
                        setEditando(null);
                      }
                    }}
                    aria-label="Texto do passo"
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                ) : podeMontar ? (
                  // Quem monta renomeia clicando no texto: o lápis seria mais um
                  // ícone em cada linha de uma lista que deve ser lida de relance.
                  <button
                    type="button"
                    onClick={() => {
                      desistiu.current = false;
                      setEditando(i.id);
                      setRascunho(i.texto);
                    }}
                    title="Clique para renomear"
                    className={`min-w-0 flex-1 cursor-text break-words rounded px-0.5 text-left text-[13px] leading-snug transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      feito ? "text-zinc-400 line-through decoration-zinc-300 dark:text-zinc-500 dark:decoration-zinc-600" : "text-zinc-700 dark:text-zinc-200"
                    }`}
                  >
                    {i.texto}
                  </button>
                ) : (
                  <span
                    className={`min-w-0 flex-1 break-words text-[13px] leading-snug ${
                      feito ? "text-zinc-400 line-through decoration-zinc-300 dark:text-zinc-500 dark:decoration-zinc-600" : "text-zinc-700 dark:text-zinc-200"
                    }`}
                  >
                    {i.texto}
                  </span>
                )}

                {/* Quem fez e quando; no cartão "para todos", quantos fizeram. */}
                {emLote ? (
                  <span className="shrink-0 pt-px text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500" title="Pessoas que já fizeram este passo">
                    {feitosNoLote(i.ordem)}/{lote.length}
                  </span>
                ) : (
                  feito && (
                    <span className="shrink-0 pt-px text-[10px] text-zinc-400 dark:text-zinc-500">
                      {i.feitoPor === eu.nome ? "você" : (i.feitoPor ?? "")} · {horaDe(i.feitoEm!)}
                    </span>
                  )
                )}

                {podeMontar && editando !== i.id && (
                  <button
                    type="button"
                    onClick={() => rodar(montar.remover(i.id))}
                    disabled={salvando}
                    aria-label={`Tirar “${i.texto}”`}
                    title={emLote ? "Tirar este passo de todas as cópias" : "Tirar este passo"}
                    className="shrink-0 rounded p-0.5 text-zinc-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover/item:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {podeMontar && itens.length < TETO_ITENS && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            acrescentar();
          }}
          className="flex items-center gap-2"
        >
          <Plus className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          <input
            ref={campoNovo}
            value={novo}
            maxLength={TETO_TEXTO_ITEM}
            disabled={salvando}
            onChange={(e) => setNovo(e.target.value)}
            placeholder={itens.length ? "Acrescentar um passo" : "Quebrar em passos: escreva o primeiro e Enter"}
            aria-label="Novo passo do checklist"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-50"
          />
          {novo.trim() && (
            <button type="submit" disabled={salvando} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Acrescentar
            </button>
          )}
        </form>
      )}

      {/* Independente, com aviso: o último passo marcado oferece fechar. */}
      {completo && podeMarcar && demandaPendente && (
        <div className="surge-suave mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
          <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">Todos os passos feitos.</span>
          <button
            type="button"
            onClick={aoFecharDemanda}
            className="rounded-md bg-emerald-600 px-2 py-1 font-medium text-white transition hover:bg-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            Marcar a demanda como feita
          </button>
        </div>
      )}
    </section>
  );
}
