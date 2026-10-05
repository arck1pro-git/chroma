"use client";

import { useSyncExternalStore } from "react";

// A hora atual para a linha vermelha da grade e para esmaecer o que já passou.
//
// Store externo, e não Date.now() no render: o relógio muda sem ninguém mexer
// na tela, e o render precisa ser puro (react-hooks/purity). No servidor o
// valor é null — a linha só aparece depois da hidratação, e o HTML do servidor
// nunca diverge do primeiro render do cliente.
//
// A leitura é em MINUTOS inteiros: dentro do mesmo minuto o valor é igual, e
// o React não redesenha à toa a cada tique.

function assinar(avisar: () => void) {
  const t = setInterval(avisar, 20_000);
  return () => clearInterval(t);
}

const minutoAtual = () => Math.floor(Date.now() / 60_000);
const noServidor = () => null;

/** Agora, em ms (arredondado ao minuto), ou null antes da hidratação. */
export function useAgora(): number | null {
  const minuto = useSyncExternalStore(assinar, minutoAtual, noServidor);
  return minuto === null ? null : minuto * 60_000;
}
