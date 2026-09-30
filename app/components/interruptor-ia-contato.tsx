"use client";

// O interruptor de IA do CONTATO — o mesmo no chat e na gaveta do dashboard.
//
// Mostra o estado que VALE agora (o do contato; sem ele, o da etapa) e QUAL IA
// responde. Desligar grava "desligada à mão". Ligar volta a seguir a etapa
// quando ela tem IA; sem IA na etapa, pede qual IA — é o "ligada à mão"
// (contatos.ia = true + contatos.ia_id). O seletor embaixo troca a IA a
// qualquer momento, e "voltar a seguir a etapa" limpa o ajuste manual.
//
// A regra do relógio fica escrita embaixo porque é o que surpreende: com a IA
// ligada, ela ainda fica quieta se um atendente falou na última hora
// (lib/ia/atendente.ts).
import { useOptimistic, useState, useTransition } from "react";
import { Bot, Loader2 } from "lucide-react";
import type { EstadoIaContato, IaResumo } from "@/lib/ia/catalogo";

type Valor = boolean | null;

export type PropsInterruptorIa = {
  estado: EstadoIaContato;
  /** As IAs que podem ser escolhidas no "ligada à mão". */
  ias: IaResumo[];
  aoDefinir: (valor: Valor, iaId: string | null) => Promise<{ erro?: string }>;
  desabilitado?: boolean;
};

const SEM_IAS = "Nenhuma IA criada ainda — crie uma no botão IA, no topo do dashboard.";

function Chave({ ligada, ocupado }: { ligada: boolean; ocupado: boolean }) {
  return (
    <span
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        ligada ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
      aria-hidden="true"
    >
      <span
        className={`flex size-4 items-center justify-center rounded-full bg-white shadow transition-transform ${
          ligada ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      >
        {ocupado && <Loader2 className="size-2.5 animate-spin text-zinc-400" />}
      </span>
    </span>
  );
}

function useInterruptor({ estado, ias, aoDefinir }: PropsInterruptorIa) {
  const [ocupado, iniciar] = useTransition();
  const [atual, setAtual] = useOptimistic({ valor: estado.valor, iaId: estado.iaId });
  const [erro, setErro] = useState<string | null>(null);
  // Ligar sem IA na etapa e com mais de uma IA criada: o seletor aparece
  // vazio e nada é gravado até a pessoa escolher.
  const [escolhendo, setEscolhendo] = useState(false);

  const nomePorId = new Map(ias.map((i) => [i.id, i.nome]));
  const ligada = atual.valor === null ? Boolean(estado.etapas) : atual.valor;
  const nomeIa =
    atual.valor === false
      ? null
      : atual.valor === true
        ? ((atual.iaId && nomePorId.get(atual.iaId)) ?? estado.iaDaEtapa)
        : estado.iaDaEtapa;

  function definir(valor: Valor, iaId: string | null) {
    setErro(null);
    setEscolhendo(false);
    const id = valor === true ? iaId : null;
    iniciar(async () => {
      setAtual({ valor, iaId: id });
      const r = await aoDefinir(valor, id);
      // Falhou: o otimista volta sozinho ao valor gravado; o motivo aparece.
      if (r.erro) setErro(r.erro);
    });
  }

  /** Devolve true quando precisa que a pessoa escolha a IA antes de gravar. */
  function ligar(): boolean {
    if (estado.etapas) {
      definir(null, null);
      return false;
    }
    if (ias.length === 1) {
      definir(true, ias[0].id);
      return false;
    }
    if (ias.length === 0) {
      setErro(SEM_IAS);
      return false;
    }
    setErro(null);
    setEscolhendo(true);
    return true;
  }

  const origem =
    atual.valor === true
      ? `Ligada à mão${nomeIa ? ` · ${nomeIa}` : ""}`
      : atual.valor === false
        ? "Desligada à mão"
        : estado.etapas
          ? `Pela etapa ${estado.etapas}${estado.iaDaEtapa ? ` · ${estado.iaDaEtapa}` : ""}`
          : "Desligada — nenhuma etapa dele tem IA";

  // O que o seletor mostra: a IA escolhida à mão, "a da etapa", ou nada ainda.
  const escolhida = atual.valor === true ? (atual.iaId ?? "") : ligada ? "etapa" : "";

  return {
    ligada,
    atual,
    ocupado,
    erro,
    origem,
    escolhendo,
    escolhida,
    /** true = ligar precisa que a pessoa escolha a IA (nada foi gravado). */
    alternar: (): boolean => {
      if (!ligada) return ligar();
      definir(false, null);
      return false;
    },
    escolher: (v: string) => (v === "etapa" ? definir(null, null) : definir(true, v)),
    seguirEtapa: () => definir(null, null),
  };
}

/** Versão completa: painel do contato no chat e gaveta do dashboard. */
export function InterruptorIaContato(props: PropsInterruptorIa) {
  const { ligada, atual, ocupado, erro, origem, escolhendo, escolhida, alternar, escolher, seguirEtapa } =
    useInterruptor(props);
  const bloqueado = props.desabilitado || ocupado;
  const mostrarSeletor = (ligada || escolhendo) && props.ias.length > 0;

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={ligada}
        onClick={alternar}
        disabled={bloqueado}
        className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 text-left transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
            ligada
              ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
              : "bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500"
          }`}
        >
          <Bot className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
            IA {ligada ? "responde este contato" : "desligada"}
          </span>
          <span className="block truncate text-[11.5px] text-zinc-500 dark:text-zinc-400">{origem}</span>
        </span>
        <Chave ligada={ligada} ocupado={ocupado} />
      </button>

      {mostrarSeletor && (
        <label className="mt-2 flex items-center gap-2 px-1 text-[12px] text-zinc-500 dark:text-zinc-400">
          <span className="shrink-0">Qual IA</span>
          <select
            value={escolhida}
            onChange={(e) => escolher(e.target.value)}
            disabled={bloqueado}
            // O foco vai direto para ele quando o ligar pediu a escolha.
            autoFocus={escolhendo}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-[12.5px] text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {escolhida === "" && (
              <option value="" disabled>
                Escolha a IA…
              </option>
            )}
            {props.estado.etapas && (
              <option value="etapa">
                A da etapa{props.estado.iaDaEtapa ? ` (${props.estado.iaDaEtapa})` : ""}
              </option>
            )}
            {props.ias.map((ia) => (
              <option key={ia.id} value={ia.id}>
                {ia.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] text-zinc-400 dark:text-zinc-500">
        <span>Não responde se um atendente falou com ele na última hora.</span>
        {atual.valor !== null && (
          <button
            type="button"
            onClick={seguirEtapa}
            disabled={bloqueado}
            className="font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            voltar a seguir a etapa
          </button>
        )}
      </div>

      {erro && (
        <p role="alert" className="mt-1.5 px-1 text-[12px] text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * Versão compacta: o cabeçalho da conversa no chat. Não cabe seletor: quando
 * ligar pede a escolha da IA, chama `aoEscolher` (o chat abre o painel do
 * contato, onde está a versão completa).
 */
export function InterruptorIaCompacto(props: PropsInterruptorIa & { aoEscolher?: () => void }) {
  const { ligada, ocupado, erro, origem, alternar } = useInterruptor(props);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label="IA para este contato"
      onClick={() => {
        if (alternar()) props.aoEscolher?.();
      }}
      disabled={props.desabilitado || ocupado}
      title={erro ?? `${origem}. A IA não responde se um atendente falou com ele na última hora. Clique para ${ligada ? "desligar" : "ligar"}.`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12px] font-medium transition disabled:opacity-60 ${
        ligada
          ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/25 dark:bg-violet-500/10 dark:text-violet-300"
          : "border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
      } ${erro ? "ring-2 ring-red-400" : ""}`}
    >
      <Bot className="size-3.5 shrink-0" />
      <span className="hidden sm:inline">IA</span>
      <Chave ligada={ligada} ocupado={ocupado} />
    </button>
  );
}
