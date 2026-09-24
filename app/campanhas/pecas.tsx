import type { LucideIcon } from "lucide-react";
import { TriangleAlert } from "lucide-react";

// As peças que as telas de Campanhas repetem: tokens de campo e botão, os
// códigos da Meta em português e os dois avisos. Cada painel trazia a própria
// cópia e elas já tinham divergido — canto arredondado, tamanho de texto e
// "OUTCOME_LEADS" cru num lugar e traduzido no outro.
//
// Os valores seguem o que o resto do sistema usa (app/components/filtros-ui.tsx
// e a lista de contatos): canto lg, 13px nos controles e zinc no lugar de uma
// cor de acento só desta tela.

export const campoAds =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-100/10";

export const botaoAds =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

export const botaoPrincipalAds =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

// Aba, igual à do painel de artigo e à do configurador de webhooks.
export const abaAds = "rounded-t-lg border-b-2 px-3 py-2 text-[12px] transition";
export const abaAtivaAds = "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-50 dark:text-zinc-50";
export const abaInativaAds = "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50";

// Cabeçalho de coluna, igual ao da tabela de contatos.
export const rotuloColuna = "text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";

export const objetivos: Record<string, string> = {
  OUTCOME_AWARENESS: "Reconhecimento", OUTCOME_TRAFFIC: "Tráfego", OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_LEADS: "Leads", OUTCOME_SALES: "Vendas", OUTCOME_APP_PROMOTION: "Aplicativo",
};

// effective_status da Meta. O código cru é a última saída, não o primeiro
// recurso: "ADSET_PAUSED" numa lista em português não diz nada a quem lê.
const entregas: Record<string, string> = {
  ACTIVE: "Ativa", PAUSED: "Pausada", CAMPAIGN_PAUSED: "Campanha pausada", ADSET_PAUSED: "Conjunto pausado",
  ARCHIVED: "Arquivada", DELETED: "Excluída", IN_PROCESS: "Em processamento", WITH_ISSUES: "Com problemas",
  DISAPPROVED: "Reprovada", PENDING_REVIEW: "Em análise", PREAPPROVED: "Pré-aprovada", PENDING_BILLING_INFO: "Aguardando pagamento",
};
export const entregaLegivel = (status?: string) => (status && entregas[status]) || status || "—";

export function Aviso({ texto, detalhe, erro }: { texto: string; detalhe?: string; erro?: boolean }) {
  return (
    <div
      role={erro ? "alert" : "status"}
      className={`flex gap-2 rounded-lg border p-3 text-[12px] leading-relaxed ${
        erro
          ? "border-red-300 bg-red-50/60 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          : "border-amber-300 bg-amber-50/60 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
      }`}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div>
        {texto}
        {detalhe && <p className="mt-1 opacity-75">{detalhe}</p>}
      </div>
    </div>
  );
}

export function Vazio({ Icone, texto, girando }: { Icone: LucideIcon; texto: string; girando?: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
      <Icone className={`size-5 text-zinc-400 ${girando ? "animate-spin" : ""}`} aria-hidden="true" />
      <p className="mt-2 text-[12px] text-zinc-500">{texto}</p>
    </div>
  );
}
