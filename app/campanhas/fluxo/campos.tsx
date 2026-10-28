"use client";

// As peças de formulário do painel do bloco. Os controles usam o campo das
// telas de Campanhas (campoAds, em ../pecas.tsx); aqui fica só o que o painel
// repete: rótulo com ajuda, grupo de vários controles, alternador de duas
// opções e o prazo em minutos, horas ou dias.
import { useState } from "react";
import { campoAds } from "../pecas";

export function Ajuda({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{children}</p>;
}

/** Um controle com rótulo. Para vários controles juntos, Grupo (fieldset com legenda). */
export function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{rotulo}</span>
      <span className="mt-1 block">{children}</span>
      {ajuda && <Ajuda>{ajuda}</Ajuda>}
    </label>
  );
}

export function Grupo({ rotulo, ajuda, children }: { rotulo: string; ajuda?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{rotulo}</legend>
      <div className="mt-1">{children}</div>
      {ajuda && <Ajuda>{ajuda}</Ajuda>}
    </fieldset>
  );
}

export function Alternar<T extends string>({
  rotulo,
  valor,
  opcoes,
  mudar,
}: {
  rotulo: string;
  valor: T;
  opcoes: Array<[T, string]>;
  mudar: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
      {opcoes.map(([v, r]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => mudar(v)}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:opacity-60 dark:focus-visible:ring-zinc-100/20 ${
            valor === v
              ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

const UNIDADES = [
  { fator: 1, rotulo: "minutos" },
  { fator: 60, rotulo: "horas" },
  { fator: 1440, rotulo: "dias" },
] as const;

/** A unidade mais redonda: 2880 → 2 dias, 120 → 2 horas, 90 → 90 minutos. */
function emUnidade(minutos: number) {
  const fator = [1440, 60, 1].find((f) => minutos >= f && minutos % f === 0) ?? 1;
  return { fator, texto: String(minutos / fator) };
}

/**
 * Um prazo em minutos, digitado na unidade que a pessoa escolher. A unidade é
 * estado do campo: derivada dos minutos, "24 horas" viraria "1 dias" no meio
 * da digitação. Quem usa remonta o campo por bloco (key).
 */
export function CampoDuracao({ rotulo, minutos, mudar }: { rotulo: string; minutos: number; mudar: (m: number) => void }) {
  const [{ fator, texto }, setEstado] = useState(() => emUnidade(minutos));
  function aplicar(novoTexto: string, novoFator: number) {
    setEstado({ fator: novoFator, texto: novoTexto });
    const n = Number(novoTexto);
    if (Number.isInteger(n) && n > 0) mudar(n * novoFator);
  }
  return (
    <Grupo rotulo={rotulo} ajuda="De 5 minutos a 30 dias.">
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          aria-label={`${rotulo}: quantidade`}
          value={texto}
          onChange={(e) => aplicar(e.target.value, fator)}
          className={`${campoAds} w-24`}
        />
        <select aria-label={`${rotulo}: unidade`} value={fator} onChange={(e) => aplicar(texto, Number(e.target.value))} className={campoAds}>
          {UNIDADES.map((u) => (
            <option key={u.fator} value={u.fator}>
              {u.rotulo}
            </option>
          ))}
        </select>
      </div>
    </Grupo>
  );
}
