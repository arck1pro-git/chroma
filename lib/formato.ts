// Formatação de dinheiro, data, lugar e iniciais, igual em toda tela e no
// servidor. Importado como valor por dezenas de componentes cliente: aqui não
// entra `server-only`, banco nem segredo, senão o build das telas quebra.
// Morava em app/formato.ts até 2026-10-21.

/**
 * "Porto Belo/SC", "Porto Belo", "SC" — ou "" quando não há nada.
 *
 * O tipo Contato diz `string`, mas cidade, estado e país são nullable no banco:
 * quem entra pelo chat ou pelo webhook costuma chegar só com nome e telefone.
 * Montar `${cidade}/${estado}` direto escrevia "null/null" no cartão do quadro,
 * na gaveta e na ficha. Quem chama decide o que mostrar no lugar do vazio.
 */
export function localizacao(
  c: { cidade?: string | null; estado?: string | null; pais?: string | null } | null | undefined,
  comPais = false,
): string {
  if (!c) return "";
  const lugar = [c.cidade, c.estado].map((v) => v?.trim()).filter(Boolean).join("/");
  return [lugar, comPais ? c.pais?.trim() : ""].filter(Boolean).join(" · ");
}

export function brl(valor: number) {
  return "R$ " + valor.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "R$ 1,3 mi", "R$ 350 mil", "R$ 9.800" — para onde o valor cheio não cabe;
 *  quem usa põe o `brl` cheio no title. */
export function brlCurto(valor: number) {
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toFixed(1).replace(/\.0$/, "").replace(".", ",")} mi`;
  if (valor >= 10_000) return `R$ ${Math.round(valor / 1_000)} mil`;
  return `R$ ${Math.round(valor).toLocaleString("pt-BR")}`;
}

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// "2026-07-13" → "13 jul 2026", sem passar por Date de propósito:
// new Date("2026-07-13") é meia-noite UTC, que em Brasília é dia 12 — a data
// apareceria um dia atrasada.
//
// Recebe uma DATA PURA ('AAAA-MM-DD'). Para um instante (timestamptz, com hora),
// use dataDoInstante: cortar a string de um instante pega o dia em UTC, que às
// 22h de Brasília já é o dia seguinte.
export function dataCurta(data: string) {
  const [ano, mes, dia] = data.slice(0, 10).split("-");
  return `${dia} ${MESES[Number(mes) - 1]} ${ano}`;
}

const anoEmBrasilia = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/**
 * "05 out", e "05 out 2025" quando não é o ano corrente. Recebe um INSTANTE
 * (timestamptz) e converte para Brasília; para uma data pura, use dataCurta.
 * Era `dataCompacta` em app/contatos/pecas.tsx até 2026-10-21.
 */
export function dataDoInstante(iso: string) {
  const d = new Date(iso);
  const mesmoAno = anoEmBrasilia.format(d) === anoEmBrasilia.format(new Date());
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: mesmoAno ? undefined : "numeric",
    timeZone: "America/Sao_Paulo",
  })
    .format(d)
    .replace(/\./g, "")
    .replace(/ de /g, " ");
}

// Aqui, ao contrário, a conversão é o ponto: histórico e anotações são
// timestamptz. O fuso é fixo para servidor e navegador renderizarem a mesma
// string — com o fuso do runtime, o SSR sai em UTC, o cliente em local, e o
// React acusa erro de hidratação.
const horaFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function dataHora(iso: string) {
  return horaFmt.format(new Date(iso));
}

// Só a hora, para as bolhas do chat e a prévia da lista, onde a data cheia
// polui. Mesmo fuso fixo do dataHora, pela mesma razão de hidratação.
const horaMinFmt = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function horaCurta(iso: string) {
  return horaMinFmt.format(new Date(iso));
}

// "Ana Paula Souza" → "AS", para os avatares da ficha e da gaveta de contatos.
// Nome vazio devolve "?" em vez de estourar: contato criado pelo webhook do
// chat pode chegar só com whatsapp.
export function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}
