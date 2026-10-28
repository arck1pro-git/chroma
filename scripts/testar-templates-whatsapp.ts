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
  baseDoLink,
  componentesDoEnvio,
  componentesDoRascunho,
  dadoDoValor,
  dadosDoContato,
  ehLinkDeVideoDoCrm,
  emGrupos,
  lerTemplate,
  linksVariaveisDe,
  motivoSemEnvio,
  nomeDeTemplate,
  problemaDoLinkVariavel,
  problemaNoEnvio,
  problemasDo,
  rascunhoDe,
  semEnvioPeloCrm,
  telefoneDoBotao,
  textoParaRevisao,
  valoresIniciais,
  valoresParaContato,
  variaveisDo,
  variaveisDoTemplate,
  type Rascunho,
} from "@/lib/templates-whatsapp";
import { entradaDaCriacao } from "@/lib/templates-whatsapp-criacao";
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
const linkVariavel = (destino: string, exemplo?: string) => r({ botoes: [{ tipo: "URL", texto: "Site", destino, exemplo }] });
caso("editor: link com variável pede exemplo e passa com ele", () => {
  assert.match(primeiro(linkVariavel("https://x.com/{{1}}")), /exemplo para o \{\{1\}\}/);
  assert.equal(primeiro(linkVariavel("https://x.com/{{1}}", "abc")), "");
  assert.equal(primeiro(linkVariavel("https://amaanoffice.amaan.com.br/v/abc12345?w={{1}}", "5547999990000")), "");
});
caso("editor: base fora do padrão e exemplo inválido barram", () => {
  assert.match(primeiro(linkVariavel("https://x.com/pagina{{1}}", "abc")), /antes do \{\{1\}\}/);
  assert.match(primeiro(linkVariavel("http://x.com/{{1}}", "abc")), /https/);
  assert.match(primeiro(linkVariavel("https://x.com/{{1}}", "@golpe.com")), /exemplo do link/);
  assert.match(primeiro(linkVariavel("https://x.com/{{1}}", "{{numero}}")), /valor de verdade/);
});
caso("editor: link com variável manda o exemplo inteiro à Meta", () =>
  assert.deepEqual(componentesDoRascunho(linkVariavel(" https://x.com/p/{{1}} ", " abc "))[1], {
    type: "BUTTONS",
    buttons: [{ type: "URL", text: "Site", url: "https://x.com/p/{{1}}", example: ["https://x.com/p/abc"] }],
  }));
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
caso("cabeçalho de mídia o CRM não envia; link com variável no padrão envia", () => {
  assert.equal(semEnvioPeloCrm(completo), true);
  assert.match(motivoSemEnvio(completo) ?? "", /mídia/);
  assert.equal(semEnvioPeloCrm(lerTemplate(meta({ components: [{ type: "BODY", text: "Oi" }] }))), false);
  const soLink = (url: string) => lerTemplate(meta({ components: [{ type: "BODY", text: "Oi" }, { type: "BUTTONS", buttons: [{ type: "URL", text: "Site", url }] }] }));
  assert.equal(semEnvioPeloCrm(soLink("https://x.com/{{1}}")), false);
  assert.match(motivoSemEnvio(soLink("https://x.com/pagina{{1}}")) ?? "", /“Site” está fora do padrão/);
  assert.match(motivoSemEnvio(soLink("https://x.com/{{1}}/fim")) ?? "", /fora do padrão/);
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
caso("campanha: e-mail e WhatsApp do contato fora do texto", () => {
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
// ── Link com variável: base, valor, {{numero}} e botões no envio ────────────
const VIDEO = "https://amaanoffice.amaan.com.br/v/abc12345?w={{1}}";
caso("link: bases válidas", () => {
  for (const base of ["https://site.com.br/{{1}}", "https://site.com.br/?id={{1}}", "https://site.com.br/#{{1}}",
    "https://site.com.br/p?a=1&b={{1}}", " https://site.com.br/lp/{{1}} ", VIDEO])
    assert.equal(problemaDoLinkVariavel(base, null), null, base);
});
caso("link: bases inválidas (http, sem / = ? # antes, host sem ponto, {{1}} no meio…)", () => {
  const casosBase: Array<[string, RegExp]> = [
    ["http://site.com.br/{{1}}", /https/],
    ["site.com.br/{{1}}", /https/],
    ["https://site.com.br/pagina{{1}}", /antes do \{\{1\}\}/],
    ["https://site.com.br{{1}}", /antes do \{\{1\}\}/],
    ["https://localhost/{{1}}", /https/],
    ["https://site.com.br/{{1}}/fim", /no fim/],
    ["https://site.com.br/{{1}}?x={{1}}", /uma só/],
    ["https://site.com.br/{{2}}", /uma só/],
    ["https://site.com.br/{{ 1 }}", /uma só/],
    ["https://site.com.br={{1}}", /https/],
    ["https://amaan.com.br@golpe.com/{{1}}", /@/],
    ["https://site.com.br/a b/{{1}}", /https/],
    [`https://site.com.br/${"a".repeat(2000)}/{{1}}`, /2000/],
  ];
  for (const [base, motivo] of casosBase) assert.match(problemaDoLinkVariavel(base, null) ?? "", motivo, base);
});
caso("link: valor fixo só [A-Za-z0-9._~-], até 100, começando por letra ou número", () => {
  assert.equal(problemaDoLinkVariavel("https://site.com.br/{{1}}", "Abc-123_x.y~z"), null);
  assert.equal(problemaDoLinkVariavel("https://site.com.br/{{1}}", "x".repeat(100)), null);
  for (const valor of ["@golpe.com", ".golpe.com", "a/b", "Ana Maria", "José", "a?b=c", "a#b", "%2e", "-x", "x".repeat(101), "  "])
    assert.ok(problemaDoLinkVariavel("https://site.com.br/{{1}}", valor), valor);
});
caso("link: {{numero}} só no link de vídeo /v/ do CRM", () => {
  assert.equal(ehLinkDeVideoDoCrm(VIDEO), true);
  assert.equal(ehLinkDeVideoDoCrm("https://chromacrm.vercel.app/v/abc12345?w={{1}}"), true);
  for (const base of ["https://site.com.br/v/abc12345?w={{1}}", "https://amaanoffice.amaan.com.br/lp?w={{1}}",
    "https://amaanoffice.amaan.com.br.golpe.com/v/abc12345?w={{1}}", "https://amaanoffice.amaan.com.br/v/{{1}}",
    "https://golpe.com@amaanoffice.amaan.com.br/v/abc12345?w={{1}}", "http://amaanoffice.amaan.com.br/v/abc12345?w={{1}}"]) {
    assert.equal(ehLinkDeVideoDoCrm(base), false, base);
    assert.ok(problemaDoLinkVariavel(base, "{{numero}}"), base);
  }
  assert.equal(problemaDoLinkVariavel(VIDEO, "{{numero}}"), null);
  assert.equal(problemaDoLinkVariavel(VIDEO, " {{numero}} "), null);
  assert.match(problemaDoLinkVariavel("https://site.com.br/?w={{1}}", "{{numero}}") ?? "", /link de vídeo do CRM/);
  assert.match(problemaDoLinkVariavel(VIDEO, "{{primeiro_nome}}") ?? "", /texto fixo/);
  assert.match(problemaDoLinkVariavel(VIDEO, "{{email}}") ?? "", /texto fixo/);
});

const comLinks = lerTemplate(meta({ components: [
  { type: "BODY", text: "Olá {{1}}, veja o vídeo." },
  { type: "BUTTONS", buttons: [
    { type: "QUICK_REPLY", text: "Quero" },
    { type: "URL", text: "Ver vídeo", url: VIDEO },
    { type: "URL", text: "Site", url: "https://amaan.com.br/lp/{{1}}" },
  ] },
] }));
const prontos = { cabecalho: [], corpo: ["{{primeiro_nome}}"], botoes: ["", "{{numero}}", "lancamento"] };
caso("envio: o que o template pede inclui os links, e o vídeo já começa com o WhatsApp", () => {
  assert.deepEqual(linksVariaveisDe(comLinks).map((l) => l.indice), [1, 2]);
  assert.deepEqual(variaveisDoTemplate(comLinks), { cabecalho: 0, corpo: 1, links: [1, 2] });
  assert.deepEqual(valoresIniciais(comLinks), { cabecalho: [], corpo: ["{{primeiro_nome}}"], botoes: ["", "{{numero}}", ""] });
});
caso("envio: problemaNoEnvio exige o valor de cada link e aplica a regra do link", () => {
  assert.match(problemaNoEnvio(comLinks, valoresIniciais(comLinks)) ?? "", /final do link do botão “Site”/);
  assert.match(problemaNoEnvio(comLinks, { cabecalho: [], corpo: ["{{primeiro_nome}}"] }) ?? "", /final do link do botão “Ver vídeo”/);
  assert.equal(problemaNoEnvio(comLinks, prontos), null);
  assert.match(problemaNoEnvio(comLinks, { ...prontos, botoes: ["x", "{{numero}}", "lancamento"] }) ?? "", /Sobrou valor/);
  assert.match(problemaNoEnvio(comLinks, { ...prontos, botoes: ["", "{{numero}}", "lancamento", "sobra"] }) ?? "", /Sobrou valor/);
  assert.match(problemaNoEnvio(comLinks, { ...prontos, botoes: ["", "{{numero}}", "{{numero}}"] }) ?? "", /“Site”: o WhatsApp do contato só vai no link de vídeo/);
  assert.match(problemaNoEnvio(comLinks, { ...prontos, botoes: ["", "{{numero}}", "@golpe.com"] }) ?? "", /“Site”/);
  assert.match(problemaNoEnvio(comLinks, { ...prontos, botoes: ["", "{{primeiro_nome}}", "x"] }) ?? "", /“Ver vídeo”: no link vai texto fixo/);
  assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{nome}}"], corpo: ["{{primeiro_nome}}", "x"], botoes: ["abc"] }) ?? "", /não tem link com variável/);
  assert.match(problemaNoEnvio(doisCampos, { cabecalho: ["{{numero}}"], corpo: ["{{primeiro_nome}}", "x"] }) ?? "", /só no link de vídeo/);
});
caso("envio: valoresParaContato resolve o {{numero}} no link; posição vazia segue vazia", () => {
  assert.deepEqual(valoresParaContato(prontos, ana), { cabecalho: [], corpo: ["Ana"], botoes: ["", "5547999990000", "lancamento"] });
  const semWhats = dadosDoContato({ nome: "Ana", whatsapp: null });
  assert.deepEqual(valoresParaContato(prontos, semWhats), { falta: "whatsapp para o link do botão 2" });
});
caso("envio: ajustarValores corta os botões nas posições de link", () =>
  assert.deepEqual(
    ajustarValores({ cabecalho: [""], corpo: ["{{primeiro_nome}}", "x"], botoes: ["lixo", "{{numero}}", "lp", "sobra"] }, variaveisDoTemplate(comLinks)),
    { cabecalho: [], corpo: ["{{primeiro_nome}}"], botoes: ["", "{{numero}}", "lp"] },
  ));
caso("envio: componentes com url e quick_reply nos índices certos", () =>
  assert.deepEqual(
    componentesDoEnvio({ cabecalho: [], corpo: ["Ana"] }, {
      links: [{ indice: 2, valor: "lancamento" }, { indice: 1, valor: "5547999990000" }],
      respostas: [{ indice: 0, payload: "campanha:abc:0" }],
    }),
    [
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "campanha:abc:0" }] },
      { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "5547999990000" }] },
      { type: "button", sub_type: "url", index: "2", parameters: [{ type: "text", text: "lancamento" }] },
    ],
  ));
caso("envio: a chamada antiga de componentesDoEnvio não muda", () => {
  const antigos = { cabecalho: ["Ana"], corpo: ["Ana", "amanhã"] };
  const esperado = [
    { type: "header", parameters: [{ type: "text", text: "Ana" }] },
    { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "amanhã" }] },
  ];
  assert.deepEqual(componentesDoEnvio(antigos), esperado);
  assert.deepEqual(componentesDoEnvio(antigos, {}), esperado);
  assert.deepEqual(componentesDoEnvio({ ...antigos, botoes: ["x"] }), esperado);
});
caso("revisão: botões no fim, com o link completo e [WhatsApp do contato]", () =>
  assert.equal(
    textoParaRevisao(comLinks, prontos),
    "Olá [Primeiro nome do contato], veja o vídeo.\n\n[Quero]\n" +
      "[Ver vídeo] https://amaanoffice.amaan.com.br/v/abc12345?w=[WhatsApp do contato]\n" +
      "[Site] https://amaan.com.br/lp/lancamento",
  ));

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

caso("botão que pede parâmetro que o CRM não manda (copiar código) barra o envio", () =>
  assert.equal(
    semEnvioPeloCrm(lerTemplate(meta({ components: [{ type: "BODY", text: "Oi, tudo bem?" }, { type: "BUTTONS", buttons: [{ type: "COPY_CODE", text: "Copiar cupom" }] }] }))),
    true,
  ));

caso("criação: a entrada da rota guarda o exemplo do link com variável até a Meta", () => {
  const corpo = {
    waba: "123",
    nome: "convite_link",
    categoria: "MARKETING",
    corpo: base.corpo,
    exemplosCorpo: base.exemplosCorpo,
    botoes: [{ tipo: "URL", texto: "Ver o imóvel", destino: "https://amaan.com.br/imoveis/{{1}}", exemplo: "porto-belo" }],
  };
  const lido = entradaDaCriacao.parse(corpo);
  assert.equal(lido.botoes[0].exemplo, "porto-belo", "o zod não descarta o exemplo");
  const { waba, ...rascunho } = lido;
  assert.equal(waba, "123");
  assert.deepEqual(problemasDo(rascunho), [], "com o exemplo, o rascunho passa");
  const botoes = componentesDoRascunho(rascunho).find((c) => c.type === "BUTTONS") as { buttons: Array<Record<string, unknown>> };
  assert.deepEqual(botoes.buttons[0].example, ["https://amaan.com.br/imoveis/porto-belo"]);
  const { waba: mesma, ...semExemplo } = entradaDaCriacao.parse({ ...corpo, botoes: [{ ...corpo.botoes[0], exemplo: undefined }] });
  assert.equal(mesma, "123");
  assert.match(problemasDo(semExemplo)[0]?.mensagem ?? "", /Dê um exemplo/, "sem exemplo, a frase de antes");
});

caso("baseDoLink: tira o {{1}} do fim e os espaços das pontas", () => {
  assert.equal(baseDoLink("  https://amaan.com.br/v/abc?w={{1}} "), "https://amaan.com.br/v/abc?w=");
  assert.equal(baseDoLink("https://amaan.com.br/lp"), "https://amaan.com.br/lp");
});

console.log(`\n${casos} casos passaram`);
