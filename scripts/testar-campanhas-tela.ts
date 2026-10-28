// O que a TELA do construtor de campanhas faz com o fluxo
// (app/campanhas/fluxo/grafo.ts): organizar o desenho, os botões do Aguardar
// seguindo o template, apagar e ligar sem laço, a revisão antes de ativar, a
// leitura do desenho da IA e as pendências iguais às do servidor. Desde
// 2026-10-28, também os blocos novos (Condição, Horário de envio, Enviar
// arquivo, Permissão de passagem): valor de partida, resumo do cartão, as duas
// saídas da Condição no desenho e no laço, a revisão e o dia e a janela em
// texto (./fluxo/tempo.ts). Puro: sem banco, sem rede e sem .env.
//
//   node scripts/jiti.mjs scripts/testar-campanhas-tela.ts
import assert from "node:assert/strict";
import {
  CATALOGO_CAMPANHA,
  NO_INICIO,
  problemasDoFluxo,
  templateDoFluxo,
  VERSAO_FLUXO,
  type BlocoCampanha,
  type FluxoCampanha,
  type TipoBloco,
} from "@/lib/campanhas-fluxo";
import { problemasDosEnvios } from "@/lib/campanhas-fluxo-envios";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import {
  alturaEstimada,
  apagarBloco,
  balaoDoTemplate,
  blocoNovo,
  COLUNA,
  fechaLaco,
  lerDesenhoDaIa,
  organizarFluxo,
  problemasDaTela,
  resumoDoBloco,
  revisaoDoFluxo,
  sincronizarBotoes,
  type OpcoesFluxo,
} from "@/app/campanhas/fluxo/grafo";
import { diasEmTexto, janelaEmTexto } from "@/app/campanhas/fluxo/tempo";
import { origemDoClique } from "@/app/campanhas/fluxo/vista";

let casos = 0;
const caso = (nome: string, f: () => void) => {
  f();
  casos++;
  console.log("ok  ", nome);
};

// ── Peças ───────────────────────────────────────────────────────────────────
const template = (nome: string, respostas: string[], status = "APPROVED"): TemplateWhatsApp => ({
  id: nome,
  nome,
  idioma: "pt_BR",
  categoria: "MARKETING",
  status,
  motivoRejeicao: null,
  qualidade: null,
  cabecalho: null,
  corpo: "Olá {{1}}, tudo bem?",
  rodape: null,
  botoes: respostas.map((texto) => ({ tipo: "QUICK_REPLY", texto, destino: null })),
  exemplosCabecalho: [],
  exemplosCorpo: ["Ana"],
});
const TEMPLATES = [template("convite", ["Quero saber mais", "Agora não"]), template("lembrete", ["Sim", "Não"]), template("rascunho", [], "PENDING")];

const OPCOES: OpcoesFluxo = {
  tags: [{ id: "tag1", nome: "Interessado" }],
  segmentos: [{ id: "seg1", nome: "Site", contatos: 10 }],
  funis: [{ id: "funil1", nome: "Vendas" }],
  etapas: [{ id: "etapa1", nome: "Reunião agendada", funil_id: "funil1" }],
  usuarios: [{ id: "u1", nome: "Fernanda" }],
  ias: [],
  instancias: [{ id: "i1", nome: "Comercial" }],
  documentos: [{ id: "doc1", nome: "Tabela de preços.pdf", tipo: "pdf" }],
  camposContato: [{ chave: "cidade_obra", rotulo: "Cidade da obra" }],
  consequencias: { etapasComCadencia: [{ id: "etapa1", nome: "Reunião agendada" }], etapasComEventoMeta: [], segmentosEmCampanha: [] },
};

const marca = { cabecalho: [], corpo: ["{{primeiro_nome}}"] };
const envio = (proximo: string | null, nome = "convite"): BlocoCampanha => ({ tipo: "enviar_template", template_nome: nome, template_idioma: "pt_BR", variaveis: marca, proximo });
const aguardar = (botoes: Record<string, string | null>, outra: string | null = null, sem: string | null = null): BlocoCampanha => ({
  tipo: "aguardar_resposta", prazo_minutos: 1440, botoes, palavras: [], outra, sem_resposta: sem,
});
const tag = (proximo: string | null = null): BlocoCampanha => ({ tipo: "mudar_tag", acao: "adicionar", tagId: "tag1", proximo });
const fluxo = (inicio: string | null, blocos: Record<string, BlocoCampanha>): FluxoCampanha => ({ versao: VERSAO_FLUXO, inicio, blocos, posicoes: {} });

const condicao = (sim: string | null, nao: string | null, tagId = "tag1"): BlocoCampanha => ({ tipo: "condicao", regra: { tipo: "tem_tag", tagId }, sim, nao });

// Os cartões têm 240px desde 2026-10-28 (no-campanha.tsx, w-60), o início também.
const LARGURA = () => 240;
const sobrepostos = (f: FluxoCampanha) => {
  const altura = (id: string) => (id === NO_INICIO ? 98 : alturaEstimada(f.blocos[id]));
  const ids = Object.keys(f.posicoes);
  const ruins: string[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = f.posicoes[ids[i]];
      const b = f.posicoes[ids[j]];
      if (a.x < b.x + LARGURA() && b.x < a.x + LARGURA() && a.y < b.y + altura(ids[j]) && b.y < a.y + altura(ids[i])) ruins.push(`${ids[i]}×${ids[j]}`);
    }
  return ruins;
};

// ── Organizar ───────────────────────────────────────────────────────────────
caso("organizar: camadas pela maior distância, na ordem das saídas, sem sobrepor", () => {
  const f = organizarFluxo(fluxo("t1", { t1: envio("a1"), a1: aguardar({ "Quero saber mais": "c1", "Agora não": "c2" }, null, "c3"), c1: tag("c3"), c2: tag(), c3: tag() }));
  assert.deepEqual(sobrepostos(f), []);
  assert.equal(f.posicoes.t1.x, COLUNA);
  assert.equal(f.posicoes.a1.x, 2 * COLUNA);
  assert.equal(f.posicoes.c3.x, 4 * COLUNA, "c3 vem depois de c1, que chega nele");
  assert.ok(f.posicoes.c1.y < f.posicoes.c2.y, "botão de cima, bloco de cima");
  assert.equal(f.posicoes[NO_INICIO].y, f.posicoes.t1.y, "caminho único sai reto");
});
caso("organizar: laço (que o contrato proíbe) termina e não sobrepõe", () => {
  const f = organizarFluxo(fluxo("a", { a: tag("b"), b: tag("a"), x: tag("y"), y: tag("x") }));
  assert.deepEqual(Object.keys(f.posicoes).sort(), [NO_INICIO, "a", "b", "x", "y"].sort());
  assert.deepEqual(sobrepostos(f), []);
});
caso("organizar: bloco solto vai embaixo do fluxo, em cadeia", () => {
  const f = organizarFluxo(fluxo("t1", { t1: envio(null), s1: tag("s2"), s2: tag() }));
  const fundo = Math.max(f.posicoes[NO_INICIO].y + 74, f.posicoes.t1.y + alturaEstimada(f.blocos.t1));
  assert.ok(f.posicoes.s1.y > fundo && f.posicoes.s2.y > fundo);
  assert.equal(f.posicoes.s2.x - f.posicoes.s1.x, COLUNA);
  assert.deepEqual(sobrepostos(f), []);
});
caso("organizar: id do Object.prototype num destino não vira bloco", () => {
  const f = organizarFluxo(fluxo("constructor", { t1: envio("toString") }));
  assert.deepEqual(Object.keys(f.posicoes).sort(), [NO_INICIO, "t1"].sort());
});

// ── Botões do Aguardar, apagar e laço ───────────────────────────────────────
caso("sincronizarBotoes: troca os botões pelos do template novo e mantém a ligação dos que continuam", () => {
  const f = fluxo("t1", { t1: envio("a1"), a1: aguardar({ "Quero saber mais": "c1", Antigo: "c2" }), c1: tag(), c2: tag() });
  const s = sincronizarBotoes(f, TEMPLATES);
  assert.deepEqual((s.blocos.a1 as Extract<BlocoCampanha, { tipo: "aguardar_resposta" }>).botoes, { "Quero saber mais": "c1", "Agora não": null });
  // Template trocado: os botões passam a ser os do lembrete.
  const trocado = sincronizarBotoes({ ...f, blocos: { ...f.blocos, t1: envio("a1", "lembrete") } }, TEMPLATES);
  assert.deepEqual(Object.keys((trocado.blocos.a1 as Extract<BlocoCampanha, { tipo: "aguardar_resposta" }>).botoes), ["Sim", "Não"]);
  // Sem nada a mudar, o mesmo objeto (não redesenha os cartões).
  assert.equal(sincronizarBotoes(s, TEMPLATES), s);
});
caso("apagarBloco: solta quem chegava nele, inclusive o início, e tira a posição", () => {
  const f = { ...fluxo("t1", { t1: envio("a1"), a1: aguardar({ "Quero saber mais": "c1" }, "c1"), c1: tag() }), posicoes: { c1: { x: 1, y: 1 } } };
  const sem = apagarBloco(f, "c1");
  const a1 = sem.blocos.a1 as Extract<BlocoCampanha, { tipo: "aguardar_resposta" }>;
  assert.equal(a1.botoes["Quero saber mais"], null);
  assert.equal(a1.outra, null);
  assert.ok(!("c1" in sem.posicoes));
  assert.equal(apagarBloco(f, "t1").inicio, null);
});
caso("fechaLaco: ligar de volta a quem já chega até a origem é laço", () => {
  const f = fluxo("t1", { t1: envio("a1"), a1: aguardar({}, "c1"), c1: tag() });
  assert.equal(fechaLaco(f, "c1", "t1"), true);
  assert.equal(fechaLaco(f, "c1", "c1"), true);
  assert.equal(fechaLaco(f, "t1", "c1"), false);
});

// ── Revisão antes de ativar ─────────────────────────────────────────────────
caso("revisaoDoFluxo: mensagens e efeitos na ordem em que o contato chega, com as consequências", () => {
  const f = fluxo("t1", {
    t1: envio("a1"),
    a1: aguardar({ "Quero saber mais": "mv" }, null, "t2"),
    t2: envio(null, "lembrete"),
    mv: { tipo: "mover_oportunidade", funilId: "funil1", etapaId: "etapa1", proximo: "tg" },
    tg: tag(),
    solto: tag(),
  });
  const r = revisaoDoFluxo(f, TEMPLATES, OPCOES);
  assert.deepEqual(r.mensagens.map((m) => m.blocoId), ["t1", "t2"]);
  assert.match(r.mensagens[0].texto, /Olá \[Primeiro nome do contato\], tudo bem\?/);
  assert.deepEqual(r.efeitos.map((e) => e.blocoId), ["mv", "tg"], "o solto não entra: ninguém chega nele");
  assert.match(r.efeitos[0].texto, /Vendas › Reunião agendada/);
  assert.deepEqual(r.efeitos[0].consequencias, ["Entra na cadência da etapa “Reunião agendada”, que manda WhatsApp a quem chega."]);
  assert.deepEqual(r.efeitos[1].consequencias, []);
});

// ── Desenho da IA ───────────────────────────────────────────────────────────
caso("lerDesenhoDaIa: aceita o bom e recusa a forma ruim", () => {
  const bom = { fluxo: { versao: VERSAO_FLUXO, inicio: "t1", blocos: { t1: envio(null) }, posicoes: { t1: { x: 9, y: 9 } } }, nome: " Reativação ", segmentoIds: ["seg1", 7], campanhaId: null };
  const d = lerDesenhoDaIa(bom);
  assert.ok(d);
  assert.deepEqual(d.fluxo.posicoes, {});
  assert.equal(d.nome, "Reativação");
  assert.deepEqual(d.segmentoIds, ["seg1"]);
  for (const ruim of [
    null,
    "fluxo",
    { ...bom, fluxo: { ...bom.fluxo, versao: 1 } },
    { ...bom, fluxo: { ...bom.fluxo, blocos: [] } },
    { ...bom, fluxo: { ...bom.fluxo, blocos: { t1: { tipo: "apagar_tudo" } } } },
    { ...bom, fluxo: { ...bom.fluxo, blocos: { t1: null } } },
    { ...bom, fluxo: { ...bom.fluxo, inicio: 3 } },
  ])
    assert.equal(lerDesenhoDaIa(ruim), null, JSON.stringify(ruim));
});

// ── Pendências iguais às do servidor ────────────────────────────────────────
// O servidor (conferirFluxo) soma problemasDoFluxo, com os templates aprovados,
// e problemasDosEnvios; a tela tem de dar o mesmo, menos o que só o banco sabe.
const doServidor = (f: FluxoCampanha) =>
  [...problemasDoFluxo(f, TEMPLATES.filter((t) => t.status === "APPROVED").map(templateDoFluxo)), ...problemasDosEnvios(f, TEMPLATES)].map(
    (p) => `${p.blocoId}|${p.mensagem}`,
  );
const daTela = (f: FluxoCampanha) => problemasDaTela(f, TEMPLATES).map((p) => `${p.blocoId}|${p.mensagem}`);

caso("pendências: fluxo só com tag pede um template, igual ao servidor", () => {
  const f = fluxo("tg", { tg: tag() });
  assert.deepEqual(daTela(f), [...new Set(doServidor(f))]);
  assert.ok(daTela(f).includes("null|O fluxo precisa enviar ao menos um template."));
});
caso("pendências: {{email}} no texto livre é recusado, igual ao servidor", () => {
  const f = fluxo("t1", { t1: envio("a1"), a1: aguardar({}, "tx"), tx: { tipo: "enviar_texto", texto: "Mandamos para {{email}}", proximo: null } });
  assert.deepEqual(daTela(f), [...new Set(doServidor(f))]);
  assert.ok(daTela(f).some((p) => p.startsWith("tx|No texto, só as marcas")));
});
caso("pendências: template que não está aprovado, igual ao servidor", () => {
  const f = fluxo("t1", { t1: envio(null, "rascunho") });
  assert.deepEqual(daTela(f), [...new Set(doServidor(f))]);
  assert.ok(daTela(f).some((p) => p.includes("ainda não foi aprovado")));
});
caso("pendências: fluxo certo não tem nenhuma", () => {
  const f = fluxo("t1", { t1: envio("a1"), a1: aguardar({ "Quero saber mais": "tg", "Agora não": null }), tg: tag() });
  assert.deepEqual(daTela(f), []);
  assert.deepEqual(doServidor(f), []);
});

// ── Os blocos de 2026-10-28 ─────────────────────────────────────────────────
const NOVOS: TipoBloco[] = ["condicao", "horario", "enviar_arquivo", "limitar_passagem"];

caso("blocos novos: estão no catálogo, nascem do tipo pedido e com as saídas do contrato", () => {
  for (const tipo of NOVOS) {
    assert.ok(Object.hasOwn(CATALOGO_CAMPANHA, tipo), tipo);
    assert.equal(blocoNovo(tipo, OPCOES).tipo, tipo);
  }
  const c = blocoNovo("condicao", OPCOES);
  assert.deepEqual(c, { tipo: "condicao", regra: { tipo: "tem_tag", tagId: "" }, sim: null, nao: null });
  // Horário e passagem nascem prontos; condição e arquivo pedem a escolha.
  const pronto = (b: BlocoCampanha) => fluxo("t1", { t1: envio("a1"), a1: aguardar({ "Quero saber mais": "x", "Agora não": null }), x: b });
  assert.deepEqual(daTela(pronto(blocoNovo("horario", OPCOES))), []);
  assert.deepEqual(daTela(pronto(blocoNovo("limitar_passagem", OPCOES))), []);
  assert.deepEqual(daTela(pronto(blocoNovo("enviar_arquivo", OPCOES))), ["x|Escolha o arquivo."]);
  assert.deepEqual(daTela(pronto(blocoNovo("condicao", OPCOES))), ["x|Escolha a tag da condição."]);
});

caso("blocos novos: o resumo vazio é a frase da pendência, para o cartão marcar o resumo e não repetir", () => {
  const vazios: BlocoCampanha[] = [
    blocoNovo("condicao", OPCOES),
    { tipo: "condicao", regra: { tipo: "no_segmento", segmentoId: "" }, sim: null, nao: null },
    { tipo: "condicao", regra: { tipo: "na_etapa", funilId: "", etapaId: "" }, sim: null, nao: null },
    { tipo: "condicao", regra: { tipo: "campo", chave: "", operador: "preenchido", valor: "" }, sim: null, nao: null },
    blocoNovo("enviar_arquivo", OPCOES),
    { tipo: "horario", dias: [], das: "09:00", ate: "18:00", proximo: null },
  ];
  for (const b of vazios) {
    const f = fluxo("t1", { t1: envio("a1"), a1: aguardar({ "Quero saber mais": "x", "Agora não": null }), x: b });
    const [p] = problemasDaTela(f, TEMPLATES);
    assert.equal(`${resumoDoBloco(b, OPCOES)}.`, p?.mensagem, JSON.stringify(b));
  }
});

caso("blocos novos: o resumo do cartão", () => {
  assert.equal(resumoDoBloco(condicao(null, null), OPCOES), "Tem a tag “Interessado”");
  assert.equal(
    resumoDoBloco({ tipo: "condicao", regra: { tipo: "campo", chave: "cidade_obra", operador: "contem", valor: "Porto" }, sim: null, nao: null }, OPCOES),
    "“Cidade da obra” contém “Porto”",
  );
  assert.equal(resumoDoBloco({ tipo: "condicao", regra: { tipo: "na_etapa", funilId: "funil1", etapaId: "etapa1" }, sim: null, nao: null }, OPCOES), "Na etapa Vendas › Reunião agendada");
  assert.equal(resumoDoBloco(blocoNovo("horario", OPCOES), OPCOES), "Seg a Sex · 09:00–18:00");
  assert.equal(resumoDoBloco(blocoNovo("limitar_passagem", OPCOES), OPCOES), "50 contatos a cada 1 hora");
  assert.equal(resumoDoBloco({ tipo: "enviar_arquivo", documentoId: "doc1", legenda: "", proximo: null }, OPCOES), "Tabela de preços.pdf");
  assert.equal(resumoDoBloco({ tipo: "enviar_arquivo", documentoId: "sumiu", legenda: "", proximo: null }, OPCOES), "arquivo removido");
});

caso("dias e janela em texto", () => {
  assert.equal(diasEmTexto([1, 2, 3, 4, 5]), "Seg a Sex");
  assert.equal(diasEmTexto([0, 1, 2, 3, 4, 5, 6]), "Todos os dias");
  assert.equal(diasEmTexto([5, 1, 3]), "Seg, Qua, Sex");
  assert.equal(diasEmTexto([6, 0]), "Sáb, Dom");
  assert.equal(diasEmTexto([0, 5, 6]), "Sex a Dom", "domingo vem depois do sábado");
  assert.equal(janelaEmTexto(3600), "1 hora");
  assert.equal(janelaEmTexto(120), "2 minutos");
  assert.equal(janelaEmTexto(90), "90 segundos");
  assert.equal(janelaEmTexto(2 * 86_400), "2 dias");
});

caso("condição: Sim em cima, Não embaixo, sem sobrepor; e ligar o Não de volta é laço", () => {
  const f = organizarFluxo(fluxo("t1", { t1: envio("a1"), a1: aguardar({ "Quero saber mais": "c1", "Agora não": null }), c1: condicao("s", "n"), s: tag(), n: tag() }));
  assert.deepEqual(sobrepostos(f), []);
  assert.equal(f.posicoes.s.x, f.posicoes.n.x, "as duas saídas na mesma camada");
  assert.ok(f.posicoes.s.y < f.posicoes.n.y, "Sim em cima");
  assert.equal(alturaEstimada(f.blocos.c1), 63 + 5 + 2 * 28 + 5, "duas linhas de saída, sem o tracejado do Aguardar");
  assert.equal(fechaLaco(f, "n", "c1"), true);
  assert.equal(fechaLaco(f, "c1", "n"), false);
  const sem = apagarBloco(f, "n");
  assert.deepEqual(sem.blocos.c1, condicao("s", null), "apagar solta a saída Não");
});

caso("clique na paleta: liga depois do selecionado só com uma saída livre (a Condição tem duas)", () => {
  const f = fluxo("t1", { t1: envio(null), c1: condicao(null, null), tg: tag(), ligado: tag("tg") });
  assert.equal(origemDoClique(f, "t1"), "t1");
  assert.equal(origemDoClique(f, "tg"), "tg");
  assert.equal(origemDoClique(f, "c1"), null, "Sim ou Não: não dá para adivinhar");
  assert.equal(origemDoClique(f, "ligado"), null, "a saída já tem destino");
  assert.equal(origemDoClique(f, null), null, "o início já está ligado");
  assert.equal(origemDoClique({ ...f, inicio: null }, null), NO_INICIO);
});

caso("revisão: o arquivo entre as mensagens, horário e passagem entre o que acontece, a condição não", () => {
  const f = fluxo("t1", {
    t1: envio("a1"),
    a1: aguardar({ "Quero saber mais": "c1", "Agora não": null }),
    c1: condicao("arq", "hor"),
    arq: { tipo: "enviar_arquivo", documentoId: "doc1", legenda: "Oi {{primeiro_nome}}, segue a tabela.", proximo: "pas" },
    pas: blocoNovo("limitar_passagem", OPCOES),
    hor: { ...(blocoNovo("horario", OPCOES) as Extract<BlocoCampanha, { tipo: "horario" }>), proximo: "tg" },
    tg: tag(),
  });
  assert.deepEqual(daTela(f), [], "o fluxo de exemplo está certo");
  const r = revisaoDoFluxo(f, TEMPLATES, OPCOES);
  assert.deepEqual(r.mensagens.map((m) => m.blocoId), ["t1", "arq"]);
  assert.equal(r.mensagens[1].titulo, "Arquivo “Tabela de preços.pdf” · depois de uma resposta");
  assert.equal(r.mensagens[1].texto, "Oi [Primeiro nome do contato], segue a tabela.");
  assert.deepEqual(r.efeitos.map((e) => e.blocoId), ["hor", "pas", "tg"], "na ordem em que o contato chega; a condição não faz nada fora");
  assert.equal(r.efeitos[0].texto, "Horário de envio: Seg a Sex · 09:00–18:00");
  assert.equal(r.efeitos[1].texto, "Permissão de passagem: 50 contatos a cada 1 hora");
});

caso("cabeçalho com mídia: o nome do arquivo no balão do cartão e no título da revisão", () => {
  const comFoto: TemplateWhatsApp = { ...template("foto", []), cabecalho: { formato: "IMAGE", texto: null } };
  const v = { ...marca, midia: "doc1" };
  assert.equal(balaoDoTemplate(comFoto, v, OPCOES).arquivo, "Tabela de preços.pdf");
  assert.equal(balaoDoTemplate(comFoto, marca, OPCOES).arquivo, null, "sem escolha, só o tipo");
  assert.equal(balaoDoTemplate(comFoto, { ...marca, midia: "sumiu" }, OPCOES).arquivo, "arquivo removido");
  const f = fluxo("t1", { t1: { tipo: "enviar_template", template_nome: "foto", template_idioma: "pt_BR", variaveis: v, proximo: null } });
  assert.equal(revisaoDoFluxo(f, [...TEMPLATES, comFoto], OPCOES).mensagens[0].titulo, "Template foto · cabeçalho “Tabela de preços.pdf”");
});

caso("pendências: arquivo antes de qualquer resposta, igual ao servidor", () => {
  const f = fluxo("t1", { t1: envio("arq"), arq: { tipo: "enviar_arquivo", documentoId: "doc1", legenda: "", proximo: null } });
  assert.deepEqual(daTela(f), [...new Set(doServidor(f))]);
  assert.ok(daTela(f).some((p) => p.startsWith("arq|Enviar arquivo só depois de uma resposta")));
});

console.log(`\n${casos} casos passaram`);
