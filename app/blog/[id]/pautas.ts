// As pautas do blog (as notícias dos feeds que ainda não viraram artigo) e o
// gesto de transformar uma delas em artigo.
//
// MORA NA TELA DO BLOG, NÃO NO QUADRO: gerar leva de um a três minutos (a IA lê
// a matéria e escreve ~1.300 palavras), e quem troca para a aba Desempenho no
// meio não pode perder o artigo nem o aviso de que ele chegou. O quadro só lê
// daqui.
//
// O que já virou artigo SAI da lista: a pauta é o que falta fazer. O servidor
// manda as usadas junto (lib/blog-pauta.ts, `incluirUsados`), e aqui elas viram
// só a contagem do rodapé da coluna.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Artigo } from "@/lib/artigo";
import type { ItemPauta, PautaDoBlog, RespostaNoticias } from "@/lib/blog-pauta-tipos";
import { mensagemDeErro } from "../pecas";

export type FasePauta =
  | { estado: "gerando"; desde: number }
  | { estado: "erro"; mensagem: string };

export interface Pautas {
  /** null enquanto os feeds são lidos. Só as que ainda não viraram artigo. */
  itens: ItemPauta[] | null;
  feeds: number;
  usadas: number;
  /** Itens lidos dos feeds antes do corte: separa "feed mudo" de "tudo usado". */
  lidos: number;
  erro: string | null;
  /** Por link. Ausente = parada. */
  fases: Record<string, FasePauta>;
  gerando: number;
  reler: () => void;
  gerar: (item: ItemPauta) => void;
}

/** Os dados de demonstração (?demo=1): a lista já vem pronta e nada vai ao servidor. */
export type PautasDemo = PautaDoBlog;

export function usePautas({
  blogId,
  demo,
  aoGerar,
}: {
  blogId: number;
  demo?: PautasDemo;
  /** O artigo recém-gravado, para a tela pôr em "Em revisão". */
  aoGerar: (artigo: Artigo) => void;
}): Pautas {
  const [grupo, setGrupo] = useState<PautaDoBlog | null>(demo ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [fases, setFases] = useState<Record<string, FasePauta>>({});
  const [recarga, setRecarga] = useState(0);
  // O retorno muda a cada render da tela; a geração em voo usa sempre o último.
  const aoGerarRef = useRef(aoGerar);
  useEffect(() => {
    aoGerarRef.current = aoGerar;
  }, [aoGerar]);

  useEffect(() => {
    if (demo) return;
    let vivo = true;
    fetch(`/api/blogs/noticias?blogId=${blogId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(mensagemDeErro(d, "Não foi possível ler as fontes agora."));
        return d as RespostaNoticias;
      })
      .then((d) => {
        if (!vivo) return;
        // Blog sem feed não volta na lista do servidor: é um grupo vazio.
        setGrupo(d.blogs[0] ?? { blogId, blogNome: "", feeds: 0, lidos: 0, itens: [] });
      })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [blogId, demo, recarga]);

  const reler = useCallback(() => {
    if (demo) return;
    setGrupo(null);
    setErro(null);
    setRecarga((n) => n + 1);
  }, [demo]);

  const gerando = Object.values(fases).filter((f) => f.estado === "gerando").length;

  // Fechar a aba no meio da geração perde o aviso (a rota termina no servidor,
  // mas ninguém vê o artigo chegar nesta tela).
  useEffect(() => {
    if (!gerando) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [gerando]);

  const tirarDaLista = useCallback((link: string) => {
    setGrupo((g) => (g ? { ...g, itens: g.itens.map((i) => (i.link === link ? { ...i, artigoId: -1 } : i)) } : g));
    setFases((f) => {
      const resto = { ...f };
      delete resto[link];
      return resto;
    });
  }, []);

  const gerar = useCallback(
    (item: ItemPauta) => {
      setFases((f) => ({ ...f, [item.link]: { estado: "gerando", desde: Date.now() } }));
      const falhar = (mensagem: string) =>
        setFases((f) => ({ ...f, [item.link]: { estado: "erro", mensagem } }));

      if (demo) {
        setTimeout(() => {
          tirarDaLista(item.link);
          aoGerarRef.current(artigoDeDemonstracao(blogId, item));
        }, 2400);
        return;
      }

      fetch("/api/blogs/noticias/gerar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blogId, link: item.link, titulo: item.titulo }),
      })
        .then(async (r) => {
          const dados = await r.json().catch(() => null);
          if (!r.ok) return falhar(mensagemDeErro(dados, "Não foi possível gerar o artigo."));
          tirarDaLista(item.link);
          aoGerarRef.current((dados as { artigo: Artigo }).artigo);
        })
        .catch(() => falhar("Falha de rede ao gerar o artigo. Tente de novo."));
    },
    [blogId, demo, tirarDaLista],
  );

  const itens = grupo ? grupo.itens.filter((i) => i.artigoId === null) : null;

  return {
    itens,
    feeds: grupo?.feeds ?? 0,
    usadas: grupo ? grupo.itens.length - (itens?.length ?? 0) : 0,
    lidos: grupo?.lidos ?? 0,
    erro,
    fases,
    gerando,
    reler,
    gerar,
  };
}

/** O artigo que a demonstração "gera": a notícia vira um rascunho plausível. */
function artigoDeDemonstracao(blogId: number, item: ItemPauta): Artigo {
  const agora = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    id: -Date.now(),
    blog_id: blogId,
    titulo: item.titulo,
    slug: "",
    meta_title: item.titulo.slice(0, 60),
    meta_description: "",
    palavra_chave: "",
    keywords: "",
    resumo: "Rascunho de demonstração: na tela de verdade, aqui vem a chamada que a IA escreveu a partir da matéria.",
    conteudo: "## Demonstração\n\nNa tela de verdade, aqui vem o artigo inteiro.",
    imagem_alt: "",
    status: "pendente",
    fonte_titulo: item.titulo,
    fonte_url: item.link,
    created_at: agora,
    updated_at: agora,
  };
}
