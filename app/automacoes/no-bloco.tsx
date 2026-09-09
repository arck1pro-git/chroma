"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { LogIn } from "lucide-react";
import { blocoPorTipo } from "@/lib/automacoes/catalogo";
import { NO_ENTRADA } from "@/lib/automacoes/tipos";
import { CORES, ICONES, ICONE_PADRAO } from "./aparencia";

// `type` e não `interface`: o React Flow exige que os dados do nó satisfaçam
// Record<string, unknown>, e só type alias ganha a index signature implícita.
export type DadosBloco = { tipo: string; config: Record<string, unknown> };
export type NoDeBloco = Node<DadosBloco, "bloco">;

// Distribui as saídas na largura do cartão: com n saídas, a i-ésima fica em
// (i+1)/(n+1). Uma saída cai em 50%, duas em 33%/66% — sempre simétrico.
function posicaoSaida(i: number, total: number) {
  return `${((i + 1) / (total + 1)) * 100}%`;
}

const conector =
  "!size-2 !rounded-full !border-2 !border-white !bg-zinc-400 dark:!border-zinc-950 dark:!bg-zinc-500";

function NoBloco({ data, selected }: NodeProps<NoDeBloco>) {
  const bloco = blocoPorTipo(data.tipo);

  // Nó de entrada: a raiz do grafo. Não vem do catálogo porque não é um bloco
  // que se escolhe — é por onde a entidade inscrita no fluxo entra.
  if (data.tipo === NO_ENTRADA) {
    return (
      <div className="w-56 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
            <LogIn className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-zinc-900 dark:text-zinc-50">
              Entrada do fluxo
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Contatos e negócios adicionados aqui
            </p>
          </div>
        </div>
        {/* id="padrao" NÃO é decorativo: ao recarregar, paraCanvas() remonta a
            aresta com sourceHandle "padrao". Sem id aqui o React Flow não acha
            o conector e descarta a aresta em silêncio — a ligação da entrada
            para o primeiro bloco sumia depois de salvar. */}
        <Handle
          id="padrao"
          type="source"
          position={Position.Bottom}
          className={conector}
        />
      </div>
    );
  }

  // Tipo desconhecido: acontece se um fluxo antigo referenciar um bloco
  // removido do catálogo. Mostrar o buraco é melhor que quebrar o canvas.
  if (!bloco) {
    return (
      <div className="w-56 rounded-xl border border-dashed border-rose-300 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
        <Handle type="target" position={Position.Top} className={conector} />
        Bloco desconhecido: <code>{data.tipo}</code>
      </div>
    );
  }

  const Icone = ICONES[bloco.tipo] ?? ICONE_PADRAO;
  const multiplasSaidas = bloco.saidas.length > 1;

  return (
    <div
      className={`relative w-56 rounded-xl border bg-white shadow-sm transition dark:bg-zinc-950 ${
        selected
          ? "border-zinc-900 ring-2 ring-zinc-900/10 dark:border-zinc-100 dark:ring-zinc-100/10"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {bloco.entradas === 1 && (
        <Handle type="target" position={Position.Top} className={conector} />
      )}

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${CORES[bloco.dominio]}`}
        >
          <Icone className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight text-zinc-900 dark:text-zinc-50">
            {bloco.rotulo}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            {bloco.descricao}
          </p>
        </div>
      </div>

      {bloco.indisponivel && (
        <p className="border-t border-amber-100 bg-amber-50/60 px-3 py-1 text-[10px] font-medium text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-400">
          {bloco.indisponivel}
        </p>
      )}

      {bloco.saidas.map((s, i) => (
        <Handle
          key={s.id}
          id={s.id}
          type="source"
          position={Position.Bottom}
          style={{ left: posicaoSaida(i, bloco.saidas.length) }}
          className={conector}
        />
      ))}

      {/* Rótulo do ramo ("Sim"/"Não") na mesma porcentagem do conector, para
          legenda e bolinha nunca saírem de alinhamento. */}
      {multiplasSaidas &&
        bloco.saidas.map((s, i) => (
          <span
            key={s.id}
            style={{ left: posicaoSaida(i, bloco.saidas.length) }}
            className="absolute -bottom-5 -translate-x-1/2 whitespace-nowrap rounded bg-white px-1 text-[10px] font-medium text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400"
          >
            {s.rotulo}
          </span>
        ))}
    </div>
  );
}

export default memo(NoBloco);
