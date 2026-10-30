// O que o service worker, o painel e o gravador dividem.

// Os endereços do CRM que a extensão alcança (host_permissions do manifest).
// Outro endereço exigiria mudar o manifest. O domínio da empresa e o da Vercel
// são o MESMO CRM de produção, mas cada um tem o seu cookie de login: quem
// entrou por um não está logado no outro.
export const CRMS = {
  producao: "https://amaanoffice.amaan.com.br",
  vercel: "https://chromacrm.vercel.app",
  local: "http://localhost:3000",
};
const PRODUCAO = [CRMS.producao, CRMS.vercel];

/**
 * O CRM em que a pessoa está logada. "Local" é escolha do painel (fica em
 * storage.session, que a página da reunião não alcança, e volta para produção
 * quando o navegador fecha). Fora dele, procura a sessão nos dois endereços da
 * produção e fica com o primeiro que responde. Pergunta com POST /inicio de
 * sala vazia: a chamada mais barata que passa pela mesma porta das outras.
 *
 * Devolve { url, conectado, erro }.
 */
export async function descobrirCrm() {
  const { crm } = await chrome.storage.session.get("crm");
  const candidatos = crm === "local" ? [CRMS.local] : PRODUCAO;
  let semResposta = false;
  for (const url of candidatos) {
    try {
      const res = await fetch(`${url}/api/reunioes/assistente/inicio`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sala: "" }),
      });
      if (res.ok) return { url, conectado: true, erro: null };
      // 401 = sem login neste endereço: tenta o próximo. Outra recusa é de
      // quem já está logado (sem o módulo Agenda, freio) e vale como resposta.
      if (res.status !== 401) {
        const dado = await res.json().catch(() => ({}));
        const erro = res.status === 403 && dado.erro === "sem acesso ao módulo"
          ? "Seu acesso não inclui o módulo Agenda, que libera o assistente de reuniões."
          : dado.erro || `O CRM respondeu ${res.status}.`;
        return { url, conectado: false, erro };
      }
    } catch {
      semResposta = true;
    }
  }
  return {
    url: candidatos[0],
    conectado: false,
    erro: semResposta && crm === "local"
      ? "O CRM local (localhost:3000) não respondeu. Rode npm run dev."
      : "Não achei o seu login no CRM. Entre no AmaanOffice neste navegador e clique em Tentar de novo.",
  };
}

/** O endereço do CRM para as chamadas: o que o painel achou por último, ou procura agora. */
export async function enderecoDoCrm() {
  const { crmAtivo } = await chrome.storage.session.get("crmAtivo");
  return Object.values(CRMS).includes(crmAtivo) ? crmAtivo : (await descobrirCrm()).url;
}

/**
 * A aba é uma reunião que dá para gravar? Meet numa sala (abc-defg-hij) ou o
 * Zoom no navegador (/wc/), também em subdomínio (us05web.zoom.us, empresa.zoom.us).
 * O Meet passou a redirecionar a sala para /meet/abc-defg-hij (visto em
 * 2026-10-30, quando a extensão dizia "abra a reunião" com o Meet aberto): os
 * dois formatos valem. O mesmo teste está em aviso-reuniao.js, que não importa
 * módulo, e o código da sala em lib/reunioes-lead.ts.
 */
export function ehReuniao(url) {
  return /^https:\/\/meet\.google\.com\/(?:meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i.test(url ?? "") ||
    /^https:\/\/([a-z0-9-]+\.)?zoom\.us\/wc\//i.test(url ?? "");
}
