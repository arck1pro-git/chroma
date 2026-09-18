import { NextRequest, NextResponse } from "next/server";
import { COOKIE_SESSAO } from "@/lib/auth/sessao";

// Rasga o cookie e devolve pro login. Existe para quebrar UM laço específico, e
// vale a pena registrar qual, porque ele é invisível em teste:
//
//   · o proxy confere só a ASSINATURA do cookie (checagem otimista, sem banco —
//     proxy.ts explica por quê) e, vendo cookie válido, manda /login → /
//   · a DAL confere no BANCO e, não achando a pessoa, manda / → /login
//
// Cookie assinado para alguém que foi APAGADO ou DESATIVADO satisfaz os dois ao
// mesmo tempo: o navegador fica quicando entre as duas telas até desistir. Foi
// o que aconteceu ao remover um usuário com sessão aberta.
//
// POR QUE UM ROUTE HANDLER, e não um redirect direto na DAL: só Route Handler e
// Server Action podem MEXER em cookie. Uma página (Server Component) não pode —
// ela até redireciona, mas o cookie continua lá, e o laço recomeça no próximo
// carregamento.
//
// GET de propósito: quem cai aqui está num redirecionamento de navegação, não
// num formulário. O que ele apaga é o cookie de quem chamou — não há o que
// forjar de outra origem.

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const destino = new URL("/login", req.nextUrl);
  // `?sessao=expirada` é o que a tela usa para dizer "sua sessão não vale mais"
  // em vez de deixar a pessoa achando que digitou algo errado.
  destino.searchParams.set("sessao", "expirada");

  const resposta = NextResponse.redirect(destino);
  resposta.cookies.delete(COOKIE_SESSAO);
  return resposta;
}
