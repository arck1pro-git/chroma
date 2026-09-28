// A cor é do FUNIL; a etapa recebe um tom dela.
//
// COMO ERA: cada etapa guardava a própria classe Tailwind em `etapas.cor`
// ('bg-violet-500'), escolhida a dedo na criação. Isso deixava o quadro sem
// leitura nenhuma — doze etapas podiam sair em doze cores sem relação entre si,
// e a cor não dizia nada sobre o andamento.
//
// COMO É: o funil define UM tom. As etapas recebem esse tom clareando no começo
// e escurecendo até o fim — a última etapa na ordem é sempre o tom mais escuro.
// Assim a cor passa a significar progresso: quanto mais escura a coluna, mais
// perto do fechamento.
//
// A derivação é PURA e roda em cima de (cor do funil, posição, total). Nada é
// gravado por etapa — `etapas.cor` deixou de ser lido (ver
// migration-cor-no-funil.sql). Uma etapa reordenada muda de tom sozinha, o que
// não aconteceria com a cor gravada na linha.

/** Os tons que um funil pode ter. O valor é o nome da cor no Tailwind. */
export const TONS_FUNIL = [
  { id: "blue", rotulo: "Azul" },
  { id: "sky", rotulo: "Celeste" },
  { id: "cyan", rotulo: "Ciano" },
  { id: "teal", rotulo: "Verde-azulado" },
  { id: "emerald", rotulo: "Esmeralda" },
  { id: "lime", rotulo: "Lima" },
  { id: "amber", rotulo: "Âmbar" },
  { id: "orange", rotulo: "Laranja" },
  { id: "rose", rotulo: "Rosa" },
  { id: "fuchsia", rotulo: "Magenta" },
  { id: "violet", rotulo: "Violeta" },
  { id: "indigo", rotulo: "Índigo" },
  { id: "zinc", rotulo: "Cinza" },
] as const;

export type TomFunil = (typeof TONS_FUNIL)[number]["id"];

export const TOM_PADRAO: TomFunil = "blue";

// A rampa, do mais claro ao mais escuro.
//
// Começa em 300 e não em 100: abaixo disso a faixa de 6px no topo da coluna
// some contra o fundo branco, e uma etapa invisível é pior que uma etapa sem
// cor. Termina em 950, que é o tom mais escuro que o Tailwind tem — é o
// "mais escuro daquela cor" do pedido, ao pé da letra.
const RAMPA = [300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * O tom da etapa na posição `indice` (0 = primeira) de um funil com `total`
 * etapas.
 *
 * A última posição cai SEMPRE no fim da rampa — é a regra do pedido, e por isso
 * a conta distribui sobre (total - 1) e não sobre total. Com uma etapa só, ela
 * é a primeira e a última ao mesmo tempo: vale a regra da última, o mais
 * escuro.
 *
 * Com mais etapas que degraus (8+), duas vizinhas repetem o tom em vez de
 * estourar a rampa. Repetir é a degradação certa aqui: o gradiente continua
 * lendo como progresso, e inventar tons fora da paleta do Tailwind exigiria cor
 * arbitrária, que o purge não veria.
 */
export function tomDaEtapa(
  cor: string,
  indice: number,
  total: number,
): string {
  const hue = corValida(cor);
  if (total <= 1) return `bg-${hue}-${RAMPA[RAMPA.length - 1]}`;

  const posicao = Math.min(Math.max(indice, 0), total - 1);
  const passo = Math.round((posicao * (RAMPA.length - 1)) / (total - 1));
  return `bg-${hue}-${RAMPA[passo]}`;
}

// O robô da IA nos cards e o interruptor de IA da etapa saem na cor do FUNIL.
// Classes escritas por extenso — montadas com `${hue}` o Tailwind não as veria.
const TEXTO_DO_TOM: Record<TomFunil, string> = {
  blue: "text-blue-600 dark:text-blue-400",
  sky: "text-sky-600 dark:text-sky-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  teal: "text-teal-600 dark:text-teal-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  lime: "text-lime-600 dark:text-lime-400",
  amber: "text-amber-600 dark:text-amber-400",
  orange: "text-orange-600 dark:text-orange-400",
  rose: "text-rose-600 dark:text-rose-400",
  fuchsia: "text-fuchsia-600 dark:text-fuchsia-400",
  violet: "text-violet-600 dark:text-violet-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  zinc: "text-zinc-600 dark:text-zinc-400",
};

const REALCE_DO_TOM: Record<TomFunil, string> = {
  blue: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300",
  sky: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300",
  cyan: "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300",
  teal: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
  lime: "border-lime-300 bg-lime-50 text-lime-700 dark:border-lime-500/40 dark:bg-lime-500/10 dark:text-lime-300",
  amber: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  orange: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300",
  rose: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
  fuchsia: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
  violet: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300",
  zinc: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
};

const SOLIDO_DO_TOM: Record<TomFunil, string> = {
  blue: "bg-blue-600 hover:bg-blue-700 text-white",
  sky: "bg-sky-600 hover:bg-sky-700 text-white",
  cyan: "bg-cyan-600 hover:bg-cyan-700 text-white",
  teal: "bg-teal-600 hover:bg-teal-700 text-white",
  emerald: "bg-emerald-600 hover:bg-emerald-700 text-white",
  lime: "bg-lime-600 hover:bg-lime-700 text-white",
  amber: "bg-amber-600 hover:bg-amber-700 text-white",
  orange: "bg-orange-600 hover:bg-orange-700 text-white",
  rose: "bg-rose-600 hover:bg-rose-700 text-white",
  fuchsia: "bg-fuchsia-600 hover:bg-fuchsia-700 text-white",
  violet: "bg-violet-600 hover:bg-violet-700 text-white",
  indigo: "bg-indigo-600 hover:bg-indigo-700 text-white",
  zinc: "bg-zinc-900 hover:bg-zinc-700 text-white dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300",
};

/** Botão cheio na cor do funil — a confirmação de ligar a IA. */
export function solidoDoTom(cor: string | null | undefined): string {
  return SOLIDO_DO_TOM[corValida(cor)];
}

/** Cor de texto do tom do funil — o robô da IA nos cards. */
export function textoDoTom(cor: string | null | undefined): string {
  return TEXTO_DO_TOM[corValida(cor)];
}

/** Borda + fundo claro + texto do tom — o interruptor de IA ligado. */
export function realceDoTom(cor: string | null | undefined): string {
  return REALCE_DO_TOM[corValida(cor)];
}

/** Cor desconhecida (vinda do banco, editada à mão) cai no padrão em vez de
 *  gerar uma classe que o Tailwind não tem e sumir na tela. */
export function corValida(cor: string | null | undefined): TomFunil {
  return (TONS_FUNIL.find((t) => t.id === cor)?.id ?? TOM_PADRAO) as TomFunil;
}

/** A amostra que o seletor de cor mostra — o tom cheio, no meio da rampa. */
export function amostraDoTom(cor: string): string {
  return `bg-${corValida(cor)}-500`;
}

/**
 * O tom mais ESCURO da cor do funil — o mesmo que a última etapa recebe, já que
 * `tomDaEtapa` sempre fecha a rampa no fim.
 *
 * Existe separado porque quem quer "a cor escura deste funil" nem sempre tem
 * índice e total de etapas para passar: a marca da IA no painel lateral
 * (app/components/chat-ia.tsx) sabe do funil, não das etapas dele.
 */
export function tomEscuro(cor: string | null | undefined): string {
  return `bg-${corValida(cor)}-${RAMPA[RAMPA.length - 1]}`;
}
