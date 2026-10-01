"use client";

// A confirmação do CRM, no lugar do window.confirm do navegador.
//
// POR QUE: a janela nativa espreme tudo numa frase só, com "OK/Cancelar" — não
// diz QUAL é a ação ("Excluir campo", "Desconectar"), não distingue o que não
// tem volta e tem a cara do navegador, não do sistema. Aqui a pergunta vira
// título, a consequência vira texto e o botão diz o que faz; o destrutivo sai
// em vermelho.
//
// USO: igual ao confirm, só que assíncrono —
//   if (!(await confirmar({ titulo, mensagem, acao: "Excluir", perigo: true }))) return;
//
// Imperativo de propósito: renderiza numa raiz própria no <body>, fora da
// árvore de quem chama. Assim serve a qualquer tela sem provider no layout e
// sem estado de "diálogo aberto" em cada componente que só quer perguntar.
import { useEffect, useId, useRef } from "react";
import { createRoot } from "react-dom/client";
import { TriangleAlert } from "lucide-react";

export type OpcoesConfirmar = {
  /** A pergunta. Curta: "Excluir o campo “CPF”?" */
  titulo: string;
  /** A consequência — o que acontece e o que NÃO acontece. */
  mensagem?: string;
  /** O rótulo do botão que confirma. Verbo da ação, não "OK". */
  acao?: string;
  cancelar?: string;
  /** Ação sem volta: botão vermelho e o foco começa em Cancelar. */
  perigo?: boolean;
};

export function confirmar(opcoes: OpcoesConfirmar): Promise<boolean> {
  return new Promise((resolver) => {
    const anterior = document.activeElement as HTMLElement | null;
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    let respondido = false;
    const responder = (sim: boolean) => {
      if (respondido) return;
      respondido = true;
      raiz.unmount();
      hospedeiro.remove();
      // Devolve o foco a quem abriu: sem isto, quem usa teclado volta ao topo
      // da página depois de cada confirmação.
      anterior?.focus?.();
      resolver(sim);
    };
    raiz.render(<Dialogo {...opcoes} aoResponder={responder} />);
  });
}

function Dialogo({
  titulo,
  mensagem,
  acao = "Confirmar",
  cancelar = "Cancelar",
  perigo = false,
  aoResponder,
}: OpcoesConfirmar & { aoResponder: (sim: boolean) => void }) {
  const idTitulo = useId();
  const idTexto = useId();
  const refCancelar = useRef<HTMLButtonElement>(null);
  const refConfirmar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (perigo ? refCancelar : refConfirmar).current?.focus();
  }, [perigo]);

  return (
    <div
      className="veu-surge fixed inset-0 z-[300] flex items-center justify-center bg-zinc-900/40 px-4 dark:bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoResponder(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={mensagem ? idTexto : undefined}
        className="surge w-full max-w-[26rem] rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            aoResponder(false);
          }
          // Prende o Tab entre os dois botões: é um diálogo modal.
          if (e.key === "Tab") {
            e.preventDefault();
            const agora = document.activeElement;
            (agora === refCancelar.current ? refConfirmar : refCancelar).current?.focus();
          }
        }}
      >
        <div className="flex gap-3">
          {perigo && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <TriangleAlert className="size-4" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={idTitulo} className="text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {titulo}
            </h2>
            {mensagem && (
              <p id={idTexto} className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                {mensagem}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={refCancelar}
            type="button"
            onClick={() => aoResponder(false)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {cancelar}
          </button>
          <button
            ref={refConfirmar}
            type="button"
            onClick={() => aoResponder(true)}
            className={`rounded-lg px-3 py-2 text-[13px] font-medium text-white transition ${
              perigo
                ? "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
                : "bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            }`}
          >
            {acao}
          </button>
        </div>
      </div>
    </div>
  );
}
