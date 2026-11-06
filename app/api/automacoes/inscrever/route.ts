import { NextRequest } from "next/server";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import {
  dadosDeDisparo,
  inscreverOportunidades,
  inscricoesPorListaNaUltimaHora,
} from "@/lib/automacoes/repositorio";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import { ehUuid } from "@/lib/validacao";

// O motor inscrevendo oportunidades numa automação publicada (2026-11-06).
// Nasceu para a reinscrição em lote: um workflow do n8n escolhe, de hora em
// hora, as próximas oportunidades de uma lista e chama aqui. Mesma porta e
// mesmo token do /api/automacoes/enviar e /mover.
//
// O motor não cria a inscrição sozinho: o chroma_n8n não tem INSERT em
// fluxo_execucoes (migration-role-n8n.sql). O n8n propõe os ids; o CRM confere
// as regras abaixo e inscreve pelo caminho do "adicionar em automação" do
// quadro (inscreverEmFluxo, app/funil/actions.ts), com origem 'lista':
// inscreverOportunidades cria a execução e a linha no histórico,
// dispararInscritos chama o webhook e marca 'perdida' o que não chegou.
//
// Travas, porque cada inscrição pode virar uma mensagem na hora:
//   · só automação publicada e ligada, e nunca a cadência de uma etapa (ela é
//     disparada pelo painel dela, com origem 'etapa' e a etapa conferida);
//   · só oportunidade aberta e que nunca passou por esta automação (perdida
//     volta): quem terminou ou foi tirado à mão não é reinscrito por aqui;
//   · MAXIMO por chamada e por hora em cada automação: um workflow mal montado
//     (gatilho de minuto em minuto, laço) para no teto, não na instância. O
//     teto conta antes de inscrever, sem trava: duas chamadas ao mesmo tempo
//     podem passar juntas, e o agendador chama de hora em hora.

export const dynamic = "force-dynamic";
// Até MAXIMO webhooks, de 5 em 5, com 20 s de teto cada (lib/automacoes/disparo.ts).
export const maxDuration = 120;

const MAXIMO = 20;

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "corpo inválido" }, { status: 400 });
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return Response.json({ erro: "corpo inválido" }, { status: 400 });
  }
  const { fluxo_id, oportunidade_ids } = corpo as Record<string, unknown>;

  const fluxoId = String(fluxo_id ?? "");
  // O tamanho antes do map: uma lista enorme não custa nada antes do 400.
  const lista = Array.isArray(oportunidade_ids) && oportunidade_ids.length <= MAXIMO ? oportunidade_ids : [];
  const pedidos = [...new Set(lista.map(String))];
  if (!ehUuid(fluxoId)) return Response.json({ erro: "fluxo_id inválido" }, { status: 400 });
  if (pedidos.length === 0 || !pedidos.every(ehUuid)) {
    return Response.json({ erro: `oportunidade_ids: de 1 a ${MAXIMO} uuids` }, { status: 400 });
  }

  const fluxo = await dadosDeDisparo(fluxoId);
  if (!fluxo) return Response.json({ erro: "automação não encontrada" }, { status: 404 });
  if (fluxo.entidade_alvo !== "oportunidade") {
    return Response.json({ erro: "esta automação é de contato, não de oportunidade" }, { status: 409 });
  }
  if (fluxo.etapa_id) {
    return Response.json({ erro: "cadência de etapa entra pelo painel da etapa, não por aqui" }, { status: 409 });
  }
  if (fluxo.estado !== "publicado" || !fluxo.versao_publicada_id || !fluxo.motor_webhook_caminho) {
    return Response.json({ erro: "a automação não está publicada e ligada" }, { status: 409 });
  }
  const naHora = await inscricoesPorListaNaUltimaHora(fluxo.id);
  if (naHora + pedidos.length > MAXIMO) {
    return Response.json({ erro: `teto de ${MAXIMO} inscrições por hora nesta automação (já foram ${naHora})` }, { status: 429 });
  }

  const inscritos = await inscreverOportunidades(fluxo.id, fluxo.versao_publicada_id, pedidos, {
    origem: "lista",
    soAbertas: true,
    semRepetir: true,
  });
  const { entraram, perdidas } = inscritos.length
    ? await dispararInscritos(fluxo, "oportunidade", inscritos)
    : { entraram: 0, perdidas: 0 };

  console.info(`[automações inscrever] ${fluxo.nome}: ${pedidos.length} pedidas, ${entraram} entraram, ${perdidas} perdidas`);
  // Nenhuma chegou ao motor: falha de verdade, para o nó do n8n ficar vermelho.
  // Repetir é seguro: 'perdida' sai da regra de reentrada.
  if (inscritos.length > 0 && entraram === 0) {
    return Response.json(
      { erro: "nenhuma inscrição chegou ao motor: confira se o workflow da automação está ativo", perdidas },
      { status: 502 },
    );
  }
  // Ignorada não é falha: fechada, já dentro do fluxo ou já passou por ele.
  return Response.json({
    ok: true,
    pedidas: pedidos.length,
    inscritas: inscritos.length,
    entraram,
    perdidas,
    ignoradas: pedidos.length - inscritos.length,
  });
}
