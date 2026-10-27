"use client";

// Modo claro ou escuro, no menu da conta da barra lateral: troca e GUARDA a
// escolha (pedido dele, 2026-10-20). A escolha vai num cookie de um ano, que o
// layout lê no servidor para já mandar o <html> com a classe certa — sem a
// piscada de abrir claro e escurecer depois. Sem escolha, vale o do sistema.
//
// Ícone e rótulo são decididos pelo CSS (dark:), não por estado: o servidor não
// sabe o tema do sistema, e um estado aqui desenharia o errado até hidratar.
import { COOKIE_TEMA } from "@/lib/tema";
import { Moon, Sun } from "./icones";

function escuroAgora(): boolean {
  const c = document.documentElement.classList;
  if (c.contains("escuro")) return true;
  if (c.contains("claro")) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function alternarTema() {
  const escuro = !escuroAgora();
  const html = document.documentElement;
  html.classList.toggle("escuro", escuro);
  html.classList.toggle("claro", !escuro);
  document.cookie = `${COOKIE_TEMA}=${escuro ? "escuro" : "claro"}; path=/; max-age=31536000; samesite=lax`;
}

/** A linha do menu: no claro oferece o escuro (lua), no escuro oferece o claro (sol). */
export default function ItemDoTema({ className }: { className: string }) {
  return (
    <button type="button" role="menuitem" onClick={alternarTema} className={className}>
      <Moon className="size-4 shrink-0 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-4 shrink-0 dark:block" aria-hidden="true" />
      <span className="dark:hidden">Modo escuro</span>
      <span className="hidden dark:inline">Modo claro</span>
    </button>
  );
}
