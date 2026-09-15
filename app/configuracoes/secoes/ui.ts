// Classes compartilhadas pelas seções de Configurações.
//
// Saíram de configuracoes.tsx quando cada seção virou uma rota própria (ver
// ../layout.tsx). São elas que mantêm os formulários das seis telas com o
// mesmo corpo, a mesma borda e o mesmo foco agora que cada seção mora num
// arquivo diferente.
export const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

export const botao =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
