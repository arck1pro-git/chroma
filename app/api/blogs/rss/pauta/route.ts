// A pauta da semana: quais notícias virar artigo, em qual blog.
//
// QUEM CHAMA: o workflow do n8n, toda segunda às 8h, autenticado pelo
// CRM_SERVICE_TOKEN. Ele pega esta lista e depois pede UM artigo por vez em
// /api/blogs/rss/gerar.
//
// POR QUE O LAÇO É DO n8n E NÃO DAQUI: gerar 10 artigos leva de 10 a 20 minutos
// (cada um lê a matéria e escreve ~1.300 palavras no Opus). Nenhum
// `maxDuration` cobre isso — a rota morreria no meio, com metade dos artigos
// gravados e nenhum aviso. Fatiado, cada chamada é UM artigo, cabe folgado no
// timeout, e o n8n ganha o que ele já sabe fazer: repetir o que falhou e seguir
// o resto. É a Opção B de docs/automacoes-n8n.md — n8n é motor de execução, o
// CRM faz o trabalho.
//
// QUEM MONTA A LISTA é lib/blog-pauta.ts, o mesmo módulo que responde à tela em
// /api/blogs/noticias. Aqui fica só o recorte da automação (blogs ligados, 10
// por blog) e o FORMATO que o workflow espera — `pauta` é o campo que o nó
// "Separar itens" abre, e cada item volta inteiro no corpo do POST de geração.
import { NextRequest } from "next/server";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { POR_BLOG_AUTOMACAO, pautaDosBlogs } from "@/lib/blog-pauta";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export interface ItemPauta {
  blogId: number;
  blogNome: string;
  titulo: string;
  link: string;
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();
  return montar();
}

// GET também: é leitura pura, e deixa conferir a pauta pelo navegador/curl sem
// disparar nada. O token continua obrigatório.
export async function GET(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();
  return montar();
}

async function montar() {
  // Só blogs LIGADOS, COM auditoria e COM feed — os três são pré-requisito, e o
  // recorte está no módulo. Itens que já viraram artigo ficam de fora: gerar de
  // novo seria pagar tokens para repetir o que está no banco.
  const blogs = await pautaDosBlogs({
    somenteAtivos: true,
    limite: POR_BLOG_AUTOMACAO,
  });

  const pauta: ItemPauta[] = blogs.flatMap((b) =>
    b.itens.map((i) => ({
      blogId: b.blogId,
      blogNome: b.blogNome,
      titulo: i.titulo,
      link: i.link,
    })),
  );

  // `resumo` existe para depurar sem abrir o n8n: dá para ver que o feed
  // respondeu (itens > 0) mas tudo já tinha virado artigo (escolhidos = 0).
  const resumo = blogs.map((b) => ({
    blogId: b.blogId,
    blog: b.blogNome,
    feeds: b.feeds,
    itens: b.lidos,
    escolhidos: b.itens.length,
  }));

  return Response.json({ total: pauta.length, resumo, pauta });
}
