// O contrato das campanhas em blocos (lib/campanhas-fluxo.ts): saídas, a saída
// que cada resposta toma, a validação do grafo e a conversão do formato antigo;
// e os envios e as consequências de lib/campanhas-fluxo-envios.ts.
// Puro: sem banco, sem rede e sem .env.
//
//   node scripts/jiti.mjs scripts/testar-campanhas-fluxo.ts
import assert from "node:assert/strict";
import {
  ehDescadastro,
  exigenciasDoFluxo,
  fluxoDoFormatoAntigo,
  ID_AGUARDAR_ANTIGO,
  ID_ENVIO_ANTIGO,
  ligar,
  NO_INICIO,
  primeiroTemplate,
  problemasDoFluxo,
  saidaDaResposta,
  saidasDe,
  VERSAO_FLUXO,
  type BlocoCampanha,
  type FluxoCampanha,
  type TemplateDoFluxo,
} from "@/lib/campanhas-fluxo";
import { consequenciasDoFluxo, LIMITE_AVISO, problemasDosEnvios } from "@/lib/campanhas-fluxo-envios";
import { lerTemplate } from "@/lib/templates-whatsapp";

let casos = 0;
const caso = (nome: string, f: () => void) => {
  f();
  casos++;
  console.log("ok  ", nome);
};

const TEMPLATES: TemplateDoFluxo[] = [{ nome: "convite", idioma: "pt_BR", respostasRapidas: ["Quero saber mais", "Não tenho interesse"] }];
const vazio = { cabecalho: [], corpo: [] };
type Aguardar = Extract<BlocoCampanha, { tipo: "aguardar_resposta" }>;
const aguardar = (p: Partial<Aguardar> = {}): Aguardar => ({
  tipo: "aguardar_resposta", prazo_minutos: 1440, botoes: {}, palavras: [], outra: null, sem_resposta: null, ...p,
});
const fluxo = (blocos: Record<string, BlocoCampanha>, inicio = "envio"): FluxoCampanha => ({
  versao: VERSAO_FLUXO, inicio, blocos, posicoes: { [NO_INICIO]: { x: 0, y: 0 } },
});
const envio = (proximo: string | null): BlocoCampanha => ({ tipo: "enviar_template", template_nome: "convite", template_idioma: "pt_BR", variaveis: vazio, proximo });
const msgs = (f: FluxoCampanha) => problemasDoFluxo(f, TEMPLATES).map((p) => p.mensagem);

// ── Saídas e ligações ───────────────────────────────────────────────────────
caso("saídas do Aguardar: botões, palavras, outra e sem resposta, nessa ordem", () => {
  const a = aguardar({ botoes: { "Quero saber mais": "x" }, palavras: [{ contem: "preço", proximo: null }] });
  assert.deepEqual(saidasDe(a).map((s) => s.id), ["botao:Quero saber mais", "palavra:0", "outra", "sem_resposta"]);
  assert.deepEqual(saidasDe(envio("y")).map((s) => [s.id, s.destino]), [["proximo", "y"]]);
});
caso("ligar troca só a saída pedida", () => {
  const a = ligar(aguardar({ botoes: { Sim: null } }), "botao:Sim", "t") as Aguardar;
  assert.equal(a.botoes.Sim, "t");
  assert.equal((ligar(a, "sem_resposta", "z") as Aguardar).sem_resposta, "z");
  assert.equal((ligar(aguardar({ palavras: [{ contem: "a", proximo: null }] }), "palavra:0", "p") as Aguardar).palavras[0].proximo, "p");
  assert.equal((ligar(envio(null), "proximo", "k") as { proximo: string }).proximo, "k");
});

// ── A resposta escolhe a saída ──────────────────────────────────────────────
caso("clique no botão vale pelo texto, sem diferença de maiúscula e acento", () => {
  const a = aguardar({ botoes: { "Não tenho interesse": "nao" }, outra: "outra" });
  assert.deepEqual(saidaDaResposta(a, { texto: "NAO TENHO INTERESSE", botao: "NAO TENHO INTERESSE" }), { saidaId: "botao:Não tenho interesse", destino: "nao" });
});
caso("palavra contida, na ordem; senão, outra", () => {
  const a = aguardar({ palavras: [{ contem: "preço", proximo: "preco" }, { contem: "visita", proximo: "visita" }], outra: "resto" });
  assert.equal(saidaDaResposta(a, { texto: "Qual o PRECO e quando posso fazer a visita?", botao: null }).destino, "preco");
  assert.equal(saidaDaResposta(a, { texto: "Bom dia", botao: null }).saidaId, "outra");
  assert.equal(saidaDaResposta(a, { texto: "Bom dia", botao: "Botão sem saída" }).destino, "resto");
});

// ── Validação ───────────────────────────────────────────────────────────────
caso("fluxo completo e válido passa", () => {
  const f = fluxo({
    envio: envio("aguardar"),
    aguardar: aguardar({ botoes: { "Quero saber mais": "texto" }, sem_resposta: "lembrete" }),
    texto: { tipo: "enviar_texto", texto: "Oi {{primeiro_nome}}, um especialista vai te chamar.", proximo: "aviso" },
    aviso: { tipo: "avisar_equipe", instanciaId: "i1", usuarioIds: [], responsavelDoFunil: "f1", texto: "Quer saber mais", proximo: null },
    lembrete: { tipo: "esperar", minutos: 2880, proximo: "envio2" },
    envio2: envio(null),
  });
  assert.deepEqual(msgs(f), []);
});
caso("fluxo vazio pede o primeiro bloco", () => assert.match(msgs(fluxo({}, null as unknown as string))[0], /Ligue o início/));
caso("ligação para bloco que não existe barra", () => assert.ok(msgs(fluxo({ envio: envio("fantasma") })).some((m) => /não existe/.test(m))));
caso("bloco solto barra", () => assert.ok(msgs(fluxo({ envio: envio(null), solto: { tipo: "registrar_conversao", proximo: null } })).some((m) => /solto/.test(m))));
caso("texto livre antes de qualquer resposta barra (fora da janela de 24h)", () => {
  assert.ok(msgs(fluxo({ envio: envio("t"), t: { tipo: "enviar_texto", texto: "oi", proximo: null } })).some((m) => /depois de uma resposta/.test(m)));
  const pelaFaltaDeResposta = fluxo({ envio: envio("a"), a: aguardar({ sem_resposta: "t" }), t: { tipo: "enviar_texto", texto: "oi", proximo: null } });
  assert.ok(msgs(pelaFaltaDeResposta).some((m) => /depois de uma resposta/.test(m)));
});
caso("Aguardar sem template antes barra; botão que o template não tem barra", () => {
  assert.ok(msgs(fluxo({ a: aguardar() }, "a")).some((m) => /template enviado antes/.test(m)));
  assert.ok(msgs(fluxo({ envio: envio("a"), a: aguardar({ botoes: { Talvez: null } }) })).some((m) => /não tem o botão/.test(m)));
});
caso("qualquer laço barra, com ou sem espera (robô que responde sozinho)", () => {
  const giro = fluxo({ envio: envio("tag"), tag: { tipo: "mudar_tag", acao: "adicionar", tagId: "t", proximo: "envio" } });
  assert.ok(msgs(giro).some((m) => /bloco anterior/.test(m)));
  const pingPong = fluxo({
    envio: envio("a"),
    a: aguardar({ outra: "t" }),
    t: { tipo: "enviar_texto", texto: "oi", proximo: "a" },
  });
  assert.ok(msgs(pingPong).some((m) => /bloco anterior/.test(m)));
});
caso("o mínimo de cada bloco", () => {
  const f = fluxo({
    envio: envio("a"),
    a: aguardar({ prazo_minutos: 1, palavras: [{ contem: " ", proximo: null }], outra: "aviso" }),
    aviso: { tipo: "avisar_equipe", instanciaId: "i1", usuarioIds: [], responsavelDoFunil: null, texto: "", proximo: "ia" },
    ia: { tipo: "ligar_ia", iaId: "", proximo: null },
  });
  const m = msgs(f);
  assert.ok(m.some((x) => /5 minutos a 30 dias/.test(x)));
  assert.ok(m.some((x) => /quem recebe/.test(x)));
  assert.ok(m.some((x) => /Escolha a IA/.test(x)));
  const semNumero = fluxo({
    envio: envio("a"),
    a: aguardar({ outra: "aviso" }),
    aviso: { tipo: "avisar_equipe", instanciaId: "", usuarioIds: ["u1"], responsavelDoFunil: null, texto: "oi", proximo: null },
  });
  assert.ok(msgs(semNumero).some((x) => /número que manda o aviso/.test(x)));
});

// ── Permissão e descadastro ─────────────────────────────────────────────────
caso("cada bloco sensível exige a permissão da tela de origem", () => {
  const f = fluxo({
    envio: envio("a"),
    a: aguardar({ outra: "mover" }),
    mover: { tipo: "mover_oportunidade", funilId: "f", etapaId: "e", proximo: "ia" },
    ia: { tipo: "ligar_ia", iaId: "x", proximo: "tag" },
    tag: { tipo: "mudar_tag", acao: "remover", tagId: "t", proximo: null },
  });
  const e = exigenciasDoFluxo(f);
  assert.deepEqual(e.map((x) => x.motivo), ["mover oportunidade", "passar para a IA", "mudar tag ou segmento"]);
  assert.deepEqual(e[0].algumDe, [{ modulo: "inicio", operacao: "editar", escopoTodos: true }]);
  assert.deepEqual(exigenciasDoFluxo(fluxo({ envio: envio(null) })), []);
});
caso("descadastro é a mensagem inteira, sem maiúscula, acento ou ponto", () => {
  assert.equal(ehDescadastro("SAIR"), true);
  assert.equal(ehDescadastro("  Parar. "), true);
  assert.equal(ehDescadastro("Não quero mais!"), true);
  assert.equal(ehDescadastro("quero sair do grupo da obra"), false);
});

// ── Formato antigo ──────────────────────────────────────────────────────────
caso("campanha do formato antigo vira fluxo equivalente e válido", () => {
  const f = fluxoDoFormatoAntigo({
    template_nome: "convite", template_idioma: "pt_BR", espera_minutos: 720, variaveis: vazio,
    ao_responder: [{ tipo: "registrar_lead" }, { tipo: "adicionar_tag", tagId: "t1" }],
    ao_expirar: [{ tipo: "adicionar_segmento", segmentoId: "s1" }],
  });
  assert.equal(f.inicio, ID_ENVIO_ANTIGO);
  const a = f.blocos[ID_AGUARDAR_ANTIGO] as Aguardar;
  assert.equal(a.prazo_minutos, 720);
  assert.equal(f.blocos[a.outra!].tipo, "registrar_conversao");
  assert.equal(f.blocos[(f.blocos[a.outra!] as { proximo: string }).proximo].tipo, "mudar_tag");
  assert.equal(f.blocos[a.sem_resposta!].tipo, "mudar_segmento");
  assert.deepEqual(msgs(f), []);
  assert.deepEqual(primeiroTemplate(f), { template_nome: "convite", template_idioma: "pt_BR" });
});
caso("formato antigo sem ações: aguardar com as duas saídas no fim", () => {
  const f = fluxoDoFormatoAntigo({ template_nome: "convite", template_idioma: "pt_BR", espera_minutos: 1440, variaveis: vazio, ao_responder: [], ao_expirar: [] });
  const a = f.blocos.aguardar as Aguardar;
  assert.equal(a.outra, null);
  assert.equal(a.sem_resposta, null);
});


// ── Envios e consequências (lib/campanhas-fluxo-envios.ts) ──────────────────
const DA_CONTA = [
  lerTemplate({ id: "1", name: "convite", language: "pt_BR", status: "APPROVED", category: "MARKETING",
    components: [{ type: "BODY", text: "Olá {{1}}, novidades.", example: { body_text: [["Ana"]] } }] }),
  lerTemplate({ id: "2", name: "em_analise", language: "pt_BR", status: "PENDING", category: "MARKETING",
    components: [{ type: "BODY", text: "Oi" }] }),
];
const preenchido = (proximo: string | null): BlocoCampanha =>
  ({ tipo: "enviar_template", template_nome: "convite", template_idioma: "pt_BR", variaveis: { cabecalho: [], corpo: ["{{primeiro_nome}}"] }, proximo });
const comEnvio = (b: BlocoCampanha) => fluxo({ envio: preenchido("x"), x: b });
const envios = (f: FluxoCampanha) => problemasDosEnvios(f, DA_CONTA).map((p) => `${p.blocoId ?? "-"}: ${p.mensagem}`);
caso("envios: template da conta, aprovado e preenchido passa", () =>
  assert.deepEqual(envios(comEnvio({ tipo: "registrar_conversao", proximo: null })), []));
caso("envios: fora da conta, não aprovado e sem variável têm frase própria", () => {
  const outro = (nome: string, corpo: string[] = []): BlocoCampanha =>
    ({ tipo: "enviar_template", template_nome: nome, template_idioma: "pt_BR", variaveis: { cabecalho: [], corpo }, proximo: null });
  assert.deepEqual(envios(fluxo({ envio: outro("sumiu") })), ["envio: O template “sumiu” não está nesta conta do WhatsApp."]);
  assert.deepEqual(envios(fluxo({ envio: outro("em_analise") })), ["envio: O template “em_analise” ainda não foi aprovado pela Meta."]);
  assert.match(envios(fluxo({ envio: outro("convite") }))[0], /^envio: Escolha o que vai na \{\{1\}\}/);
  assert.deepEqual(envios(fluxo({ envio: outro("") })), [], "sem nome é do contrato (Escolha o template), não daqui");
});
caso("envios: fluxo sem template, marca inventada no texto e aviso acima do limite", () => {
  assert.deepEqual(envios(fluxo({ t: { tipo: "registrar_conversao", proximo: null } }, "t")), ["-: O fluxo precisa enviar ao menos um template."]);
  assert.match(envios(comEnvio({ tipo: "enviar_texto", texto: "Seu e-mail {{email}}", proximo: null }))[0], /^x: No texto, só as marcas/);
  const aviso = (texto: string, usuarioIds: string[]): BlocoCampanha =>
    ({ tipo: "avisar_equipe", instanciaId: "i", usuarioIds, responsavelDoFunil: null, texto, proximo: null });
  assert.deepEqual(envios(comEnvio(aviso("x".repeat(LIMITE_AVISO.texto + 1), ["u"]))), [`x: O aviso tem até ${LIMITE_AVISO.texto} caracteres.`]);
  const gente = Array.from({ length: LIMITE_AVISO.destinatarios + 1 }, (_, i) => `u${i}`);
  assert.deepEqual(envios(comEnvio(aviso("ok", gente))), [`x: São até ${LIMITE_AVISO.destinatarios} pessoas por aviso.`]);
});
caso("consequências: só onde o motor faz (mover entra na cadência; criar só manda o evento)", () => {
  const ctx = {
    etapasComCadencia: [{ id: "e1", nome: "Novo contato" }],
    etapasComEventoMeta: [{ id: "e1", nome: "Novo contato" }, { id: "e2", nome: "Reunião" }],
    segmentosEmCampanha: [{ segmentoId: "s1", campanha: "Outra" }, { segmentoId: "s1", campanha: "Mais uma" }],
  };
  const f = fluxo({
    mover: { tipo: "mover_oportunidade", funilId: "f", etapaId: "e1", proximo: "criar" },
    criar: { tipo: "criar_oportunidade", funilId: "f", etapaId: "e1", nome: "x", proximo: "seg" },
    seg: { tipo: "mudar_segmento", acao: "adicionar", segmentoId: "s1", proximo: "tira" },
    tira: { tipo: "mudar_segmento", acao: "remover", segmentoId: "s1", proximo: "nada" },
    nada: { tipo: "mover_oportunidade", funilId: "f", etapaId: "e3", proximo: null },
  }, "mover");
  assert.deepEqual(consequenciasDoFluxo(f, ctx), [
    { blocoId: "mover", texto: "Entra na cadência da etapa “Novo contato”, que manda WhatsApp a quem chega." },
    { blocoId: "mover", texto: "A etapa “Novo contato” manda o evento de conversão à Meta." },
    { blocoId: "criar", texto: "A etapa “Novo contato” manda o evento de conversão à Meta." },
    { blocoId: "seg", texto: "Inscreve o contato também na campanha ativa “Outra”, “Mais uma”." },
  ]);
});

console.log(`\n${casos} casos passaram`);
