// A automação dos artigos no n8n, para a aba Automação do blog.
//
//   GET                       → o estado: ligada, pausada ou não criada, as
//                               últimas rodadas e a próxima.
//   POST { acao: "ligar" }    → cria ou atualiza o workflow e o liga.
//   POST { acao: "pausar" }   → desliga o workflow (os blogs continuam como estão).
//
// LIGAR E PAUSAR SÃO SÓ DA PRODUÇÃO e de quem tem Editar no Blog. A instância
// do n8n é uma só para DEV e produção (e é dividida com o SprintHub), e o
// workflow é único: ver o cabeçalho de lib/blog-automacao.ts. É uma pessoa,
// olhando a tela, que liga — nada disto roda sozinho.
import { exigirModuloApi } from "@/lib/auth/dal";
import { lerCorpo } from "@/lib/blog";
import {
  estadoDaAutomacao,
  FalhaAutomacao,
  ligarAutomacao,
  pausarAutomacao,
  podeLigarDaqui,
} from "@/lib/blog-automacao";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  return Response.json(await estadoDaAutomacao());
}

export async function POST(req: Request) {
  const sessao = await exigirModuloApi("blog", "editar");
  if (sessao instanceof Response) return sessao;

  const corpo = await lerCorpo(req);
  const acao = corpo?.acao;
  if (acao !== "ligar" && acao !== "pausar") {
    return Response.json({ error: 'acao deve ser "ligar" ou "pausar".' }, { status: 400 });
  }
  if (!podeLigarDaqui()) {
    return Response.json(
      {
        error:
          "A automação é uma só para o CRM no ar. Ligue ou pause pela tela do AmaanOffice em produção (amaanoffice.amaan.com.br).",
      },
      { status: 400 },
    );
  }

  try {
    if (acao === "ligar") await ligarAutomacao();
    else await pausarAutomacao();
  } catch (e) {
    if (e instanceof FalhaAutomacao) return Response.json({ error: e.message }, { status: 400 });
    console.error(`[blog] ${acao} a automação falhou:`, e);
    return Response.json({ error: "O n8n recusou o pedido. Tente de novo em instantes." }, { status: 502 });
  }
  console.log(`[blog] automação: ${acao} por ${sessao.usuario.id}`);
  return Response.json(await estadoDaAutomacao());
}
