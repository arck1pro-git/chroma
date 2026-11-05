// O que as partes do Financeiro usam igual: o endereço com o mês e a pessoa na
// URL, o cabeçalho do topo, a navegação de mês, os cartões e os formatos.
import type { ReactNode } from "react";
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

/** Quando o Financeiro não deixa editar: o que fazer para liberar. */
export const SO_PARA_VER = "Só para ver. Para editar, o TI marca a operação “Editar” do Financeiro em Configurações › Acessos.";

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
 * "Trocar mês" volta à escolha do mês de competência (./escolher-mes.tsx).
 */
export function NavegacaoDoMes({ mes, meses, pessoaId }: { mes: string; meses: string[]; pessoaId: string | null }) {
  const maisVelho = meses[meses.length - 1] ?? mes;
  const anterior = mes > maisVelho ? somarMes(mes, -1) : null;
  const seguinte = meses[0] && mes < meses[0] ? somarMes(mes, 1) : null;
  return (
    <div className="flex items-center gap-2">
      <SetaDoMes href={anterior && endereco(anterior, pessoaId)} rotulo="Mês anterior" Icone={ChevronLeft} />
      <p className="min-w-40 text-center text-[14px] font-medium text-zinc-900 dark:text-zinc-50">
        <span className="block text-[10.5px] font-normal uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Competência</span>
        {nomeDoMes(mes)}
      </p>
      <SetaDoMes href={seguinte && endereco(seguinte, pessoaId)} rotulo="Mês seguinte" Icone={ChevronRight} />
      <Link
        href="/financeiro"
        className="ml-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-zinc-600 underline-offset-2 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        Trocar mês
      </Link>
    </div>
  );
}

/** A largura da página (2026-11-04, "essa página deve ser mais larga"). */
export const PAGINA = "mx-auto flex w-full max-w-[100rem] flex-col gap-6";

/**
 * O cabeçalho do topo da página: o nome do módulo e a legenda à esquerda; à
 * direita o mês e as ações (o "Adicionar colaborador").
 */
export function CabecalhoFinanceiro({ legenda, navegacao, acoes }: { legenda?: ReactNode; navegacao?: ReactNode; acoes?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Financeiro</h1>
        {legenda && <div className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{legenda}</div>}
      </div>
      {(navegacao || acoes) && (
        <div className="flex flex-wrap items-center gap-3">
          {navegacao}
          {acoes}
        </div>
      )}
    </header>
  );
}
