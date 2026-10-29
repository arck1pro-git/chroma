"use server";

// O "Personalizado" do gráfico do topo do quadro (2026-10-29): os dias de um
// intervalo escolhido, de um funil. Os 30 dias e a semana já vêm na carga da
// tela (./grafico-funil.ts); só o intervalo livre passa por aqui.
//
// Mesma guarda e mesmo corte do quadro: módulo Dashboard, e no escopo
// 'proprio' só o que cai em oportunidade da pessoa.
import { exigirModulo } from "@/lib/auth/dal";
import { comoResultado, Recusa, type ResultadoAcao } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";
import { diasDoFunil, MAXIMO_DIAS_PERSONALIZADO, type DiaDoFunil } from "./grafico-funil";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function graficoDoPeriodo(funilId: string, de: string, ate: string): Promise<ResultadoAcao<{ dias: DiaDoFunil[] }>> {
  const { usuario, escopo } = await exigirModulo("inicio");
  return comoResultado(async () => {
    if (!ehUuid(funilId)) throw new Recusa("Funil inválido.");
    if (!DATA.test(de) || !DATA.test(ate) || Number.isNaN(Date.parse(de)) || Number.isNaN(Date.parse(ate)))
      throw new Recusa("Escolha as duas datas.");
    if (de > ate) throw new Recusa("A data inicial vem depois da final.");
    const dias = (Date.parse(ate) - Date.parse(de)) / 86_400_000 + 1;
    if (dias > MAXIMO_DIAS_PERSONALIZADO) throw new Recusa(`Escolha até ${MAXIMO_DIAS_PERSONALIZADO} dias.`);
    return { dias: await diasDoFunil(funilId, de, ate, escopo === "proprio" ? usuario.id : null) };
  });
}
