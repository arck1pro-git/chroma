"use client";

// Quem responde os COMENTÁRIOS de uma conta do Instagram (2026-10-26).
//
// Duas camadas de regra (instagram_ia_regras): a da CONTA, que vale para todas
// as postagens (menos anúncios), e a de cada POSTAGEM, que vence a da conta —
// inclusive para desligar numa postagem o que a conta liga. "Seguir a conta"
// apaga a regra da postagem.
//
// LIGAR PEDE CONFIRMAÇÃO num diálogo nosso: a IA passa a responder em público,
// em nome da marca, e a conta pode já ter outro robô respondendo (ManyChat) —
// com os dois ligados, cada comentário recebe duas respostas (pedido dele,
// 2026-10-26). Desligar é imediato: parar de falar nunca é o passo arriscado.
//
// Só quem administra (podeAdministrar: módulo Meta, Admin e TI) vê a chave; os
// outros leem o estado. A ação confere de novo no servidor e recusa com a
// frase que aparece aqui.
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bot, Loader2, MessageCircle, TriangleAlert, X } from "lucide-react";
import type { IaResumo } from "@/lib/ia/catalogo";
import type { RegraIaInstagram } from "@/lib/instagram-tipos";
import CamadaTopo from "../components/camada-topo";
import { Chave } from "../components/interruptor-ia-contato";
import { salvarRegraIaInstagram } from "./acoes-instagram";

/** A regra que vale numa postagem: a dela, senão a da conta. */
export function regraEfetiva(regras: RegraIaInstagram[], midiaId: string): RegraIaInstagram | null {
  return regras.find((r) => r.midiaId === midiaId) ?? regras.find((r) => r.midiaId === null) ?? null;
}

const linkTexto =
  "shrink-0 rounded text-[11px] font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50";

export function RegraIaComentarios({
  contaId,
  usuario,
  midiaId,
  regras,
  ias,
  podeAdministrar,
  demo,
}: {
  contaId: string;
  /** O @ da conta, para o diálogo dizer onde a IA vai falar. */
  usuario: string;
  /** null = a regra da conta (todas as postagens). */
  midiaId: string | null;
  regras: RegraIaInstagram[];
  ias: IaResumo[];
  podeAdministrar: boolean;
  demo: boolean;
}) {
  const daConta = regras.find((r) => r.midiaId === null) ?? null;
  const gravada = midiaId === null ? daConta : (regras.find((r) => r.midiaId === midiaId) ?? null);
  // A regra desta camada; null = não existe (na postagem: segue a conta).
  const [propria, setPropria] = useOptimistic(gravada);
  const [ocupado, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const efetiva = midiaId === null ? propria : (propria ?? daConta);
  const ligada = Boolean(efetiva?.ligada);
  const nomeIa = efetiva ? (ias.find((i) => i.id === efetiva.iaId)?.nome ?? "IA") : null;

  const titulo = midiaId === null ? "IA nos comentários" : "IA nesta postagem";
  const origem =
    midiaId === null
      ? ligada
        ? `Responde todas as postagens · ${nomeIa}`
        : "Desligada em todas as postagens"
      : propria
        ? propria.ligada
          ? `Só nesta postagem · ${nomeIa}`
          : "Desligada nesta postagem"
        : daConta?.ligada
          ? `Segue a conta · ${nomeIa}`
          : "Segue a conta · desligada";

  function salvar(iaId: string | null, ligar: boolean, depois?: () => void) {
    setErro(null);
    iniciar(async () => {
      setPropria(iaId ? { contaId, midiaId, iaId, ligada: ligar } : null);
      try {
        const r = await salvarRegraIaInstagram(contaId, midiaId, iaId, ligar);
        // Falhou: o otimista volta sozinho ao que está gravado; o motivo aparece.
        if (!r.ok) setErro(r.erro);
        else depois?.();
      } catch { setErro("Não consegui salvar a configuração da IA. Tente novamente."); }
    });
  }

  function alternar() {
    if (!ligada) {
      setErro(null);
      setConfirmando(true);
      return;
    }
    // Desligar. Na postagem ligada só por ela, com a conta desligada, apagar a
    // regra própria já desliga — e deixa a postagem seguindo a conta.
    if (midiaId !== null && propria?.ligada && !daConta?.ligada) salvar(null, false);
    else if (efetiva) salvar(efetiva.iaId, false);
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
            ligada
              ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
              : "bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500"
          }`}
        >
          <Bot className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-zinc-900 dark:text-zinc-50">{titulo}</span>
          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={origem}>
            {origem}
          </span>
        </span>
        {podeAdministrar && (
          <>
            {midiaId !== null && propria && (
              <button type="button" onClick={() => salvar(null, false)} disabled={demo || ocupado} className={linkTexto}>
                seguir a conta
              </button>
            )}
            {ligada && ias.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setErro(null);
                  setConfirmando(true);
                }}
                disabled={demo || ocupado}
                className={linkTexto}
              >
                trocar IA
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={ligada}
              aria-label={titulo}
              onClick={alternar}
              disabled={demo || ocupado}
              title={demo ? "Indisponível na demonstração" : `Clique para ${ligada ? "desligar" : "ligar"}`}
              className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-60"
            >
              <Chave ligada={ligada} ocupado={ocupado} />
            </button>
          </>
        )}
      </div>

      {erro && !confirmando && (
        <p role="alert" className="mt-1.5 text-[11.5px] text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}

      {confirmando && (
        <ConfirmarIaComentarios
          usuario={usuario}
          todas={midiaId === null}
          ias={ias}
          inicial={efetiva?.iaId ?? daConta?.iaId ?? ias[0]?.id ?? null}
          trocando={ligada}
          salvando={ocupado}
          erro={erro}
          aoConfirmar={(iaId) => salvar(iaId, true, () => setConfirmando(false))}
          aoCancelar={() => {
            setConfirmando(false);
            setErro(null);
          }}
        />
      )}
    </div>
  );
}

// ── O diálogo de confirmação ────────────────────────────────────────────────

function ConfirmarIaComentarios({
  usuario,
  todas,
  ias,
  inicial,
  trocando,
  salvando,
  erro,
  aoConfirmar,
  aoCancelar,
}: {
  usuario: string;
  /** true = regra da conta (todas as postagens). */
  todas: boolean;
  ias: IaResumo[];
  inicial: string | null;
  /** Já ligada: o diálogo só troca a IA. */
  trocando: boolean;
  salvando: boolean;
  erro: string | null;
  aoConfirmar: (iaId: string) => void;
  aoCancelar: () => void;
}) {
  const [escolhida, setEscolhida] = useState<string | null>(inicial);
  const confirmar = useRef<HTMLButtonElement>(null);

  // Foco no confirmar ao abrir (sem ele o teclado ficaria na tela de trás).
  useEffect(() => {
    confirmar.current?.focus();
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoCancelar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoCancelar]);

  return (
    <CamadaTopo>
      <div className="veu-surge fixed inset-0 z-[300] bg-black/40 backdrop-blur-[2px]" onClick={aoCancelar} aria-hidden="true" />
      <div className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ia-comentarios-titulo"
          className="veu-surge pointer-events-auto flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="relative min-h-0 overflow-y-auto px-6 pb-5 pt-6 tela-baixa:px-5 tela-baixa:pb-4 tela-baixa:pt-5">
            <button
              type="button"
              onClick={aoCancelar}
              aria-label="Fechar"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-3.5 pr-6">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                <Bot className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id="ia-comentarios-titulo" className="text-[16px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {trocando ? "Trocar a IA dos comentários" : "Ligar a IA nos comentários"}
                </h2>
                <p className="truncate text-[12.5px] text-zinc-500 dark:text-zinc-400">
                  @{usuario} · {todas ? "todas as postagens, menos anúncios" : "só nesta postagem"}
                </p>
              </div>
            </div>

            {ias.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
                <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Nenhuma IA criada ainda</p>
                <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                  Crie uma no botão IA, no topo do{" "}
                  <Link href="/" className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100">
                    dashboard
                  </Link>
                  , e volte aqui para ligá-la.
                </p>
              </div>
            ) : (
              <div role="radiogroup" aria-label="IA que responde" className="mt-5 flex flex-col gap-1.5 tela-baixa:mt-4">
                {ias.map((ia) => {
                  const marcada = escolhida === ia.id;
                  return (
                    <button
                      key={ia.id}
                      type="button"
                      role="radio"
                      aria-checked={marcada}
                      onClick={() => setEscolhida(ia.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 tela-baixa:py-2 ${
                        marcada
                          ? "border-zinc-900 bg-zinc-50 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:text-zinc-50"
                          : "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
                      }`}
                    >
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                          marcada ? "border-zinc-900 dark:border-zinc-50" : "border-zinc-300 dark:border-zinc-600"
                        }`}
                        aria-hidden="true"
                      >
                        {marcada && <span className="size-2 rounded-full bg-zinc-900 dark:bg-zinc-50" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{ia.nome}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900 tela-baixa:mt-4 dark:bg-amber-500/10 dark:text-amber-100">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">A IA vai responder em público em nome da marca.</p>
                <p className="mt-1">
                  Confira antes que nenhum outro robô (ex.: ManyChat) responde esta conta — senão os dois respondem.
                </p>
              </div>
            </div>

            <p className="mt-3 flex gap-2.5 px-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              <MessageCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Responde só comentários novos na postagem (não as respostas), com uma frase curta aprovada, uma vez por
                pessoa em cada postagem, e chama a pessoa no direct, onde a conversa segue.
                {todas ? " Uma postagem pode ter a regra dela, que vence esta." : " Esta regra vence a da conta."}
              </span>
            </p>

            {erro && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {erro}
              </p>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50/70 px-6 py-3.5 tela-baixa:py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <button
              type="button"
              onClick={aoCancelar}
              className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              Cancelar
            </button>
            {ias.length > 0 && (
              <button
                ref={confirmar}
                type="button"
                onClick={() => escolhida && aoConfirmar(escolhida)}
                disabled={salvando || !escolhida}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-zinc-950"
              >
                {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
                {trocando ? "Trocar IA" : "Ligar IA"}
              </button>
            )}
          </footer>
        </div>
      </div>
    </CamadaTopo>
  );
}
