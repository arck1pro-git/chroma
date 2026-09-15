"use client";

// A coluna da esquerda: as webhooks cadastradas. Mesma forma da lista de
// /automacoes — cartão clicável, seleção na URL, busca no topo.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  SearchX,
  TriangleAlert,
  Webhook as WebhookIcon,
} from "lucide-react";
import { criarWebhook } from "./acoes";
import { normalizar } from "../filtros-comuns";
import { dataCurta } from "../formato";
import { NOME_PADRAO, type Webhook } from "@/lib/webhooks";

function Cartao({
  webhook,
  ordem,
  aberto,
}: {
  webhook: Webhook;
  ordem: number;
  aberto: boolean;
}) {
  return (
    <Link
      href={`/webhooks?webhook=${webhook.id}`}
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
          {webhook.nome}
        </h2>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
            webhook.ativo
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
              : "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
          }`}
        >
          {webhook.ativo ? "Ativa" : "Desligada"}
        </span>
      </div>

      {webhook.descricao && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {webhook.descricao}
        </p>
      )}

      {/* Só o que ajuda a ESCOLHER qual abrir. Recebidos em 7 dias é o número
          que responde "essa está funcionando?" de relance. */}
      <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
        <WebhookIcon className="size-2.5 shrink-0" aria-hidden="true" />
        {webhook.total_campos} campo{webhook.total_campos === 1 ? "" : "s"}
        <span aria-hidden="true">·</span>
        {webhook.total_acoes} aç{webhook.total_acoes === 1 ? "ão" : "ões"}
        <span aria-hidden="true">·</span>
        {dataCurta(webhook.data_criacao)}
        {webhook.recebidos_7d > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{webhook.recebidos_7d} em 7d</span>
          </>
        )}
        {webhook.erros_7d > 0 && (
          <span className="tabular-nums text-rose-600 dark:text-rose-400">
            {webhook.erros_7d} com erro
          </span>
        )}
      </p>
    </Link>
  );
}

export default function ListaWebhooks({
  webhooks,
  selecionadoId,
}: {
  webhooks: Webhook[];
  selecionadoId: string | null;
}) {
  const [termo, setTermo] = useState("");
  const [criando, iniciar] = useTransition();
  const router = useRouter();

  // Cria e já abre: uma webhook sem campo nenhum não serve para nada, e o
  // painel abre direto no primeiro passo que falta — que é dar nome a ela.
  function nova() {
    iniciar(async () => {
      const id = await criarWebhook(NOME_PADRAO);
      router.push(`/webhooks?webhook=${id}`);
    });
  }

  const visiveis = useMemo(() => {
    const t = normalizar(termo.trim());
    if (!t) return webhooks;
    return webhooks.filter((w) =>
      normalizar(`${w.nome} ${w.descricao ?? ""} ${w.slug}`).includes(t),
    );
  }, [webhooks, termo]);

  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-zinc-200 lg:w-[22rem] dark:border-zinc-800">
      <header className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Webhooks
            </h1>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {webhooks.length} captaç{webhooks.length === 1 ? "ão" : "ões"} ·{" "}
              {webhooks.filter((w) => w.ativo).length} ativa
              {webhooks.filter((w) => w.ativo).length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={nova}
            disabled={criando}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {criando ? "Criando…" : "Nova"}
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
            placeholder="Buscar webhook…"
            aria-label="Buscar webhook"
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-[12px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {webhooks.length === 0 ? (
          <div className="surge flex flex-col items-center gap-2 px-4 py-16 text-center">
            <WebhookIcon
              className="size-6 text-zinc-300 dark:text-zinc-700"
              aria-hidden="true"
            />
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
              Nenhuma webhook ainda
            </p>
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Crie uma por origem de captação — site, landing page, anúncio —,
              declare os campos que ela recebe e copie o prompt para quem vai
              implementar do outro lado.
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
            {visiveis.map((w, i) => (
              <Cartao
                key={w.id}
                webhook={w}
                ordem={i}
                aberto={w.id === selecionadoId}
              />
            ))}
          </div>
        )}
      </div>

      <p className="flex shrink-0 items-start gap-1.5 border-t border-zinc-200 px-4 py-2.5 text-[11px] leading-snug text-amber-700 dark:border-zinc-800 dark:text-amber-500">
        <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span>
          O segredo vai na URL. Chame de um servidor (backend, n8n, Zapier) —
          nunca de JavaScript de página pública.
        </span>
      </p>
    </aside>
  );
}
