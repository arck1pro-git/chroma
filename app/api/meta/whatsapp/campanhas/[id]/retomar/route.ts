// Retomar uma campanha pausada. Revalida tudo, como na ativação: a
// permissão de quem retoma, os templates no estado de hoje na Meta, o banco e
// o número. O que venceu durante a pausa sai na próxima rodada; a resposta que
// chegou na pausa já tem a saída gravada e anda agora. retomarCampanha trava a
// linha, confere que a definição é a que foi conferida aqui e inscreve quem
// entrou nos segmentos durante a pausa.
import { exigirModuloApi } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { respostaErroMeta } from "@/lib/meta";
import { numeroDaConta, processarFila, retomarCampanha } from "@/lib/campanhas-whatsapp";
import { conferirFluxo, lerDefinicao, recusaDoFluxo } from "@/lib/campanhas-fluxo-entrada";
import { ehUuid } from "@/lib/validacao";

export const dynamic = "force-dynamic";

const SO_PAUSADA = "Só uma campanha pausada pode ser retomada.";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await exigirModuloApi("campanhas", "editar");
  if (acesso instanceof Response) return acesso;
  const { id } = await params;
  if (!ehUuid(id)) return Response.json({ erro: "Campanha não encontrada." }, { status: 404 });
  try {
    const [c] = (await sql`
      SELECT waba_id, telefone_id, definicao, template_nome, template_idioma
        FROM campanhas_whatsapp WHERE id = ${id}::uuid AND status = 'pausada'`) as Array<{
      waba_id: string; telefone_id: string; definicao: unknown; template_nome: string; template_idioma: string;
    }>;
    if (!c) return Response.json({ erro: SO_PAUSADA }, { status: 409 });
    const fluxo = lerDefinicao(c.definicao, c);
    const problemas = await conferirFluxo({ fluxo, wabaId: c.waba_id, usuario: acesso.usuario });
    if (problemas.length) return recusaDoFluxo(problemas);
    if (!(await numeroDaConta(c.waba_id, c.telefone_id))) {
      return Response.json({ erro: "O número desta campanha não pertence mais à conta do WhatsApp." }, { status: 400 });
    }
    const r = await retomarCampanha(id, fluxo, acesso.usuario.id);
    if (r.estado === "nao_pausada") return Response.json({ erro: SO_PAUSADA }, { status: 409 });
    if (r.estado === "mudou") {
      return Response.json({ erro: "O fluxo mudou enquanto era conferido (outra aba salvou). Recarregue e retome de novo." }, { status: 409 });
    }
    const processamento = await processarFila(5, id);
    return Response.json({ ok: true, inscritas: r.inscritas, processamento });
  } catch (e) {
    return respostaErroMeta(e);
  }
}
