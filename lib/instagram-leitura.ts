import "server-only";
import { sql } from "@/lib/db";
import { ehUuid } from "@/lib/validacao";
import { ehIdMeta, perfilDaConta } from "@/lib/instagram";
import { Recusa } from "@/lib/resultado-acao";
import type { ComentarioInstagram, PaginaComentariosInstagram } from "./instagram-tipos";

const POR_PAGINA = 100;

/** Cursor é uma linha desta conta/postagem. Ancestrais vêm junto para preservar a thread. */
export async function paginaDeComentarios(contaId: string, midiaId: string, antes: string | null = null): Promise<PaginaComentariosInstagram> {
  if (!perfilDaConta(contaId) || !ehIdMeta(midiaId) || (antes !== null && !ehUuid(antes))) {
    throw new Recusa("Conta, postagem ou página inválida.");
  }
  const linhas = await sql`
    WITH RECURSIVE marco AS (
      SELECT data_criacao, id FROM instagram_comentarios
       WHERE id = ${antes}::uuid AND conta_id = ${contaId} AND midia_id = ${midiaId}
    ), pagina AS MATERIALIZED (
      SELECT c.id, c.data_criacao FROM instagram_comentarios c
       WHERE c.conta_id = ${contaId} AND c.midia_id = ${midiaId}
         AND (c.envio IS NULL OR c.envio = 'enviado')
         AND (${antes}::uuid IS NULL OR (c.data_criacao, c.id) < (SELECT data_criacao, id FROM marco))
       ORDER BY c.data_criacao DESC, c.id DESC LIMIT ${POR_PAGINA + 1}
    ), selecionados AS (
      SELECT * FROM pagina ORDER BY data_criacao DESC, id DESC LIMIT ${POR_PAGINA}
    ), arvore AS (
      SELECT c.* FROM instagram_comentarios c JOIN selecionados s ON s.id = c.id
      UNION
      SELECT pai.* FROM instagram_comentarios pai JOIN arvore filho ON pai.comentario_id = filho.pai_id
       WHERE pai.conta_id = ${contaId} AND pai.midia_id = ${midiaId}
         AND (pai.envio IS NULL OR pai.envio = 'enviado')
    )
    SELECT c.id, c.comentario_id, c.pai_id, c.autor_usuario, c.autor_id, c.texto, c.da_conta, c.enviada_por,
           coalesce(c.contato_id, k.id) AS contato_id,
           (SELECT a.id FROM atendimentos a WHERE a.contato_id = coalesce(c.contato_id, k.id)
             AND a.canal = 'instagram' AND a.numero_instancia = c.conta_id LIMIT 1) AS atendimento_id,
           to_char(c.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS quando,
           (c.da_conta OR c.lido_em IS NOT NULL) AS lido,
           EXISTS (SELECT 1 FROM instagram_comentarios d WHERE d.conta_id = c.conta_id
             AND d.midia_id = c.midia_id AND d.autor_id = c.autor_id AND d.direct_em IS NOT NULL) AS direct_feito,
           (SELECT count(*) > ${POR_PAGINA} FROM pagina) AS tem_mais,
           (SELECT id FROM selecionados ORDER BY data_criacao, id LIMIT 1) AS antes
      FROM arvore c
      LEFT JOIN LATERAL (SELECT id FROM contatos WHERE c.contato_id IS NULL AND NOT c.da_conta
        AND campos ? 'instagram_id' AND campos->>'instagram_id' = c.autor_id) k ON true
     ORDER BY c.data_criacao, c.id`;
  return {
    antes: (linhas[0]?.antes as string | undefined) ?? null,
    temMais: linhas[0]?.tem_mais === true,
    comentarios: linhas.map((c): ComentarioInstagram => ({
      id: c.id as string,
      comentarioId: (c.comentario_id as string | null) ?? "",
      paiId: (c.pai_id as string | null) ?? null,
      autorUsuario: (c.autor_usuario as string | null) ?? null,
      texto: (c.texto as string) ?? "",
      daConta: c.da_conta === true,
      enviadaPor: (c.enviada_por as ComentarioInstagram["enviadaPor"]) ?? null,
      contatoId: (c.contato_id as string | null) ?? null,
      atendimentoId: (c.atendimento_id as string | null) ?? null,
      quando: c.quando as string,
      lido: c.lido === true,
      motivoDirect: c.da_conta ? "Esta resposta é da própria conta."
        : !c.autor_id ? "O Instagram não identificou o autor deste comentário."
        : c.direct_feito ? "Essa pessoa já foi chamada no direct por esta postagem. Continue pela conversa."
        : Date.now() - Date.parse(c.quando as string) > 7 * 24 * 60 * 60_000 ? "O prazo de 7 dias para chamar no direct terminou." : null,
    })),
  };
}
