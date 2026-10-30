// O service worker: prepara e para a gravação, guarda o estado da reunião para
// o painel e baixa o arquivo quando a pessoa pede.
//
// Três peças, cada uma com um papel:
//   · gravador.html (documento invisível, "offscreen"): o áudio, a transcrição e
//     a análise. É o único que fala com o CRM durante a reunião.
//   · este arquivo: o ÚNICO que grava o estado (chrome.storage.session, que o
//     painel lê), o ícone, a captura da aba e o download. O status da reunião
//     só muda aqui; o gravador e o painel mandam só as chaves de
//     CHAVES_DO_ESTADO.
//   · painel.html (painel lateral): mostra e manda comandos.
//
// O CAMINHO DE UMA REUNIÃO (desenho revisto pela auditoria de 2026-10-28):
//   1. clique no ícone (ou Alt+Shift+G) na aba da reunião: abre o painel e a aba
//      fica "pronta". O Chrome só entrega o áudio da aba depois desse gesto; o
//      aviso na página (aviso-reuniao.js) lembra de clicar.
//   2. no painel, a pessoa anexa a reunião do CRM (a lista vem antes de gravar)
//      e clica em Gravar. Só então a aba é capturada. Nunca começa sozinha.
//      Desde 2026-10-30 (pedido dele: "o botão gravar deve já permitir gravar")
//      o Gravar não espera o interruptor "avisei os participantes" nem o passo 1:
//      sem a aba preparada, grava a reunião aberta na janela, e a hora do clique
//      é a hora do aviso (consentimentoEm). Se o Chrome recusar a captura por
//      falta do clique no ícone, o painel pede esse clique e ele começa.
//   3. Parar, ou parada sozinha (a aba fecha ou sai da reunião, 15 min sem som da
//      reunião sem ninguém confirmar que ela segue, 3 h de gravação): a gravação
//      fica na memória do gravador até a pessoa escolher Baixar ou Descartar. A
//      transcrição fica no estado até "Nova reunião".
import { CRMS, descobrirCrm, ehReuniao } from "./comum.js";

const VAZIA = {
  status: "parada", // parada | pronta | comecando | gravando | encerrada
  abaId: null,
  sala: null,
  sessao: null,
  consentimentoEm: null,
  esperandoClique: false, // o Chrome recusou o Começar: o próximo clique no ícone começa
  inicio: null,
  fim: null,
  lead: null,
  candidatos: null, // as reuniões de hoje; null = o CRM ainda não respondeu
  falas: [],
  transcrevendo: [], // de que lado ("lead", "voce") há trecho esperando o texto: o painel mostra "…"
  analise: null,
  analiseEm: null,
  analisando: false,
  silencioDesde: null, // a reunião ficou sem som: o painel pergunta se ela segue
  arquivo: null, // endereço blob: da gravação, enquanto o gravador está aberto
  downloadId: null,
  erro: null,
  aviso: null,
};

// O que o gravador e o painel podem pôr no estado. O resto (status, sessão,
// arquivo, aba) só este arquivo grava.
const CHAVES_DO_ESTADO = ["lead", "candidatos", "falas", "transcrevendo", "analise", "analiseEm", "analisando", "silencioDesde", "erro", "aviso"];
const soChavesPermitidas = (parcial) =>
  Object.fromEntries(Object.entries(parcial ?? {}).filter(([k]) => CHAVES_DO_ESTADO.includes(k)));

// Uma escrita por vez: ler-e-gravar em paralelo perderia atualização.
let fila = Promise.resolve();
function mudar(parcial, recomecar = false) {
  fila = fila
    .then(async () => {
      const { reuniao } = await chrome.storage.session.get("reuniao");
      await chrome.storage.session.set({ reuniao: { ...(recomecar ? VAZIA : reuniao ?? VAZIA), ...parcial } });
    })
    .catch((e) => console.error("[reunioes] estado não gravou", e));
  return fila;
}

async function estado() {
  await fila;
  return (await chrome.storage.session.get("reuniao")).reuniao ?? VAZIA;
}

const gravando = (r) => r.status === "gravando" || r.status === "comecando";

async function garantirGravador() {
  const abertos = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (abertos.length) return;
  await chrome.offscreen.createDocument({
    url: "gravador.html",
    reasons: ["USER_MEDIA"],
    justification: "Gravar e transcrever o áudio da reunião (aba e microfone).",
  });
}

async function fecharGravador() {
  await chrome.offscreen.closeDocument().catch(() => {});
}

async function badge(abaId, texto) {
  // O valor da aba vence o global: os dois juntos, para o REC aparecer na aba
  // da reunião e o "!" do aviso não ficar por cima dele.
  await chrome.action.setBadgeText({ text: texto });
  if (abaId) await chrome.action.setBadgeText({ tabId: abaId, text: texto }).catch(() => {});
}

/** O clique no ícone: a aba fica pronta para gravar (ou o painel explica por que não). */
async function preparar(aba) {
  const atual = await estado();
  // Gravando, ou encerrada com transcrição para resumir: o clique só abre o
  // painel. Zerar é com "Nova reunião".
  if (gravando(atual) || atual.status === "encerrada") return;
  if (!ehReuniao(aba.url)) {
    await mudar({ status: "parada", aviso: "Abra a reunião do Meet ou do Zoom no navegador e clique no ícone de novo." }, true);
    return;
  }
  // O Chrome recusou a captura pelo Gravar e pediu o clique no ícone: com o
  // Gravar já clicado nesta aba, este clique começa.
  if (atual.status === "pronta" && atual.esperandoClique && atual.abaId === aba.id && atual.consentimentoEm) {
    await iniciar(aba, atual.consentimentoEm);
    return;
  }
  await chrome.action.setBadgeText({ tabId: aba.id, text: "" }).catch(() => {});
  // A reunião já anexada no painel (antes do clique no ícone) continua anexada.
  await mudar({ status: "pronta", abaId: aba.id, sala: aba.url, lead: atual.lead ?? null, candidatos: atual.candidatos ?? null }, true);
}

// A recusa do Chrome por falta do clique no ícone vem em inglês: "Extension has
// not been invoked for the current page (see activeTab permission)".
const pediuClique = (e) => /invoked|activeTab/i.test(String(e?.message ?? e));

/** O Chrome recusa a captura em inglês; o painel mostra em português. */
function motivoDaCaptura(e) {
  const texto = String(e?.message ?? e);
  if (/active stream|already/i.test(texto)) return "Esta aba já está sendo capturada por outra extensão ou gravação.";
  return `A gravação não começou: ${texto}`;
}

/**
 * A aba a gravar: a que o clique no ícone preparou ou, sem ele, a reunião da
 * janela em foco (a aba aberta, ou a única reunião entre as abas dela).
 */
async function abaDaReuniao(atual) {
  if (atual.status === "pronta" && atual.abaId) {
    const aba = await chrome.tabs.get(atual.abaId).catch(() => null);
    if (aba && ehReuniao(aba.url)) return aba;
  }
  const [ativa] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (ativa && ehReuniao(ativa.url)) return ativa;
  const reunioes = (await chrome.tabs.query({ lastFocusedWindow: true })).filter((a) => ehReuniao(a.url));
  return reunioes.length === 1 ? reunioes[0] : null;
}

/** O Gravar do painel. A hora do clique fica como a hora do aviso aos participantes. */
async function comecar() {
  const atual = await estado();
  if (atual.status !== "parada" && atual.status !== "pronta") throw new Error("Já há uma reunião neste painel: pare a gravação ou clique em Nova reunião.");
  const aba = await abaDaReuniao(atual);
  if (!aba) throw new Error("Abra a reunião do Meet ou do Zoom nesta janela e clique em Gravar.");
  await iniciar(aba, new Date().toISOString());
}

/**
 * O id da captura da aba e o documento invisível, preparados juntos. Espera os
 * dois terminarem antes de recusar: fechar o documento no meio da criação o
 * deixaria aberto.
 */
async function prepararCaptura(aba) {
  const [captura, documento] = await Promise.allSettled([chrome.tabCapture.getMediaStreamId({ targetTabId: aba.id }), garantirGravador()]);
  if (captura.status === "rejected") throw captura.reason;
  if (documento.status === "rejected") throw documento.reason;
  return captura.value;
}

/** Captura a aba e liga o gravador. Pelo Gravar ou pelo clique no ícone. */
async function iniciar(aba, consentimentoEm) {
  // O lead da reunião anexada antes de gravar vai junto: o gravador não procura outro.
  const leadId = (await estado()).lead?.contatoId ?? null;
  // A aba entra aqui também: pelo Gravar sem o clique no ícone, é a primeira vez,
  // e o "Falta um clique" logo abaixo precisa dela para o clique começar.
  await mudar({ status: "comecando", abaId: aba.id, consentimentoEm, esperandoClique: false, sessao: crypto.randomUUID(), sala: aba.url, erro: null, aviso: null });

  // Sem login no CRM não adianta gravar: nada seria transcrito nem analisado.
  // Confere na hora (a pessoa pode ter entrado ou saído depois de abrir o
  // painel), ao mesmo tempo em que a captura se prepara (2026-10-30, menos
  // latência para começar). O gravador só recebe a ordem depois do login.
  const preparo = prepararCaptura(aba);
  preparo.catch(() => {}); // a recusa é lida logo abaixo, depois do login
  const conexao = await descobrirCrm();
  await chrome.storage.session.set({ crmAtivo: conexao.url });
  const crm = conexao.url;
  if (!conexao.conectado || !Object.values(CRMS).includes(crm)) {
    await preparo.catch(() => {});
    await fecharGravador();
    await mudar({ status: "pronta" });
    throw new Error(conexao.conectado ? "Endereço do CRM fora da lista." : conexao.erro);
  }
  try {
    const streamId = await preparo;
    const r = await chrome.runtime.sendMessage({ alvo: "gravador", tipo: "iniciar", streamId, sala: aba.url, crm, leadId });
    if (!r?.ok) throw new Error(r?.erro ?? "o gravador não respondeu");
  } catch (e) {
    await fecharGravador();
    if (pediuClique(e)) {
      // A confirmação fica guardada: o próximo clique no ícone desta aba começa.
      await mudar({
        status: "pronta",
        esperandoClique: true,
        erro: null,
        aviso: "Falta um clique: o Chrome só libera o áudio depois do clique no ícone da extensão. Clique no ícone (ou Alt+Shift+G) com a aba da reunião aberta, e a gravação começa.",
      });
    } else {
      await mudar({ status: "pronta", erro: motivoDaCaptura(e) });
    }
    return;
  }
  await mudar({ status: "gravando", inicio: Date.now() });
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  await badge(aba.id, "REC");
}

async function parar() {
  const atual = await estado();
  if (!gravando(atual)) return;
  // O gravador espera as últimas transcrições antes de responder.
  const r = await chrome.runtime.sendMessage({ alvo: "gravador", tipo: "parar" }).catch(() => null);
  await badge(atual.abaId, "");
  if (!r?.ok) await fecharGravador();
  await mudar({ status: "encerrada", fim: Date.now(), analisando: false, transcrevendo: [], silencioDesde: null, arquivo: r?.ok ? r.url ?? null : null });
}

function nomeDoArquivo(r) {
  // Sem o nome do lead: o arquivo fica no computador, e o nome aparece em
  // qualquer lista de downloads.
  const d = new Date(r.inicio ?? Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `AmaanOffice/reuniao-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}h${p(d.getMinutes())}.webm`;
}

async function baixar() {
  const r = await estado();
  if (!r.arquivo) throw new Error("A gravação não está mais disponível.");
  if (r.downloadId) throw new Error("O arquivo já está sendo baixado.");
  const id = await chrome.downloads.download({ url: r.arquivo, filename: nomeDoArquivo(r), saveAs: false });
  // No estado, e não na memória: o service worker pode reiniciar no meio.
  await mudar({ downloadId: id });
}

async function descartar() {
  await chrome.runtime.sendMessage({ alvo: "gravador", tipo: "descartar" }).catch(() => null);
  await fecharGravador();
  await mudar({ arquivo: null, downloadId: null });
}

async function limpar() {
  const atual = await estado();
  if (gravando(atual)) throw new Error("Pare a gravação antes.");
  await fecharGravador();
  await mudar({}, true);
}

chrome.downloads.onChanged.addListener(async (d) => {
  if (!d.state || d.state.current === "in_progress") return;
  const r = await estado();
  if (r.downloadId !== d.id) return;
  if (d.state.current === "interrupted") {
    await mudar({ downloadId: null, erro: "O arquivo da gravação não foi salvo. Tente Baixar de novo." });
    return;
  }
  // A transcrição já está no estado: o gravador pode sair da memória.
  await fecharGravador();
  await mudar({ arquivo: null, downloadId: null, aviso: "Gravação salva em Downloads/AmaanOffice." });
});

chrome.action.onClicked.addListener((aba) => {
  // O painel abre já, dentro do gesto do clique: depois de um await o Chrome
  // não aceita mais abrir.
  chrome.sidePanel.open({ tabId: aba.id }).catch(() => {});
  preparar(aba).catch((e) => mudar({ erro: String(e?.message ?? e) }));
});

// Página da própria extensão (painel, gravador): manda comando. Content script
// (a página do Meet ou do Zoom) só avisa que a reunião abriu. Content script
// sempre chega com `tab`; o painel e o gravador, nunca.
const dePaginaDaExtensao = (remetente) => !remetente.tab;

const COMANDOS = {
  comecar: () => comecar(),
  parar,
  baixar,
  descartar,
  limpar,
};

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (msg?.alvo !== "sw" || remetente.id !== chrome.runtime.id) return;
  if (msg.tipo === "reuniao-aberta") {
    // Aviso da página da reunião: um "!" no ícone desta aba lembra de clicar.
    // A aba vem do remetente, nunca do corpo da mensagem.
    const abaId = remetente.tab?.id;
    if (abaId && ehReuniao(remetente.tab.url)) {
      estado().then((r) => {
        if (!gravando(r)) chrome.action.setBadgeText({ tabId: abaId, text: "!" });
      });
    }
    return;
  }
  if (!dePaginaDaExtensao(remetente)) return;
  if (msg.tipo === "estado") {
    // Responde sempre: sem resposta, a promessa de quem mandou é rejeitada.
    mudar(soChavesPermitidas(msg.parcial)).then(() => responder({ ok: true }));
    return true;
  }
  const comando = COMANDOS[msg.tipo];
  if (!comando) return;
  Promise.resolve()
    .then(() => comando(msg))
    .then(() => responder({ ok: true }), (e) => responder({ ok: false, erro: String(e?.message ?? e) }));
  return true;
});

// A gravação para sozinha quando a aba fecha ou sai da reunião.
chrome.tabs.onRemoved.addListener(async (abaId) => {
  const r = await estado();
  if (r.abaId === abaId) await parar();
});
// Só quando a página muda (URL nova ou carregamento): a própria captura gera
// eventos da aba (som, mudo) que não são saída da reunião. Quando a aba vai para
// um site fora das permissões, o Chrome esconde a URL: URL que não se vê para.
chrome.tabs.onUpdated.addListener(async (abaId, mudou) => {
  if (!("url" in mudou) && !mudou.status) return;
  const r = await estado();
  if (r.abaId !== abaId || !gravando(r)) return;
  const aba = await chrome.tabs.get(abaId).catch(() => null);
  if (!aba?.url || !ehReuniao(aba.url)) await parar();
});
