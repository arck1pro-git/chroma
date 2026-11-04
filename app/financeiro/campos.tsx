"use client";

// As peças dos formulários do Financeiro (a gaveta do pagamento e a linha da
// folha): o campo em reais com "R$", o alternador Hora/Fixo e o PIX com copiar.
import { useState } from "react";
import type { TipoPagamento } from "@/lib/financeiro-tipos";
import { Check, Copy } from "@/app/components/icones";

/** Campo em reais. */
export function CampoReais({
  valor,
  aoMudar,
  rotulo,
  apagado = false,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  rotulo: string;
  /** O valor não entra na conta (o valor hora de quem é fixo, e vice-versa). */
  apagado?: boolean;
}) {
  return (
    <label
      className={`flex w-full items-center rounded-lg border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:ring-4 focus-within:ring-zinc-900/5 dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-zinc-500 dark:focus-within:ring-white/5 ${
        apagado ? "opacity-45 focus-within:opacity-100 hover:opacity-100" : ""
      }`}
    >
      <span className="select-none pl-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">R$</span>
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        aria-label={rotulo}
        className="min-w-0 flex-1 bg-transparent py-2 pl-1 pr-2 text-right text-[13px] tabular-nums text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-50 dark:placeholder:text-zinc-600"
      />
    </label>
  );
}

/** Por hora ou fixo, em dois botões lado a lado. */
export function AlternarTipo({ valor, aoMudar, rotulo }: { valor: TipoPagamento | ""; aoMudar: (v: TipoPagamento) => void; rotulo: string }) {
  const opcoes: Array<[TipoPagamento, string]> = [
    ["hora", "Por hora"],
    ["fixo", "Fixo no mês"],
  ];
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex rounded-lg bg-zinc-100 p-0.5 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-800/70 dark:ring-zinc-700/60">
      {opcoes.map(([v, texto]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => aoMudar(v)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
            valor === v
              ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-zinc-950 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

/** O PIX com o botão de copiar, para quem vai pagar. */
export function CopiarPix({ pix }: { pix: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(pix).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        });
      }}
      className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      title="Copiar a chave PIX"
    >
      {copiado ? <Check className="size-3 shrink-0 text-emerald-500" aria-hidden="true" /> : <Copy className="size-3 shrink-0" aria-hidden="true" />}
      <span className="truncate">{pix}</span>
    </button>
  );
}
