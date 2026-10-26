import type { ValoresPersonalizados } from "@/lib/entidades";
import { IDS_DE_CAMPANHA, NOMES_DE_CAMPANHA, idDaMeta } from "@/lib/meta-ads-calculos";

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
// ID só vale como número (idDaMeta): o utm_id dos parâmetros automáticos da
// Meta não é ID de campanha e não pode passar por cima do utm_campaign.
function corresponde(campos: ValoresPersonalizados, alvo: OrigemSelecionada, ids: string[], nomes: string[]) {
  const valor = (chaves: string[]) => chaves.map(k => campos[k]).find(v => typeof v === "string" && v.trim())?.trim();
  const id = idDaMeta(campos, ids);
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
  const temCampanha = (campos?: ValoresPersonalizados) => campos && (idDaMeta(campos, IDS_DE_CAMPANHA) ||
    NOMES_DE_CAMPANHA.some(k => typeof campos[k] === "string" && campos[k].trim()));
  const campos = temCampanha(oportunidade) ? oportunidade! : contato ?? {};
  return corresponde(campos, filtro.campanha, IDS_DE_CAMPANHA, NOMES_DE_CAMPANHA)
    && (!filtro.conjunto || corresponde(campos, filtro.conjunto, ["adset_id", "conjunto_id"], ["adset_name", "utm_term"]))
    && (!filtro.anuncio || corresponde(campos, filtro.anuncio, ["ad_id", "anuncio_id"], ["ad_name", "utm_content"]));
}
