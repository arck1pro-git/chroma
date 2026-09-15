// Gera UM artigo da pauta e GRAVA. Chamada pelo n8n, um item por vez.
//
// A DIFERENÇA PARA /api/artigos/generate: lá a rota devolve o rascunho e quem
// grava é a pessoa, depois de olhar a prévia. Aqui não há ninguém olhando às 8h
// da segunda — então esta rota grava. O artigo entra `pendente`, que é
// exatamente o estado que pede leitura humana antes de ir ao ar: só o aprovado
// sai em /api/publico/<chave>/artigos.
//
// O caminho da notícia até a linha no banco é o de lib/blog-pauta.ts, o mesmo
// que o botão da tela usa (/api/blogs/noticias/gerar). O que muda aqui é só o
// tratamento da falha, logo abaixo.
//
// FALHA NÃO DERRUBA A EXECUÇÃO: um item que não pode ser lido (paywall, site
// fora) devolve 200 com ok:false. Se devolvesse 5xx, o nó do n8n marcaria a
// execução inteira como falha e os outros nove artigos iriam junto. O erro fica
// registrado na resposta, item a item.
import { NextRequest } from "next/server";
import { autorizado, naoAutorizado } from "@/lib/automacoes/servico";
import { campo, lerCorpo } from "@/lib/blog";
import { gerarDaPauta } from "@/lib/blog-pauta";
import { tamanhoValido } from "@/lib/artigo-geracao";

// Um artigo: lê a matéria (até 12s) e escreve ~1.300 palavras. Cabe aqui; dez
// não caberiam — por isso o n8n chama esta rota uma vez por item.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return naoAutorizado();

  const corpo = await lerCorpo(req);
  if (!corpo) return Response.json({ error: "Corpo inválido." }, { status: 400 });

  const blogId = Number(corpo.blogId);
  if (!Number.isInteger(blogId) || blogId <= 0) {
    return Response.json({ error: "blogId ausente." }, { status: 400 });
  }

  const link = campo(corpo.link, 2000);
  if (!link) return Response.json({ error: "link ausente." }, { status: 400 });

  const titulo = campo(corpo.titulo, 500);

  const saida = await gerarDaPauta({
    blogId,
    link,
    titulo,
    tamanho: tamanhoValido(corpo.tamanho),
  });

  if (!saida.ok) {
    // 200 de propósito, nos dois casos — ver o cabeçalho do arquivo.
    return saida.repetido
      ? Response.json({ ok: false, pulado: true, motivo: saida.mensagem, link })
      : Response.json({ ok: false, erro: saida.mensagem, link, titulo });
  }

  return Response.json({
    ok: true,
    artigoId: saida.artigo.id,
    slug: saida.artigo.slug,
    titulo: saida.artigo.titulo,
    blogId,
  });
}
