// Na página do Meet ou do Zoom: só um lembrete de que dá para gravar com a
// extensão, e um "!" no ícone dela. Não lê nada da página, não põe dado de lead
// na página, não escuta mensagens da página e não fala com o CRM: o Chrome só
// deixa gravar depois do clique no ícone, e a gravação começa no painel.
(() => {
  // Só dentro de uma sala (o mesmo teste de ehReuniao, em comum.js): a página
  // inicial do Meet não é reunião.
  const sala =
    /^https:\/\/meet\.google\.com\/(?:meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i.test(location.href) ||
    /^https:\/\/([a-z0-9-]+\.)?zoom\.us\/wc\//i.test(location.href);
  if (!sala || window.top !== window || document.getElementById("amaanoffice-reunioes-aviso")) return;
  chrome.runtime.sendMessage({ alvo: "sw", tipo: "reuniao-aberta" }).catch(() => {});

  const caixa = document.createElement("div");
  caixa.id = "amaanoffice-reunioes-aviso";
  // Shadow DOM: o estilo da página não mexe no aviso, nem o aviso na página.
  const sombra = caixa.attachShadow({ mode: "closed" });
  const estilo = document.createElement("style");
  estilo.textContent = `
    div { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; max-width: 300px;
      display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px;
      background: #18181b; color: #fafafa; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    button { border: 0; background: transparent; color: #a1a1aa; font: inherit; cursor: pointer; padding: 0; }`;
  const aviso = document.createElement("div");
  const textoDoAviso = document.createElement("span");
  textoDoAviso.textContent = "AmaanOffice: para gravar e receber sugestões, clique no ícone da extensão (Alt+Shift+G) e em Gravar no painel.";
  const fechar = document.createElement("button");
  fechar.textContent = "✕";
  fechar.title = "Fechar";
  fechar.addEventListener("click", () => caixa.remove());
  aviso.append(textoDoAviso, fechar);
  sombra.append(estilo, aviso);
  document.documentElement.append(caixa);
  setTimeout(() => caixa.remove(), 20_000);
})();
