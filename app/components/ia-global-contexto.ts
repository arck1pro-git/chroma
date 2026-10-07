"use client";

// O canal entre as telas e o PAINEL FIXO de IA do TI (./ia-global.tsx).
//
// Arquivo à parte para não haver ciclo: chat-ia.tsx precisa do contexto (para
// saber que não deve se desenhar) e ia-global.tsx precisa do painel de
// chat-ia.tsx (para desenhar o fixo).

import { createContext, useContext } from "react";

/** O que uma tela conta ao painel fixo sobre si. */
export type RegistroIa = {
  /** A frase da tela (vai como "[Tela agora: …]" para o modelo). */
  contexto: string;
  /** Campos extras do POST — o editor e a cadência mandam o fluxo_id. */
  extra?: Record<string, string>;
  /** O que recarregar quando a IA gravar algo (o canvas do editor, por exemplo). */
  aoAplicar?: () => void;
};

export type CanalIaFixa = {
  /** Registra ou atualiza o que a tela `id` informa. A ordem é a do primeiro registro. */
  registrar: (id: string, registro: RegistroIa) => void;
  remover: (id: string) => void;
};

export const IaFixa = createContext<CanalIaFixa | null>(null);

/**
 * O "+" de Análises da barra, para o TI: abre o painel fixo numa conversa
 * nova SEM navegar. Por URL (?ia=nova) havia corrida — a navegação do clique
 * terminava depois da limpeza do parâmetro e o devolvia, e o segundo "+" não
 * fazia nada.
 */
export const EVENTO_NOVA_ANALISE = "chroma:ia-nova";

/** O canal, quando o painel fixo está ligado (só para o TI); null nos demais. */
export function useIaFixa() {
  return useContext(IaFixa);
}
