// O gravador (documento invisível, aberto pelo service worker): o áudio da
// reunião, a transcrição e a análise.
//
//   · ABA = o que se ouve na reunião, a voz do lead. MICROFONE = quem grava.
//     Gravados separados, a transcrição sabe quem falou sem adivinhar.
//   · A reunião inteira (aba + microfone misturados) vai para um arquivo que só
//     existe na memória deste computador: no fim, a pessoa escolhe no painel
//     entre Baixar (o service worker salva em Downloads) e Descartar.
//   · Cada fonte é cortada em trechos que vão ao CRM para transcrever
//     (/api/reunioes/assistente/trecho). Desde 2026-10-30 (pedido dele de menos
//     latência) o corte é na PAUSA da fala: depois de TRECHO_MIN_MS, a primeira
//     pausa de PAUSA_MS fecha o trecho, e TRECHO_MAX_MS fecha de qualquer jeito.
//     A frase aparece ~1 s depois de dita, em vez de esperar o fim de um bloco
//     fixo de 15 s, e o corte não cai no meio da palavra. Trecho em silêncio não
//     sai: economiza a chamada e evita as frases que o Whisper inventa no silêncio.
//   · Depois de uma fala NOVA do lead, pede a análise ao copiloto
//     (/api/reunioes/assistente/analise), no máximo a cada ANALISE_MS: a fala que
//     cai dentro da espera fica agendada para o fim dela. "Analisar agora" pula a
//     espera. Recusa de freio (429) ou erro do CRM dobra a espera, até 5 min: a
//     Groq e a Anthropic são as mesmas do atendimento de WhatsApp. Os tetos das
//     rotas (lib/reunioes-extensao.ts) acompanham estes tempos.
//   · SILENCIO_MAXIMO sem som da reunião (no Meet e no Zoom, sair da chamada não
//     muda a URL, e o microfone seguiria gravando a sala): o painel pergunta se
//     a reunião continua; sem resposta em PRAZO_RESPOSTA, para. Para também com
//     DURACAO_MAXIMA ou quando a aba deixa de mandar áudio.
//   · Parar espera as transcrições em andamento: o fim da reunião, onde fica o
//     próximo passo combinado, não pode ficar de fora do resumo.
//
// Este documento só tem chrome.runtime: o estado vai ao service worker, que é o
// único que o grava. Só obedece a páginas da própria extensão (o service worker
// e o painel), nunca ao content script da página da reunião.
import { CRMS } from "./comum.js";

const TRECHO_MIN_MS = 4_000;
const TRECHO_MAX_MS = 12_000;
const PAUSA_MS = 700;
// De quanto em quanto tempo o volume é medido (fala ou pausa).
const MEDIDA_MS = 100;
const ANALISE_MS = 20_000;
const ESPERA_MAXIMA_MS = 5 * 60_000;
const DURACAO_MAXIMA_MS = 3 * 60 * 60_000;
const SILENCIO_MAXIMO_MS = 15 * 60_000;
const PRAZO_RESPOSTA_MS = 2 * 60_000;
// Quanto Parar espera as últimas transcrições antes de entregar o arquivo.
const ESPERA_FINAL_MS = 20_000;
// Volume médio (RMS) abaixo disto é silêncio ou ruído de fundo.
const SILENCIO = 0.008;
// Na análise vão as falas mais recentes (o CRM aceita até 80).
const FALAS_NA_ANALISE = 80;

let r = null; // a reunião em andamento (ou a última, já encerrada)

function emitir(parcial) {
  chrome.runtime.sendMessage({ alvo: "sw", tipo: "estado", parcial }).catch(() => {});
}

function erroDoCrm(status, erro) {
  if (status === 401) return "O login no CRM saiu durante a reunião. Entre no AmaanOffice neste navegador para continuar transcrevendo.";
  if (status === 403 && (!erro || erro === "sem acesso ao módulo")) return "Seu acesso não inclui o módulo Agenda, que libera o assistente de reuniões.";
  return erro || `O CRM respondeu ${status}.`;
}

async function chamar(caminho, opcoes) {
  const res = await fetch(`${r.crm}${caminho}`, { credentials: "include", ...opcoes });
  const dado = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(erroDoCrm(res.status, dado.erro)), { status: res.status });
  return dado;
}

function pedirParada() {
  chrome.runtime.sendMessage({ alvo: "sw", tipo: "parar" }).catch(() => {});
}

const json = (corpo) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

async function iniciar({ streamId, sala, crm, leadId }) {
  if (r && !r.encerrada) throw new Error("Já há uma gravação em andamento.");
  if (!Object.values(CRMS).includes(crm)) throw new Error("Endereço do CRM fora da lista.");
  if (r?.url) URL.revokeObjectURL(r.url);
  // A aba e o microfone abrem juntos: começar espera o mais lento, não a soma.
  const [daAbaPedido, doMicPedido] = await Promise.allSettled([
    navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } }),
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
  ]);
  const mic = doMicPedido.status === "fulfilled" ? doMicPedido.value : null;
  if (daAbaPedido.status === "rejected") {
    // Sem a aba não há gravação: o microfone que abriu é solto na hora.
    mic?.getTracks().forEach((t) => t.stop());
    throw daAbaPedido.reason;
  }
  const aba = daAbaPedido.value;
  const aviso = mic ? null : "Sem o microfone: só a fala do lead será transcrita. Use “Liberar microfone” no painel e grave de novo.";

  const ctx = new AudioContext();
  const daAba = ctx.createMediaStreamSource(aba);
  // Capturar a aba a deixa muda: isto devolve o som da reunião ao alto-falante.
  daAba.connect(ctx.destination);
  const mistura = ctx.createMediaStreamDestination();
  daAba.connect(mistura);
  const doMic = mic ? ctx.createMediaStreamSource(mic) : null;
  doMic?.connect(mistura);

  const pedacos = [];
  const inteiro = new MediaRecorder(mistura.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 48_000 });
  inteiro.ondataavailable = (e) => {
    if (e.data.size) pedacos.push(e.data);
  };
  inteiro.start(10_000);

  r = {
    crm, sala, ctx, fluxos: [aba, mic].filter(Boolean), inteiro, pedacos, falas: [],
    // A reunião anexada no painel antes de gravar (2026-10-30); sem ela, identificar() procura.
    leadId: typeof leadId === "string" && leadId ? leadId : null,
    ultimaAnalise: 0, esperaAnalise: ANALISE_MS, novasDoLead: 0, analisando: false, agendada: null,
    // Trechos de cada fonte esperando o texto: o painel mostra os "…" no lado de quem falou.
    transcrevendo: { lead: 0, voce: 0 },
    encerrada: false, cortes: [], pendentes: new Set(), url: null,
    ultimoSomDaAba: Date.now(), perguntouEm: null,
    limite: setTimeout(pedirParada, DURACAO_MAXIMA_MS),
  };
  r.vigia = setInterval(vigiarSilencio, 30_000);
  // A aba parou de mandar áudio (o Chrome encerrou a captura): para tudo.
  aba.getAudioTracks().forEach((t) => t.addEventListener("ended", pedirParada));
  r.cortes.push(cortar(aba, daAba, "lead"));
  if (mic) r.cortes.push(cortar(mic, doMic, "voce"));
  emitir({ aviso, erro: null });
  if (!r.leadId) identificar();
  return {};
}

/** Sem som da reunião por SILENCIO_MAXIMO: pergunta no painel; sem resposta, para. */
function vigiarSilencio() {
  if (!r || r.encerrada) return;
  if (r.perguntouEm) {
    if (Date.now() - r.perguntouEm >= PRAZO_RESPOSTA_MS) {
      emitir({ silencioDesde: null, aviso: "A gravação parou sozinha: a reunião ficou sem som e ninguém confirmou que ela continuava." });
      pedirParada();
    }
    return;
  }
  if (Date.now() - r.ultimoSomDaAba >= SILENCIO_MAXIMO_MS) {
    r.perguntouEm = Date.now();
    emitir({ silencioDesde: r.ultimoSomDaAba });
  }
}

/** "A reunião continua": zera a contagem do silêncio. */
function continuar() {
  if (!r || r.encerrada) return {};
  r.ultimoSomDaAba = Date.now();
  r.perguntouEm = null;
  emitir({ silencioDesde: null });
  return {};
}

/**
 * Corta `fluxo` em trechos e manda transcrever os que não são silêncio: fecha na
 * primeira pausa depois de TRECHO_MIN_MS de trecho com fala, ou em TRECHO_MAX_MS.
 * `parar()` devolve uma promessa que resolve quando o último trecho foi entregue.
 */
function cortar(fluxo, fonte, fala) {
  const medidor = r.ctx.createAnalyser();
  medidor.fftSize = 2048;
  fonte.connect(medidor);
  const amostra = new Float32Array(medidor.fftSize);
  let atual = null;

  const novo = () => {
    // ultimaVoz: a última medida acima do silêncio (0 = ninguém falou ainda neste trecho).
    const trecho = { nivel: 0, ultimaVoz: 0, partes: [], em: Date.now(), gravador: new MediaRecorder(fluxo, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 }) };
    trecho.entregue = new Promise((pronto) => {
      trecho.gravador.onstop = () => {
        if (trecho.nivel >= SILENCIO) {
          if (fala === "lead") r.ultimoSomDaAba = Date.now();
          transcrever(new Blob(trecho.partes, { type: "audio/webm" }), fala, trecho.em);
        }
        pronto();
      };
    });
    trecho.gravador.ondataavailable = (e) => {
      if (e.data.size) trecho.partes.push(e.data);
    };
    trecho.gravador.start();
    atual = trecho;
  };
  const fechar = () => {
    if (atual?.gravador.state === "recording") atual.gravador.stop();
    return atual?.entregue ?? Promise.resolve();
  };

  novo();
  // Cada medida diz se é fala ou pausa; a pausa depois de fala fecha o trecho.
  const medir = setInterval(() => {
    medidor.getFloatTimeDomainData(amostra);
    let soma = 0;
    for (const v of amostra) soma += v * v;
    const nivel = Math.sqrt(soma / amostra.length);
    const agora = Date.now();
    if (nivel >= SILENCIO) {
      atual.nivel = Math.max(atual.nivel, nivel);
      atual.ultimaVoz = agora;
    }
    const idade = agora - atual.em;
    const pausou = atual.ultimaVoz > 0 && agora - atual.ultimaVoz >= PAUSA_MS;
    if (idade >= TRECHO_MAX_MS || (idade >= TRECHO_MIN_MS && pausou)) {
      fechar();
      novo();
    }
  }, MEDIDA_MS);
  return {
    parar() {
      clearInterval(medir);
      return fechar();
    },
  };
}

const fontesTranscrevendo = () => Object.keys(r.transcrevendo).filter((f) => r.transcrevendo[f] > 0);

function transcrever(audio, fala, em) {
  const corpo = new FormData();
  corpo.append("audio", audio, "trecho.webm");
  r.transcrevendo[fala]++;
  emitir({ transcrevendo: fontesTranscrevendo() });
  const tarefa = chamar("/api/reunioes/assistente/trecho", { method: "POST", body: corpo })
    .then(({ texto }) => {
      if (!texto) return {};
      r.falas.push({ fala, texto, em });
      // Os trechos voltam fora de ordem (cada um é uma chamada): vale a hora em que começou.
      r.falas.sort((a, b) => a.em - b.em);
      return { falas: r.falas };
    })
    .catch((e) => ({ erro: e.message }))
    .then((parcial) => {
      // A fala e o fim dos "…" chegam ao painel juntos, numa escrita só.
      r.transcrevendo[fala]--;
      emitir({ ...parcial, transcrevendo: fontesTranscrevendo() });
      if (parcial.falas && fala === "lead" && !r.encerrada) {
        r.novasDoLead++;
        analisar(false);
      }
    })
    .finally(() => r.pendentes.delete(tarefa));
  r.pendentes.add(tarefa);
}

async function analisar(agora) {
  if (!r || r.encerrada || !r.falas.length || r.analisando) return;
  if (!agora) {
    if (!r.novasDoLead) return;
    const falta = r.esperaAnalise - (Date.now() - r.ultimaAnalise);
    if (falta > 0) {
      // Dentro da espera: uma análise só, agendada para quando ela acabar.
      if (!r.agendada) {
        r.agendada = setTimeout(() => {
          r.agendada = null;
          analisar(false);
        }, falta);
      }
      return;
    }
  }
  clearTimeout(r.agendada);
  r.agendada = null;
  r.analisando = true;
  r.ultimaAnalise = Date.now();
  r.novasDoLead = 0;
  emitir({ analisando: true });
  try {
    const falas = r.falas.slice(-FALAS_NA_ANALISE).map(({ fala, texto }) => ({ fala, texto }));
    const { analise } = await chamar("/api/reunioes/assistente/analise", json({ contato_id: r.leadId, falas }));
    r.esperaAnalise = ANALISE_MS;
    emitir({ analise, analiseEm: Date.now(), erro: null });
  } catch (e) {
    if (e.status === 429 || e.status >= 500) r.esperaAnalise = Math.min(r.esperaAnalise * 2, ESPERA_MAXIMA_MS);
    emitir({ erro: e.message });
  } finally {
    r.analisando = false;
    emitir({ analisando: false });
    // O lead falou enquanto esta análise rodava: a próxima fica agendada.
    if (r.novasDoLead) analisar(false);
  }
}

/** Quem é o lead desta sala: o CRM casa o link do Meet com uma reunião dele. */
async function identificar() {
  try {
    const { lead, candidatos } = await chamar("/api/reunioes/assistente/inicio", json({ sala: r.sala }));
    r.leadId = lead?.contatoId ?? null;
    emitir({ lead, candidatos });
  } catch (e) {
    emitir({ erro: e.message });
  }
}

async function escolherLead({ contatoId }) {
  if (!r) throw new Error("Não há reunião.");
  const { lead } = await chamar("/api/reunioes/assistente/inicio", json({ contato_id: contatoId }));
  r.leadId = lead.contatoId;
  // A lista de reuniões fica: o "Trocar" volta a mostrá-la.
  emitir({ lead, erro: null });
  return {};
}

const comPrazo = (promessa, ms) => Promise.race([promessa, new Promise((pronto) => setTimeout(pronto, ms))]);

async function parar() {
  if (!r || r.encerrada) return { url: r?.url ?? null };
  r.encerrada = true;
  clearTimeout(r.limite);
  clearTimeout(r.agendada);
  clearInterval(r.vigia);
  try {
    // Os últimos trechos saem para transcrever, e o arquivo inteiro fecha.
    const ultimos = r.cortes.map((c) => c.parar());
    const inteiroFechado =
      r.inteiro.state === "inactive"
        ? Promise.resolve()
        : new Promise((pronto) => {
            r.inteiro.onstop = pronto;
            r.inteiro.stop();
          });
    await comPrazo(Promise.all([...ultimos, inteiroFechado]), 5_000);
    await comPrazo(Promise.allSettled([...r.pendentes]), ESPERA_FINAL_MS);
  } finally {
    // O microfone e a aba se soltam aconteça o que acontecer acima.
    r.fluxos.forEach((f) => f.getTracks().forEach((t) => t.stop()));
    await r.ctx.close().catch(() => {});
  }
  const arquivo = new Blob(r.pedacos, { type: "audio/webm" });
  r.url = URL.createObjectURL(arquivo);
  return { url: r.url, bytes: arquivo.size };
}

/** Descartar: a gravação sai da memória sem ser baixada. */
function descartar() {
  if (r?.url) URL.revokeObjectURL(r.url);
  if (r) {
    r.url = null;
    r.pedacos.length = 0;
  }
  return {};
}

const TAREFAS = { iniciar, parar, descartar, continuar, lead: escolherLead, sugerir: () => analisar(true).then(() => ({})) };

// Content script sempre chega com `tab`; o service worker e o painel, nunca.
const dePaginaDaExtensao = (remetente) => !remetente.tab;

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (msg?.alvo !== "gravador" || remetente.id !== chrome.runtime.id || !dePaginaDaExtensao(remetente)) return;
  const tarefa = TAREFAS[msg.tipo];
  if (!tarefa) return;
  Promise.resolve()
    .then(() => tarefa(msg))
    .then((x) => responder({ ok: true, ...x }), (e) => responder({ ok: false, erro: e?.message ?? String(e) }));
  return true;
});
