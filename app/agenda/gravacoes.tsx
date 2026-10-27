"use client";

// A gaveta "Gravações" da Agenda: todas as reuniões gravadas no Meet da conta
// meet@arck1pro.com (lib/gravacoes.ts), da mais nova para a mais antiga, com
// busca pelo nome. Clicar abre o visor — vídeo e anotações do Gemini.
import { useEffect, useMemo, useState } from "react";
import type { Gravacao } from "@/lib/gravacoes";
import { FileText, Search, Sparkles, Video, X } from "@/app/components/icones";
import { listarGravacoes, type ListaDeGravacoes } from "../gravacoes/acoes";
import { BotaoIcone, Carregando, CascaGaveta, CorpoGaveta, IconeLinha, LINHA, Vazio } from "../components/gaveta";
import VisorGravacao, { quandoDaGravacao, tituloDaGravacao } from "../components/visor-gravacao";

const fmtMes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long", year: "numeric" });

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export default function GavetaGravacoes({ aoFechar }: { aoFechar: () => void }) {
  const [resposta, setResposta] = useState<ListaDeGravacoes | null>(null);
  const [termo, setTermo] = useState("");
  const [visor, setVisor] = useState<Gravacao | null>(null);

  useEffect(() => {
    let vivo = true;
    listarGravacoes()
      .then((r) => vivo && setResposta(r))
      .catch(() => vivo && setResposta({ ok: false, mensagem: "Não foi possível ler as gravações agora." }));
    return () => {
      vivo = false;
    };
  }, []);

  // Esc fecha a gaveta — mas com o visor aberto a tecla é dele (ele a para
  // na captura da janela, antes de chegar aqui).
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const grupos = useMemo(() => {
    if (!resposta?.ok) return [];
    const busca = normalizar(termo.trim());
    const lista = busca ? resposta.gravacoes.filter((g) => normalizar(tituloDaGravacao(g)).includes(busca)) : resposta.gravacoes;
    const porMes = new Map<string, Gravacao[]>();
    for (const g of lista) {
      const mes = fmtMes.format(new Date(g.inicio));
      porMes.set(mes, [...(porMes.get(mes) ?? []), g]);
    }
    return [...porMes.entries()];
  }, [resposta, termo]);

  const total = resposta?.ok ? resposta.gravacoes.length : 0;

  return (
    <CascaGaveta
      rotulo="Gravações do Meet"
      aoFechar={aoFechar}
      depois={visor && <VisorGravacao gravacao={visor} aoFechar={() => setVisor(null)} />}
    >
      <header className="shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Gravações</h2>
          {total > 0 && <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">{total}</span>}
          <BotaoIcone Icone={X} rotulo="Fechar gravações" onClick={aoFechar} className="-mr-2 ml-auto" />
        </div>
        <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">As reuniões gravadas no Meet da conta meet@arck1pro.com.</p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar pelo nome da reunião ou do lead"
            aria-label="Buscar gravação"
            autoFocus
            className="w-full rounded-xl bg-zinc-100 py-2.5 pl-9 pr-3 text-[13.5px] text-zinc-900 outline-none ring-1 ring-inset ring-transparent transition placeholder:text-zinc-400 focus:bg-white focus:ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:bg-zinc-950 dark:focus:ring-zinc-700"
          />
        </div>
      </header>

      <CorpoGaveta>
        {!resposta ? (
          <div className="px-5 pt-2">
            <Carregando />
          </div>
        ) : !resposta.ok ? (
          <div className="px-5 pt-2">
            <Vazio>{resposta.mensagem}</Vazio>
          </div>
        ) : grupos.length === 0 ? (
          <div className="px-5 pt-2">
            <Vazio>{termo ? "Nenhuma gravação com esse nome." : "Nenhuma gravação na pasta do Meet."}</Vazio>
          </div>
        ) : (
          grupos.map(([mes, lista]) => (
            <section key={mes} className="px-5 pt-3">
              <h3 className="sticky top-0 z-10 -mx-5 bg-white/95 px-5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400 backdrop-blur dark:bg-zinc-950/95 dark:text-zinc-500">
                {mes} <span className="font-medium tabular-nums text-zinc-300 dark:text-zinc-600">{lista.length}</span>
              </h3>
              <ul className="flex flex-col">
                {lista.map((g) => (
                  <li key={g.id}>
                    <button type="button" onClick={() => setVisor(g)} className={LINHA}>
                      <IconeLinha Icone={g.videoId ? Video : FileText} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[13px] font-medium ${g.titulo ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"}`}>
                          {tituloDaGravacao(g)}
                        </span>
                        <span className="block truncate text-[11.5px] tabular-nums text-zinc-500 dark:text-zinc-400">
                          {quandoDaGravacao(g, false)}
                        </span>
                      </span>
                      {g.notasId && (
                        <span title="Tem resumo do Gemini" className="shrink-0 text-violet-500 dark:text-violet-400">
                          <Sparkles className="size-3.5" aria-label="Tem resumo do Gemini" />
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </CorpoGaveta>
    </CascaGaveta>
  );
}
