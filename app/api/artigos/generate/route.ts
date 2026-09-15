// Geração manual: alguém colou o link de uma matéria e pediu um artigo.
//
// O TRABALHO NÃO ESTÁ AQUI — está em lib/artigo-geracao.ts, compartilhado com a
// geração automática por RSS (/api/blogs/rss/gerar). Esta rota é só a porta da
// TELA: valida a entrada do formulário e traduz FalhaGeracao em resposta HTTP.
//
// E ela NÃO GRAVA NADA: devolve o rascunho, e quem salva é POST /api/artigos,
// depois que a pessoa aprova a prévia. Gravar antes encheria o blog de rascunho
// descartado, um por tentativa.
import { NextRequest } from "next/server";
import { campo, lerCorpo } from "@/lib/blog";
import {
  FalhaGeracao,
  gerarArtigoDeMateria,
  tamanhoValido,
} from "@/lib/artigo-geracao";

// Ler a matéria + escrever 2.000 palavras não cabe no timeout padrão.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const blogId = Number(corpo.blogId);
  if (!Number.isInteger(blogId) || blogId <= 0) {
    return Response.json({ error: "Selecione o blog." }, { status: 400 });
  }

  const link = campo(corpo.link, 2000);
  if (!link) {
    return Response.json({ error: "Link da matéria ausente." }, { status: 400 });
  }

  try {
    const r = await gerarArtigoDeMateria({
      blogId,
      link,
      newsTitle: campo(corpo.newsTitle, 500),
      palavraChave: campo(corpo.palavraChave, 200),
      instrucoes: campo(corpo.instrucoes, 4000),
      tamanho: tamanhoValido(corpo.tamanho),
    });
    return Response.json(r);
  } catch (e) {
    if (e instanceof FalhaGeracao) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
