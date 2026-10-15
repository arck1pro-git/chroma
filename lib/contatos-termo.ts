// O termo da busca de contatos, sem banco: a tela usa para saber se já dá para
// buscar (e mostrar a dica certa), o servidor usa para montar a consulta
// (lib/contatos-busca.ts). Separado de lá porque aquele arquivo importa o
// driver do Postgres, que não pode ir para o navegador.

/** Abaixo disso a busca não vai ao banco: "a" casaria com metade da base. */
export const MIN_LETRAS = 2;
export const MIN_DIGITOS = 4;
export const LIMITE_BUSCA = 30;

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** O que a busca usa do termo digitado; null = curto demais para buscar. */
export function prepararTermo(termo: string): { texto: string; digitos: string } | null {
  const texto = semAcento(termo.trim().toLowerCase()).replace(/\s+/g, " ");
  const digitos = termo.replace(/\D/g, "");
  const letras = texto.replace(/[^a-z0-9@._-]/g, "");
  if (letras.length < MIN_LETRAS && digitos.length < MIN_DIGITOS) return null;
  return { texto, digitos: digitos.length >= MIN_DIGITOS ? digitos : "" };
}
