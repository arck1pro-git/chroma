// O painel lateral: mostra o estado da reunião (chrome.storage.session, que só o
// service worker grava) e manda os comandos. Tudo o que vem do CRM e da
// transcrição entra como textContent, nunca como HTML: é texto dito pelo lead.
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
//   · durante a reunião, a transcrição em balões (lead à esquerda, você à
//     direita), com a condução compacta em cima quando há objeção.
//   · o Gravar grava direto (ainda em 2026-10-30): sem o interruptor "avisei os
//     participantes" e sem exigir o clique no ícone antes; o service worker acha
//     a aba da reunião na janela.
//   · a sugestão nova aparece num card por cima de tudo (ainda em 2026-10-30:
//     "popup com brilho azul ao redor, fundo preto e letra branca"), ver
//     abrirSugestao. A transcrição só acrescenta a fala nova, em vez de
//     redesenhar a lista a cada mudança, e mostra "…" do lado de quem acabou de
//     falar enquanto o trecho é transcrito.
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

// ── O card de sugestão ──────────────────────────────────────────────────────
// Análise nova com o que fazer abre o card por cima de tudo. Ele some sozinho
// quando a barra de baixo esvazia (o mouse em cima segura), no ✕ ou no Esc, e a
// mesma análise segue no cartão Condução. Análise igual à anterior não reabre,
// salvo depois do "Analisar agora". Fica no painel e nunca na página da
// reunião: quem compartilha só a aba do Meet não mostra a sugestão ao lead.
let analiseVista = null; // o analiseEm da última análise já tratada
let assinaturaVista = "";
let popupAberto = false;
let pediuAgora = false;

const assinatura = (a) => JSON.stringify([a?.objecao?.tipo ?? "", a?.conducao ?? []]);
const temSugestao = (a) => Boolean(a?.conducao?.length || a?.objecao);

function abrirSugestao(a) {
  $("pop-objecao").textContent = a.objecao?.tipo ? `Objeção · ${a.objecao.tipo}` : "";
  mostrar("pop-objecao", Boolean(a.objecao?.tipo));
  $("pop-frase").textContent = a.objecao?.frase ? `“${a.objecao.frase}”` : "";
  mostrar("pop-frase", Boolean(a.objecao?.frase));
  const [principal, ...mais] = a.conducao ?? [];
  $("pop-principal").textContent = principal ?? a.objecao?.porTras ?? "";
  $("pop-mais").replaceChildren(...mais.map((t) => elemento("li", t)));
  $("pop-proximo").replaceChildren(...(a.proximoPasso ? [elemento("b", "Próximo passo: "), a.proximoPasso] : []));
  mostrar("pop-proximo", Boolean(a.proximoPasso));

  const pop = $("sugestao");
  // Já aberto: o card renova o brilho em vez de entrar de novo.
  pop.classList.remove("renovada");
  if (popupAberto) {
    void pop.offsetWidth;
    pop.classList.add("renovada");
  }
  // A barra recomeça a esvaziar: a sugestão nova ganha o tempo inteiro.
  const barra = $("pop-barra");
  barra.style.animation = "none";
  void barra.offsetWidth;
  barra.style.animation = "";
  popupAberto = true;
  mostrar("sugestao", true);
  desenharConducao(atual);
}

function fecharSugestao() {
  if (!popupAberto) return;
  popupAberto = false;
  mostrar("sugestao", false);
  desenharConducao(atual);
}

/** Uma análise que o painel ainda não tratou: abre o card se ela traz algo novo a fazer. */
function conferirSugestao(r) {
  if (popupAberto && r.status !== "gravando") fecharSugestao();
  if (!r.analiseEm || r.analiseEm === analiseVista) return;
  analiseVista = r.analiseEm;
  const nova = assinatura(r.analise) !== assinaturaVista;
  assinaturaVista = assinatura(r.analise);
  if (r.status === "gravando" && temSugestao(r.analise) && (nova || pediuAgora)) abrirSugestao(r.analise);
  pediuAgora = false;
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

function desenharConducao(r) {
  const gravando = r.status === "gravando";
  const a = r.analise;
  mostrar("conducao", gravando || (r.status === "encerrada" && Boolean(a)));
  // Com o card aberto, o cartão não repete a mesma sugestão embaixo dele.
  const noCartao = popupAberto ? null : a;
  mostrar("objecao", Boolean(noCartao?.objecao));
  $("objecao-tipo").textContent = noCartao?.objecao?.tipo ?? "";
  $("objecao-frase").textContent = noCartao?.objecao?.frase ? `“${noCartao.objecao.frase}”` : "";
  $("objecao-portras").textContent = noCartao?.objecao?.porTras ? `Por trás: ${noCartao.objecao.porTras}` : "";
  $("sugestoes").replaceChildren(...(noCartao?.conducao ?? []).map((t) => elemento("li", t)));
  $("proximo").textContent = noCartao?.proximoPasso ? `Próximo passo: ${noCartao.proximoPasso}` : "";
  mostrar("proximo", Boolean(noCartao?.proximoPasso));
  const hora = r.analiseEm ? new Date(r.analiseEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  $("analise-quando").textContent = r.analisando
    ? "Analisando…"
    : popupAberto
      ? `Sugestão das ${hora} aberta acima.`
      : r.analiseEm
        ? `Atualizado às ${hora}`
        : gravando
          ? "As sugestões aparecem quando o lead falar."
          : "";
  $("sugerir").disabled = !gravando || r.analisando || !r.falas?.length;
  mostrar("sugerir", gravando);
}

// As falas já na tela, pela chave (hora do trecho + quem falou): a fala nova
// entra no fim sem redesenhar a lista. Trecho que voltou fora de ordem, ou a
// lista que mudou de outro jeito, redesenha tudo.
let falasNaTela = [];
const chaveDaFala = (f) => `${f.em}:${f.fala}`;
const lado = (fala) => (fala === "lead" ? "lead" : "voce");

/** Um balão. `anterior` é quem falou antes: a mesma pessoa seguida junta os balões. */
function balao(quem, anterior, classe, conteudo) {
  const li = elemento("li", "", `fala ${quem}${anterior === quem ? " continua" : ""}${classe ? ` ${classe}` : ""}`);
  li.append(elemento("span", quem === "lead" ? "Lead" : "Você", "quem"), conteudo);
  return li;
}

function digitando(quem, anterior) {
  const pontos = elemento("span", "", "texto");
  pontos.append(elemento("i", "", "ponto"), elemento("i", "", "ponto"), elemento("i", "", "ponto"));
  const li = balao(quem, anterior, "digitando", pontos);
  li.setAttribute("aria-label", quem === "lead" ? "Transcrevendo a fala do lead" : "Transcrevendo a sua fala");
  return li;
}

function desenharTranscricao(r) {
  const gravando = r.status === "gravando" || r.status === "comecando";
  const falas = (r.falas ?? []).slice(-200);
  const pendentes = r.status === "gravando" ? r.transcrevendo ?? [] : [];
  mostrar("transcricao", gravando || (r.status === "encerrada" && falas.length > 0));
  mostrar("ao-vivo", r.status === "gravando");
  mostrar("ouvindo", gravando && falas.length === 0 && pendentes.length === 0);
  const ol = $("falas");
  const estavaNoFim = ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 12;
  ol.querySelectorAll(".digitando").forEach((li) => li.remove());
  const chaves = falas.map(chaveDaFala);
  const soAcrescentou = falasNaTela.length <= chaves.length && falasNaTela.every((c, i) => c === chaves[i]);
  // Só a fala que chegou agora entra animada; a lista redesenhada, não.
  const animar = soAcrescentou && falasNaTela.length > 0;
  if (!soAcrescentou) ol.replaceChildren();
  for (let i = soAcrescentou ? falasNaTela.length : 0; i < falas.length; i++) {
    ol.append(balao(lado(falas[i].fala), falas[i - 1] && lado(falas[i - 1].fala), animar ? "nova" : "", elemento("span", falas[i].texto, "texto")));
  }
  falasNaTela = chaves;
  let anterior = falas.length ? lado(falas.at(-1).fala) : null;
  for (const quem of pendentes) {
    ol.append(digitando(lado(quem), anterior));
    anterior = lado(quem);
  }
  if (estavaNoFim) ol.scrollTop = ol.scrollHeight;
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
  conferirSugestao(r);
  desenharReuniao(r);
  desenharGravar(r);
  desenharConducao(r);
  desenharTranscricao(r);
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
  // Pedida agora: o card abre mesmo que a sugestão venha igual à anterior.
  pediuAgora = true;
  chrome.runtime.sendMessage({ alvo: "gravador", tipo: "sugerir" }).catch(() => {});
});

$("pop-fechar").addEventListener("click", fecharSugestao);
// A barra do card esvaziou (o mouse em cima a segura): o card sai.
$("pop-barra").addEventListener("animationend", fecharSugestao);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharSugestao();
});
// O card fica logo abaixo do topo, que muda de altura com o status e os botões.
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--topo-altura", `${Math.ceil($("topo").getBoundingClientRect().height) + 8}px`);
}).observe($("topo"));

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

const inicial = (await chrome.storage.session.get("reuniao")).reuniao ?? { status: "parada" };
// A análise que já estava lá quando o painel abriu não vira card: ela segue no cartão Condução.
analiseVista = inicial.analiseEm ?? null;
assinaturaVista = assinatura(inicial.analise);
desenhar(inicial);
conferirMicrofone();
conferirConexao(true);
