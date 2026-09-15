// As classes repetidas do módulo Webhooks.
//
// Existe porque o painel virou três arquivos — a casca (painel.tsx), a visão
// geral (metricas.tsx) e a configuração (configuracao.tsx) — e os três desenham
// o mesmo campo e o mesmo botão.
//
// As medidas NÃO são novas: são as do painel de Automações
// (app/automacoes/painel-lateral.tsx), que é a tela irmã desta — lista à
// esquerda, detalhe do selecionado à direita. Botão de painel é py-1.5/12px, e
// não o py-2/13px das Configurações, porque aqui o conteúdo divide a largura
// com a lista e um corpo maior empurraria tudo para baixo.
export const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[12px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

export const botao =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

export const botaoFraco =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

/** Ação só-ícone do cabeçalho. Mesma caixa de 32px de /automacoes. */
export const botaoIcone =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

/** Rótulo de campo de formulário. 11px, como em todas as outras telas. */
export const rotuloCampo =
  "text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";

/** O cartão de conteúdo: sempre p-4, sempre rounded-xl. */
export const cartao =
  "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

/** Vazio: tracejado, centralizado, cinza fraco. */
export const vazio =
  "rounded-lg border border-dashed border-zinc-200 px-3 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500";

export const avisoAmbar =
  "flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";

// O selo de estado de um recebimento. Mesmas cores dos estados de conexão em
// Configurações › WhatsApp. Cor + a palavra: o estado nunca depende só do tom,
// que é o que faz ele sobreviver a daltonismo e a print em cinza.
export const SELO_RECEBIMENTO = {
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  recusado: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  erro: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400",
} as const;

// A tabela de "quem passou": as mesmas classes da lista de Contatos
// (app/contatos/lista.tsx), inclusive o border-separate — com collapse o
// navegador descarta as bordas e as linhas somem ao rolar.
export const cabecalhoTabela =
  "border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-500";

export const celulaTabela =
  "border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800/70";
