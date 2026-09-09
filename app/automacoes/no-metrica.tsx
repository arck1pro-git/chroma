"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { LogIn } from "lucide-react";
import { blocoPorTipo } from "@/lib/automacoes/catalogo";
import { NO_ENTRADA } from "@/lib/automacoes/tipos";
import { CORES, ICONES, ICONE_PADRAO } from "./aparencia";

export type DadosMetrica = {
  tipo: string;
  rotulo: string;
  passaram: number;
  erros: number;
  // fração do bloco de entrada; pinta a barra de proporção no rodapé
  proporcao: number;
};

export type NoDeMetrica = Node<DadosMetrica, "metrica">;

const conector =
  "!size-2 !rounded-full !border-2 !border-white !bg-zinc-300 dark:!border-zinc-950 dark:!bg-zinc-600";

// Mesmo cartão do construtor, com a contagem ocupando o miolo — é o dado que a
// tela existe para mostrar, então ele fica no centro e grande, não num canto.
function NoMetrica({ data, selected }: NodeProps<NoDeMetrica>) {
  const bloco = blocoPorTipo(data.tipo);
  const entrada = data.tipo === NO_ENTRADA;
  const Icone = entrada ? LogIn : (ICONES[data.tipo] ?? ICONE_PADRAO);
  const saidas = bloco?.saidas ?? [{ id: "padrao", rotulo: "" }];

  return (
    <div
      className={`w-48 cursor-pointer overflow-hidden rounded-xl border bg-white shadow-sm transition dark:bg-zinc-950 ${
        selected
          ? "border-zinc-900 ring-2 ring-zinc-900/10 dark:border-zinc-100 dark:ring-zinc-100/10"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
      }`}
    >
      {bloco?.entradas === 1 && (
        <Handle type="target" position={Position.Top} className={conector} />
      )}

      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded ${
            entrada
              ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
              : `ring-1 ring-inset ${CORES[bloco?.dominio ?? "controle"]}`
          }`}
        >
          <Icone className="size-2.5" aria-hidden="true" />
        </span>
        <p className="truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
          {data.rotulo}
        </p>
      </div>

      <p className="px-2.5 pb-0.5 pt-1 text-center text-2xl font-semibold leading-none tracking-tight text-zinc-900 dark:text-zinc-50">
        {data.passaram}
      </p>
      <p className="pb-2 text-center text-[10px] text-zinc-400 dark:text-zinc-500">
        {data.passaram === 1 ? "execução" : "execuções"}
      </p>

      {data.erros > 0 && (
        <p className="bg-rose-50 px-2.5 py-1 text-center text-[10px] font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
          {data.erros} {data.erros === 1 ? "falha" : "falhas"}
        </p>
      )}

      {/* Proporção em relação ao bloco de entrada: a queda do funil fica
          legível como comprimento, sem precisar comparar números. */}
      <div
        className="h-[3px]"
        style={{
          width: `${Math.round(data.proporcao * 1000) / 10}%`,
          background: "var(--serie-ok)",
        }}
        aria-hidden="true"
      />

      {saidas.map((s, i) => (
        <Handle
          key={s.id}
          id={s.id}
          type="source"
          position={Position.Bottom}
          style={{ left: `${((i + 1) / (saidas.length + 1)) * 100}%` }}
          className={conector}
        />
      ))}
    </div>
  );
}

export default memo(NoMetrica);
