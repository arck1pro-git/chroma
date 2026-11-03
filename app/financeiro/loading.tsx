import { Loader2 } from "@/app/components/icones";

// O ponto vem de outra base a cada abertura: enquanto isso, o esqueleto da aba.
export default function CarregandoFinanceiro() {
  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Financeiro</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Lendo o app de ponto…
          </p>
        </header>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
      </div>
    </div>
  );
}
