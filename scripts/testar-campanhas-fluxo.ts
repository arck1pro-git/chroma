// O contrato das campanhas em blocos (lib/campanhas-fluxo.ts): saídas, a saída
// que cada resposta toma, a validação do grafo e a conversão do formato antigo;
// e os envios e as consequências de lib/campanhas-fluxo-envios.ts. Desde
// 2026-10-28, também os blocos Condição, Horário de envio, Enviar arquivo e
// Permissão de passagem (validação, saídas, exigências e o filtro da IA).
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
  LIMITES_FLUXO,
  ligar,
  minutosDoHorario,
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
import {
  campanhaFalaAntesDeEsperar,
  consequenciasDoFluxo,
  LIMITE_AVISO,
  problemaDoArquivoDaCampanha,
  problemasDosEnvios,
  tipoDoArquivoDaCampanha,
} from "@/lib/campanhas-fluxo-envios";
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

// ── Blocos de 2026-10-28: Condição, Horário, Enviar arquivo, Permissão de passagem ──
type Condicao = Extract<BlocoCampanha, { tipo: "condicao" }>;
const condicao = (regra: Condicao["regra"], sim: string | null, nao: string | null): BlocoCampanha => ({ tipo: "condicao", regra, sim, nao });
const tagSim = { tipo: "tem_tag" as const, tagId: "t1" };
const horario = (p: Partial<Extract<BlocoCampanha, { tipo: "horario" }>> = {}): BlocoCampanha =>
  ({ tipo: "horario", dias: [1, 2, 3, 4, 5], das: "08:00", ate: "18:00", proximo: null, ...p });
const passagem = (quantidade: number, janela_segundos: number): BlocoCampanha => ({ tipo: "limitar_passagem", quantidade, janela_segundos, proximo: null });
const arquivo = (p: Partial<Extract<BlocoCampanha, { tipo: "enviar_arquivo" }>> = {}): BlocoCampanha =>
  ({ tipo: "enviar_arquivo", documentoId: "d1", legenda: "", proximo: null, ...p });
/** O bloco depois de uma resposta, para o mínimo dele ser o único problema. */
const respondido = (b: BlocoCampanha) => fluxo({ envio: envio("a"), a: aguardar({ outra: "x" }), x: b });

caso("condição: saídas sim e não; ligar troca só a pedida", () => {
  const c = condicao(tagSim, "s", null);
  assert.deepEqual(saidasDe(c).map((s) => [s.id, s.destino]), [["sim", "s"], ["nao", null]]);
  assert.deepEqual(ligar(c, "nao", "n"), { ...c, nao: "n" });
  assert.deepEqual(ligar(c, "sim", null), { ...c, sim: null });
  assert.equal(ligar(c, "proximo", "z"), c, "saída que a condição não tem não muda nada");
});
caso("condição: as duas saídas contam no alcance e no laço", () => {
  const f = fluxo({ envio: envio("c"), c: condicao(tagSim, "s", "n"), s: { tipo: "registrar_conversao", proximo: null }, n: { tipo: "registrar_conversao", proximo: null } });
  assert.deepEqual(msgs(f), [], "nada solto: o caminho do não também é alcançado");
  const laco = fluxo({ envio: envio("c"), c: condicao(tagSim, null, "envio") });
  assert.ok(msgs(laco).some((m) => /bloco anterior/.test(m)), "voltar pelo não é laço");
  const textoPeloNao = fluxo({ envio: envio("a"), a: aguardar({ outra: "c" }), c: condicao(tagSim, null, "t"), t: { tipo: "enviar_texto", texto: "oi", proximo: null } });
  assert.deepEqual(msgs(textoPeloNao), [], "a resposta antes da condição vale nas duas saídas");
});
caso("condição: regra completa", () => {
  const m = (r: Condicao["regra"]) => msgs(respondido(condicao(r, null, null)));
  assert.deepEqual(m({ tipo: "tem_tag", tagId: "" }), ["Escolha a tag da condição."]);
  assert.deepEqual(m({ tipo: "no_segmento", segmentoId: "" }), ["Escolha o segmento da condição."]);
  assert.deepEqual(m({ tipo: "na_etapa", funilId: "f", etapaId: "" }), ["Escolha o funil e a etapa da condição."]);
  assert.deepEqual(m({ tipo: "campo", chave: "", operador: "preenchido", valor: "" }), ["Escolha o campo do contato."]);
  assert.deepEqual(m({ tipo: "campo", chave: "profissao", operador: "igual", valor: "  " }), ["Escreva o valor que o campo deve ter."]);
  assert.deepEqual(m({ tipo: "campo", chave: "profissao", operador: "preenchido", valor: "" }), []);
  assert.deepEqual(m({ tipo: "campo", chave: "profissao", operador: "contem", valor: "médic" }), []);
});
caso("horário: dias não vazios, únicos, de 0 a 6; HH:MM; o fim depois do começo", () => {
  const m = (p: Parameters<typeof horario>[0]) => msgs(respondido(horario(p)));
  assert.deepEqual(m({}), []);
  assert.deepEqual(m({ dias: [] }), ["Escolha ao menos um dia."], "a mesma frase do resumo vazio na tela");
  for (const dias of [[1, 1], [7], [-1], [1.5]]) assert.deepEqual(m({ dias }), ["Escolha os dias do horário."], JSON.stringify(dias));
  for (const errado of ["8:00", "24:00", "08:60", "0800", "08:00 "]) assert.deepEqual(m({ das: errado }), ["Os horários são no formato HH:MM."], errado);
  assert.deepEqual(m({ das: "18:00", ate: "18:00" }), ["O fim da janela tem de ser depois do começo."]);
  assert.deepEqual(m({ das: "18:00", ate: "08:00" }), ["O fim da janela tem de ser depois do começo."]);
  assert.deepEqual(m({ dias: [0, 6], das: "00:00", ate: "23:59" }), []);
  assert.equal(minutosDoHorario("23:59"), 1439);
  assert.equal(minutosDoHorario("00:00"), 0);
  assert.equal(minutosDoHorario("7:00"), null);
});
caso("permissão de passagem: quantidade inteira de 1 ao teto; intervalo de 1 s a 30 dias", () => {
  const m = (q: number, j: number) => msgs(respondido(passagem(q, j)));
  assert.deepEqual(m(1, LIMITES_FLUXO.passagemJanelaMinima), []);
  assert.deepEqual(m(LIMITES_FLUXO.passagemQuantidadeMaxima, LIMITES_FLUXO.passagemJanelaMaxima), []);
  for (const q of [0, LIMITES_FLUXO.passagemQuantidadeMaxima + 1, 2.5]) assert.match(m(q, 60)[0], /Passam de 1 a 10\.000/, String(q));
  for (const j of [0, LIMITES_FLUXO.passagemJanelaMaxima + 1, 1.5]) assert.match(m(5, j)[0], /de 1 segundo a 30 dias/, String(j));
});
caso("enviar arquivo: com documento, legenda no limite e só depois de uma resposta (como o texto)", () => {
  assert.deepEqual(msgs(respondido(arquivo())), []);
  assert.deepEqual(msgs(respondido(arquivo({ documentoId: "" }))), ["Escolha o arquivo."]);
  assert.deepEqual(msgs(respondido(arquivo({ legenda: "x".repeat(LIMITES_FLUXO.texto + 1) }))), [`A legenda tem até ${LIMITES_FLUXO.texto} caracteres.`]);
  assert.ok(msgs(fluxo({ envio: envio("x"), x: arquivo() })).some((m) => /Enviar arquivo só depois de uma resposta/.test(m)));
  const peloPrazo = fluxo({ envio: envio("a"), a: aguardar({ sem_resposta: "x" }), x: arquivo() });
  assert.ok(msgs(peloPrazo).some((m) => /Enviar arquivo só depois de uma resposta/.test(m)), "sem resposta não abre a janela");
});
caso("exigências: arquivo pede ver Documentos; condição, horário e passagem só Campanhas", () => {
  const f = respondido(arquivo({ proximo: "c" }));
  f.blocos.c = condicao(tagSim, "h", null);
  f.blocos.h = horario({ proximo: "p" });
  f.blocos.p = passagem(5, 60);
  assert.deepEqual(exigenciasDoFluxo(f), [{ motivo: "enviar arquivo da biblioteca", algumDe: [{ modulo: "documentos" }] }]);
  const semArquivo = fluxo({ envio: envio("c"), c: condicao(tagSim, "h", null), h: horario({ proximo: "p" }), p: passagem(5, 60) });
  assert.deepEqual(exigenciasDoFluxo(semArquivo), []);
});
caso("envios: legenda só com as marcas da campanha", () => {
  assert.deepEqual(envios(comEnvio(arquivo({ legenda: "Oi {{primeiro_nome}}, segue a tabela." }))), []);
  assert.deepEqual(envios(comEnvio(arquivo({ legenda: "Seu e-mail {{email}}" }))), ["x: Na legenda, só as marcas {{primeiro_nome}}, {{nome}}, {{cidade}}."]);
  assert.deepEqual(envios(comEnvio(arquivo({ legenda: "chaves soltas }}" }))).length, 1);
});
caso("IA calada: arquivo é mensagem; a condição segue os dois caminhos; horário e passagem não seguram", () => {
  const f = fluxo({
    envio: envio("a"),
    a: aguardar({ outra: "c" }),
    c: condicao(tagSim, "tag", "arq"),
    tag: { tipo: "mudar_tag", acao: "adicionar", tagId: "t", proximo: null },
    arq: arquivo(),
    so: condicao(tagSim, "tag", null),
    h: horario({ proximo: "e2" }),
    p: passagem(1, 60),
    e2: envio(null),
    espera: { tipo: "esperar", minutos: 10, proximo: "e2" },
    hp: horario({ proximo: "espera" }),
  });
  f.blocos.p = { ...passagem(1, 60), proximo: "h" } as BlocoCampanha;
  assert.equal(campanhaFalaAntesDeEsperar(f, "arq"), true, "enviar arquivo fala");
  assert.equal(campanhaFalaAntesDeEsperar(f, "c"), true, "basta um caminho da condição falar");
  assert.equal(campanhaFalaAntesDeEsperar(f, "so"), false, "os dois caminhos só fazem CRM");
  assert.equal(campanhaFalaAntesDeEsperar(f, "p"), true, "passagem e horário deixam passar: o template depois deles conta");
  assert.equal(campanhaFalaAntesDeEsperar(f, "hp"), false, "o Esperar depois do horário segura");
});
caso("arquivo da campanha: imagem, PDF e vídeo, no formato e tamanho da Cloud API; o resto não", () => {
  assert.equal(tipoDoArquivoDaCampanha({ tipo: "imagem", mime: "image/png" }), "imagem");
  assert.equal(tipoDoArquivoDaCampanha({ tipo: "video", mime: "video/mp4" }), "video");
  assert.equal(tipoDoArquivoDaCampanha({ tipo: "documento", mime: "application/pdf" }), "pdf");
  assert.equal(tipoDoArquivoDaCampanha({ tipo: "documento", mime: "Application/PDF; charset=binary" }), "pdf");
  assert.equal(tipoDoArquivoDaCampanha({ tipo: "documento", mime: "application/vnd.ms-excel" }), null);
  assert.equal(tipoDoArquivoDaCampanha({ tipo: "audio", mime: "audio/mpeg" }), null);
  const MB = 1024 * 1024;
  assert.equal(problemaDoArquivoDaCampanha({ tipo: "imagem", mime: "image/png", tamanho: MB }), null);
  assert.equal(problemaDoArquivoDaCampanha({ tipo: "documento", mime: "application/pdf", tamanho: 30 * MB }), null);
  assert.equal(problemaDoArquivoDaCampanha({ tipo: "video", mime: "video/mp4", tamanho: 10 * MB }), null);
  assert.equal(problemaDoArquivoDaCampanha({ tipo: "imagem", mime: "image/webp", tamanho: MB }), "Pela campanha vai uma imagem JPG ou PNG de até 5 MB.");
  assert.equal(problemaDoArquivoDaCampanha({ tipo: "imagem", mime: "image/jpeg", tamanho: 6 * MB }), "Pela campanha vai uma imagem JPG ou PNG de até 5 MB.");
  assert.equal(problemaDoArquivoDaCampanha({ tipo: "video", mime: "video/mp4", tamanho: 17 * MB }), "Pela campanha vai um vídeo MP4 ou 3GPP de até 16 MB.");
  assert.equal(problemaDoArquivoDaCampanha({ tipo: "audio", mime: "audio/mpeg", tamanho: MB }), "Pela campanha vão só imagem, PDF ou vídeo.");
});
caso("primeiro template passa pela condição (saída sim)", () =>
  assert.deepEqual(primeiroTemplate(fluxo({ c: condicao(tagSim, "envio", null), envio: envio(null) }, "c")), { template_nome: "convite", template_idioma: "pt_BR" }));

console.log(`\n${casos} casos passaram`);
