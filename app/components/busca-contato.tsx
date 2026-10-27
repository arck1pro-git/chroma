"use client";

// Escolher UM contato pesquisando — o seletor da nova oportunidade. Era um menu
// com uma opção por contato da base; com os ~27 mil leads do SprintHub isso
// deixou de caber na tela e na página (pedido dele, 2026-10-15: contato só
// aparece quando é pesquisado). A busca é a mesma da gaveta de contatos
// (buscarContatos → lib/contatos-busca.ts).
import { useEffect, useState } from "react";
import type { ContatoEncontrado } from "@/lib/contatos-busca";
import { MIN_DIGITOS, MIN_LETRAS, prepararTermo } from "@/lib/contatos-termo";
import { Loader2, Search, User, X } from "./icones";
import { buscarContatos } from "../contatos/actions";

export type ContatoEscolhido = { id: string; nome: string; detalhe?: string };

const ESPERA_DIGITACAO_MS = 300;

export default function BuscaContato({
  valor,
  aoMudar,
  className = "",
}: {
  valor: ContatoEscolhido | null;
  aoMudar: (contato: ContatoEscolhido | null) => void;
  className?: string;
}) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<{ termo: string; lista: ContatoEncontrado[] } | null>(null);
  const podeBuscar = prepararTermo(termo) !== null;
  const lista = podeBuscar && achados?.termo === termo ? achados.lista : null;

  useEffect(() => {
    if (!podeBuscar) return;
    let vivo = true;
    const espera = setTimeout(() => {
      buscarContatos(termo)
        .then((r) => vivo && setAchados({ termo, lista: r }))
        .catch(() => vivo && setAchados({ termo, lista: [] }));
    }, ESPERA_DIGITACAO_MS);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [termo, podeBuscar]);

  if (valor) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-900 ${className}`}>
        <User className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{valor.nome}</span>
          {valor.detalhe && <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{valor.detalhe}</span>}
        </span>
        <button
          type="button"
          onClick={() => aoMudar(null)}
          aria-label="Trocar contato"
          title="Trocar contato"
          className="shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Pesquisar por nome, e-mail ou telefone…"
          aria-label="Pesquisar contato"
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-2.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10"
        />
      </div>
      {termo.trim() && (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          {!podeBuscar ? (
            <p className="px-3 py-2.5 text-[12px] text-zinc-500 dark:text-zinc-400">
              Continue digitando: {MIN_LETRAS} letras ou {MIN_DIGITOS} números.
            </p>
          ) : !lista ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-zinc-500 dark:text-zinc-400">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Procurando…
            </p>
          ) : lista.length === 0 ? (
            <p className="px-3 py-2.5 text-[12px] text-zinc-500 dark:text-zinc-400">Nenhum contato com esse termo.</p>
          ) : (
            <ul>
              {lista.map((c) => {
                const detalhe = c.whatsapp || c.email || "";
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        aoMudar({ id: c.id, nome: c.nome, detalhe });
                        setTermo("");
                      }}
                      className="flex w-full flex-col px-3 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      <span className="truncate text-[13px] text-zinc-900 dark:text-zinc-50">{c.nome}</span>
                      {detalhe && <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{detalhe}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
