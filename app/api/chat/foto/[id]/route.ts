// A foto de perfil do contato, para os avatares do /chat.
//
// POR QUE UMA ROTA E NÃO A URL DIRETO NA TELA: a URL da foto é da CDN do
// WhatsApp e EXPIRA em alguns dias. Guardada no banco ou no HTML, ela quebraria
// sozinha. Aqui a URL é buscada quando falta (com cache de 12h, lib/canais.ts),
// os bytes passam por nós, e o navegador guarda a imagem por 12h.
//
// O id é o do CONTATO, não um número: a rota só devolve foto de quem já está no
// CRM — não vira um serviço de "me mostre a foto deste telefone".
//
// `?via=<número do canal>` diz por qual instância perguntar primeiro (a da
// conversa). Sem foto, 404 — e a tela mostra as iniciais.
import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { sql } from "@/lib/db";
import { exigirModuloApi } from "@/lib/auth/dal";
import { soDigitos } from "@/lib/telefone";
import { tagDaFoto, urlDaFoto } from "@/lib/canais";

export const dynamic = "force-dynamic";

const semFoto = (segundos: number) =>
  new Response(null, { status: 404, headers: { "Cache-Control": `private, max-age=${segundos}` } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirModuloApi("chat");
  if (sessao instanceof Response) return sessao;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return semFoto(3600);

  const [contato] = await sql`SELECT whatsapp FROM contatos WHERE id = ${id}`;
  const numero = soDigitos((contato?.whatsapp as string | null) ?? "");
  if (numero.length < 10) return semFoto(86_400);

  const via = soDigitos(req.nextUrl.searchParams.get("via") ?? "") || null;
  const url = await urlDaFoto(numero, via);
  // Sem foto (ou privacidade do contato fechada): o navegador não pergunta de
  // novo por 6h. É a resposta mais comum depois de "tem foto".
  if (!url) return semFoto(21_600);

  const imagem = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!imagem?.ok || !imagem.body) {
    // A URL guardada expirou: esquece e a próxima visita busca outra.
    revalidateTag(tagDaFoto(numero), { expire: 0 });
    return semFoto(300);
  }

  return new Response(imagem.body, {
    headers: {
      "Content-Type": imagem.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=43200, stale-while-revalidate=86400",
    },
  });
}
