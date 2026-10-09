// A conferência de Demandas da barra lateral (app/components/vigia-demandas.tsx):
// o número do item, a versão do quadro e — com `?desde=` — as demandas que
// chegaram depois daquele instante, para a notificação. Uma consulta pequena,
// de minuto em minuto, uma aba por navegador.
import { exigirModuloApi } from "@/lib/auth/dal";
import { conferirDemandas } from "@/lib/demandas";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const acesso = await exigirModuloApi("demandas");
  if (acesso instanceof Response) return acesso;
  const pedido = new URL(req.url).searchParams.get("desde");
  const desde = pedido && !Number.isNaN(Date.parse(pedido)) ? new Date(pedido).toISOString() : null;
  return Response.json(await conferirDemandas(acesso.usuario, desde));
}
