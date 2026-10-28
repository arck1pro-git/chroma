"use client";

// As peças do formulário do editor de template (./editor.tsx): o bloco com
// título, contador e dica, o botão da barra de formatação, o contador de
// caracteres, o campo de exemplo de variável, o link do botão (com a opção
// "Link com variável", 2026-10-27) e a linha de situação do rodapé.
// Sem estado próprio: o editor decide, estas só desenham.
import { baseDoLink, LIMITE } from "@/lib/templates-whatsapp";
import { CircleCheck, type TipoIcone } from "@/app/components/icones";
import { CAMPO } from "../components/gaveta";

/** O que a opção "Link com variável" acrescenta no fim do link (e tira ao desligar). */
export const FIM_VARIAVEL = "{{1}}";


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

/**
 * O link do botão. Com variável, o {{1}} fica fixo depois do campo e só a parte
 * de antes se edita — não dá para apagar o {{1}} sem querer. O <input> é o
 * mesmo nos dois modos: quem digita o {{1}} à mão no fim liga a opção, e trocar
 * de elemento no meio da digitação tiraria o foco.
 */
export function CampoLink({
  destino,
  variavel,
  rotulo,
  invalido,
  aoMudar,
}: {
  destino: string;
  variavel: boolean;
  rotulo: string;
  invalido?: boolean;
  aoMudar: (destino: string) => void;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center rounded-lg border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
      <input
        value={variavel ? baseDoLink(destino) : destino}
        // Quem cola o link inteiro, já com o {{1}}, não fica com dois.
        onChange={(e) => aoMudar(variavel ? e.target.value.replace(/\{\{1\}\}$/, "") + FIM_VARIAVEL : e.target.value)}
        maxLength={variavel ? LIMITE.url - FIM_VARIAVEL.length : LIMITE.url}
        inputMode="url"
        aria-label={rotulo}
        aria-invalid={invalido || undefined}
        placeholder={variavel ? "https://…/v/código?w=" : "https://…"}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-600"
      />
      {variavel && (
        <span
          className="mr-1.5 shrink-0 rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          title="O final do link, preenchido em cada envio"
        >
          {FIM_VARIAVEL}
        </span>
      )}
    </span>
  );
}

/**
 * A linha de baixo de um botão de link: a opção "Link com variável" e, ligada,
 * o exemplo do final que a Meta pede para analisar. O erro (ou a dica do uso
 * típico) fica embaixo, alinhado com o texto do botão.
 */
export function OpcaoLinkVariavel({
  ligado,
  exemplo,
  erro,
  aoAlternar,
  aoMudarExemplo,
}: {
  ligado: boolean;
  exemplo: string;
  erro?: string;
  aoAlternar: (ligado: boolean) => void;
  aoMudarExemplo: (exemplo: string) => void;
}) {
  return (
    <div className="pl-10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Alternador
          ligado={ligado}
          rotulo="Link com variável"
          dica="O final do link muda a cada envio — como o link rastreável do vídeo, com o WhatsApp do contato."
          aoMudar={aoAlternar}
        />
        {ligado && (
          <label className="flex min-w-48 flex-1 items-center gap-2">
            <span className="shrink-0 text-[11.5px] text-zinc-500 dark:text-zinc-400">Exemplo do final do link</span>
            <input
              value={exemplo}
              onChange={(e) => aoMudarExemplo(e.target.value)}
              maxLength={LIMITE.valorLink}
              placeholder="5547999990000"
              spellCheck={false}
              autoComplete="off"
              className={`${CAMPO} w-full font-mono`}
            />
          </label>
        )}
      </div>
      {ligado &&
        (erro ? (
          <p className="mt-1 text-[11.5px] leading-snug text-red-600 dark:text-red-400">{erro}</p>
        ) : (
          <p className="mt-1 text-[11.5px] leading-snug text-zinc-400 dark:text-zinc-500">
            Uso típico: o link rastreável do vídeo (…/v/código?w=) com o WhatsApp do contato no fim. O final é preenchido em cada
            envio.
          </p>
        ))}
    </div>
  );
}

/** Interruptor pequeno com o rótulo ao lado, num botão só: o clique no texto também liga. */
function Alternador({
  ligado,
  rotulo,
  dica,
  aoMudar,
}: {
  ligado: boolean;
  rotulo: string;
  dica?: string;
  aoMudar: (ligado: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      title={dica}
      onClick={() => aoMudar(!ligado)}
      className="inline-flex h-7 shrink-0 items-center gap-2 rounded-md px-1.5 text-[12px] font-medium text-zinc-600 outline-none transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:focus-visible:ring-white/20"
    >
      <span
        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition ${ligado ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-700"}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full shadow-sm transition-all ${ligado ? "left-3.5 bg-white dark:bg-zinc-900" : "left-0.5 bg-white"}`}
        />
      </span>
      {rotulo}
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
