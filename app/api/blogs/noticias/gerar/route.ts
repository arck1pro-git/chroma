// Uma notícia da lista → artigo gravado. É o botão "Gerar artigo" da tela.
//
// POR QUE ESTA ROTA GRAVA (e /api/artigos/generate não): lá o pedido é "me
// mostra como ficaria" — alguém colou um link, ajusta palavra-chave, tamanho e
// instruções, olha a prévia e decide. Aqui o pedido é o clique de uma linha da
// lista: pega ESTA notícia, com a auditoria JÁ definida no blog, e gera. Pedir
// uma aprovação depois do clique seria inventar uma etapa que ninguém pediu — e
// o artigo nasce `pendente`, que já é o estado que segura a publicação: a rota
// pública só serve o que está aprovado.
//
// O trabalho todo está em lib/blog-pauta.ts, compartilhado com a automação por
// RSS: as duas portas geram o MESMO artigo e desviam o MESMO repetido.
import { NextRequest } from "next/server";
import { campo, lerCorpo } from "@/lib/blog";
import { gerarDaPauta } from "@/lib/blog-pauta";
import { tamanhoValido } from "@/lib/artigo-geracao";
import { exigirModuloApi } from "@/lib/auth/dal";

// Ler a matéria + escrever ~1.300 palavras no Opus. O mesmo teto da geração
// manual — a espera é do modelo, não da rota.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
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

  const saida = await gerarDaPauta({
    blogId,
    link,
    titulo: campo(corpo.titulo, 500),
    tamanho: tamanhoValido(corpo.tamanho),
  });

  // Aqui o erro É erro: tem alguém na tela esperando resposta, e o status é o
  // que faz a linha da notícia mostrar o motivo em vez de um "gerado" falso.
  if (!saida.ok) {
    return Response.json(
      { error: saida.mensagem, repetido: saida.repetido },
      { status: saida.status },
    );
  }

  return Response.json({ artigo: saida.artigo }, { status: 201 });
}
