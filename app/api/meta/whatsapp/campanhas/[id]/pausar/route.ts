// Pausar uma campanha ativa. Não mexe no n8n: o agendador segue chamando o
// /processar, e o motor não anda campanha que não está 'ativa' (cada bloco
// confere). Retomar é em ../retomar.
import { exigirModuloApi } from "@/lib/auth/dal";
import { pausarCampanha } from "@/lib/campanhas-whatsapp";
import { ehUuid } from "@/lib/validacao";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await exigirModuloApi("campanhas", "editar");
  if (acesso instanceof Response) return acesso;
  const { id } = await params;
  if (!ehUuid(id)) return Response.json({ erro: "Campanha não encontrada." }, { status: 404 });
  if (!(await pausarCampanha(id, acesso.usuario.id))) {
    return Response.json({ erro: "Só uma campanha ativa pode ser pausada." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
