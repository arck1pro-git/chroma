// O que as partes do Financeiro usam igual: o endereço com o mês e a pessoa na
// URL, a navegação de mês, os cartões e os formatos.
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "@/app/components/icones";

export const cartao = "rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

/** 452 (minutos) → "7h32". */
export function horas(minutos: number): string {
  const m = Math.round(minutos);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** "2026-11" → "Novembro de 2026". */
export function nomeDoMes(mes: string): string {
  const nome = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-01T12:00:00Z`));
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** /financeiro?mes=…&pessoa=… */
export function endereco(mes: string, pessoaId: string | null = null): string {
  const q = new URLSearchParams({ mes });
  if (pessoaId) q.set("pessoa", pessoaId);
  return `/financeiro?${q}`;
}

export function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className={`${cartao} px-4 py-3`}>
      <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{rotulo}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{valor}</p>
      {detalhe && <p className="text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{detalhe}</p>}
    </div>
  );
}

const botaoMes =
  "inline-flex size-8 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** A seta para o mês vizinho; apagada quando não há para onde ir. */
function SetaDoMes({ href, rotulo, Icone }: { href: string | null; rotulo: string; Icone: typeof ChevronLeft }) {
  return href ? (
    <Link href={href} className={botaoMes} aria-label={rotulo}>
      <Icone className="size-3.5" aria-hidden="true" />
    </Link>
  ) : (
    <span className={`${botaoMes} pointer-events-none opacity-40`} aria-hidden="true">
      <Icone className="size-3.5" />
    </span>
  );
}

/**
 * ‹ Mês › com o limite dos meses que têm batida (`meses`, do mais novo para o
 * mais velho): não deixa ir para antes do primeiro nem para depois do último.
 */
export function NavegacaoDoMes({ mes, meses, pessoaId, legenda }: { mes: string; meses: string[]; pessoaId: string | null; legenda: string }) {
  const maisVelho = meses[meses.length - 1] ?? mes;
  const anterior = mes > maisVelho ? somarMes(mes, -1) : null;
  const seguinte = meses[0] && mes < meses[0] ? somarMes(mes, 1) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <SetaDoMes href={anterior && endereco(anterior, pessoaId)} rotulo="Mês anterior" Icone={ChevronLeft} />
        <p className="min-w-40 text-center text-[14px] font-medium text-zinc-900 dark:text-zinc-50">{nomeDoMes(mes)}</p>
        <SetaDoMes href={seguinte && endereco(seguinte, pessoaId)} rotulo="Mês seguinte" Icone={ChevronRight} />
      </div>
      <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{legenda}</p>
    </div>
  );
}
