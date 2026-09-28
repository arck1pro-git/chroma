// Quem a IA atende, do jeito que o quadro e a gaveta mostram.
//
// A regra é a mesma do servidor (lib/ia/atendente.ts): a exceção do CONTATO
// manda — vinculado (true) ou removido (false) —, e sem exceção vale a ETAPA
// em que a oportunidade está. Por card, e não por contato, porque o card é de
// UMA etapa: o mesmo contato pode ter o robô numa oportunidade e não na outra.
import { textoDoTom } from "@/lib/cores-funil";
import type { Contato, Etapa } from "../data";

export function iaAtende(contato: Contato | undefined, etapa: Etapa | undefined): boolean {
  return contato?.ia ?? etapa?.ia_atende ?? false;
}

/** A cor do robô no card (a do funil), ou null quando a IA não atende. */
export function corDoRobo(contato: Contato | undefined, etapa: Etapa | undefined): string | null {
  return iaAtende(contato, etapa) ? textoDoTom(etapa?.tom_funil) : null;
}
