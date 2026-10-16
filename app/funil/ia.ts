// Quem a IA atende, do jeito que o quadro e a gaveta mostram.
//
// A regra é a mesma do servidor (lib/ia/atendente.ts): a exceção do CONTATO
// manda — ligado à mão (true, com a IA dele) ou removido (false) —, e sem
// exceção vale a IA da ETAPA em que a oportunidade está. Por card, e não por
// contato, porque o card é de UMA etapa: o mesmo contato pode ter o robô numa
// oportunidade e não na outra.
import { textoDoTom } from "@/lib/cores-funil";
import type { Contato, Etapa } from "../data";

/** O id da IA que responde este card, ou null. */
export function iaDoCard(contato: Contato | undefined, etapa: Etapa | undefined): string | null {
  if (contato?.ia === false) return null;
  if (contato?.ia === true) return contato.ia_id ?? etapa?.ia_id ?? null;
  return etapa?.ia_id ?? null;
}

/** A cor do robô no card (a do funil), ou null quando a IA não atende. */
export function corDoRobo(contato: Contato | undefined, etapa: Etapa | undefined): string | null {
  return iaDoCard(contato, etapa) ? textoDoTom(etapa?.tom_funil) : null;
}
