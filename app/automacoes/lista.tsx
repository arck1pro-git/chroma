"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, Plus, Search, SearchX, Workflow } from "lucide-react";
import { criarFluxo } from "./acoes";
import { normalizar } from "../filtros-comuns";
import { dataCurta } from "../formato";
import type { EstadoFluxo, Fluxo } from "./dados";

const SELO: Record<EstadoFluxo, { rotulo: string; classe: string }> = {
  publicado: {
    rotulo: "Publicado",
    classe:
      "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  },
  pausado: {
    rotulo: "Pausado",
    classe:
      "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  },
  rascunho: {
    rotulo: "Rascunho",
    classe:
      "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
  },
  arquivado: {
    rotulo: "Arquivado",
    classe:
      "bg-zinc-100 text-zinc-400 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-500 dark:ring-zinc-800",
  },
};

function Cartao({
  fluxo,
  ordem,
  aberto,
}: {
  fluxo: Fluxo;
  ordem: number;
  aberto: boolean;
}) {
  const selo = SELO[fluxo.estado];

  return (
    <Link
      href={`/automacoes?fluxo=${fluxo.id}`}
      scroll={false}
      aria-current={aberto ? "true" : undefined}
      style={{ animationDelay: `${Math.min(ordem, 6) * 26}ms` }}
      className={`surge block rounded-lg border p-3 outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
        aberto
          ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-950"
          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
      }`}
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          {fluxo.nome}
        </h2>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${selo.classe}`}
        >
          {selo.rotulo}
        </span>
      </div>

      {fluxo.descricao && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {fluxo.descricao}
        </p>
      )}

      {/* Só o que ajuda a ESCOLHER qual abrir. O detalhe completo vive no
          painel à direita, então repetir aqui seria ruído. */}
      <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
        <LogIn className="size-2.5 shrink-0" aria-hidden="true" />
        v{fluxo.numero_versao ?? 1}
        <span aria-hidden="true">·</span>
        {dataCurta(fluxo.data_atualizacao)}
        {fluxo.execucoes_14d > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{fluxo.execucoes_14d} exec.</span>
          </>
        )}
        {fluxo.erros_14d > 0 && (
          <span className="tabular-nums text-rose-600 dark:text-rose-400">
            {fluxo.erros_14d} erro{fluxo.erros_14d > 1 ? "s" : ""}
          </span>
        )}
      </p>
    </Link>
  );
}

export default function ListaFluxos({
  fluxos,
  selecionadoId,
}: {
  fluxos: Fluxo[];
  selecionadoId: string | null;
}) {
  const [termo, setTermo] = useState("");
  const [criando, iniciar] = useTransition();
  const router = useRouter();

  // Cria e já abre o builder: um fluxo vazio na lista não serve para nada, o
  // próximo passo do usuário é sempre desenhar.
  function novo() {
    iniciar(async () => {
      const id = await criarFluxo("Novo fluxo", "oportunidade");
      router.push(`/automacoes/${id}`);
    });
  }

  const visiveis = useMemo(() => {
    const t = normalizar(termo.trim());
    if (!t) return fluxos;
    return fluxos.filter((f) =>
      normalizar(`${f.nome} ${f.descricao ?? ""}`).includes(t),
    );
  }, [fluxos, termo]);

  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-zinc-200 lg:w-[22rem] dark:border-zinc-800">
      <header className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Automações
            </h1>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {fluxos.length} fluxos ·{" "}
              {fluxos.filter((f) => f.estado === "publicado").length} publicados
            </p>
          </div>
          <button
            type="button"
            onClick={novo}
            disabled={criando}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {criando ? "Criando…" : "Novo"}
          </button>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar automação…"
            aria-label="Buscar automação"
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-[12px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {fluxos.length === 0 ? (
          <div className="surge flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Workflow
              className="size-6 text-zinc-300 dark:text-zinc-700"
              aria-hidden="true"
            />
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
              Nenhuma automação ainda
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Crie um fluxo, desenhe os blocos e publique no motor.
            </p>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="surge flex flex-col items-center gap-2 py-16 text-center">
            <SearchX
              className="size-6 text-zinc-300 dark:text-zinc-700"
              aria-hidden="true"
            />
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
              Nenhuma com “{termo}”
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visiveis.map((f, i) => (
              <Cartao
                key={f.id}
                fluxo={f}
                ordem={i}
                aberto={f.id === selecionadoId}
              />
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 border-t border-zinc-200 px-4 py-2 text-[10px] leading-snug text-amber-700 dark:border-zinc-800 dark:text-amber-500">
        Publicar cria workflow real no n8n compartilhado da empresa. O CRM ainda
        não tem autenticação.
      </p>
    </aside>
  );
}
