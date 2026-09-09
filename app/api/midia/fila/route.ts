// Retentativa manual da fila de mídia.
//
// A baixa normal sai sozinha do webhook (baixarPendentesEmSegundoPlano). Esta
// rota existe para os dois casos em que aquilo não bastou:
//   · o processo caiu no meio, e sobraram linhas 'pendente'
//   · a origem falhou e a linha virou 'erro' — retentar é decisão de gente,
//     não laço automático contra uma URL possivelmente morta
//
// AUTENTICAÇÃO: mesma do restante das rotas de serviço — o CRM_SERVICE_TOKEN
// no header. Sem ele qualquer um dispara download em lote a partir de URLs que
// estão gravadas no nosso banco, o que é um belo amplificador de tráfego.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { baixarPendentes } from "@/lib/midia";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();

  // ?retentar=erro devolve as que falharam para a fila. Fora disso, só o que
  // nunca foi tentado é processado.
  if (req.nextUrl.searchParams.get("retentar") === "erro") {
    await sql`
      UPDATE mensagens SET midia_estado = 'pendente', midia_erro = NULL
      WHERE midia_estado = 'erro' AND midia_url_origem IS NOT NULL`;
  }

  const r = await baixarPendentes(50);
  return Response.json({ ok: true, ...r });
}
