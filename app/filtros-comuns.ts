// O que funil e contatos filtram em comum. A forma dos filtros muda (o funil
// tem responsável e etapa; contatos, não), mas estas regras são as mesmas.

// Mora aqui, e não em data.ts, porque data.ts é o mock de 602 linhas e este
// módulo é importado por componentes client (filtros de contatos, funil e a
// paleta de automações). Importar uma constante de lá arrastava o mock inteiro
// para o bundle do navegador — os `import type` do resto do app somem na
// compilação, este era o único import de valor que sobrava.
// Agora, de verdade. Era uma data FIXA (2026-07-15) da época do mock, e desde
// que os dados passaram a vir do banco isso virou bug: em setembro, "últimos 7
// dias" continuava contando a partir de 8 de julho — o filtro dizia uma coisa e
// fazia outra, sempre para mais.
//
// Função e não constante de módulo: em processo de servidor que fica vivo por
// dias, uma const de import congelaria o "hoje" no boot. Não há risco de
// hidratação porque o período nasce em "todos" e nada disto roda no 1º render.
function agora() {
  return new Date();
}

export const periodos = [
  { valor: "todos", rotulo: "Qualquer data" },
  { valor: "7", rotulo: "Últimos 7 dias" },
  { valor: "30", rotulo: "Últimos 30 dias" },
  { valor: "90", rotulo: "Últimos 90 dias" },
];

// "São Paulo" e "sao paulo" têm que casar: NFD separa a letra do acento, e o
// replace joga fora o acento solto.
export function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function dentroDoPeriodo(data: string, periodo: string) {
  if (periodo === "todos") return true;

  const limite = agora();
  limite.setDate(limite.getDate() - Number(periodo));
  return new Date(data) >= limite;
}

// Mesmo corte, calculado uma vez por filtro em vez de dois `new Date` por linha
// filtrada. Devolve no formato exato que os dados.ts trazem
// ("AAAA-MM-DDTHH:MM:SSZ", sem milissegundos), então dá pra comparar com >= como
// texto: em ISO UTC de largura fixa a ordem lexicográfica é a cronológica.
export function corteDoPeriodo(periodo: string): string | null {
  if (periodo === "todos") return null;

  const limite = agora();
  limite.setDate(limite.getDate() - Number(periodo));
  return limite.toISOString().slice(0, 19) + "Z";
}
