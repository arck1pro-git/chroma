// Editar o fluxo de uma campanha PAUSADA ou RASCUNHO. A no ar não se edita:
// mudar o grafo com contatos andando nele exige parar antes. Quem estava num
// bloco apagado termina como 'concluida', com evento (salvarEdicao). Bloco que
// já existia não muda de tipo: a recusa vem com os `problemas`, como as outras.
import { exigirModuloApi } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { respostaErroMeta } from "@/lib/meta";
import { salvarEdicao } from "@/lib/campanhas-whatsapp";
import { conferirFluxo, lerFluxoDaEntrada, recusaDoFluxo } from "@/lib/campanhas-fluxo-entrada";
import { ehUuid } from "@/lib/validacao";

export const dynamic = "force-dynamic";

const EDITAVEIS = ["pausada", "rascunho"];

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await exigirModuloApi("campanhas", "editar");
  if (acesso instanceof Response) return acesso;
  const { id } = await params;
  if (!ehUuid(id)) return Response.json({ erro: "Campanha não encontrada." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ erro: "Corpo inválido." }, { status: 400 });
  const nome = typeof b.nome === "string" ? b.nome.trim().slice(0, 160) || null : null;
  const lido = lerFluxoDaEntrada(b.definicao);
  if (!lido.ok) return recusaDoFluxo(lido.problemas);
  try {
    const [c] = (await sql`SELECT waba_id, status FROM campanhas_whatsapp WHERE id = ${id}::uuid`) as Array<{ waba_id: string; status: string }>;
    if (!c) return Response.json({ erro: "Campanha não encontrada." }, { status: 404 });
    if (!EDITAVEIS.includes(c.status)) return Response.json({ erro: "Pause a campanha antes de editar o fluxo." }, { status: 409 });
    const problemas = await conferirFluxo({ fluxo: lido.fluxo, wabaId: c.waba_id, usuario: acesso.usuario });
    if (problemas.length) return recusaDoFluxo(problemas);
    const r = await salvarEdicao({ campanhaId: id, nome, fluxo: lido.fluxo, usuarioId: acesso.usuario.id });
    if (!r) return Response.json({ erro: "Pause a campanha antes de editar o fluxo." }, { status: 409 });
    // Bloco que já existia e mudou de tipo (trava de id, em salvarEdicao).
    if ("problemas" in r) return recusaDoFluxo(r.problemas);
    return Response.json({ ok: true, concluidas: r.concluidas });
  } catch (e) {
    return respostaErroMeta(e);
  }
}
