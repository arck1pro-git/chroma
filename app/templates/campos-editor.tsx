"use client";

// As peças do formulário do editor de template (./editor.tsx): o bloco com
// título, contador e dica, o botão da barra de formatação, o contador de
// caracteres, o campo de exemplo de variável e a linha de situação do rodapé.
// Sem estado próprio: o editor decide, estas só desenham.
import { LIMITE } from "@/lib/templates-whatsapp";
import { CircleCheck, type TipoIcone } from "@/app/components/icones";

/** A linha do rodapé do editor: o erro da Meta, o que falta, ou que está pronto. */
export function Situacao({ erro, problema, comAvisos }: { erro: string | null; problema?: string; comAvisos: boolean }) {
  if (erro) {
    return (
      <p role="alert" className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug text-red-600 dark:text-red-400" title={erro}>
        {erro}
      </p>
    );
  }
  if (problema) {
    return (
      <p className="min-w-0 flex-1 truncate text-[12px] text-zinc-500 dark:text-zinc-400" title={problema}>
        {problema}
      </p>
    );
  }
  return (
    <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[12px] text-emerald-700 dark:text-emerald-400">
      <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
      {comAvisos ? "Pronto para enviar — veja os avisos ao lado." : "Pronto para enviar."}
    </p>
  );
}

export function Bloco({
  titulo,
  opcional,
  htmlFor,
  contador,
  acao,
  erro,
  dica,
  children,
}: {
  titulo: string;
  opcional?: boolean;
  htmlFor?: string;
  contador?: React.ReactNode;
  acao?: React.ReactNode;
  erro?: string;
  dica?: string;
  children?: React.ReactNode;
}) {
  // <label> só quando há um campo para ele apontar; título de grupo é texto.
  const Rotulo = htmlFor ? "label" : "span";
  return (
    <section>
      <div className="mb-1.5 flex min-h-6 items-center justify-between gap-2">
        <Rotulo
          htmlFor={htmlFor}
          className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
        >
          {titulo}
          {opcional && <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-400 dark:text-zinc-500">opcional</span>}
        </Rotulo>
        {(acao || contador) && (
          <span className="flex items-center gap-2">
            {acao}
            {contador}
          </span>
        )}
      </div>
      {children}
      {erro ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-red-600 dark:text-red-400">{erro}</p>
      ) : dica ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-zinc-400 dark:text-zinc-500">{dica}</p>
      ) : null}
    </section>
  );
}

/**
 * Botão da barra do editor. O mousedown não tira o foco do campo: sem isso o
 * clique em Negrito perderia a seleção que ele vai envolver.
 */
export function Ferramenta({
  Icone,
  rotulo,
  onClick,
  somenteIcone,
  disabled,
}: {
  Icone: TipoIcone;
  rotulo: string;
  onClick: () => void;
  somenteIcone?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={rotulo}
      title={rotulo}
      className={`inline-flex h-7 items-center justify-center gap-1 rounded-md text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-35 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 ${
        somenteIcone ? "w-7" : "px-1.5"
      }`}
    >
      <Icone className="size-3.5" aria-hidden="true" />
      {!somenteIcone && rotulo}
    </button>
  );
}

export function Contador({ atual, maximo }: { atual: number; maximo: number }) {
  const cor =
    atual > maximo
      ? "text-red-600 dark:text-red-400"
      : atual >= maximo * 0.9
        ? "text-amber-600 dark:text-amber-400"
        : "text-zinc-400 dark:text-zinc-500";
  return (
    <span className={`text-[10.5px] tabular-nums ${cor}`}>
      {atual.toLocaleString("pt-BR")}/{maximo.toLocaleString("pt-BR")}
    </span>
  );
}

export function CampoExemplo({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white pl-2.5 transition focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
      <span className="shrink-0 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{rotulo}</span>
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        maxLength={LIMITE.exemplo}
        placeholder="Exemplo"
        className="min-w-0 flex-1 bg-transparent py-1.5 pr-2.5 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-50 dark:placeholder:text-zinc-600"
      />
    </label>
  );
}
