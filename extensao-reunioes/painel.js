// O painel lateral: mostra o estado da reunião (chrome.storage.session, que só o
// service worker grava) e manda os comandos. Tudo o que vem do CRM e do
// copiloto entra como textContent, nunca como HTML: o copiloto leu a fala do lead.
//
// REVISTO EM 2026-10-30 (pedido dele: "simples e intuitivo, só com reunião para
// anexar, puxando direto do CRM em prod as reuniões disponíveis com nome do
// lead, componentes personalizados e a transcrição do que está sendo dito"):
//   · a lista das reuniões de hoje vem do CRM assim que o painel abre e a cada
//     aba de reunião nova (POST /inicio com a sala); o link do Meet que casa já
//     anexa sozinho. Clicar numa reunião pede "Anexar"; anexada, vira o cartão
//     do lead com "Trocar". A busca livre saiu.
//   · o seletor Produção/Local saiu da tela: o painel fala com o CRM de
//     produção (o "local" segue em storage.session, para quem desenvolve).
//   · o Gravar grava direto (ainda em 2026-10-30): sem o interruptor "avisei os
//     participantes" e sem exigir o clique no ícone antes; o service worker acha
//     a aba da reunião na janela.
//   · durante a reunião, SÓ cards de sugestão (ainda em 2026-10-30: "não mostre
//     a transcrição, apenas crie cards de sugestão com base no andamento da
//     conversa"): preto, letra branca e brilho azul no mais novo, ver
//     desenharSugestoes. A transcrição segue por trás, para o copiloto e o resumo.
//     Desde o roteiro da reunião (ainda em 2026-10-30), o card diz a etapa.
import { CRMS, descobrirCrm, enderecoDoCrm } from "./comum.js";

const $ = (id) => document.getElementById(id);
let atual = { status: "parada" };
let trocando = false;
let conectado = false;
// A reunião clicada, esperando o "Anexar": o clique sozinho não troca o lead da gravação.
let pendente = null;
// Os pedidos do painel em andamento ("comecar", "gerar", "salvar", "reunioes"): o botão não religa no meio.
const emAndamento = new Set();
// De que sala a lista já foi buscada: busca de novo só quando a aba de reunião muda.
let listaDaSala = null;
// O que o CRM aceita no resumo (lib/ia/reuniao.ts): o painel manda o fim da
// reunião que cabe, em vez de a rota recusar tudo.
const RESUMO_MAXIMO = { falas: 3000, caracteres: 190_000 };

const mostrar = (id, sim) => {
  $(id).hidden = !sim;
};
const elemento = (tag, conteudo, classe) => Object.assign(document.createElement(tag), { textContent: conteudo ?? "", className: classe ?? "" });

/** Manda um comando ao service worker; o erro volta para o estado, que o painel mostra. */
async function comando(tipo, extra = {}) {
  const r = await chrome.runtime.sendMessage({ alvo: "sw", tipo, ...extra }).catch((e) => ({ ok: false, erro: e.message }));
  if (r && !r.ok) await chrome.runtime.sendMessage({ alvo: "sw", tipo: "estado", parcial: { erro: r.erro } });
  return r;
}

/** Chama o CRM a partir do painel (reuniões, resumo, salvar). */
async function crm(caminho, corpo) {
  const res = await fetch(`${await enderecoDoCrm()}${caminho}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const dado = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Entre no AmaanOffice neste navegador.");
  if (!res.ok) throw new Error(dado.erro ?? `O CRM respondeu ${res.status}.`);
  return dado;
}

function duracao(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const iniciais = (nome) =>
  String(nome ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "?";

// ── As reuniões de hoje ─────────────────────────────────────────────────────

/** A hora da reunião e o selo de quando ela é, pelo horário de quem vê. */
function quandoDa(r) {
  if (!r.inicio) return { hora: (r.detalhe ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "—", selo: null };
  const d = new Date(r.inicio);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const minutos = Math.round((d.getTime() - Date.now()) / 60_000);
  if (Math.abs(minutos) <= 15) return { hora, selo: { texto: "agora", classe: "agora" } };
  if (minutos > 0) return { hora, selo: { texto: minutos < 60 ? `em ${minutos} min` : `em ${Math.round(minutos / 60)} h`, classe: "neutra" } };
  return { hora, selo: { texto: "já passou", classe: "neutra" } };
}

function cartaoDaReuniao(r) {
  const escolhida = pendente && pendente.contatoId === r.contatoId && pendente.inicio === r.inicio;
  const { hora, selo } = quandoDa(r);
  const cartao = elemento("div", "", `reuniao${escolhida ? " escolhida" : ""}`);
  cartao.setAttribute("role", "button");
  cartao.tabIndex = 0;
  const linha = elemento("div", "", "reuniao-linha");
  const textos = elemento("div", "", "reuniao-texto");
  // Só o nome: o "reunião às 10:00" do CRM repetiria a hora da caixa ao lado.
  textos.append(elemento("span", r.nome, "nome"));
  linha.append(elemento("span", hora, "hora"), textos);
  if (selo) linha.append(elemento("span", selo.texto, `pilula ${selo.classe}`));
  cartao.append(linha);

  if (escolhida) {
    const confirmar = elemento("div", "", "confirmar");
    confirmar.append(elemento("p", `Anexar a gravação à reunião de ${r.nome}? A condução e o resumo usam a ficha deste lead.`));
    const anexar = elemento("button", "Anexar", "botao pequeno");
    const cancelar = elemento("button", "Cancelar", "botao leve pequeno");
    anexar.addEventListener("click", (e) => {
      e.stopPropagation();
      anexarLead(r);
    });
    cancelar.addEventListener("click", (e) => {
      e.stopPropagation();
      pendente = null;
      desenhar(atual);
    });
    confirmar.append(anexar, cancelar);
    cartao.append(confirmar);
  } else {
    const escolher = () => {
      pendente = r;
      desenhar(atual);
    };
    cartao.addEventListener("click", escolher);
    cartao.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        escolher();
      }
    });
  }
  return cartao;
}

/**
 * Busca no CRM as reuniões de hoje (e qual é a desta sala, quando o link do Meet
 * casa) e guarda no estado, onde o gravador também as deixa. Anexa sozinho só
 * quando nada está anexado.
 */
async function carregarReunioes(forcar = false) {
  if (!conectado || emAndamento.has("reunioes")) return;
  const sala = atual.sala ?? "";
  // Uma busca por sala: falhou, o erro aparece e o botão de atualizar tenta de novo
  // (sem isto, cada mudança de estado buscaria outra vez, em laço com o freio da rota).
  if (!forcar && listaDaSala === sala) return;
  listaDaSala = sala;
  emAndamento.add("reunioes");
  desenhar(atual);
  try {
    const dado = await crm("/api/reunioes/assistente/inicio", { sala });
    const parcial = { candidatos: dado.candidatos ?? [] };
    if (dado.lead && !atual.lead) parcial.lead = dado.lead;
    await comando("estado", { parcial });
  } catch (e) {
    await comando("estado", { parcial: { erro: e.message } });
  } finally {
    emAndamento.delete("reunioes");
    desenhar(atual);
  }
}

async function anexarLead(lead) {
  trocando = false;
  pendente = null;
  desenhar(atual);
  const r = await chrome.runtime.sendMessage({ alvo: "gravador", tipo: "lead", contatoId: lead.contatoId }).catch(() => null);
  if (r?.ok) return;
  if (r) return comando("estado", { parcial: { erro: r.erro } });
  // Sem gravador (antes de gravar, ou a reunião acabou e o arquivo já saiu): o
  // painel busca a ficha e o service worker, que é quem grava o estado, a guarda.
  try {
    const dado = await crm("/api/reunioes/assistente/inicio", { contato_id: lead.contatoId });
    await comando("estado", { parcial: { lead: dado.lead, erro: null } });
  } catch (e) {
    await comando("estado", { parcial: { erro: e.message } });
  }
}

// ── Os cards de sugestão ────────────────────────────────────────────────────
// Cada sugestão nova do copiloto é um card (o gravador só guarda a que traz
// novidade). O mais novo fica em cima, com o brilho azul; os anteriores ficam
// menores e apagados, como histórico da conversa. Ficam no painel e nunca na
// página da reunião: quem compartilha só a aba do Meet não mostra nada ao lead.
const CARDS_NA_TELA = 8;
// Os "em" dos cards desenhados, na ordem da tela. null = o painel ainda não
// desenhou: os cards que já estavam lá quando ele abriu não entram animados.
let cardsNaTela = null;

const hora = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Um card, a partir do modelo do HTML. Tudo entra como texto: vem do modelo, que leu a fala do lead. */
function card(s, nova) {
  const li = $("modelo-card").content.firstElementChild.cloneNode(true);
  if (nova) li.classList.add("nova");
  const campo = (classe) => li.querySelector(`.${classe}`);
  campo("pop-hora").textContent = hora(s.em);
  // A etapa do roteiro da reunião em que a conversa estava (lib/ia/reuniao-roteiro.ts).
  campo("pop-etapa").textContent = s.etapa ? `Etapa ${s.etapa.numero} · ${s.etapa.titulo}` : "";
  campo("pop-etapa").hidden = !s.etapa;
  campo("pop-chip").textContent = s.objecao?.tipo ? `Objeção · ${s.objecao.tipo}` : "";
  campo("pop-chip").hidden = !s.objecao?.tipo;
  campo("pop-frase").textContent = s.objecao?.frase ? `“${s.objecao.frase}”` : "";
  campo("pop-frase").hidden = !s.objecao?.frase;
  const [principal, ...mais] = s.conducao ?? [];
  campo("pop-principal").textContent = principal ?? s.objecao?.porTras ?? "";
  campo("pop-mais").replaceChildren(...mais.map((t) => elemento("li", t)));
  campo("pop-proximo").replaceChildren(...(s.proximoPasso ? [elemento("b", "Próximo passo: "), s.proximoPasso] : []));
  campo("pop-proximo").hidden = !s.proximoPasso;
  return li;
}

/** Os cards da reunião: o card que chegou entra no topo, animado, sem redesenhar os outros. */
function desenharSugestoes(r) {
  const gravando = r.status === "gravando";
  const lista = (r.sugestoes ?? []).slice(0, CARDS_NA_TELA);
  mostrar("sugestoes", gravando);
  mostrar("ouvindo", gravando && lista.length === 0);
  $("analise-quando").textContent = r.analisando ? "Analisando a conversa…" : r.analiseEm ? `Atualizado às ${hora(r.analiseEm)}` : "";
  $("sugerir").disabled = !gravando || r.analisando || !r.falas?.length;

  const ol = $("cards");
  const chaves = lista.map((s) => s.em);
  const antes = cardsNaTela;
  // Quantos cards chegaram: a posição, na lista nova, do card que estava no topo.
  const chegaram = antes === null ? -1 : antes.length ? chaves.indexOf(antes[0]) : chaves.length;
  const encaixa = chegaram >= 0 && chaves.slice(chegaram).every((c, i) => c === antes[i]);
  if (encaixa) {
    ol.prepend(...lista.slice(0, chegaram).map((s) => card(s, true)));
    while (ol.children.length > lista.length) ol.lastElementChild.remove();
  } else {
    ol.replaceChildren(...lista.map((s) => card(s, false)));
  }
  cardsNaTela = chaves;
  [...ol.children].forEach((li, i) => li.classList.toggle("atual", i === 0));
  if (encaixa && chegaram > 0) ol.firstElementChild.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ── Desenho ─────────────────────────────────────────────────────────────────

function desenharStatus(r) {
  const status = $("status");
  status.className = `status${r.status === "gravando" ? " gravando" : ""}`;
  status.textContent = {
    gravando: `Gravando ${duracao(Date.now() - (r.inicio ?? Date.now()))}`,
    comecando: "Começando…",
    pronta: "Pronta para gravar",
    encerrada: "Reunião encerrada",
  }[r.status] ?? "Aguardando a reunião";
}

function desenharReuniao(r) {
  mostrar("reuniao", conectado);
  const anexada = Boolean(r.lead) && !trocando;
  mostrar("anexada", anexada);
  if (r.lead) {
    $("anexada-iniciais").textContent = iniciais(r.lead.nome);
    $("anexada-nome").textContent = r.lead.nome;
    $("anexada-resumo").textContent = (r.lead.resumo ?? []).join(" · ") || "Lead do CRM";
  }
  const lista = anexada ? [] : r.candidatos ?? [];
  $("lista").replaceChildren(...lista.map(cartaoDaReuniao));
  const carregando = emAndamento.has("reunioes");
  mostrar("lista-carregando", !anexada && carregando && !lista.length);
  mostrar("lista-vazia", !anexada && !carregando && Array.isArray(r.candidatos) && !r.candidatos.length);
  $("atualizar").classList.toggle("girando", carregando);
  $("atualizar").disabled = carregando;
  mostrar("atualizar", !anexada);
}

function desenharGravar(r) {
  const antes = r.status === "parada" || r.status === "pronta";
  mostrar("gravar", conectado && antes && !(r.status === "pronta" && r.esperandoClique));
  $("comecar").disabled = emAndamento.has("comecar");
}

function desenharFim(r) {
  const encerrada = r.status === "encerrada";
  mostrar("gravacao", encerrada && Boolean(r.arquivo));
  $("baixar").disabled = Boolean(r.downloadId);
  mostrar("resumo", encerrada && Boolean(r.falas?.length));
  $("gerar-resumo").disabled = emAndamento.has("gerar") || !r.falas?.length;
  $("salvar-resumo").disabled = emAndamento.has("salvar") || !r.lead || !$("resumo-texto").value.trim();
  if (encerrada && !r.lead && !$("resumo-status").textContent) {
    $("resumo-status").textContent = "Anexe a reunião acima para salvar o resumo na ficha do lead.";
  }
  mostrar("nova", encerrada && !r.arquivo);
}

function desenhar(r) {
  atual = r;
  desenharStatus(r);
  // Gravando, o topo dá lugar ao relógio e ao Parar: a conexão já foi conferida para começar.
  mostrar("conexao", conectado && r.status !== "gravando");
  mostrar("parar", r.status === "gravando");
  mostrar("lembrete", r.status === "gravando");
  $("erro").textContent = r.erro ?? "";
  mostrar("erro", Boolean(r.erro));
  $("aviso").textContent = r.aviso ?? "";
  mostrar("aviso", Boolean(r.aviso));
  mostrar("silencio", r.status === "gravando" && Boolean(r.silencioDesde));
  desenharReuniao(r);
  desenharGravar(r);
  desenharSugestoes(r);
  desenharFim(r);
}

// ── Ações ───────────────────────────────────────────────────────────────────

$("atualizar").addEventListener("click", () => carregarReunioes(true));

$("trocar").addEventListener("click", () => {
  trocando = true;
  pendente = null;
  desenhar(atual);
  if (!atual.candidatos) carregarReunioes(true);
});

$("comecar").addEventListener("click", async () => {
  emAndamento.add("comecar");
  desenhar(atual);
  await comando("comecar");
  emAndamento.delete("comecar");
  desenhar(atual);
});

$("parar").addEventListener("click", async () => {
  $("parar").disabled = true;
  await comando("parar");
  $("parar").disabled = false;
});

$("sugerir").addEventListener("click", () => {
  // O gravador pede sem a sugestão anterior: quem pediu ganha um card.
  chrome.runtime.sendMessage({ alvo: "gravador", tipo: "sugerir" }).catch(() => {});
});

$("continuar").addEventListener("click", () => {
  chrome.runtime.sendMessage({ alvo: "gravador", tipo: "continuar" }).catch(() => {});
});

$("baixar").addEventListener("click", () => comando("baixar"));

// Dois cliques: o painel lateral não garante a caixa de confirmação do navegador.
$("descartar").addEventListener("click", async () => {
  const botao = $("descartar");
  if (botao.dataset.confirmar !== "sim") {
    botao.dataset.confirmar = "sim";
    botao.textContent = "Confirmar: descartar o áudio";
    setTimeout(() => {
      botao.dataset.confirmar = "";
      botao.textContent = "Descartar";
    }, 5000);
    return;
  }
  botao.dataset.confirmar = "";
  botao.textContent = "Descartar";
  await comando("descartar");
});

/** O fim da reunião que cabe no resumo: das falas mais recentes para trás. */
function falasParaResumo(falas) {
  const saida = [];
  let total = 0;
  for (let i = falas.length - 1; i >= 0 && saida.length < RESUMO_MAXIMO.falas; i--) {
    const t = falas[i].texto.slice(0, 1000);
    total += t.length;
    if (total > RESUMO_MAXIMO.caracteres) break;
    saida.unshift({ fala: falas[i].fala, texto: t });
  }
  return saida;
}

$("gerar-resumo").addEventListener("click", async () => {
  emAndamento.add("gerar");
  desenhar(atual);
  $("resumo-status").textContent = "Resumindo a reunião…";
  try {
    const falas = falasParaResumo(atual.falas);
    const { resumo } = await crm("/api/reunioes/assistente/resumo", { contato_id: atual.lead?.contatoId ?? null, falas });
    $("resumo-texto").value = resumo;
    mostrar("resumo-texto", true);
    mostrar("salvar-resumo", true);
    $("resumo-status").textContent =
      falas.length < atual.falas.length
        ? "A reunião é longa: o resumo cobre o final dela. Revise e corrija antes de salvar."
        : "Revise e corrija o texto antes de salvar.";
  } catch (e) {
    $("resumo-status").textContent = `Não resumiu: ${e.message}`;
  }
  emAndamento.delete("gerar");
  desenhar(atual);
});

$("resumo-texto").addEventListener("input", () => desenhar(atual));

$("salvar-resumo").addEventListener("click", async () => {
  emAndamento.add("salvar");
  desenhar(atual);
  try {
    const dado = await crm("/api/reunioes/assistente/encerrar", {
      contato_id: atual.lead.contatoId,
      texto: $("resumo-texto").value,
      sessao: atual.sessao,
      consentimento_em: atual.consentimentoEm,
    });
    $("resumo-status").textContent = dado.jaSalvo ? "O resumo desta reunião já estava na ficha." : "Resumo salvo como anotação na ficha do lead.";
  } catch (e) {
    $("resumo-status").textContent = `Não salvou: ${e.message}`;
  }
  emAndamento.delete("salvar");
  desenhar(atual);
});

$("nova").addEventListener("click", async () => {
  pendente = null;
  trocando = false;
  listaDaSala = null;
  $("resumo-texto").value = "";
  $("resumo-status").textContent = "";
  mostrar("resumo-texto", false);
  mostrar("salvar-resumo", false);
  await comando("limpar");
});

$("liberar-mic").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("permissao.html") }));

// A CONEXÃO COM O CRM, à vista no topo: a extensão usa o login do CRM neste
// navegador. Confere ao abrir, ao voltar para o painel (no máximo a cada 30 s,
// pelo freio das rotas) e no "Tentar de novo". Conectou, a lista de reuniões vem.
let ultimaConferencia = 0;
async function conferirConexao(agora = false) {
  if (!agora && Date.now() - ultimaConferencia < 30_000) return;
  ultimaConferencia = Date.now();
  const c = await descobrirCrm();
  await chrome.storage.session.set({ crmAtivo: c.url });
  conectado = c.conectado;
  $("conexao").title = c.conectado ? `Conectado a ${new URL(c.url).host}` : "";
  $("desconectado-motivo").textContent = c.erro ?? "";
  mostrar("desconectado", !c.conectado);
  desenhar(atual);
  if (c.conectado) carregarReunioes();
}

$("tentar-de-novo").addEventListener("click", () => conferirConexao(true));
$("abrir-crm").addEventListener("click", async () => {
  const { crm: escolha } = await chrome.storage.session.get("crm");
  chrome.tabs.create({ url: `${escolha === "local" ? CRMS.local : CRMS.producao}/login` });
});
window.addEventListener("focus", () => conferirConexao());

async function conferirMicrofone() {
  const p = await navigator.permissions.query({ name: "microphone" }).catch(() => null);
  mostrar("microfone", p?.state !== "granted");
  if (p) p.onchange = () => mostrar("microfone", p.state !== "granted");
}

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area !== "session" || !mudancas.reuniao) return;
  const novo = mudancas.reuniao.newValue ?? { status: "parada" };
  const salaMudou = (novo.sala ?? "") !== (atual.sala ?? "");
  desenhar(novo);
  // Aba de reunião nova (o clique no ícone): a lista é buscada de novo para ela.
  if (salaMudou) carregarReunioes();
});

// O relógio do "Gravando" e os selos "agora / em 20 min" andam sozinhos.
setInterval(() => {
  if (atual.status === "gravando") desenharStatus(atual);
}, 1000);
setInterval(() => {
  if (!atual.lead && atual.candidatos?.length) desenharReuniao(atual);
}, 60_000);

desenhar((await chrome.storage.session.get("reuniao")).reuniao ?? { status: "parada" });
conferirMicrofone();
conferirConexao(true);
