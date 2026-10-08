"use client";

// A IA de UMA etapa, no cabeçalho da coluna do quadro (etapas.ia_id).
//
// Com IA, o botão assume a cor do funil — a mesma do robô nos cards — e mostra
// o nome dela, para a coluna e os cards lerem como uma coisa só: "aqui a IA X
// responde".
//
// Clicar abre um diálogo nosso, por cima da tela e na cor do funil, com as IAs
// para escolher (ou nenhuma). ESCOLHER PEDE CONFIRMAÇÃO no próprio diálogo:
// trocar ou ligar a IA faz ela começar a falar com clientes reais na próxima
// mensagem deles. Criar IA não é aqui — é a gaveta do botão IA, no topo; sem
// nenhuma criada, o diálogo leva até lá.
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightLeft, BookOpen, Bot, Check, Hand, Loader2, MessageCircle, Plus, X } from "lucide-react";
import { realceDoTom, solidoDoTom } from "@/lib/cores-funil";
import type { Ia } from "@/lib/ia/catalogo";
import CamadaTopo from "../components/camada-topo";
import type { Etapa } from "../data";
import { definirIaDaEtapa } from "./acoes-ia";

export default function InterruptorIa({
  etapa,
  quantidade,
  ias,
  aoGerenciarIas,
}: {
  etapa: Etapa;
  quantidade: number;
  ias: Ia[];
  /** Abre a gaveta de IAs (botão IA do topo). */
  aoGerenciarIas: () => void;
}) {
  const [salvando, iniciar] = useTransition();
  const [iaId, setIaId] = useOptimistic(etapa.ia_id ?? null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ia = iaId ? ias.find((i) => i.id === iaId) : undefined;

  function aplicar(nova: string | null) {
    setErro(null);
    iniciar(async () => {
      setIaId(nova);
      const r = await definirIaDaEtapa(etapa.id, nova);
      if (r.erro) setErro(r.erro);
      else setAberto(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        title={
          erro ??
          (ia
            ? `A IA "${ia.nome}" responde no WhatsApp quem está nesta etapa. Clique para trocar ou desligar.`
            : "Escolher a IA que responde no WhatsApp quem está nesta etapa.")
        }
        className={`mt-2 tela-baixa:mt-1.5 inline-flex min-w-0 max-w-[55%] shrink-0 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[12px] font-medium transition ${
          ia
            ? realceDoTom(etapa.tom_funil)
            : "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        } ${erro && !aberto ? "ring-2 ring-red-400" : ""}`}
      >
        <Bot className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{ia ? ia.nome : "IA"}</span>
        <span
          className={`ml-0.5 size-1.5 shrink-0 rounded-full ${ia ? "bg-current" : "bg-zinc-300 dark:bg-zinc-600"}`}
          aria-hidden="true"
        />
      </button>

      {aberto && (
        <EscolherIa
          etapa={etapa}
          quantidade={quantidade}
          ias={ias}
          atual={iaId}
          salvando={salvando}
          erro={erro}
          aoConfirmar={aplicar}
          aoGerenciarIas={() => {
            setAberto(false);
            aoGerenciarIas();
          }}
          aoCancelar={() => {
            setAberto(false);
            setErro(null);
          }}
        />
      )}
    </>
  );
}

// ── O diálogo ───────────────────────────────────────────────────────────────

function EscolherIa({
  etapa,
  quantidade,
  ias,
  atual,
  salvando,
  erro,
  aoConfirmar,
  aoGerenciarIas,
  aoCancelar,
}: {
  etapa: Etapa;
  quantidade: number;
  ias: Ia[];
  atual: string | null;
  salvando: boolean;
  erro: string | null;
  aoConfirmar: (iaId: string | null) => void;
  aoGerenciarIas: () => void;
  aoCancelar: () => void;
}) {
  // Nasce na IA atual; sem nenhuma, na primeira da lista — é o caso de quem
  // abriu o diálogo para ligar.
  const [escolhida, setEscolhida] = useState<string | null>(atual ?? ias[0]?.id ?? null);
  const confirmar = useRef<HTMLButtonElement>(null);

  // Foco no botão de confirmar (Enter confirma) e Esc cancela — sem o foco, o
  // teclado continuaria no quadro de trás.
  useEffect(() => {
    confirmar.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoCancelar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoCancelar]);

  const leads = quantidade === 1 ? "1 oportunidade" : `${quantidade} oportunidades`;
  const mudou = escolhida !== atual;
  const rotuloConfirmar = !mudou ? "Sem mudança" : escolhida ? (atual ? "Trocar IA" : "Ligar IA") : "Desligar IA";

  return (
    <CamadaTopo>
      <div
        className="veu-surge fixed inset-0 z-[300] bg-black/40 backdrop-blur-[2px]"
        onClick={aoCancelar}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ia-etapa-titulo"
          className="veu-surge pointer-events-auto flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="relative min-h-0 overflow-y-auto px-6 pb-5 pt-6">
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
                  IA da etapa “{etapa.nome}”
                </h2>
                <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">
                  {quantidade > 0 ? `${leads} nesta etapa agora` : "Nenhuma oportunidade nesta etapa ainda"}
                </p>
              </div>
            </div>

            {ias.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
                <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Nenhuma IA criada ainda</p>
                <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                  Crie uma com o prompt e o que ela pode fazer, e volte aqui para ligá-la nesta etapa.
                </p>
                <button
                  type="button"
                  onClick={aoGerenciarIas}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Criar IA
                </button>
              </div>
            ) : (
              <>
                <div role="radiogroup" aria-label="IA que atende" className="mt-5 flex flex-col gap-1.5">
                  {ias.map((ia) => (
                    <Opcao
                      key={ia.id}
                      marcada={escolhida === ia.id}
                      aoMarcar={() => setEscolhida(ia.id)}
                      titulo={ia.nome}
                      detalhe={ia.prompt}
                      selo={ia.acoes.includes("mover_etapa") ? "Move entre etapas" : null}
                    />
                  ))}
                  <Opcao
                    marcada={escolhida === null}
                    aoMarcar={() => setEscolhida(null)}
                    titulo="Nenhuma"
                    detalhe="A IA não responde quem está nesta etapa."
                    selo={null}
                  />
                </div>
                <button
                  type="button"
                  onClick={aoGerenciarIas}
                  className="mt-2 px-1 text-[12px] font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Criar ou editar IAs
                </button>
              </>
            )}

            {escolhida && (
              <ul className="mt-5 flex flex-col gap-3">
                <Item Icone={MessageCircle}>
                  Quem estiver nesta etapa passa a ser <strong className="font-medium text-zinc-900 dark:text-zinc-100">respondido
                  por esta IA no WhatsApp</strong>, pelo mesmo número em que já conversa.
                </Item>
                <Item Icone={Hand}>
                  Ela fica quieta se um atendente falou com o contato na última hora, e nunca fala com contato
                  removido da IA.
                </Item>
                <Item Icone={BookOpen}>
                  Só afirma o que está em{" "}
                  <Link href="/contextos" className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100">
                    Contextos
                  </Link>
                  . O que não souber, pede à equipe.
                </Item>
                {ias.find((i) => i.id === escolhida)?.acoes.includes("mover_etapa") && (
                  <Item Icone={ArrowRightLeft}>
                    Pode mover a oportunidade para outra etapa deste funil — e lá quem atende é a IA daquela etapa.
                  </Item>
                )}
              </ul>
            )}

            {erro && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {erro}
              </p>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50/70 px-6 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
            <button
              type="button"
              onClick={aoCancelar}
              className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              Cancelar
            </button>
            {ias.length > 0 && (
              <button
                ref={confirmar}
                type="button"
                onClick={() => aoConfirmar(escolhida)}
                disabled={salvando || !mudou}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold shadow-sm transition disabled:opacity-50 ${solidoDoTom(etapa.tom_funil)}`}
              >
                {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
                {rotuloConfirmar}
              </button>
            )}
          </footer>
        </div>
      </div>
    </CamadaTopo>
  );
}

function Opcao({
  marcada,
  aoMarcar,
  titulo,
  detalhe,
  selo,
}: {
  marcada: boolean;
  aoMarcar: () => void;
  titulo: string;
  detalhe: string;
  selo: string | null;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={aoMarcar}
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        marcada
          ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
      }`}
    >
      <span
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
          marcada
            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            : "border-zinc-300 dark:border-zinc-600"
        }`}
        aria-hidden="true"
      >
        {marcada && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{titulo}</span>
          {selo && (
            <span className="shrink-0 rounded-full bg-violet-50 px-1.5 py-px text-[10.5px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              {selo}
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{detalhe}</span>
      </span>
    </button>
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
