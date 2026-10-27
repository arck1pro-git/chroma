// As regras do editor de templates (lib/templates-whatsapp.ts), que a rota
// app/api/meta/templates aplica antes de criar o template na Meta. Puro: sem
// banco, sem rede e sem .env.
//
//   node scripts/jiti.mjs scripts/testar-templates-whatsapp.ts
import assert from "node:assert/strict";
import {
  avisosDo,
  componentesDoRascunho,
  emGrupos,
  lerTemplate,
  nomeDeTemplate,
  problemasDo,
  rascunhoDe,
  soPorCampanhas,
  telefoneDoBotao,
  variaveisDo,
  type Rascunho,
} from "@/lib/templates-whatsapp";
import type { TemplateMeta } from "@/lib/meta";

const base: Rascunho = {
  nome: "convite_lancamento",
  categoria: "MARKETING",
  cabecalho: "",
  corpo: "Olá {{1}}, separamos uma condição para você até {{2}}.",
  rodape: "",
  exemplosCabecalho: [],
  exemplosCorpo: ["Ana", "sexta"],
  botoes: [],
};
const r = (p: Partial<Rascunho>): Rascunho => ({ ...base, ...p });
const primeiro = (x: Rascunho) => problemasDo(x)[0]?.mensagem ?? "";
const meta = (p: Partial<TemplateMeta>): TemplateMeta => ({
  id: "1", name: "x", language: "pt_BR", status: "APPROVED", category: "MARKETING", components: [], ...p,
});
let casos = 0;
const caso = (nome: string, f: () => void) => {
  f();
  casos++;
  console.log("ok  ", nome);
};

caso("rascunho completo passa", () => assert.deepEqual(problemasDo(base), []));
caso("nome: acento, espaço e maiúscula viram o formato da Meta", () =>
  assert.equal(nomeDeTemplate("Promoção Setembro 2026!"), "promocao_setembro_2026_"));
caso("nome vazio barra", () => assert.match(primeiro(r({ nome: "" })), /nome/));

caso("variável sem exemplo barra (a Meta exige)", () => assert.match(primeiro(r({ exemplosCorpo: ["Ana"] })), /\{\{2\}\}/));
caso("variáveis fora de sequência barram", () => assert.match(primeiro(r({ corpo: "Oi {{1}} e {{3}} ok" })), /sequência/));
caso("variável repetida conta uma vez", () => assert.deepEqual(variaveisDo("{{1}} {{2}} {{1}}"), [1, 2]));
caso("variável nomeada ou com espaço barra", () => {
  assert.match(primeiro(r({ corpo: "Oi {{nome}}, tudo bem?" })), /numeradas/);
  assert.match(primeiro(r({ corpo: "Oi {{ 1 }}, tudo bem?" })), /numeradas/);
  assert.match(primeiro(r({ cabecalho: "Oi {{nome}}" })), /numeradas/);
});
caso("texto que começa ou termina com variável barra", () => {
  assert.match(primeiro(r({ corpo: "{{1}}, tudo bem?", exemplosCorpo: ["Ana"] })), /começar nem terminar/);
  assert.match(primeiro(r({ corpo: "Tudo bem, {{1}}", exemplosCorpo: ["Ana"] })), /começar nem terminar/);
  assert.equal(primeiro(r({ corpo: "Tudo bem, {{1}}?", exemplosCorpo: ["Ana"] })), "");
});
caso("exemplo acima do limite barra", () => assert.match(primeiro(r({ exemplosCorpo: ["Ana", "x".repeat(201)] })), /exemplo/));
caso("cabeçalho com {{2}} barra", () => assert.match(primeiro(r({ cabecalho: "Oi {{2}}" })), /\{\{1\}\}/));
caso("cabeçalho com {{1}} sem exemplo barra", () => assert.match(primeiro(r({ cabecalho: "Oi {{1}}" })), /cabeçalho/));
caso("rodapé com variável barra", () => assert.match(primeiro(r({ rodape: "Até {{1}}" })), /rodapé/));
caso("corpo acima de 1024 barra", () => assert.match(primeiro(r({ corpo: "a".repeat(1025), exemplosCorpo: [] })), /1\.024/));
caso("avisos: variáveis coladas", () => {
  assert.equal(avisosDo(r({ corpo: "Oi {{1}} {{2}} tudo bem" })).length, 1);
  assert.deepEqual(avisosDo(base), []);
});

const link = (destino: string) => r({ botoes: [{ tipo: "URL", texto: "Site", destino }] });
caso("3 links barram", () =>
  assert.ok(problemasDo(r({ botoes: [1, 2, 3].map((i) => ({ tipo: "URL" as const, texto: `L${i}`, destino: "https://x.com" })) }))
    .some((p) => /2 botões de link/.test(p.mensagem))));
caso("link só com https e completo", () => {
  assert.match(primeiro(link("amaan.com.br")), /link completo/);
  assert.match(primeiro(link("http://amaan.com.br")), /link completo/);
  assert.match(primeiro(link("https://")), /link completo/);
  assert.equal(primeiro(link("https://amaan.com.br/lancamento")), "");
});
caso("link com variável barra", () => assert.match(primeiro(link("https://x.com/{{1}}")), /variável/));
caso("texto de botão com variável barra", () =>
  assert.match(primeiro(r({ botoes: [{ tipo: "QUICK_REPLY", texto: "Sim {{1}}", destino: "" }] })), /não aceita variável/));
caso("botões com o mesmo texto barram", () =>
  assert.match(primeiro(r({ botoes: [{ tipo: "QUICK_REPLY", texto: "Sim", destino: "" }, { tipo: "QUICK_REPLY", texto: "sim", destino: "" }] })), /“sim”/));

const ligar = (destino: string) => r({ botoes: [{ tipo: "PHONE_NUMBER", texto: "Ligar", destino }] });
caso("telefone: BR ganha 55, zero de tronco sai, + respeita o país", () => {
  assert.equal(telefoneDoBotao("(47) 99999-0000"), "+5547999990000");
  assert.equal(telefoneDoBotao("(047) 99999-0000"), "+5547999990000");
  assert.equal(telefoneDoBotao("0xx47 99999-0000"), "+5547999990000");
  assert.equal(telefoneDoBotao("0800 123 4567"), "+558001234567");
  assert.equal(telefoneDoBotao("+1 555 005 1310"), "+15550051310");
});
caso("telefone sem DDD ou com país inválido barra", () => {
  assert.match(primeiro(ligar("99999-0000")), /DDD/);
  assert.match(primeiro(ligar("+047 99999-0000")), /DDD/);
  assert.equal(primeiro(ligar("0800 123 4567")), "");
});

caso("respostas rápidas vêm antes das ações", () =>
  assert.deepEqual(
    emGrupos([{ tipo: "URL" }, { tipo: "QUICK_REPLY" }, { tipo: "PHONE_NUMBER" }, { tipo: "QUICK_REPLY" }]).map((b) => b.tipo),
    ["QUICK_REPLY", "QUICK_REPLY", "URL", "PHONE_NUMBER"],
  ));
caso("componentes no formato da Graph API, com exemplos", () => {
  const c = componentesDoRascunho(r({
    cabecalho: "Oi {{1}}",
    exemplosCabecalho: ["Ana"],
    rodape: " Responda SAIR ",
    botoes: [
      { tipo: "URL", texto: "Site", destino: "https://amaan.com.br" },
      { tipo: "QUICK_REPLY", texto: " Quero ", destino: "" },
      { tipo: "PHONE_NUMBER", texto: "Ligar", destino: "47 99999-0000" },
    ],
  }));
  assert.deepEqual(c, [
    { type: "HEADER", format: "TEXT", text: "Oi {{1}}", example: { header_text: ["Ana"] } },
    { type: "BODY", text: base.corpo, example: { body_text: [["Ana", "sexta"]] } },
    { type: "FOOTER", text: "Responda SAIR" },
    { type: "BUTTONS", buttons: [
      { type: "QUICK_REPLY", text: "Quero" },
      { type: "URL", text: "Site", url: "https://amaan.com.br" },
      { type: "PHONE_NUMBER", text: "Ligar", phone_number: "+5547999990000" },
    ] },
  ]);
});
caso("sem variável não manda example", () =>
  assert.deepEqual(componentesDoRascunho(r({ corpo: "Oi, tudo bem?", exemplosCorpo: [] })), [{ type: "BODY", text: "Oi, tudo bem?" }]));

const completo = lerTemplate(meta({
  status: "REJECTED",
  rejected_reason: "PROMOTIONAL",
  quality_score: { score: "GREEN" },
  components: [
    { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://…"] } },
    { type: "BODY", text: "Oi {{1}}, tudo bem?", example: { body_text: [["Ana"]] } },
    { type: "FOOTER", text: "rodapé" },
    { type: "BUTTONS", buttons: [
      { type: "URL", text: "Site", url: "https://x.com/{{1}}" },
      { type: "COPY_CODE", text: "Copiar código" },
      { type: "QUICK_REPLY", text: "Sim" },
    ] },
  ],
}));
caso("lerTemplate entende o JSON da Meta", () => {
  assert.equal(completo.motivoRejeicao, "PROMOTIONAL");
  assert.equal(completo.qualidade, "GREEN");
  assert.deepEqual(completo.cabecalho, { formato: "IMAGE", texto: null });
  assert.deepEqual(completo.exemplosCorpo, ["Ana"]);
  assert.equal(completo.botoes[0].destino, "https://x.com/{{1}}");
  assert.equal(lerTemplate(meta({ rejected_reason: "NONE" })).motivoRejeicao, null);
});
caso("cabeçalho de mídia ou link variável só sai por Campanhas", () => {
  assert.equal(soPorCampanhas(completo), true);
  assert.equal(soPorCampanhas(lerTemplate(meta({ components: [{ type: "BODY", text: "Oi" }] }))), false);
});
caso("duplicar: próximo nome livre, botões agrupados e o que ficou de fora", () => {
  const { rascunho, deFora } = rascunhoDe(completo, new Set(["x_v2"]));
  assert.equal(rascunho.nome, "x_v3");
  assert.equal(rascunho.cabecalho, "");
  assert.deepEqual(rascunho.botoes.map((b) => b.tipo), ["QUICK_REPLY", "URL"]);
  assert.deepEqual(deFora, ["o cabeçalho de imagem", "1 botão de um tipo que este editor não cria"]);
  assert.deepEqual(rascunhoDe(lerTemplate(meta({ category: "AUTHENTICATION" })), new Set()).deFora, [
    "a categoria Autenticação (a cópia sai como Marketing)",
  ]);
});

console.log(`\n${casos} casos passaram`);
