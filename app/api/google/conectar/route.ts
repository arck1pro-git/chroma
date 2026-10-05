import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { CAMINHO_CALLBACK, COOKIE_ESTADO, googleConfigurado, urlDeConsentimento } from "@/lib/google-oauth";

// O botão "Conectar com o Google" de /integracoes vem para cá: sorteia o
// `state`, guarda num cookie e manda para o consentimento. A volta é
// /api/google/callback, que confere o mesmo `state` — sem isso, qualquer site
// poderia levar alguém logado no CRM a conectar a conta Google DO ATACANTE, e
// as reuniões passariam a cair na agenda dele.
//
// GET porque é navegação (o botão é um link). Quem não tem Integrações volta
// com o motivo em vez de um JSON 403 na tela.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const volta = new URL("/integracoes", req.nextUrl);

  const acesso = await exigirModuloApi("integracoes");
  if (acesso instanceof Response) {
    volta.searchParams.set("google", "erro");
    volta.searchParams.set("motivo", "Sem acesso ao módulo Integrações.");
    return NextResponse.redirect(volta);
  }
  if (!googleConfigurado()) {
    volta.searchParams.set("google", "erro");
    volta.searchParams.set("motivo", "Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente.");
    return NextResponse.redirect(volta);
  }

  // A origem de quem chamou: em produção é https://chromacrm.vercel.app, no dev
  // http://localhost:3000. As duas precisam estar cadastradas no Google Cloud
  // — e a URL de preview da Vercel não está, então conectar por ela falha.
  const redirectUri = req.nextUrl.origin + CAMINHO_CALLBACK;
  const estado = randomBytes(24).toString("base64url");

  const resposta = NextResponse.redirect(urlDeConsentimento(redirectUri, estado));
  resposta.cookies.set(COOKIE_ESTADO, estado, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // lax: a volta do Google é navegação GET de outro site, e lax deixa o
    // cookie ir junto nela (strict não deixaria).
    sameSite: "lax",
    maxAge: 600,
    path: "/api/google",
  });
  return resposta;
}
