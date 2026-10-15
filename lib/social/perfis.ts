// Os perfis em que o conector de postar pode publicar (escolha dele,
// 2026-10-15: os três). É uma lista FECHADA de propósito: o token do system
// user alcança essas páginas hoje, e alcançaria qualquer outra que alguém
// atribuísse a ele amanhã. Página nova só publica depois de entrar aqui.
//
// Os ids saem de GET /me/accounts?fields=instagram_business_account com o
// META_SYSTEM_USER_TOKEN (conferido em 2026-10-15).

export type Perfil = {
  chave: string;
  nome: string;
  /** Página do Facebook. */
  paginaId: string;
  /** Conta profissional do Instagram ligada à página. */
  instagramId: string;
  instagram: string;
};

export const PERFIS: Perfil[] = [
  {
    chave: "fabhricioari",
    nome: "Fabhricio Ari",
    paginaId: "730611700133506",
    instagramId: "17841414589016337",
    instagram: "fabhricioari",
  },
  {
    chave: "amaan",
    nome: "AMAAN Incorporadora",
    paginaId: "675659308971866",
    instagramId: "17841469497443080",
    instagram: "amaanincorporadora",
  },
  {
    chave: "arck1pro",
    nome: "Arck1Pro",
    paginaId: "105254138398120",
    instagramId: "17841447158154788",
    instagram: "arck1pro",
  },
];

export const CHAVES_PERFIS = PERFIS.map((p) => p.chave) as [string, ...string[]];

export function perfilPorChave(chave: string): Perfil | null {
  return PERFIS.find((p) => p.chave === chave) ?? null;
}
