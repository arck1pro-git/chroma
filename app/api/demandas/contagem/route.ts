// O número de demandas a fazer da barra lateral (app/components/sidebar.tsx),
// que confere de minuto em minuto e quando alguém mexe em Demandas. Uma
// consulta pequena, por isso pode ser chamada à vontade.
import { exigirModuloApi } from "@/lib/auth/dal";
import { contarPendentes } from "@/lib/demandas";

export const dynamic = "force-dynamic";

export async function GET() {
  const acesso = await exigirModuloApi("demandas");
  if (acesso instanceof Response) return acesso;
  return Response.json(await contarPendentes(acesso.usuario));
}
