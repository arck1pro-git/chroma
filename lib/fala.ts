// O texto que a IA escreveu, reescrito para ser FALADO.
//
// Existe porque a voz (lib/voz.ts) lê algarismo mal, e o atendimento é feito
// de valores. Testado em 2026-09-29 com a voz da Magnific e conferido pela
// transcrição: "R$ 3.800" saiu "3.800 dólares", "1,90% a.m." saiu "1,90% a
// ano", "R$ 200.000" saiu "200 milhares". Escrito por extenso, sai certo.
//
// Determinístico e sem modelo: dinheiro, porcentagem e número com milhar viram
// palavras; as abreviações do mercado viram o que se fala; a formatação do
// WhatsApp (*negrito*, _itálico_) e links saem. Número pequeno solto ("18, 24
// ou 36 meses") fica como está — a voz lê esses bem.

const UNIDADES = [
  "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos",
];

function ate999(n: number): string {
  if (n === 100) return "cem";
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 20) partes.push(UNIDADES[r]);
    else partes.push(r % 10 ? `${DEZENAS[Math.floor(r / 10)]} e ${UNIDADES[r % 10]}` : DEZENAS[Math.floor(r / 10)]);
  }
  return partes.join(" e ");
}

/** 91200 → "noventa e um mil e duzentos". Inteiros de zero a 999 bilhões. */
export function porExtenso(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return String(n);
  n = Math.trunc(n);
  if (n === 0) return "zero";

  const grupos: Array<{ valor: number; texto: string }> = [];
  const bilhoes = Math.floor(n / 1e9);
  const milhoes = Math.floor((n % 1e9) / 1e6);
  const milhares = Math.floor((n % 1e6) / 1e3);
  const resto = n % 1e3;
  if (bilhoes) grupos.push({ valor: bilhoes, texto: bilhoes === 1 ? "um bilhão" : `${ate999(bilhoes)} bilhões` });
  if (milhoes) grupos.push({ valor: milhoes, texto: milhoes === 1 ? "um milhão" : `${ate999(milhoes)} milhões` });
  if (milhares) grupos.push({ valor: milhares, texto: milhares === 1 ? "mil" : `${ate999(milhares)} mil` });
  if (resto) grupos.push({ valor: resto, texto: ate999(resto) });

  // O "e" entre grupos só entra antes do último, e quando ele é redondo ou
  // pequeno: "três mil e oitocentos", mas "três mil oitocentos e cinquenta".
  return grupos
    .map((g, i) => {
      if (i === 0) return g.texto;
      const ultimo = i === grupos.length - 1;
      return ultimo && (g.valor < 100 || g.valor % 100 === 0) ? `e ${g.texto}` : g.texto;
    })
    .join(" ");
}

const inteiroDe = (s: string) => Number(s.replace(/\./g, ""));

function reais(inteiro: number, centavos: number): string {
  const redondo = inteiro >= 1e6 && inteiro % 1e6 === 0;
  const nome = inteiro === 1 ? "real" : redondo ? "de reais" : "reais";
  const base = inteiro ? `${porExtenso(inteiro)} ${nome}` : "";
  if (!centavos) return base || "zero reais";
  const c = `${porExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`;
  return base ? `${base} e ${c}` : c;
}

/** Decimal falado: "1,90" → "um vírgula noventa"; "2,05" → "dois vírgula zero cinco". */
function decimal(s: string): string {
  const [int, dec] = s.split(",");
  const inteiro = porExtenso(inteiroDe(int));
  // "3,00" se fala "três": casas zeradas não dizem nada.
  if (!dec || /^0+$/.test(dec)) return inteiro;
  const casas = dec.startsWith("0") ? dec.split("").map((d) => UNIDADES[Number(d)]).join(" ") : porExtenso(Number(dec));
  return `${inteiro} vírgula ${casas}`;
}

export function paraFala(texto: string): string {
  let t = texto;

  // CNPJ fica como está: virar "cinquenta milhões…" seria pior que a voz
  // ler os dígitos. Guardado fora e devolvido no fim.
  const guardados: string[] = [];
  t = t.replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, (cnpj) => `§${guardados.push(cnpj) - 1}§`);

  // Links e formatação do WhatsApp não se falam.
  t = t.replace(/https?:\/\/\S+/g, "");
  t = t.replace(/[*_~`]/g, "");

  // Abreviações do mercado, antes dos números (o "a.m." cola na porcentagem).
  t = t.replace(/\ba\.\s?m\./gi, "ao mês").replace(/\ba\.\s?a\./gi, "ao ano").replace(/\bp\.\s?p\./gi, "pontos percentuais");

  // Dinheiro: "R$ 200 mil", "R$ 1,5 milhão", "R$ 3.800,50", "R$ 91.200".
  t = t.replace(/R\$\s?(\d+(?:,\d+)?)\s?(mil|milhão|milhões|bilhão|bilhões)\b/gi, (_, n: string, escala: string) =>
    `${decimal(n)} ${escala} de reais`.replace(/ mil de reais$/, " mil reais"),
  );
  t = t.replace(/R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g, (_, int: string, cent?: string) =>
    reais(inteiroDe(int), cent ? Number(cent.padEnd(2, "0")) : 0),
  );

  // Porcentagem: "1,90%" → "um vírgula noventa por cento".
  t = t.replace(/(\d+(?:,\d+)?)\s?%/g, (_, n: string) => `${decimal(n)} por cento`);

  // Número com separador de milhar solto: "200.000" → "duzentos mil".
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (n) => porExtenso(inteiroDe(n)));
  // Decimal solto: "0,5 pontos" → "zero vírgula cinco pontos". Vírgula seguida
  // de espaço ("18, 24") é lista, não decimal, e fica.
  t = t.replace(/\b(\d+,\d+)\b/g, (_, n: string) => decimal(n));

  // Travessão e quebra de linha viram pausa; espaços repetidos somem.
  t = t.replace(/\s*[—–]\s*/g, ", ").replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ");
  t = t.replace(/§(\d+)§/g, (_, i: string) => guardados[Number(i)]);
  return t.trim();
}
