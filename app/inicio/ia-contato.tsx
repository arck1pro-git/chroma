"use client";

// "Atendimento por IA" na gaveta do contato: o estado de agora, em uma frase,
// e os três jeitos de mexer nele.
//
//   Pela etapa  → contatos.ia = null  (o normal: vale a etapa da oportunidade)
//   Vinculado   → contatos.ia = true  (a IA responde em qualquer etapa)
//   Removido    → contatos.ia = false (a IA não responde, nem em etapa com IA)
//
// "Removido" também é o que a própria IA marca quando passa a conversa para a
// equipe — e aí esta seção é o lugar de devolver o contato para ela.
import { useOptimistic, useState, useTransition } from "react";
import { Bot } from "lucide-react";
import { textoDoTom } from "@/lib/cores-funil";
import type { Contato, Etapa, Funil, Oportunidade } from "../data";
import { definirIaDoContato } from "./acoes-ia";

type Valor = boolean | null;

const OPCOES: Array<{ valor: Valor; rotulo: string }> = [
  { valor: null, rotulo: "Pela etapa" },
  { valor: true, rotulo: "Vinculado" },
  { valor: false, rotulo: "Removido" },
];

export default function IaDoContato({
  contato,
  oportunidades,
  etapaPorId,
  funilPorId,
}: {
  contato: Contato;
  oportunidades: Oportunidade[];
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
}) {
  const [, iniciar] = useTransition();
  const [valor, setValor] = useOptimistic<Valor>(contato.ia ?? null);
  const [erro, setErro] = useState<string | null>(null);

  // As etapas COM IA em que ele tem oportunidade aberta — é o que "pela etapa"
  // significa para este contato agora.
  const etapasComIa = oportunidades
    .filter((o) => o.status === "aberta")
    .map((o) => etapaPorId.get(o.etapa_id))
    .filter((e): e is Etapa => Boolean(e?.ia_atende));
  const atende = valor ?? etapasComIa.length > 0;
  const tom = etapasComIa[0]?.tom_funil ?? funilPorId.get(oportunidades[0]?.funil_id ?? "")?.cor;
  const nomes = [...new Set(etapasComIa.map((e) => e.nome))].join(", ");

  const frase =
    valor === true
      ? "Vinculado: a IA responde este contato no WhatsApp em qualquer etapa."
      : valor === false
        ? `Removido: a IA não responde este contato${nomes ? `, mesmo estando em ${nomes}` : ""}.`
        : nomes
          ? `A IA responde este contato pela etapa ${nomes}.`
          : "Nenhuma etapa dele tem IA ligada — ninguém responde automaticamente.";

  function escolher(novo: Valor) {
    if (novo === valor) return;
    setErro(null);
    iniciar(async () => {
      setValor(novo);
      const r = await definirIaDoContato(contato.id, novo);
      // Falhou: o otimista volta sozinho ao valor gravado, e o motivo aparece aqui.
      if (r.erro) setErro(r.erro);
    });
  }

  return (
    <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <Bot
          className={`size-4 shrink-0 ${atende ? textoDoTom(tom) : "text-zinc-300 dark:text-zinc-600"}`}
          aria-hidden="true"
        />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Atendimento por IA
        </h3>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            atende
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
          }`}
        >
          {atende ? "IA responde" : "Sem IA"}
        </span>
      </div>

      <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{frase}</p>

      <div
        role="radiogroup"
        aria-label="Atendimento por IA"
        className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900"
      >
        {OPCOES.map((o) => {
          const ativo = o.valor === valor;
          return (
            <button
              key={String(o.valor)}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => escolher(o.valor)}
              className={`rounded-md px-2 py-1.5 text-[12px] font-medium transition ${
                ativo
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              {o.rotulo}
            </button>
          );
        })}
      </div>

      {erro && (
        <p role="alert" className="mt-2 text-[12px] text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}
    </section>
  );
}
