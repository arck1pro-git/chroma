// O que o service worker, o painel e o gravador dividem.

// Os dois endereços do CRM que a extensão alcança (host_permissions do
// manifest). Outro endereço exigiria mudar o manifest.
export const CRMS = {
  producao: "https://amaanoffice.amaan.com.br",
  local: "http://localhost:3000",
};

/**
 * O CRM escolhido no painel (padrão: produção). A escolha fica em
 * storage.session, que a página da reunião (content script) não alcança, e
 * volta para produção quando o navegador fecha.
 */
export async function enderecoDoCrm() {
  const { crm } = await chrome.storage.session.get("crm");
  return Object.hasOwn(CRMS, crm ?? "") ? CRMS[crm] : CRMS.producao;
}

/**
 * A aba é uma reunião que dá para gravar? Meet numa sala (abc-defg-hij) ou o
 * Zoom no navegador (/wc/), também em subdomínio (us05web.zoom.us, empresa.zoom.us).
 * O mesmo teste está em aviso-reuniao.js, que não importa módulo.
 */
export function ehReuniao(url) {
  return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i.test(url ?? "") ||
    /^https:\/\/([a-z0-9-]+\.)?zoom\.us\/wc\//i.test(url ?? "");
}
