"use client";

// Os três checks de uma linha da folha (2026-11-04): a Patricia validou, o
// prestador enviou a NF, o pagamento foi enviado. Em sequência (decisão dele):
// só o próximo se marca e só o último marcado se desmarca; o resto fica
// esmaecido, com o motivo no título. O servidor confere a mesma ordem
// (marcarCheckDaFolha); a tela só antecipa o clique.
//
// Sem a permissão de editar, os checks só mostram o estado.
import { useOptimistic, useState, useTransition } from "react";
import { CHECKS_DA_FOLHA, motivoParaNaoMudar, ROTULO_CHECK, type CheckDaFolha, type ChecksDoMes } from "@/lib/financeiro-tipos";
import { dataHora } from "@/lib/formato";
import { Check, Loader2 } from "@/app/components/icones";
import { marcarCheckDaFolha } from "./acoes";

export default function ChecksDaFolha({
  mes,
  pessoaId,
  nome,
  checks,
  podeEditar,
}: {
  mes: string;
  pessoaId: string;
  nome: string;
  checks: ChecksDoMes;
  podeEditar: boolean;
}) {
  const [vistos, mudar] = useOptimistic(checks, (atual, { check, marcar }: { check: CheckDaFolha; marcar: boolean }) => ({
    ...atual,
    [check]: marcar ? { em: new Date().toISOString(), por: null } : null,
  }));
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, iniciar] = useTransition();

  function alternar(check: CheckDaFolha) {
    const marcar = !vistos[check];
    setErro(null);
    iniciar(async () => {
      mudar({ check, marcar });
      const r = await marcarCheckDaFolha({ mes, pessoaId, check, marcar });
      if (!r.ok) setErro(r.erro);
    });
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1" role="group" aria-label={`Checks do pagamento de ${nome}`}>
        {CHECKS_DA_FOLHA.map((c, i) => {
          const marca = vistos[c];
          const motivo = motivoParaNaoMudar(vistos, c);
          const bloqueado = !podeEditar || Boolean(motivo) || gravando;
          const titulo = [
            ROTULO_CHECK[c].longo,
            marca ? `${marca.por ? `por ${marca.por} ` : ""}em ${dataHora(marca.em)}` : "ainda não",
            podeEditar && motivo ? motivo : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <span key={c} className="flex items-center gap-1">
              {i > 0 && <span className={`h-px w-2 ${marca ? "bg-emerald-400 dark:bg-emerald-600" : "bg-zinc-200 dark:bg-zinc-700"}`} aria-hidden="true" />}
              <button
                type="button"
                onClick={() => alternar(c)}
                disabled={bloqueado}
                aria-pressed={Boolean(marca)}
                aria-label={`${ROTULO_CHECK[c].longo}: ${marca ? "marcado" : "não marcado"}`}
                title={titulo}
                className={`flex h-6 items-center gap-1 rounded-full px-2 text-[10.5px] font-semibold transition disabled:cursor-default ${
                  marca
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 enabled:hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
                    : motivo || !podeEditar
                      ? "text-zinc-300 ring-1 ring-inset ring-zinc-200 dark:text-zinc-600 dark:ring-zinc-800"
                      : "text-zinc-600 ring-1 ring-inset ring-zinc-300 enabled:hover:bg-zinc-100 enabled:hover:text-zinc-900 dark:text-zinc-300 dark:ring-zinc-600 dark:enabled:hover:bg-zinc-800"
                }`}
              >
                {marca ? <Check className="size-3" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />}
                {ROTULO_CHECK[c].curto}
              </button>
            </span>
          );
        })}
        {gravando && <Loader2 className="size-3 animate-spin text-zinc-400" aria-hidden="true" />}
      </div>
      {erro && (
        <p role="alert" className="max-w-56 text-center text-[10.5px] leading-tight text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}
    </div>
  );
}
