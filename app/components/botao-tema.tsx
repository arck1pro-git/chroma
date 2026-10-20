"use client";

// Sol e lua ao lado do "Sair": troca entre modo claro e escuro e GUARDA a
// escolha (pedido dele, 2026-10-20). A escolha vai num cookie de um ano, que o
// layout lê no servidor para já mandar o <html> com a classe certa — sem a
// piscada de abrir claro e escurecer depois. Sem escolha, vale o do sistema.
//
// O ícone é decidido pelo CSS (dark:), não por estado: o servidor não sabe o
// tema do sistema, e um estado aqui desenharia o ícone errado até hidratar.
import { Moon, Sun } from "lucide-react";
import { COOKIE_TEMA } from "@/lib/tema";

function escuroAgora(): boolean {
  const c = document.documentElement.classList;
  if (c.contains("escuro")) return true;
  if (c.contains("claro")) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function BotaoTema({ className = "" }: { className?: string }) {
  function alternar() {
    const escuro = !escuroAgora();
    const html = document.documentElement;
    html.classList.toggle("escuro", escuro);
    html.classList.toggle("claro", !escuro);
    document.cookie = `${COOKIE_TEMA}=${escuro ? "escuro" : "claro"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label="Alternar entre modo claro e escuro"
      title="Modo claro / escuro"
      className={`flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-950 transition-colors hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800/60 ${className}`}
    >
      {/* No escuro aparece o sol (vai para o claro); no claro, a lua. */}
      <Sun className="hidden size-3.5 dark:block" aria-hidden="true" />
      <Moon className="size-3.5 dark:hidden" aria-hidden="true" />
    </button>
  );
}
