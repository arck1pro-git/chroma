"use client";

// O painel de RSS, aberto POR CIMA da tela pelo botão "RSS" da coluna da
// direita. É configuração que se mexe uma vez, não a cada visita: ocupar altura
// fixa ao lado das notícias custaria espaço todo dia por uma visita a cada mês.
//
// Monta só quando abre — por isso a busca é no `useEffect` normal, sem guarda:
// quem decide quando consultar é quem decide quando montar.
//
// O que ele controla: até 5 feeds e o interruptor da geração automática. Toda
// segunda às 8h um workflow do n8n pergunta ao CRM quais notícias desses feeds
// ainda não viraram artigo e manda gerar 10 por blog.
import { useEffect, useState } from "react";
import { Rss } from "lucide-react";
import { Balao, CabecalhoFolha } from "./pecas";

const MAX_FEEDS = 5;

interface EstadoRss {
  rss_ativo: boolean;
  feeds: { id: number; url: string }[];
}

export default function PainelRss({
  blogId,
  aoFechar,
}: {
  blogId: number;
  aoFechar: () => void;
}) {
  const [carregado, setCarregado] = useState(false);
  const [ativo, setAtivo] = useState(false);
  // Sempre 5 campos na tela: um vazio a mais convida a adicionar, e some do que
  // é salvo. Guardar uma lista curta e um botão "+" seria mais estado para o
  // mesmo resultado.
  const [urls, setUrls] = useState<string[]>(Array(MAX_FEEDS).fill(""));
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/blogs/${blogId}/rss`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("falhou"))))
      .then((d: EstadoRss) => {
        if (!vivo) return;
        setAtivo(d.rss_ativo);
        const lista = d.feeds.map((f) => f.url);
        setUrls([
          ...lista,
          ...Array(Math.max(0, MAX_FEEDS - lista.length)).fill(""),
        ]);
      })
      .catch(() => vivo && setErro("Não foi possível carregar os feeds."))
      .finally(() => vivo && setCarregado(true));
    return () => {
      vivo = false;
    };
  }, [blogId]);

  async function salvar(novoAtivo = ativo) {
    setSalvando(true);
    setErro(null);

    const r = await fetch(`/api/blogs/${blogId}/rss`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rss_ativo: novoAtivo,
        feeds: urls.map((u) => u.trim()).filter(Boolean),
      }),
    });
    const dados = await r.json();
    setSalvando(false);

    if (!r.ok) {
      setErro(dados.error ?? "Não foi possível salvar.");
      // Reverte o interruptor: ligar sem feed é recusado pela API, e o botão
      // não pode ficar mostrando "ligado" com o servidor dizendo que não.
      setAtivo(ativo);
      return;
    }

    setAtivo((dados as EstadoRss).rss_ativo);
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2000);
  }

  return (
    <Balao rotulo="RSS" medida="w-[min(34rem,90vw)]" aoFechar={aoFechar}>
      <CabecalhoFolha icone={Rss} titulo="RSS" aoFechar={aoFechar} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Até {MAX_FEEDS} endereços de RSS. Toda segunda às 8h a automação lê
            os feeds, descarta o que já virou artigo e gera 10 artigos novos
            como pendentes, usando a auditoria deste blog.
          </p>

          {!carregado ? (
            <div className="h-32 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {urls.map((url, i) => (
                  <input
                    key={i}
                    value={url}
                    onChange={(e) =>
                      setUrls((atuais) =>
                        atuais.map((u, j) => (j === i ? e.target.value : u)),
                      )
                    }
                    placeholder={`https://site.com.br/feed  (${i + 1}º)`}
                    className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 font-mono text-[12px] text-zinc-900 outline-none transition placeholder:font-sans placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* O interruptor SALVA junto: separar "ligar" de "salvar"
                    deixaria ligar um conjunto de feeds que ainda não está no
                    banco, e a automação leria outra coisa na segunda. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={ativo}
                  disabled={salvando}
                  onClick={() => {
                    const novo = !ativo;
                    setAtivo(novo);
                    salvar(novo);
                  }}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                    ativo
                      ? "bg-emerald-600"
                      : "bg-zinc-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${ativo ? "left-[22px]" : "left-0.5"}`}
                  />
                </button>
                <span className="text-[12px] text-zinc-600 dark:text-zinc-400">
                  {ativo ? "Geração automática ligada" : "Geração automática desligada"}
                </span>

                <button
                  type="button"
                  onClick={() => salvar()}
                  disabled={salvando}
                  className="ml-auto rounded-full bg-zinc-900 px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {salvando ? "Salvando…" : salvo ? "Salvo!" : "Salvar feeds"}
                </button>
              </div>
            </>
          )}

          {erro && (
            <p className="text-[12px] text-red-600 dark:text-red-400">{erro}</p>
          )}
      </div>
    </Balao>
  );
}
