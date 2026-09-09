// O laço que leva as inscrições ao motor.
//
// Existe porque há TRÊS disparos com a mesma mecânica e validações diferentes:
// a cadência de uma etapa (app/inicio/acoes-cadencia.ts), o segmento e a
// seleção do kanban (app/automacoes/acoes.ts, app/funil/actions.ts). O que
// muda entre eles é o que vem ANTES — quem pode disparar, quem entra na lista,
// que erro a pessoa lê. O laço em si é idêntico, e com três cópias um ajuste de
// tamanho de lote viraria três edições que saem de sincronia.
import { marcarPerdida } from "./repositorio";
import { dispararWebhook } from "./motores/n8n/adaptador";

export type Inscrito = { id: string; entidade_id: string };

export type AlvoDeDisparo = {
  id: string;
  motor_webhook_caminho: string | null;
  motor_webhook_segredo: string | null;
};

// Lotes de 5: sequencial atrasa demais um lote grande, e tudo de uma vez
// estoura o limite de conexões do motor.
const LOTE = 5;

/**
 * Chama o webhook do motor uma vez por inscrição e devolve o que entrou.
 *
 * A linha da execução JÁ EXISTE quando isto roda (nasce antes da chamada, de
 * propósito). Por isso a falha não é só um erro contado: a execução é marcada
 * 'perdida', e é o que devolve a entidade ao próximo disparo em vez de deixá-la
 * travada como 'pendente' segurando a vaga no índice de reentrada.
 */
export async function dispararInscritos(
  fluxo: AlvoDeDisparo,
  entidadeTipo: "contato" | "oportunidade",
  inscritos: Inscrito[],
): Promise<{ entraram: number; perdidas: number }> {
  const perdidas: string[] = [];

  for (let i = 0; i < inscritos.length; i += LOTE) {
    const lote = inscritos.slice(i, i + LOTE);
    await Promise.all(
      lote.map(async (ins) => {
        try {
          await dispararWebhook(
            fluxo.motor_webhook_caminho!,
            fluxo.motor_webhook_segredo ?? "",
            {
              execucao_id: ins.id,
              fluxo_id: fluxo.id,
              entidade_tipo: entidadeTipo,
              entidade_id: ins.entidade_id,
            },
          );
        } catch (e) {
          perdidas.push(ins.id);
          // O catch vazio é deliberado: se nem marcar 'perdida' der certo, o
          // disparo dos OUTROS não pode parar por causa disso.
          await marcarPerdida(
            ins.id,
            e instanceof Error ? e.message : String(e),
          ).catch(() => {});
        }
      }),
    );
  }

  return { entraram: inscritos.length - perdidas.length, perdidas: perdidas.length };
}
