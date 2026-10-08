"use client";

// Uma preferência de liga/desliga guardada NO APARELHO (localStorage): a barra
// lateral recolhida, o gráfico de IA minimizado. É do aparelho e não da conta
// de propósito — quem abre o CRM no tablet e no monitor quer as duas telas
// diferentes.
//
// ── Por que LOJA EXTERNA ────────────────────────────────────────────────────
//
// O localStorage é um sistema de fora do React, e é assim que o React quer que
// se leia um: `useSyncExternalStore`, não `useState` + efeito que grava no
// primeiro render. O caminho do efeito pinta uma vez errado e corrige na
// segunda — é a cascata de render que o lint deste projeto barra
// (react-hooks/set-state-in-effect).
//
// O snapshot do servidor é `false`: no servidor não existe localStorage, o HTML
// sai com o valor "desligado" e o cliente ajusta na primeira leitura, sem
// divergência de hidratação.
//
// O cache existe porque `getSnapshot` tem que devolver o MESMO valor enquanto
// nada muda. Ler o localStorage a cada chamada devolveria um booleano novo a
// cada render e o React entraria em laço.
//
// ── O padrão de quem nunca escolheu ─────────────────────────────────────────
//
// `padrao` só vale enquanto a pessoa não clicou: é o que faz o tablet abrir já
// com a barra recolhida e o gráfico minimizado. Clicou uma vez, a escolha fica
// gravada e o tamanho da tela deixa de mandar.
import { useSyncExternalStore } from "react";

/** A mesma altura da variante `tela-baixa:` (app/globals.css). */
export const TELA_BAIXA = "(max-height: 900px)";

export function criarPreferencia(chave: string, padrao: () => boolean = () => false) {
  let emCache: boolean | null = null;
  const ouvintes = new Set<() => void>();

  function assinar(ouvinte: () => void) {
    ouvintes.add(ouvinte);
    return () => {
      ouvintes.delete(ouvinte);
    };
  }

  function ler() {
    if (emCache === null) {
      try {
        const salvo = localStorage.getItem(chave);
        emCache = salvo === null ? padrao() : salvo === "1";
      } catch {
        // Navegador com armazenamento bloqueado: funciona, só não lembra.
        emCache = false;
      }
    }
    return emCache;
  }

  function noServidor() {
    return false;
  }

  function definir(valor: boolean) {
    emCache = valor;
    try {
      localStorage.setItem(chave, valor ? "1" : "0");
    } catch {}
    for (const ouvinte of ouvintes) ouvinte();
  }

  function useValor() {
    return useSyncExternalStore(assinar, ler, noServidor);
  }

  return { useValor, definir };
}
