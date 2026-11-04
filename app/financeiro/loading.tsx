import { Loader2 } from "@/app/components/icones";
import { CabecalhoFinanceiro, PAGINA } from "./comum";

// O ponto vem de outra base a cada abertura: enquanto isso, o esqueleto da
// página (o cabeçalho, a folha e o ponto embaixo).
export default function CarregandoFinanceiro() {
  const bloco = "animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-8">
      <div className={PAGINA}>
        <CabecalhoFinanceiro
          legenda={
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Lendo o app de ponto…
            </span>
          }
        />
        <div className={`h-96 ${bloco}`} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`h-20 ${bloco}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
