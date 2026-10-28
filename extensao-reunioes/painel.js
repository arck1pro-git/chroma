// O painel lateral: mostra o estado da reunião (chrome.storage.session, que só o
// service worker grava) e manda os comandos. Tudo o que vem do CRM e da
// transcrição entra como textContent, nunca como HTML: é texto dito pelo lead.
import { enderecoDoCrm } from "./comum.js";

const $ = (id) => document.getElementById(id);
let atual = { status: "parada" };
let trocandoLead = false;
// Os pedidos do painel em andamento ("gerar", "salvar"): o botão não religa no meio.
const emAndamento = new Set();
// O que o CRM aceita no resumo (lib/ia/reuniao.ts): o painel manda o fim da
// reunião que cabe, em vez de a rota recusar tudo.
const RESUMO_MAXIMO = { falas: 3000, caracteres: 190_000 };

const mostrar = (id, sim) => {
  $(id).hidden = !sim;
};
const texto = (tag, conteudo, classe) => Object.assign(document.createElement(tag), { textContent: conteudo, className: classe ?? "" });

/** Manda um comando ao service worker; o erro volta para o estado, que o painel mostra. */
async function comando(tipo, extra = {}) {
  const r = await chrome.runtime.sendMessage({ alvo: "sw", tipo, ...extra }).catch((e) => ({ ok: false, erro: e.message }));
  if (r && !r.ok) await chrome.runtime.sendMessage({ alvo: "sw", tipo: "estado", parcial: { erro: r.erro } });
  return r;
}

/** Chama o CRM a partir do painel (busca, resumo, salvar). */
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

function preencherLista(id, itens) {
  $(id).replaceChildren(...(itens ?? []).map((t) => texto("li", t)));
}

function opcao(lead) {
  const b = texto("button", lead.nome, "opcao");
  if (lead.detalhe) b.append(texto("small", lead.detalhe));
  b.addEventListener("click", () => escolher(lead));
  return b;
}

function duracao(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function desenharStatus(r) {
  const status = $("status");
  status.className = `status${r.status === "gravando" ? " gravando" : ""}`;
  status.textContent = {
    gravando: `Gravando ${duracao(Date.now() - (r.inicio ?? Date.now()))}`,
    comecando: "Começando…",
    pronta: "Pronta para gravar",
    encerrada: "Encerrada",
  }[r.status] ?? "Parada";
}

function desenhar(r) {
  atual = r;
  const gravando = r.status === "gravando";
  const emReuniao = gravando || r.status === "comecando" || r.status === "encerrada";

  desenharStatus(r);
  mostrar("parar", gravando);
  mostrar("lembrete", gravando);
  mostrar("ocioso", r.status === "parada");
  // Esperando o clique no ícone (o Chrome recusou o Começar): o aviso diz o que fazer.
  mostrar("pronta", r.status === "pronta" && !r.esperandoClique);
  $("comecar").disabled = !$("consentimento").checked;

  $("erro").textContent = r.erro ?? "";
  mostrar("erro", Boolean(r.erro));
  $("aviso").textContent = r.aviso ?? "";
  mostrar("aviso", Boolean(r.aviso));

  // Condução: a objeção vem primeiro, é o que o vendedor precisa ver de relance.
  const a = r.analise;
  mostrar("conducao", gravando || (r.status === "encerrada" && Boolean(a)));
  mostrar("objecao", Boolean(a?.objecao));
  $("objecao-tipo").textContent = a?.objecao?.tipo ?? "";
  $("objecao-frase").textContent = a?.objecao?.frase ? `“${a.objecao.frase}”` : "";
  $("objecao-portras").textContent = a?.objecao?.porTras ? `Por trás: ${a.objecao.porTras}` : "";
  preencherLista("sugestoes", a?.conducao);
  $("proximo").textContent = a?.proximoPasso ? `Próximo passo: ${a.proximoPasso}` : "";
  mostrar("proximo", Boolean(a?.proximoPasso));
  $("analise-quando").textContent = r.analisando
    ? "Analisando…"
    : r.analiseEm
      ? `Atualizado às ${new Date(r.analiseEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
      : gravando ? "As sugestões aparecem quando o lead falar." : "";
  $("sugerir").disabled = !gravando || r.analisando || !r.falas?.length;

  // Lead: o que o CRM achou, ou a escolha.
  mostrar("lead", emReuniao && Boolean(r.lead) && !trocandoLead);
  $("lead-nome").textContent = r.lead?.nome ?? "Lead";
  preencherLista("lead-resumo", r.lead?.resumo);
  preencherLista("perfil", a?.perfil);
  mostrar("escolha", emReuniao && (!r.lead || trocandoLead));
  $("candidatos").replaceChildren(...(r.candidatos ?? []).map(opcao));

  // A reunião ficou sem som: o gravador para em 2 min se ninguém confirmar.
  mostrar("silencio", gravando && Boolean(r.silencioDesde));

  // O fim: a gravação (baixar ou descartar) e o resumo (gerar, revisar, salvar).
  // Botão com pedido em andamento fica desligado até a resposta.
  const encerrada = r.status === "encerrada";
  mostrar("gravacao", encerrada && Boolean(r.arquivo));
  $("baixar").disabled = Boolean(r.downloadId);
  mostrar("resumo", encerrada && Boolean(r.falas?.length));
  $("gerar-resumo").disabled = emAndamento.has("gerar") || !r.falas?.length;
  $("salvar-resumo").disabled = emAndamento.has("salvar") || !r.lead || !$("resumo-texto").value.trim();
  if (encerrada && !r.lead && !$("resumo-status").textContent) {
    $("resumo-status").textContent = "Escolha o lead acima para salvar o resumo na ficha dele.";
  }
  mostrar("nova", encerrada && !r.arquivo);

  mostrar("transcricao", emReuniao && Boolean(r.falas?.length));
  const ol = $("falas");
  const estavaNoFim = ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 8;
  ol.replaceChildren(
    ...(r.falas ?? []).slice(-200).map((f) => {
      const li = document.createElement("li");
      li.className = f.fala;
      li.append(texto("b", f.fala === "lead" ? "Lead: " : "Você: "), f.texto);
      return li;
    }),
  );
  if (estavaNoFim) ol.scrollTop = ol.scrollHeight;
}

async function escolher(lead) {
  trocandoLead = false;
  desenhar(atual);
  const r = await chrome.runtime.sendMessage({ alvo: "gravador", tipo: "lead", contatoId: lead.contatoId }).catch(() => null);
  if (r?.ok) return;
  if (r) return comando("estado", { parcial: { erro: r.erro } });
  // Sem gravador (a reunião acabou e o arquivo já saiu): o painel busca a ficha
  // e o service worker, que é quem grava o estado, a guarda.
  try {
    const dado = await crm("/api/reunioes/assistente/inicio", { contato_id: lead.contatoId });
    await comando("estado", { parcial: { lead: dado.lead, candidatos: [], erro: null } });
  } catch (e) {
    await comando("estado", { parcial: { erro: e.message } });
  }
}

let busca = 0;
$("busca").addEventListener("input", async (e) => {
  const termo = e.target.value.trim();
  const minha = ++busca;
  if (termo.length < 2) return $("resultados").replaceChildren();
  await new Promise((pronto) => setTimeout(pronto, 300));
  if (minha !== busca) return;
  try {
    const { leads = [] } = await crm("/api/reunioes/assistente/leads", { termo });
    if (minha !== busca) return;
    $("resultados").replaceChildren(...(leads.length ? leads.map(opcao) : [texto("p", "Nenhum lead encontrado.", "suave")]));
  } catch (erro) {
    $("resultados").replaceChildren(texto("p", erro.message, "suave"));
  }
});

$("consentimento").addEventListener("change", () => desenhar(atual));

$("comecar").addEventListener("click", async () => {
  $("comecar").disabled = true;
  await comando("comecar", { consentimentoEm: new Date().toISOString() });
  $("consentimento").checked = false;
  desenhar(atual);
});

$("trocar-lead").addEventListener("click", () => {
  trocandoLead = true;
  desenhar(atual);
  $("busca").focus();
});

$("parar").addEventListener("click", async () => {
  $("parar").disabled = true;
  await comando("parar");
  $("parar").disabled = false;
});

$("sugerir").addEventListener("click", () => {
  chrome.runtime.sendMessage({ alvo: "gravador", tipo: "sugerir" }).catch(() => {});
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

$("continuar").addEventListener("click", () => {
  chrome.runtime.sendMessage({ alvo: "gravador", tipo: "continuar" }).catch(() => {});
});

$("nova").addEventListener("click", async () => {
  $("resumo-texto").value = "";
  $("resumo-status").textContent = "";
  mostrar("resumo-texto", false);
  mostrar("salvar-resumo", false);
  await comando("limpar");
});

$("liberar-mic").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("permissao.html") }));

$("crm").addEventListener("change", (e) => chrome.storage.session.set({ crm: e.target.value }));

async function conferirMicrofone() {
  const p = await navigator.permissions.query({ name: "microphone" }).catch(() => null);
  mostrar("microfone", p?.state !== "granted");
  if (p) p.onchange = () => mostrar("microfone", p.state !== "granted");
}

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area === "session" && mudancas.reuniao) desenhar(mudancas.reuniao.newValue ?? { status: "parada" });
});

// O relógio do "Gravando" anda sozinho.
setInterval(() => {
  if (atual.status === "gravando") desenharStatus(atual);
}, 1000);

const { crm: escolhido } = await chrome.storage.session.get("crm");
$("crm").value = escolhido === "local" ? "local" : "producao";
desenhar((await chrome.storage.session.get("reuniao")).reuniao ?? { status: "parada" });
conferirMicrofone();
