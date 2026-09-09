import type { LucideIcon } from "lucide-react";

// Cartão de métrica das faixas de topo (lista de contatos e tela inicial).
// `ordem` escalona o fade: cada cartão entra 26ms depois do anterior, então a
// faixa assenta da esquerda pra direita em vez de piscar inteira de uma vez.
//
// O funil tem um indicador próprio, em tira horizontal — lá a faixa divide o
// espaço com o quadro e um cartão desta altura empurraria o kanban pra baixo.
export default function Indicador({
  Icone,
  rotulo,
  valor,
  detalhe,
  ordem,
}: {
  Icone: LucideIcon;
  rotulo: string;
  valor: string;
  detalhe: string;
  ordem: number;
}) {
  return (
    <div
      style={{ animationDelay: `${ordem * 26}ms` }}
      className="surge rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
        <Icone className="size-3.5" aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {rotulo}
        </span>
      </div>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
        {valor}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {detalhe}
      </p>
    </div>
  );
}
