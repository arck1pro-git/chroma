// A tela do módulo Infra: um cartão por serviço (os com problema primeiro, ver
// lib/infra.ts) e, em cima, a faixa "Pede atenção" com o que fazer. Sem estado
// próprio: componente de servidor; só o botão de atualizar é do cliente.
import { horaCurta } from "@/lib/formato";
import type { CartaoInfra, EstadoInfra, MedidaInfra } from "@/lib/infra-tipos";
import { CircleCheck, TriangleAlert } from "@/app/components/icones";
import BotaoAtualizar from "./atualizar";

const VISUAL: Record<EstadoInfra, { rotulo: string; selo: string; barra: string; texto: string; ponto: string }> = {
  ok: {
    rotulo: "Ok",
    selo: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20",
    barra: "bg-emerald-500",
    texto: "text-zinc-900 dark:text-zinc-100",
    ponto: "bg-emerald-500",
  },
  atencao: {
    rotulo: "Atenção",
    selo: "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20",
    barra: "bg-amber-500",
    texto: "text-amber-700 dark:text-amber-400",
    ponto: "bg-amber-500",
  },
  critico: {
    rotulo: "Crítico",
    selo: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20",
    barra: "bg-red-500",
    texto: "text-red-700 dark:text-red-400",
    ponto: "bg-red-500",
  },
  desconhecido: {
    rotulo: "Sem leitura",
    selo: "bg-zinc-100 text-zinc-600 ring-zinc-500/15 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-400/20",
    barra: "bg-zinc-400",
    texto: "text-zinc-500 dark:text-zinc-400",
    ponto: "bg-zinc-400",
  },
};

export default function PainelInfra({ cartoes, lidoEm, semLeitura }: { cartoes: CartaoInfra[]; lidoEm: string; semLeitura: string[] }) {
  const pendencias = cartoes.flatMap((c) =>
    c.estado === "critico" || c.estado === "atencao" ? c.avisos.map((aviso) => ({ titulo: c.titulo, estado: c.estado, aviso })) : [],
  );

  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Infra</h1>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Os serviços de que o CRM depende, com o uso contra o limite. Lido às {horaCurta(lidoEm)}.
            </p>
          </div>
          <BotaoAtualizar />
        </header>

        {pendencias.length > 0 ? (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
              <TriangleAlert className="size-3.5 text-amber-500" aria-hidden="true" />
              Pede atenção
            </h2>
            <ul className="mt-2.5 flex flex-col gap-2">
              {pendencias.map((p, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-zinc-700 dark:text-zinc-300">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${VISUAL[p.estado].ponto}`} aria-hidden="true" />
                  <span>
                    <strong className="font-medium text-zinc-900 dark:text-zinc-100">{p.titulo}:</strong> {p.aviso}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-[13px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <CircleCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
            Nada perto do limite agora.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cartoes.map((c) => (
            <Cartao key={c.chave} cartao={c} />
          ))}
        </div>

        <footer className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          <p className="font-medium text-zinc-600 dark:text-zinc-300">O que esta tela ainda não lê</p>
          <ul className="mt-1 list-disc pl-4">
            {semLeitura.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </footer>
      </div>
    </div>
  );
}

function Cartao({ cartao }: { cartao: CartaoInfra }) {
  const visual = VISUAL[cartao.estado];
  return (
    <section className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{cartao.titulo}</h2>
          <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{cartao.subtitulo}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${visual.selo}`}>{visual.rotulo}</span>
      </header>

      {cartao.medidas.length > 0 && (
        <ul className="mt-3.5 flex flex-col gap-3">
          {cartao.medidas.map((m) => (
            <Medida key={m.rotulo} medida={m} />
          ))}
        </ul>
      )}

      {/* O aviso do cartão crítico ou em atenção já está na faixa "Pede atenção": aqui ficam só os outros (sem leitura, ok). */}
      {cartao.avisos.length > 0 && cartao.estado !== "critico" && cartao.estado !== "atencao" && (
        <ul className="mt-3.5 flex flex-col gap-1.5 border-t border-zinc-100 pt-3 text-[12px] leading-snug text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {cartao.avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      <p className="mt-auto pt-3 text-[11px] text-zinc-400 dark:text-zinc-500">Lido às {horaCurta(cartao.lidoEm)}</p>
    </section>
  );
}

function Medida({ medida }: { medida: MedidaInfra }) {
  const visual = VISUAL[medida.estado ?? "ok"];
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="min-w-0 text-zinc-600 dark:text-zinc-400">{medida.rotulo}</span>
        <span className={`shrink-0 text-right font-medium tabular-nums ${medida.estado ? visual.texto : "text-zinc-900 dark:text-zinc-100"}`}>
          {medida.valor}
        </span>
      </div>
      {medida.limite && <p className="text-right text-[11px] text-zinc-400 dark:text-zinc-500">{medida.limite}</p>}
      {medida.uso !== undefined && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="presentation">
          <div className={`h-full rounded-full ${visual.barra}`} style={{ width: `${Math.min(100, Math.max(2, medida.uso * 100))}%` }} />
        </div>
      )}
    </li>
  );
}
