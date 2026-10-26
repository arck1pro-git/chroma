import assert from "node:assert/strict";
import { filtroCampanhasVazio, passaNoFiltroCampanhas, type FiltroCampanhas } from "../app/inicio/filtro-campanhas";

const campanha = { id: "100", nome: "Captação" };
const conjunto = { id: "200", nome: "Público A" };
const anuncio = { id: "300", nome: "Vídeo" };
const filtro: FiltroCampanhas = { campanha, conjunto: null, anuncio: null };
const origens: Record<string, string>[] = [
  { campaign_id: "100", adset_id: "200", ad_id: "300" },
  { campaign_id: "100", adset_id: "200", ad_id: "301" },
  { campaign_id: "100", adset_id: "201", ad_id: "302" },
  { campaign_id: "101", adset_id: "200", ad_id: "300" },
  {},
];
assert.equal(origens.filter(o => passaNoFiltroCampanhas(filtro, o)).length, 3);
assert.equal(origens.filter(o => passaNoFiltroCampanhas({ ...filtro, conjunto }, o)).length, 2);
assert.equal(origens.filter(o => passaNoFiltroCampanhas({ ...filtro, conjunto, anuncio }, o)).length, 1);
assert.equal(origens.filter(o => passaNoFiltroCampanhas(filtroCampanhasVazio, o)).length, 5);
assert.equal(passaNoFiltroCampanhas({ ...filtro, conjunto, anuncio }, undefined, {
  utm_campaign: campanha.nome, utm_term: conjunto.nome, utm_content: anuncio.nome,
}), true);
assert.equal(passaNoFiltroCampanhas(filtro, { campaign_id: "101", utm_campaign: campanha.nome }), false);
assert.equal(passaNoFiltroCampanhas(filtro, { campaign_id: "101" }, { campaign_id: "100" }), false);
assert.equal(passaNoFiltroCampanhas({ ...filtro, conjunto }, { campaign_id: "100" }, { campaign_id: "100", adset_id: "200" }), false);
assert.equal(passaNoFiltroCampanhas(filtro, {}, { utm_id: "100" }), true);
assert.equal(passaNoFiltroCampanhas(filtro, undefined, {}), false);
// Parâmetros automáticos da Meta: o utm_id "<conjunto>_v2_…" não é ID; vale o utm_campaign (que é o ID).
const automaticos = { utm_campaign: "100", utm_term: "200", utm_content: "300", utm_id: "200_v2_s04_i97938797" };
assert.equal(passaNoFiltroCampanhas({ ...filtro, conjunto, anuncio }, {}, automaticos), true);
assert.equal(passaNoFiltroCampanhas(filtro, { utm_id: "200_v2_s04" }, automaticos), true);
assert.equal(passaNoFiltroCampanhas(filtro, {}, { ...automaticos, utm_campaign: "101" }), false);
console.log("13 verificações de filtro de origem passaram.");
