"use client";

// A URL de conexão do blog: o que se cola no site do cliente.
//
// ABRE POR CIMA DA TELA, a partir do botão "Conexão" da coluna da direita. É
// configuração que se copia uma vez e se esquece — ocupar altura fixa ao lado
// das notícias seria pagar espaço todo dia por uma visita a cada mês. Mostra só
// o endereço; o COMO usar está no prompt de implementação, que vai inteiro para
// a IA que escrever o site.
//
// A CHAVE É O SEGREDO E FICA VISÍVEL. Não há como esconder: quem configura o
// site precisa copiá-la. O que existe é o botão de trocar, para quando ela
// vazar — e ele avisa que a URL antiga morre na hora.
import { useState } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import type { Blog } from "@/lib/artigo";
import { promptDeImplementacao, urlDeConexao } from "@/lib/blog-conexao";
import { Balao, CabecalhoFolha } from "./pecas";

export default function PainelConexao({
  blog,
  base,
  basePublica,
  aoFechar,
  aoTrocarChave,
}: {
  blog: Blog;
  /** Endereço deste CRM, do request (lib/endereco.ts). Sem barra no fim. */
  base: string;
  /** false em localhost/rede local: a URL existe, mas não sai daqui. */
  basePublica: boolean;
  aoFechar: () => void;
  aoTrocarChave: (b: Blog) => void;
}) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [armado, setArmado] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const url = urlDeConexao(base, blog.chave);

  async function copiar(qual: string, texto: string) {
    await navigator.clipboard.writeText(texto);
    setCopiado(qual);
    setTimeout(() => setCopiado(null), 2000);
  }

  async function trocar() {
    setTrocando(true);
    setErro(null);

    const r = await fetch(`/api/blogs/${blog.id}/chave`, { method: "POST" });
    const dados = await r.json().catch(() => ({}));
    setTrocando(false);
    setArmado(false);

    if (!r.ok) {
      setErro(dados.error ?? "Não foi possível trocar a chave.");
      return;
    }
    aoTrocarChave(dados as Blog);
  }

  return (
    <Balao rotulo="Conexão com o site" medida="w-[min(30rem,90vw)]" aoFechar={aoFechar}>
      <CabecalhoFolha
        icone={Link2}
        titulo="Conexão com o site"
        aoFechar={aoFechar}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              URL do blog
            </span>
            <button
              type="button"
              onClick={() => copiar("url", url)}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              {copiado === "url" ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <Copy className="size-3" aria-hidden="true" />
              )}
              {copiado === "url" ? "Copiado!" : "Copiar"}
            </button>
          </div>

          {/* `break-all`: a chave é uma palavra só de 35 caracteres e
              estouraria a coluna. Quebrar em qualquer ponto é feio e é o certo
              — o endereço inteiro tem que ficar visível para conferência. */}
          <code className="mt-1 block break-all rounded-xl bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {url}
          </code>

          {!basePublica && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Este endereço é local: serve para testar com curl, mas nenhum site
              na internet alcança. Em produção a URL nasce com o domínio certo.
            </p>
          )}

          {/* O prompt é a documentação DE VERDADE desta integração: ele explica
              a lista, a consulta por slug e o que não fazer. Cabe num clique
              porque quem vai implementar é uma IA no editor de quem faz o
              site. */}
          <button
            type="button"
            onClick={() =>
              copiar("prompt", promptDeImplementacao(blog, base))
            }
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-zinc-900 px-3 py-2 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {copiado === "prompt" ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copiado === "prompt"
              ? "Prompt copiado!"
              : "Copiar prompt de implementação"}
          </button>

          {erro && (
            <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
              {erro}
            </p>
          )}

          <button
            type="button"
            disabled={trocando}
            onBlur={() => setArmado(false)}
            onClick={() => (armado ? trocar() : setArmado(true))}
            className={`mt-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
              armado
                ? "bg-red-600 text-white hover:bg-red-700"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            }`}
          >
            <RefreshCw className="size-3 shrink-0" aria-hidden="true" />
            {trocando
              ? "Trocando…"
              : armado
                ? "Trocar e derrubar a URL atual"
                : "Trocar chave"}
          </button>
      </div>
    </Balao>
  );
}
