"use client";

// "Atendimento por IA" na gaveta do contato: o interruptor do contato
// (contatos.ia + contatos.ia_id), o mesmo do chat —
// app/components/interruptor-ia-contato.tsx.
//
// Ligado/desligado aqui é ajuste MANUAL do contato e vale em qualquer etapa;
// "voltar a seguir a etapa" limpa o ajuste. Desligado também é o que a própria
// IA marca quando passa a conversa para a equipe — e aqui é onde se religa.
import { textoDoTom } from "@/lib/cores-funil";
import type { Ia } from "@/lib/ia/catalogo";
import type { Contato, Etapa, Funil, Oportunidade } from "@/lib/entidades";
import { Bot } from "@/app/components/icones";
import { InterruptorIaContato } from "../components/interruptor-ia-contato";
import { iaDoCard } from "../funil/ia";
import { definirIaDoContato } from "./acoes-ia";
import { Secao } from "../components/gaveta";

export default function IaDoContato({
  contato,
  oportunidades,
  etapaPorId,
  funilPorId,
  ias,
}: {
  contato: Contato;
  oportunidades: Oportunidade[];
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  ias: Ia[];
}) {
  // As etapas COM IA em que ele tem oportunidade aberta — é o que "seguir a
  // etapa" significa para este contato agora. A IA delas é a da primeira,
  // mesma preferência do servidor (lib/ia/atendente.ts).
  const etapasComIa = oportunidades
    .filter((o) => o.status === "aberta")
    .map((o) => etapaPorId.get(o.etapa_id))
    .filter((e): e is Etapa => Boolean(e?.ia_id));
  const nomes = [...new Set(etapasComIa.map((e) => e.nome))].join(", ") || null;
  const nomePorId = new Map(ias.map((i) => [i.id, i.nome]));
  const iaDaEtapa = etapasComIa[0]?.ia_id ? (nomePorId.get(etapasComIa[0].ia_id) ?? null) : null;

  const tom = etapasComIa[0]?.tom_funil ?? funilPorId.get(oportunidades[0]?.funil_id ?? "")?.cor;
  const ligada = Boolean(iaDoCard(contato, etapasComIa[0]));

  return (
    <Secao
      titulo={
        <>
          {/* O robô na cor do funil, como no card — é por ele que se reconhece. */}
          <Bot className={`size-3.5 ${ligada ? textoDoTom(tom) : "text-zinc-300 dark:text-zinc-600"}`} aria-hidden="true" />
          Atendimento por IA
        </>
      }
    >
      <InterruptorIaContato
        estado={{ valor: contato.ia ?? null, iaId: contato.ia_id ?? null, etapas: nomes, iaDaEtapa }}
        ias={ias}
        aoDefinir={(v, iaId) => definirIaDoContato(contato.id, v, iaId)}
      />
    </Secao>
  );
}
