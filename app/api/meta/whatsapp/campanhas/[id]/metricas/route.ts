// As métricas de UMA campanha de WhatsApp oficial: funil, números por bloco,
// falhas por motivo e gasto (lib/campanhas-metricas.ts; contrato em
// lib/campanhas-metricas-tipos.ts). A mesma tranca da listagem de campanhas.
// A Graph fora do ar não derruba a rota: vem em custo.situacao "erro", com o aviso.
import { exigirModuloApi } from "@/lib/auth/dal";
import { metricasDaCampanha } from "@/lib/campanhas-metricas";
import { ehUuid } from "@/lib/validacao";

export const dynamic = "force-dynamic";

const SEM_GUARDAR = { "Cache-Control": "private, no-store" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  const { id } = await params;
  if (!ehUuid(id)) return Response.json({ erro: "Campanha não encontrada." }, { status: 404, headers: SEM_GUARDAR });
  try {
    const metricas = await metricasDaCampanha(id);
    if (!metricas) return Response.json({ erro: "Campanha não encontrada." }, { status: 404, headers: SEM_GUARDAR });
    return Response.json(metricas, { headers: SEM_GUARDAR });
  } catch (e) {
    console.error("[campanhas] métricas da campanha", id, e);
    return Response.json({ erro: "Não consegui calcular as métricas da campanha." }, { status: 500, headers: SEM_GUARDAR });
  }
}
