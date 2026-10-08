// Classes compartilhadas pelas seções de Configurações.
//
// Saíram de configuracoes.tsx quando cada seção virou uma rota própria (ver
// ../layout.tsx). São elas que mantêm os formulários das sete telas com o
// mesmo corpo, a mesma borda e o mesmo foco agora que cada seção mora num
// arquivo diferente. As peças com marcação (cabeçalho, painel, vazio,
// interruptor) estão em ./pecas.tsx.
//
// A ESCALA (redesenho de 2026-10-08): campo e botão com a MESMA altura (36px),
// para que um formulário em linha nunca tenha controles desalinhados; rótulo
// em caixa normal, 12px, médio — o caixa-alta espaçado de antes gritava mais
// alto que o próprio campo.
export const campoTexto =
  "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 shadow-[0_1px_0_rgba(0,0,0,0.02)] outline-none transition placeholder:text-zinc-400 hover:border-zinc-300 focus-visible:border-zinc-400 focus-visible:ring-4 focus-visible:ring-zinc-900/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-700 dark:focus-visible:border-zinc-600 dark:focus-visible:ring-zinc-100/5";

/** O botão principal da tela: um por bloco, no máximo. */
export const botao =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-[13px] font-medium text-white shadow-sm transition hover:bg-zinc-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

/** Ação secundária com moldura: Cancelar, Conexão, Desconectar. */
export const botaoSecundario =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

/** Ação de texto, sem moldura: Cancelar ao lado do principal, Atualizar. */
export const botaoFantasma =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

/** O rótulo de um campo de formulário. */
export const rotuloCampo = "text-[12px] font-medium text-zinc-600 dark:text-zinc-400";

/** Texto de ajuda sob um campo ou um bloco. */
export const textoAjuda = "text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400";
