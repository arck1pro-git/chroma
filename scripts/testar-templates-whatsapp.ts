// As regras de lib/templates-whatsapp.ts: as do editor de templates, que a rota
// app/api/meta/templates aplica antes de criar o template na Meta, e as do envio
// — variáveis com dado do contato no chat e nas campanhas. Puro: sem banco, sem
// rede e sem .env.
//
//   node scripts/jiti.mjs scripts/testar-templates-whatsapp.ts
import assert from "node:assert/strict";
import {
  ajustarValores,
  avisosDo,
  componentesDoEnvio,
  componentesDoRascunho,
  dadoDoValor,
  dadosDoContato,
  emGrupos,
  lerTemplate,
  nomeDeTemplate,
  problemaNoEnvio,
  problemasDo,
  rascunhoDe,
  semEnvioPeloCrm,
  telefoneDoBotao,
  textoParaRevisao,
  valoresIniciais,
  valoresParaContato,
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
caso("cabeçalho de mídia ou link variável o CRM não envia", () => {
  assert.equal(semEnvioPeloCrm(completo), true);
  assert.equal(semEnvioPeloCrm(lerTemplate(meta({ components: [{ type: "BODY", text: "Oi" }] }))), false);
});

// ── Envio: variáveis com dado do contato ────────────────────────────────────
const ana = dadosDoContato({ nome: "Ana Maria Souza", whatsapp: "+55 (47) 99999-0000", email: " ana@exemplo.com ", cidade: null });
const doisCampos = lerTemplate(meta({ components: [
  { type: "HEADER", format: "TEXT", text: "Oi {{1}}" },
  { type: "BODY", text: "Olá {{1}}, seu atendimento é {{2}}." },
] }));
caso("dados do contato: primeiro nome, só dígitos, sem espaço sobrando", () => {
  assert.deepEqual(ana, { primeiro_nome: "Ana", nome: "Ana Maria Souza", numero: "5547999990000", email: "ana@exemplo.com", cidade: "" });
  assert.equal(dadosDoContato({ nome: "+55 47 99999-0000" }).primeiro_nome, "");
  assert.equal(dadosDoContato({ cidade: "São Bento do Sul" }).cidade, "São Bento do Sul");
  assert.equal(dadosDoContato({ nome: "José d'Ávila" }).primeiro_nome, "José");
});
caso("nome de formulário público com link, domínio, número ou marca vira vazio", () => {
  for (const nome of ["golpe.com/pix", "Ana golpe.com", "Ana https://x.io", "Ana www.x", "joao@x.com", "(47) 99999-0000",
    "Ana *promo*", "Ana 2", "Sem nome", "Contato do Instagram", "A".repeat(61), "{{nome}}"]) {
    const d = dadosDoContato({ nome });
    assert.equal(d.primeiro_nome, "", nome);
    assert.equal(d.nome, "", nome);
  }
  assert.equal(dadosDoContato({ cidade: "www.golpe.com" }).cidade, "");
  assert.equal(dadosDoContato({ email: "não é e-mail" }).email, "");
});
caso("marcas viram os dados do contato; texto fixo passa igual", () => {
  assert.deepEqual(valoresParaContato({ cabecalho: ["{{primeiro_nome}}"], corpo: ["Sra. {{nome}}", "amanhã\n às  10h"] }, ana), {
    cabecalho: ["Ana"],
    corpo: ["Sra. Ana Maria Souza", "amanhã às 10h"],
  });
});
caso("contato sem o dado não vai com variável vazia", () => {
  assert.deepEqual(valoresParaContato({ cabecalho: [], corpo: ["{{primeiro_nome}}", "{{cidade}}"] }, ana), { falta: "cidade para a {{2}}" });
  assert.deepEqual(valoresParaContato({ cabecalho: [], corpo: ["  "] }, ana), { falta: "valor para a {{1}}" });
});
caso("parâmetros no formato do envio da Graph API", () =>
  assert.deepEqual(componentesDoEnvio({ cabecalho: ["Ana"], corpo: ["Ana", "amanhã"] }), [
    { type: "header", parameters: [{ type: "text", text: "Ana" }] },
    { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "amanhã" }] },
  ]));
caso("campanha: começa com o primeiro nome na {{1}} e confere cada variável", () => {
  const inicio = valoresIniciais(doisCampos);
  assert.deepEqual(inicio, { cabecalho: [""], corpo: ["{{primeiro_nome}}", ""] });
  assert.match(problemaNoEnvio(doisCampos, inicio) ?? "", /\{\{1\}\} do cabeçalho/);
  assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["{{primeiro_nome}}", ""] }) ?? "", /\{\{2\}\}/);
  assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["{{apelido}}", "x"] }) ?? "", /não é dado do contato/);
  assert.equal(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["{{primeiro_nome}}", "pela manhã"] }), null);
  assert.match(problemaNoEnvio(completo, { cabecalho: [], corpo: ["Ana"] }) ?? "", /mídia/);
});
caso("campanha: marca com erro de digitação não sai literal", () => {
  for (const errada of ["{{Primeiro_nome}}", "{{ primeiro_nome }}", "{{primeiro nome}}", "{{1}}", "Olá }}"])
    assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: [errada, "x"] }) ?? "", /não é dado do contato/, errada);
});
caso("campanha: e-mail e WhatsApp do contato só pelo chat", () => {
  assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["{{email}}", "x"] }) ?? "", /não vai em campanha/);
  assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["Fale no {{numero}}", "x"] }) ?? "", /não vai em campanha/);
});
caso("campanha: valor a mais barra; sobra vazia é cortada no disparo", () => {
  const umaSo = lerTemplate(meta({ components: [{ type: "BODY", text: "Olá {{1}}, tudo bem?" }] }));
  assert.match(problemaNoEnvio(umaSo, { cabecalho: [], corpo: ["{{primeiro_nome}}", "extra"] }) ?? "", /sobrou valor/);
  assert.match(problemaNoEnvio(umaSo, { cabecalho: ["Ana"], corpo: ["{{primeiro_nome}}"] }) ?? "", /não tem variável do cabeçalho/);
  const comSobraVazia = { cabecalho: [""], corpo: ["{{primeiro_nome}}", ""] };
  assert.equal(problemaNoEnvio(umaSo, comSobraVazia), null);
  assert.deepEqual(ajustarValores(comSobraVazia, { cabecalho: 0, corpo: 1 }), { cabecalho: [], corpo: ["{{primeiro_nome}}"] });
});
caso("campanha: texto fixo longo barra", () =>
  assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["{{primeiro_nome}}", "x".repeat(201)] }) ?? "", /até 200/));
caso("variável com nome ({{first_name}}) o CRM não envia", () =>
  assert.equal(semEnvioPeloCrm(lerTemplate(meta({ components: [{ type: "BODY", text: "Hi {{first_name}}, ok?" }] }))), true));
caso("mensagem para conferir antes de ativar", () =>
  assert.equal(
    textoParaRevisao(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["{{primeiro_nome}}", "pela manhã"] }),
    "Oi [Nome completo do contato]\n\nOlá [Primeiro nome do contato], seu atendimento é pela manhã.",
  ));
caso("o seletor reconhece valor que é só um dado do contato", () => {
  assert.equal(dadoDoValor("{{email}}"), "email");
  assert.equal(dadoDoValor("Sra. {{nome}}"), null);
  assert.equal(dadoDoValor("{{apelido}}"), null);
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
