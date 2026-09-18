// Porta da rua. Roda antes de QUALQUER rota e fecha o CRM inteiro por padrão.
//
// É `proxy.ts` e não `middleware.ts`: o nome middleware está deprecado no Next
// 16 (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
//
// FECHADO POR PADRÃO, e é o ponto principal do arquivo: rota nova nasce
// protegida. A lista abaixo é de EXCEÇÕES — quem entra nela é porque alguém de
// fora precisa chamar sem cookie, e sempre com outra tranca no lugar.
//
// Esta checagem é OTIMISTA: lê o cookie, confere a assinatura e acredita. Não
// consulta banco, de propósito — o proxy roda em toda requisição, inclusive nos
// prefetch que o <Link> dispara ao aparecer na tela, e uma consulta aqui seria
// uma por link visível. Quem confere de verdade (usuário ainda existe? ainda
// está ativo?) é a DAL, em lib/auth/dal.ts.
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, verificar } from "@/lib/auth/sessao";

// Telas e endpoints que respondem sem sessão.
const PUBLICAS_EXATAS = new Set([
  "/login",
  // Rasga o cookie e volta pro login. Público porque quem precisa dele está
  // justamente com um cookie que o proxy considera válido e o banco não — ver
  // app/sair/route.ts.
  "/sair",
  // Entrada do WhatsApp. Confere UAZAPI_WEBHOOK_SECRET na querystring, dentro
  // do próprio handler — quem chama é a uazapi, que não tem como ter cookie.
  "/api/uazapi/webhook",
]);

const PUBLICAS_PREFIXO = [
  // API do blog publicado: o site do cliente lê daqui, muitas vezes do
  // navegador do visitante. A tranca é a chave do blog na própria URL.
  "/api/publico/",
  // Captação de formulário: quem chama é o site do cliente, sem sessão.
  "/api/webhooks/",
];

// Porta de serviço do n8n. Cada uma confere `Authorization: Bearer
// <CRM_SERVICE_TOKEN>` em tempo constante (lib/automacoes/servico.ts) — e
// recusa tudo se a variável não estiver definida, em vez de abrir.
//
// Lista EXATA e não prefixo `/api/blogs/rss/`: `/api/blogs/rss/workflow` é
// tela, não serviço, e um prefixo a deixaria aberta junto.
const SERVICO_EXATAS = new Set([
  "/api/blogs/rss/gerar",
  "/api/blogs/rss/pauta",
  "/api/midia/fila",
  // O motor pedindo o envio de uma mensagem da cadência. Quem tem a credencial
  // da uazapi é o CRM, não o n8n — ver app/api/automacoes/enviar/route.ts.
  "/api/automacoes/enviar",
]);

function dispensaSessao(caminho: string): boolean {
  if (PUBLICAS_EXATAS.has(caminho) || SERVICO_EXATAS.has(caminho)) return true;
  return PUBLICAS_PREFIXO.some((p) => caminho.startsWith(p));
}

export default async function proxy(req: NextRequest) {
  const caminho = req.nextUrl.pathname;
  const sessao = await verificar(req.cookies.get(COOKIE_SESSAO)?.value);

  if (dispensaSessao(caminho)) {
    // Quem já entrou não fica vendo tela de login.
    if (caminho === "/login" && sessao) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    return NextResponse.next();
  }

  if (sessao) return NextResponse.next();

  // API responde 401 em JSON. Redirecionar aqui devolveria 307 pra uma página
  // de HTML, e todo `fetch()` da interface engasgaria tentando ler isso como
  // resposta da API.
  if (caminho.startsWith("/api/")) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  // `?de=` devolve a pessoa exatamente onde ela tentou entrar depois do login —
  // o link de ficha que alguém mandou no WhatsApp não se perde no caminho.
  const destino = new URL("/login", req.nextUrl);
  const volta = caminho + req.nextUrl.search;
  if (volta !== "/") destino.searchParams.set("de", volta);
  return NextResponse.redirect(destino);
}

export const config = {
  // Sem matcher o proxy rodaria também em _next/static e travaria CSS e JS da
  // própria tela de login. O negativo abaixo tira os estáticos e deixa TODO o
  // resto passar por aqui — inclusive /api, que é onde estão os dados.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
