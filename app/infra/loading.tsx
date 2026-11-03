import { Loader2 } from "@/app/components/icones";

// A tela pergunta a cada serviço na hora (até ~20 s no pior caso): enquanto
// isso, o esqueleto dos cartões.
export default function CarregandoInfra() {
  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Infra</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Perguntando a cada serviço como está o uso…
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    </div>
  );
}
