import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { CAMINHO_CALLBACK, COOKIE_ESTADO, concluirConexao } from "@/lib/google-oauth";

// A volta do consentimento do Google. ESTA é a URL que vai no Google Cloud,
// em "URIs de redirecionamento autorizados":
//
//   https://chromacrm.vercel.app/api/google/callback   (produção)
//   http://localhost:3000/api/google/callback          (dev)
//
// Confere o `state` com o cookie de /api/google/conectar, troca o `code` pelos
// tokens e volta para /integracoes com o resultado na URL.
export const dynamic = "force-dynamic";

function mesmoEstado(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  const volta = new URL("/integracoes", req.nextUrl);
  const falhar = (motivo: string) => {
    volta.searchParams.set("google", "erro");
    volta.searchParams.set("motivo", motivo.slice(0, 300));
    const r = NextResponse.redirect(volta);
    r.cookies.delete({ name: COOKIE_ESTADO, path: "/api/google" });
    return r;
  };

  const acesso = await exigirModuloApi("integracoes");
  if (acesso instanceof Response) return falhar("Sem acesso ao módulo Integrações.");

  const busca = req.nextUrl.searchParams;
  // access_denied = a pessoa clicou em Cancelar na tela do Google.
  const erro = busca.get("error");
  if (erro) return falhar(erro === "access_denied" ? "A conexão foi cancelada na tela do Google." : `O Google devolveu: ${erro}`);

  if (!mesmoEstado(busca.get("state"), req.cookies.get(COOKIE_ESTADO)?.value)) {
    return falhar("A conexão expirou ou veio de outra aba. Clique em Conectar de novo.");
  }
  const code = busca.get("code");
  if (!code) return falhar("O Google voltou sem o código de autorização.");

  try {
    await concluirConexao(code, req.nextUrl.origin + CAMINHO_CALLBACK, acesso.usuario.id);
  } catch (e) {
    console.error("[google] callback falhou:", e);
    return falhar(e instanceof Error ? e.message : String(e));
  }

  volta.searchParams.set("google", "conectado");
  const r = NextResponse.redirect(volta);
  r.cookies.delete({ name: COOKIE_ESTADO, path: "/api/google" });
  return r;
}
