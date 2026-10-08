// Um tom por pessoa, tirado do nome: numa lista de doze iniciais cinzas o olho
// não acha ninguém; com cor, "a laranja é a Patricia" vira atalho. A tinta é
// clara e o texto, escuro do mesmo tom — nada aqui compete com o tom do funil.
//
// Mora aqui, e não nas Configurações, porque Demandas usa a mesma tinta: a
// pessoa tem a mesma cor nas duas telas.
const TINTAS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
];

export function tintaDe(nome: string) {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTAS[h % TINTAS.length];
}
