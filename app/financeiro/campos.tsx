"use client";

// As peças dos formulários do Financeiro (a linha da folha e o pagamento na
// ficha): o campo em reais com "R$", o alternador Hora/Fixo, o PIX com copiar e
// o salvamento automático com o seu indicador.
//
// SALVAR SOZINHO (2026-11-04, "ta muito travada... deixe mais moderno"): não há
// botão. O que mudou e está completo é gravado um instante depois da última
// tecla, ou na hora em que o foco sai do bloco; o indicador diz "Salvando",
// "Salvo" ou o que falta.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TipoPagamento } from "@/lib/financeiro-tipos";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { AlertCircle, Check, Copy, Loader2 } from "@/app/components/icones";

/** Campo em reais. `fantasma`: sem borda até passar o mouse ou focar (as linhas da tabela). */
export function CampoReais({
  valor,
  aoMudar,
  rotulo,
  apagado = false,
  fantasma = false,
  largura = "w-full",
}: {
  valor: string;
  aoMudar: (v: string) => void;
  rotulo: string;
  /** O valor não entra na conta (o valor hora de quem é fixo, e vice-versa). */
  apagado?: boolean;
  fantasma?: boolean;
  largura?: string;
}) {
  const moldura = fantasma
    ? "border-transparent bg-transparent hover:border-zinc-200 hover:bg-white focus-within:border-zinc-300 focus-within:bg-white dark:hover:border-zinc-700 dark:hover:bg-zinc-950 dark:focus-within:border-zinc-600 dark:focus-within:bg-zinc-950"
    : "border-zinc-200 bg-white focus-within:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-zinc-500";
  return (
    <label
      className={`flex items-center rounded-lg border transition focus-within:ring-4 focus-within:ring-zinc-900/5 dark:focus-within:ring-white/5 ${moldura} ${largura} ${
        apagado ? "opacity-45 focus-within:opacity-100 hover:opacity-100" : ""
      }`}
    >
      <span className={`select-none pl-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 ${fantasma ? "" : "pl-2.5"}`}>R$</span>
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        aria-label={rotulo}
        className={`min-w-0 flex-1 bg-transparent pl-1 pr-2 text-right tabular-nums text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-50 dark:placeholder:text-zinc-600 ${
          fantasma ? "py-1 text-[12.5px]" : "py-2 text-[13px]"
        }`}
      />
    </label>
  );
}

/** Por hora ou fixo, em dois botões lado a lado. */
export function AlternarTipo({
  valor,
  aoMudar,
  compacto = false,
  rotulo,
}: {
  valor: TipoPagamento | "";
  aoMudar: (v: TipoPagamento) => void;
  compacto?: boolean;
  rotulo: string;
}) {
  const opcoes: Array<[TipoPagamento, string]> = compacto
    ? [
        ["hora", "Hora"],
        ["fixo", "Fixo"],
      ]
    : [
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
          className={`rounded-md font-medium transition ${compacto ? "px-2 py-0.5 text-[11.5px]" : "px-3 py-1.5 text-[12.5px]"} ${
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

export type EstadoSalvamento = "parado" | "salvando" | "salvo" | "erro";

/**
 * Salvar sozinho. `pronto` diz se o que está na tela pode ir (mudou e está
 * completo); `gravar` manda para o servidor. Grava `espera` ms depois da última
 * mudança, ou já, com `agora()` (o foco saiu do bloco). Uma gravação por vez: a
 * que chega no meio espera a anterior terminar.
 */
export function useSalvarSozinho({ pronto, gravar, espera = 900, assinatura }: { pronto: boolean; gravar: () => Promise<ResultadoAcao>; espera?: number; assinatura: string }) {
  const [estado, setEstado] = useState<EstadoSalvamento>("parado");
  const [erro, setErro] = useState<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emCurso = useRef<Promise<void> | null>(null);
  const atual = useRef({ pronto, gravar });

  useEffect(() => {
    atual.current = { pronto, gravar };
  });

  const salvar = useCallback(async () => {
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = null;
    if (emCurso.current) await emCurso.current;
    if (!atual.current.pronto) return;
    setEstado("salvando");
    setErro(null);
    const tarefa = atual.current.gravar().then(
      (r) => {
        if (r.ok) setEstado("salvo");
        else {
          setEstado("erro");
          setErro(r.erro);
        }
      },
      () => {
        setEstado("erro");
        setErro("Não consegui salvar agora. Tente de novo.");
      },
    );
    emCurso.current = tarefa;
    await tarefa;
    emCurso.current = null;
  }, []);

  // Cada mudança (a `assinatura` do que está na tela) reinicia a espera.
  useEffect(() => {
    if (!pronto) return;
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = setTimeout(() => void salvar(), espera);
    return () => {
      if (relogio.current) clearTimeout(relogio.current);
    };
  }, [assinatura, pronto, espera, salvar]);

  // "Salvo" some depois de um tempo, para não ficar gritando.
  useEffect(() => {
    if (estado !== "salvo") return;
    const t = setTimeout(() => setEstado("parado"), 2500);
    return () => clearTimeout(t);
  }, [estado]);

  return { estado, erro, agora: salvar };
}

/** O indicador do salvamento: girando, "Salvo", o que falta ou o erro. */
export function IndicadorSalvamento({ estado, erro, falta, compacto = false }: { estado: EstadoSalvamento; erro: string | null; falta?: string | null; compacto?: boolean }) {
  let conteudo: ReactNode = null;
  if (estado === "salvando") {
    conteudo = (
      <span className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {!compacto && "Salvando"}
      </span>
    );
  } else if (estado === "erro") {
    conteudo = (
      <span className="inline-flex items-start gap-1 text-red-600 dark:text-red-400" title={erro ?? undefined}>
        <AlertCircle className="mt-px size-3 shrink-0" aria-hidden="true" />
        {erro}
      </span>
    );
  } else if (falta) {
    conteudo = <span className="text-amber-600 dark:text-amber-400">{falta}</span>;
  } else if (estado === "salvo") {
    conteudo = (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" aria-hidden="true" />
        Salvo
      </span>
    );
  }
  return (
    <span role="status" aria-live="polite" className="text-[11px] leading-tight">
      {conteudo}
    </span>
  );
}
