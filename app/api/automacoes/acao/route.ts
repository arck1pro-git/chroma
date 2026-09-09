// Um bloco da automação, executado pelo CRM a pedido do motor.
//
// Route Handler e não server action: quem chama é externo (docs/automacoes-n8n.md
// §4). A autenticação é o `Authorization: Bearer <CRM_SERVICE_TOKEN>`, conferido
// em tempo constante — esta é a única porta do CRM que dispara WhatsApp sem um
// humano do outro lado, então ela não pode depender de "ninguém sabe a URL".
//
// SEMPRE 200 quando o bloco foi processado, inclusive no 'erro' do bloco: o
// corpo diz o que houve. Status ≥ 400 é reservado para "não entrei" (401 sem
// token, 400 corpo inválido) — assim o motor distingue falha de rede/porta de
// falha de negócio, que são coisas diferentes na hora de reprocessar.

import { NextRequest } from "next/server";
import { executarAcao } from "@/lib/automacoes/executor";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";

export const dynamic = "force-dynamic";

function texto(v: unknown, max: number) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "Corpo inválido." }, { status: 400 });
  }

  const execucaoId = texto(corpo.execucao_id, 64).trim();
  const fluxoId = texto(corpo.fluxo_id, 64).trim();
  const noId = texto(corpo.no_id, 128).trim();

  if (!execucaoId || !fluxoId || !noId) {
    return Response.json(
      { erro: "Faltam execucao_id, fluxo_id ou no_id." },
      { status: 400 },
    );
  }

  // `tipo` e `config`, se vierem no corpo, são IGNORADOS: o executor lê os dois
  // da versão que esta execução inscreveu. Aceitá-los daqui deixaria quem tem o
  // token mandar qualquer texto para qualquer contato.
  const resultado = await executarAcao({ execucaoId, fluxoId, noId });

  // `execucao_id` volta no corpo de propósito: é ele que o próximo nó do motor
  // encadeia (ver o adaptador), e sem isso cada bloco teria que voltar até o
  // nó de webhook para reencontrá-lo.
  return Response.json({
    ok: resultado.estado !== "erro",
    execucao_id: execucaoId,
    no_id: noId,
    estado: resultado.estado,
    detalhe: resultado.detalhe,
    ...(resultado.previa ? { previa: resultado.previa } : {}),
  });
}
