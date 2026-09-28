"use client";

// O liga/desliga da IA de UMA etapa, no cabeçalho da coluna do quadro.
//
// Ligado, ele assume a cor do funil — a mesma do robô nos cards — para a
// coluna e os cards dela lerem como uma coisa só: "aqui a IA responde".
//
// LIGAR PEDE CONFIRMAÇÃO e desligar não: ligar faz a IA começar a falar com
// clientes reais na próxima mensagem deles; desligar só a cala. A confirmação
// é um diálogo nosso, por cima da tela e na cor do funil — era o `confirm` do
// navegador, que não diz nada sobre o CRM e não dá para ler direito.
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Bot, Hand, Loader2, MessageCircle, X } from "lucide-react";
import { realceDoTom, solidoDoTom } from "@/lib/cores-funil";
import CamadaTopo from "../components/camada-topo";
import type { Etapa } from "../data";
import { definirIaDaEtapa } from "./acoes-ia";

export default function InterruptorIa({ etapa, quantidade }: { etapa: Etapa; quantidade: number }) {
  const [salvando, iniciar] = useTransition();
  const [ligada, setLigada] = useOptimistic(etapa.ia_atende ?? false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function aplicar(nova: boolean) {
    setErro(null);
    iniciar(async () => {
      setLigada(nova);
      const r = await definirIaDaEtapa(etapa.id, nova);
      if (r.erro) setErro(r.erro);
      else setConfirmando(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (ligada ? aplicar(false) : setConfirmando(true))}
        aria-pressed={ligada}
        title={
          erro ??
          (ligada
            ? "A IA responde no WhatsApp quem está nesta etapa. Clique para desligar."
            : "Ligar a IA: quem está nesta etapa passa a ser respondido por ela no WhatsApp.")
        }
        className={`mt-2 inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[12px] font-medium transition ${
          ligada
            ? realceDoTom(etapa.tom_funil)
            : "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        } ${erro && !confirmando ? "ring-2 ring-red-400" : ""}`}
      >
        <Bot className="size-3.5 shrink-0" aria-hidden="true" />
        IA
        <span
          className={`ml-0.5 size-1.5 shrink-0 rounded-full ${ligada ? "bg-current" : "bg-zinc-300 dark:bg-zinc-600"}`}
          aria-hidden="true"
        />
      </button>

      {confirmando && (
        <ConfirmarIa
          etapa={etapa}
          quantidade={quantidade}
          salvando={salvando}
          erro={erro}
          aoConfirmar={() => aplicar(true)}
          aoCancelar={() => {
            setConfirmando(false);
            setErro(null);
          }}
        />
      )}
    </>
  );
}

// ── O diálogo ───────────────────────────────────────────────────────────────

function ConfirmarIa({
  etapa,
  quantidade,
  salvando,
  erro,
  aoConfirmar,
  aoCancelar,
}: {
  etapa: Etapa;
  quantidade: number;
  salvando: boolean;
  erro: string | null;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const confirmar = useRef<HTMLButtonElement>(null);

  // Foco no botão de ligar (Enter confirma) e Esc cancela — sem o foco, o
  // teclado continuaria no quadro de trás.
  useEffect(() => {
    confirmar.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoCancelar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoCancelar]);

  const leads = quantidade === 1 ? "1 oportunidade" : `${quantidade} oportunidades`;

  return (
    <CamadaTopo>
      <div
        className="veu-surge fixed inset-0 z-[300] bg-black/40 backdrop-blur-[2px]"
        onClick={aoCancelar}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-4">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ia-etapa-titulo"
          aria-describedby="ia-etapa-texto"
          className="veu-surge pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="relative px-6 pb-5 pt-6">
            <button
              type="button"
              onClick={aoCancelar}
              aria-label="Fechar"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-3.5">
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${realceDoTom(etapa.tom_funil)}`}
              >
                <Bot className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 pr-6">
                <h2
                  id="ia-etapa-titulo"
                  className="text-[16px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
                >
                  Ligar a IA em “{etapa.nome}”?
                </h2>
                <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">
                  {quantidade > 0 ? `${leads} nesta etapa agora` : "Nenhuma oportunidade nesta etapa ainda"}
                </p>
              </div>
            </div>

            <ul id="ia-etapa-texto" className="mt-5 flex flex-col gap-3">
              <Item Icone={MessageCircle}>
                Quem estiver nesta etapa passa a ser <strong className="font-medium text-zinc-900 dark:text-zinc-100">respondido
                pela IA no WhatsApp</strong>, pelo mesmo número em que já conversa.
              </Item>
              <Item Icone={Hand}>
                Ela não entra em conversa que alguém da equipe assumiu ou respondeu nas últimas 12h, nem fala com contato
                removido da IA.
              </Item>
              <Item Icone={BookOpen}>
                Só usa o que está em{" "}
                <Link href="/contextos" className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100">
                  Contextos
                </Link>
                . Quando não souber, passa a conversa para a equipe.
              </Item>
            </ul>

            {erro && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {erro}
              </p>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50/70 px-6 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
            <button
              type="button"
              onClick={aoCancelar}
              className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              Cancelar
            </button>
            <button
              ref={confirmar}
              type="button"
              onClick={aoConfirmar}
              disabled={salvando}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold shadow-sm transition disabled:opacity-60 ${solidoDoTom(etapa.tom_funil)}`}
            >
              {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
              Ligar IA
            </button>
          </footer>
        </div>
      </div>
    </CamadaTopo>
  );
}

function Item({ Icone, children }: { Icone: typeof Bot; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        <Icone className="size-3.5" aria-hidden="true" />
      </span>
      <span>{children}</span>
    </li>
  );
}
