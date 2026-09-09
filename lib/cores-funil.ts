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

/** Cor desconhecida (vinda do banco, editada à mão) cai no padrão em vez de
 *  gerar uma classe que o Tailwind não tem e sumir na tela. */
export function corValida(cor: string | null | undefined): TomFunil {
  return (TONS_FUNIL.find((t) => t.id === cor)?.id ?? TOM_PADRAO) as TomFunil;
}

/** A amostra que o seletor de cor mostra — o tom cheio, no meio da rampa. */
export function amostraDoTom(cor: string): string {
  return `bg-${corValida(cor)}-500`;
}
