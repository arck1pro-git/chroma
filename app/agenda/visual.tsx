import type { CSSProperties } from "react";
import { Bot, CalendarCheck2 } from "lucide-react";
import type { AgendaGoogle, EventoAgenda, ReuniaoDoSistema } from "@/lib/agenda";

// O que todas as visões dividem para desenhar um evento.

const COR_PADRAO = "#71717a";

/** A cor própria do evento vale sobre a da agenda — como no Google. */
export const corDe = (e: EventoAgenda, agenda: AgendaGoogle | undefined) => e.cor ?? agenda?.cor ?? COR_PADRAO;

/** A cor vai como variável CSS; as classes abaixo derivam tinta e borda dela. */
export const comCor = (cor: string) => ({ "--cor": cor }) as CSSProperties;

// TINTA, e não a cor cheia, no fundo do cartão: as cores das agendas vão do
// amarelo-claro ao vermelho, e texto escuro sobre metade delas some. A mistura
// com o fundo da tela deixa todo cartão claro (ou escuro, no tema escuro), com
// a cor inteira só na borda — o texto fica legível em qualquer agenda.
export const TINTA =
  "bg-[color-mix(in_srgb,var(--cor)_17%,white)] dark:bg-[color-mix(in_srgb,var(--cor)_26%,#09090b)]";
export const TINTA_HOVER =
  "hover:bg-[color-mix(in_srgb,var(--cor)_27%,white)] dark:hover:bg-[color-mix(in_srgb,var(--cor)_36%,#09090b)]";
export const BORDA_COR = "border-[var(--cor)]";
export const PONTO_COR = "bg-[var(--cor)]";

/** "pela IA" ou "por Fulano". */
export const quemMarcou = (r: ReuniaoDoSistema) => (r.autor ? `por ${r.autor}` : "pela IA");

/**
 * O selo das reuniões que o CRM marcou: robô para a IA, agenda com check para
 * quem marcou pela ficha. Nunca vem sozinho — o título/aria diz o que é.
 */
export function SeloSistema({ reuniao, className = "size-3" }: { reuniao: ReuniaoDoSistema; className?: string }) {
  const Icone = reuniao.autor ? CalendarCheck2 : Bot;
  return (
    <Icone
      className={`shrink-0 ${className}`}
      aria-label={`Agendada pelo Chroma ${quemMarcou(reuniao)}`}
      role="img"
    />
  );
}
