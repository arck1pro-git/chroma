export function brl(valor: number) {
  return "R$ " + valor.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// "2026-07-13" → "13 jul 2026", sem passar por Date de propósito:
// new Date("2026-07-13") é meia-noite UTC, que em Brasília é dia 12 — a data
// apareceria um dia atrasada.
export function dataCurta(data: string) {
  const [ano, mes, dia] = data.slice(0, 10).split("-");
  return `${dia} ${MESES[Number(mes) - 1]} ${ano}`;
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
