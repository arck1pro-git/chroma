import type { ValoresPersonalizados } from "../data";

export type OrigemSelecionada = { id: string; nome: string };
export type FiltroCampanhas = {
  campanha: OrigemSelecionada | null;
  conjunto: OrigemSelecionada | null;
  anuncio: OrigemSelecionada | null;
};
export const filtroCampanhasVazio: FiltroCampanhas = { campanha: null, conjunto: null, anuncio: null };

// IDs explícitos têm prioridade sobre nomes/UTMs, que podem mudar na Meta.
// Convenção dos links: utm_campaign=campanha, utm_term=conjunto,
// utm_content=anúncio. Cada campo também pode conter o ID correspondente.
function corresponde(campos: ValoresPersonalizados, alvo: OrigemSelecionada, ids: string[], nomes: string[]) {
  const valor = (chaves: string[]) => chaves.map(k => campos[k]).find(v => typeof v === "string" && v.trim())?.trim();
  const id = valor(ids);
  if (id) return id === alvo.id;
  const nome = valor(nomes);
  return nome === alvo.id || nome === alvo.nome;
}

export function passaNoFiltroCampanhas(
  filtro: FiltroCampanhas,
  oportunidade?: ValoresPersonalizados,
  contato?: ValoresPersonalizados,
): boolean {
  if (!filtro.campanha) return true;
  // Não mistura atribuições de captações diferentes: a origem registrada na
  // oportunidade prevalece; usa a do contato apenas quando ela está ausente.
  const temCampanha = (campos?: ValoresPersonalizados) => campos &&
    ["campaign_id", "campanha_id", "utm_id", "campaign_name", "utm_campaign"].some(k => typeof campos[k] === "string" && campos[k].trim());
  const campos = temCampanha(oportunidade) ? oportunidade! : contato ?? {};
  return corresponde(campos, filtro.campanha, ["campaign_id", "campanha_id", "utm_id"], ["campaign_name", "utm_campaign"])
    && (!filtro.conjunto || corresponde(campos, filtro.conjunto, ["adset_id", "conjunto_id"], ["adset_name", "utm_term"]))
    && (!filtro.anuncio || corresponde(campos, filtro.anuncio, ["ad_id", "anuncio_id"], ["ad_name", "utm_content"]));
}
