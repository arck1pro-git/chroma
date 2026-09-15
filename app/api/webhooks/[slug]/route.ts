// A porta de entrada de lead: POST /api/webhooks/<slug>?secret=<segredo>
//
// Só envelope HTTP. Quem decide o que vira contato, card e disparo é
// lib/webhooks-recepcao.ts — ver o cabeçalho de lá para a ordem das ações e
// por que a automação é sempre a última.
//
// SEGURANÇA: a rota é pública e o segredo vai na querystring, como no webhook
// da uazapi. A consequência está escrita em migration-webhooks.sql: não colar
// esta URL em JavaScript de página pública, porque com a ação de automação
// ligada um lead falso vira WhatsApp real pela arckwpp, compartilhada com o
// SprintHub.
import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { receberLead } from "@/lib/webhooks-recepcao";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/webhooks/[slug]">,
) {
  const { slug } = await ctx.params;
  const secret = req.nextUrl.searchParams.get("secret") ?? "";

  // Lido como TEXTO e só então parseado: com req.json() direto, um corpo
  // malformado estoura antes de a gente ter como responder 422 com explicação
  // — e o outro lado receberia um 500 sem pista do que fazer.
  const cru = await req.text();
  let payload: unknown;
  try {
    payload = cru ? JSON.parse(cru) : {};
  } catch {
    return Response.json(
      { erro: "corpo não é JSON válido" },
      { status: 422 },
    );
  }

  const { status, corpo } = await receberLead(slug, secret, payload);

  // Lead novo tem que aparecer no quadro e na lista sem F5. Só quando entrou
  // de verdade: revalidar a cada sonda de 401 seria trabalho à toa.
  if (status === 200 && corpo.contato_id) {
    revalidatePath("/");
    revalidatePath("/webhooks");
  }

  return Response.json(corpo, { status });
}

// GET existe só para dar uma resposta útil a quem abrir a URL no navegador
// tentando "testar" — sem isso o Next responde 405 seco e parece quebrado.
export async function GET() {
  return Response.json(
    {
      erro: "esta URL recebe POST com corpo JSON",
      dica: "use o prompt de implementação em /webhooks para montar a chamada",
    },
    { status: 405 },
  );
}
