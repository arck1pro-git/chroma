// Editar o fluxo de uma campanha PAUSADA ou RASCUNHO. A no ar não se edita:
// mudar o grafo com contatos andando nele exige parar antes. Quem estava num
// bloco apagado termina como 'concluida', com evento (salvarEdicao). Bloco que
// já existia não muda de tipo: a recusa vem com os `problemas`, como as outras.
//
// `segmentoIds` (opcional, 2026-10-28) troca o público, com as conferências da
// criação: ao menos um, todos existem e há contato com WhatsApp neles. Quem
// ficou fora e não terminou sai da campanha (salvarEdicao).
import { exigirModuloApi } from "@/lib/auth/dal";
import { listaUuid, sql } from "@/lib/db";
import { respostaErroMeta } from "@/lib/meta";
import { contatosNosSegmentos, salvarEdicao } from "@/lib/campanhas-whatsapp";
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
    let publico: Array<{ id: string; nome: string }> | null = null;
    if (b.segmentoIds !== undefined) {
      const segmentoIds = Array.isArray(b.segmentoIds)
        ? [...new Set(b.segmentoIds.filter((s): s is string => typeof s === "string" && ehUuid(s)))].slice(0, 50)
        : [];
      if (!segmentoIds.length) return Response.json({ erro: "Escolha pelo menos um segmento." }, { status: 400 });
      publico = (await sql`SELECT id, nome FROM segmentos WHERE id = ANY(string_to_array(${listaUuid(segmentoIds)}, ',')::uuid[]) ORDER BY nome`) as unknown as Array<{ id: string; nome: string }>;
      if (publico.length !== segmentoIds.length) return Response.json({ erro: "Um dos segmentos não existe." }, { status: 400 });
      if (!(await contatosNosSegmentos({ segmentoIds }))) return Response.json({ erro: "Os segmentos escolhidos não têm contato com WhatsApp." }, { status: 400 });
    }
    const r = await salvarEdicao({ campanhaId: id, nome, fluxo: lido.fluxo, usuarioId: acesso.usuario.id, publico });
    if (!r) return Response.json({ erro: "Pause a campanha antes de editar o fluxo." }, { status: 409 });
    // Bloco que já existia e mudou de tipo (trava de id, em salvarEdicao).
    if ("problemas" in r) return recusaDoFluxo(r.problemas);
    return Response.json({ ok: true, concluidas: r.concluidas, foraDoPublico: r.foraDoPublico });
  } catch (e) {
    return respostaErroMeta(e);
  }
}
