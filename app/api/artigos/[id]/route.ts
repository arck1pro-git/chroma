// Um artigo: salvar o conteúdo (PUT), mover de status (PATCH) e excluir.
//
// POR QUE PUT E PATCH SÃO CAMINHOS SEPARADOS: no rodapé do painel, o seletor de
// status fica ao lado do botão Salvar. Se mudar o status passasse pelo mesmo
// PUT, ele levaria junto o rascunho do painel — e mover um artigo para "em
// revisão" gravaria edições que a pessoa ainda não decidiu salvar. Pior no
// contrário: o PUT devolveria a linha inteira e a tela descartaria o que estava
// sendo digitado. O PATCH toca uma coluna e devolve três campos.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { ARTIGO_STATUS, slugify, type ArtigoStatus } from "@/lib/artigo";
import { slugLivre } from "@/lib/artigo-server";
import { campo, camposArtigo, lerCorpo } from "@/lib/blog";

export const dynamic = "force-dynamic";

function idValido(bruto: string): number | null {
  return /^\d+$/.test(bruto) ? Number(bruto) : null;
}

const NAO_ENCONTRADO = { error: "Artigo não encontrado." };

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = idValido((await params).id);
  if (id === null) return Response.json(NAO_ENCONTRADO, { status: 404 });

  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const titulo = campo(corpo.titulo, 500);
  if (!titulo) {
    return Response.json(
      { error: "O artigo precisa de um título." },
      { status: 400 },
    );
  }

  const [atual] = await sql`SELECT blog_id FROM artigo WHERE id = ${id}`;
  if (!atual) return Response.json(NAO_ENCONTRADO, { status: 404 });

  // `id` no terceiro argumento: o artigo não colide consigo mesmo, então salvar
  // sem trocar o título NÃO vira "titulo-2" a cada gravação.
  const slug = await slugLivre(
    atual.blog_id as number,
    campo(corpo.slug, 200) || slugify(titulo),
    id,
  );

  const [alterado] = await sql`
    UPDATE artigo SET
      titulo           = ${titulo},
      slug             = ${slug},
      meta_title       = ${campo(corpo.meta_title, 300)},
      meta_description = ${campo(corpo.meta_description, 500)},
      palavra_chave    = ${campo(corpo.palavra_chave, 200)},
      keywords         = ${campo(corpo.keywords, 1000)},
      resumo           = ${campo(corpo.resumo, 2000)},
      conteudo         = ${campo(corpo.conteudo, 200_000)},
      imagem_alt       = ${campo(corpo.imagem_alt, 500)},
      fonte_titulo     = ${campo(corpo.fonte_titulo, 500)},
      fonte_url        = ${campo(corpo.fonte_url, 2000)},
      updated_at       = now()
    WHERE id = ${id}
    RETURNING ${sql.unsafe(camposArtigo())}`;

  if (!alterado) return Response.json(NAO_ENCONTRADO, { status: 404 });

  // A tela ressincroniza o slug com o que voltar daqui: o servidor pode ter
  // desambiguado, e o campo tem que mostrar o endereço que existe de verdade.
  return Response.json(alterado);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = idValido((await params).id);
  if (id === null) return Response.json(NAO_ENCONTRADO, { status: 404 });

  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const status = campo(corpo.status, 20) as ArtigoStatus;
  if (!ARTIGO_STATUS.includes(status)) {
    return Response.json(
      { error: `status deve ser um de: ${ARTIGO_STATUS.join(", ")}.` },
      { status: 400 },
    );
  }

  // APROVAR SEM SLUG É APROVAR PARA LUGAR NENHUM: a rota pública acha o artigo
  // por /artigos/<slug>, então um aprovado de slug vazio fica invisível para o
  // site — e a pessoa não teria como saber. Aqui ele ganha o endereço a partir
  // do título, pelo mesmo caminho do PUT (slug livre dentro do blog).
  //
  // Só no caminho de aprovar: voltar para pendente não precisa de endereço.
  let slug: string | null = null;
  if (status === "aprovado") {
    const [artigo] = await sql`
      SELECT blog_id, titulo, slug FROM artigo WHERE id = ${id}`;
    if (!artigo) return Response.json(NAO_ENCONTRADO, { status: 404 });

    if (!(artigo.slug as string)) {
      slug = await slugLivre(
        artigo.blog_id as number,
        artigo.titulo as string,
        id,
      );
    }
  }

  const [alterado] = slug
    ? await sql`
        UPDATE artigo SET status = ${status}, slug = ${slug}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, status, slug,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at`
    : await sql`
        UPDATE artigo SET status = ${status}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, status, slug,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at`;

  if (!alterado) return Response.json(NAO_ENCONTRADO, { status: 404 });

  return Response.json(alterado);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = idValido((await params).id);
  if (id === null) return Response.json(NAO_ENCONTRADO, { status: 404 });

  await sql`DELETE FROM artigo WHERE id = ${id}`;
  return Response.json({ ok: true });
}
