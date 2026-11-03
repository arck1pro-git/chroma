"use client";

// Ler de novo: refaz a página no servidor. As sondas da Anthropic e da Groq
// voltam guardadas por alguns minutos (lib/infra-ia.ts), e o cartão diz a hora.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "@/app/components/icones";

export default function BotaoAtualizar() {
  const router = useRouter();
  const [lendo, iniciar] = useTransition();
  return (
    <button
      type="button"
      onClick={() => iniciar(() => router.refresh())}
      disabled={lendo}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {lendo ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
      {lendo ? "Lendo…" : "Atualizar"}
    </button>
  );
}
