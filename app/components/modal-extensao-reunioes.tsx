"use client";

// Instalar a extensão de reuniões pelo CRM (pedido dele em 2026-10-30: "um
// botão ao clicar no nome do usuário na barra lateral"). Abre pelo menu da
// conta (./sidebar.tsx).
//
// O Chrome não deixa um site instalar extensão: desde 2018 só a Chrome Web
// Store instala com um clique. Enquanto a extensão não está publicada lá, o
// modal baixa o .zip pronto (app/api/extensao-reunioes) e mostra os passos de
// "Carregar sem compactação". Publicada (de preferência como "não listada"),
// basta pôr o endereço da loja em URL_CHROME_WEB_STORE: o modal passa a ser um
// botão "Adicionar ao Chrome".
//
// chrome://extensions não abre por link de página (o navegador bloqueia), por
// isso o passo 3 copia o endereço para colar.
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Download, ExternalLink, Puzzle, X } from "./icones";

/** O endereço da extensão na Chrome Web Store, quando publicada; null = instalar pelo .zip. */
const URL_CHROME_WEB_STORE: string | null = null;

const ENDERECO_EXTENSOES = "chrome://extensions";

export default function ModalExtensaoReunioes({ aoFechar }: { aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(ENDERECO_EXTENSOES);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem acesso à área de transferência, o endereço continua escrito ao lado.
    }
  }

  const passos: Array<{ titulo: string; texto: ReactNode }> = [
    {
      titulo: "Baixe a extensão",
      texto: (
        <a
          href="/api/extensao-reunioes"
          download
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3.5 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Download className="size-3.5" aria-hidden="true" />
          Baixar a extensão (.zip)
        </a>
      ),
    },
    {
      titulo: "Descompacte o arquivo",
      texto: (
        <>
          Clique com o botão direito no arquivo baixado e escolha <strong className="font-medium">Extrair tudo</strong>. Fica a
          pasta <span className="font-mono text-[12px]">amaanoffice-reunioes</span>.
        </>
      ),
    },
    {
      titulo: "Abra as extensões do Chrome",
      texto: (
        <>
          Cole{" "}
          <button
            type="button"
            onClick={copiar}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-1.5 py-0.5 font-mono text-[12px] text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Copiar o endereço"
          >
            {ENDERECO_EXTENSOES}
            {copiado ? <Check className="size-3 text-emerald-600" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
          </button>{" "}
          na barra de endereço e ligue o <strong className="font-medium">Modo do desenvolvedor</strong>, no canto de cima.
        </>
      ),
    },
    {
      titulo: "Carregue a pasta",
      texto: (
        <>
          Clique em <strong className="font-medium">Carregar sem compactação</strong> e escolha a pasta{" "}
          <span className="font-mono text-[12px]">amaanoffice-reunioes</span>.
        </>
      ),
    },
    {
      titulo: "Fixe o ícone",
      texto: (
        <>
          Na peça de quebra-cabeça ao lado do endereço, fixe o <strong className="font-medium">AmaanOffice · Reuniões</strong>.
          Na reunião do Meet ou do Zoom, clique nele (ou <span className="font-mono text-[12px]">Alt+Shift+G</span>).
        </>
      ),
    },
  ];

  return (
    <>
      <div className="veu-surge fixed inset-0 z-40 bg-zinc-900/30 dark:bg-black/50" onClick={aoFechar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Extensão de reuniões"
        className="surge fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800"
      >
        <header className="flex items-start gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
            <Puzzle className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-zinc-950 dark:text-zinc-50">Extensão de reuniões</h2>
            <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
              Grava a reunião do Meet ou do Zoom no navegador e mostra sugestões de condução enquanto o lead fala.
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-950 transition hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {URL_CHROME_WEB_STORE ? (
          <div className="flex flex-col items-start gap-2 px-5 py-5">
            <a
              href={URL_CHROME_WEB_STORE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Adicionar ao Chrome
            </a>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Abre a Chrome Web Store. Depois, fixe o ícone na barra.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3.5 px-5 py-4">
            {passos.map((p, i) => (
              <li key={p.titulo} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11.5px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                  {i + 1}
                </span>
                <div className="min-w-0 pt-0.5 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <p className="font-medium text-zinc-950 dark:text-zinc-50">{p.titulo}</p>
                  {p.texto}
                </div>
              </li>
            ))}
          </ol>
        )}

        <footer className="border-t border-zinc-200 px-5 py-3 text-[11.5px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Funciona no Chrome do computador, com o login do AmaanOffice neste navegador.
          {!URL_CHROME_WEB_STORE && " Para atualizar, baixe de novo, troque a pasta e clique em ↻ na extensão."}
        </footer>
      </div>
    </>
  );
}
