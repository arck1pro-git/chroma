"use client";

// A seção "Anotações" do contato com o botão de anotar DENTRO dela — usada na
// gaveta de contatos e na aba Cliente da ficha da oportunidade. Antes a gaveta
// tinha um botão solto acima das oportunidades, longe da lista, e a ficha não
// tinha botão nenhum.
//
// Quem usa passa key={contatoId}: trocar de contato descarta o rascunho em vez
// de levá-lo para o contato seguinte.
import { useState, useTransition } from "react";
import { MessageSquare, Plus } from "lucide-react";
import type { Anotacao, Usuario } from "../data";
import { dataHora } from "../formato";
import { adicionarAnotacao } from "../contatos/actions";

export function AnotacoesContato({
  contatoId,
  anotacoes,
  usuarioPorId,
}: {
  contatoId: string;
  anotacoes: Anotacao[];
  usuarioPorId: Map<string, Usuario>;
}) {
  const [escrevendo, setEscrevendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciarSalvamento] = useTransition();

  function fechar() {
    setEscrevendo(false);
    setTexto("");
    setErro(null);
  }

  function salvar() {
    const limpo = texto.trim();
    if (!limpo || salvando) return;
    setErro(null);
    iniciarSalvamento(async () => {
      try {
        // O revalidatePath da action devolve a lista nova na mesma ida ao
        // servidor — não precisa de router.refresh().
        await adicionarAnotacao(contatoId, limpo);
        fechar();
      } catch {
        // Em produção a mensagem da action chega mascarada; o texto fica no
        // campo para a pessoa tentar de novo sem redigitar.
        setErro("Não foi possível salvar a anotação. Tente de novo.");
      }
    });
  }

  return (
    <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          Anotações
          {anotacoes.length > 0 && (
            <span className="tabular-nums text-zinc-300 dark:text-zinc-600">
              {anotacoes.length}
            </span>
          )}
        </h3>
        {!escrevendo && (
          <button
            type="button"
            onClick={() => setEscrevendo(true)}
            className="-my-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <Plus className="size-3" aria-hidden="true" /> Nova
          </button>
        )}
      </div>

      {escrevendo && (
        <div className="mb-3 space-y-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // O Esc aqui é do formulário: sem o stopPropagation ele também
              // chegaria ao listener da gaveta/ficha e fecharia o contato.
              if (e.key === "Escape") {
                e.stopPropagation();
                fechar();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                salvar();
              }
            }}
            maxLength={4000}
            rows={3}
            autoFocus
            disabled={salvando}
            aria-label="Nova anotação"
            placeholder="Escreva uma anotação sobre este contato…"
            className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {erro && (
            <p role="alert" className="text-[11px] text-red-500">
              {erro}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={fechar}
              disabled={salvando}
              className="rounded-lg px-3 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || !texto.trim()}
              title="Ctrl+Enter"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {salvando ? "Salvando…" : "Salvar anotação"}
            </button>
          </div>
        </div>
      )}

      {anotacoes.length === 0 ? (
        // Com o formulário aberto o "nada anotado" só repetiria o óbvio.
        !escrevendo && (
          <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
            Nada anotado sobre este contato
          </p>
        )
      ) : (
        <ul className="flex flex-col gap-2.5">
          {anotacoes.map((a) => (
            <li
              key={a.id}
              className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-inset ring-amber-100 dark:bg-amber-500/5 dark:ring-amber-500/15"
            >
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                {a.texto}
              </p>
              <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                {/* A IA não é usuário: as anotações dela (o resumo do
                    atendimento, lib/ia/atendente.ts) vêm sem autor e com 🤖
                    no começo. */}
                {usuarioPorId.get(a.autor_id)?.nome ??
                  (!a.autor_id && a.texto.startsWith("🤖") ? "IA" : "Autor desconhecido")}{" "}
                ·{" "}
                {dataHora(a.data_criacao)}
                {/* anotação se edita (o histórico não) — marcar isso evita
                    discussão sobre "eu não escrevi assim" */}
                {a.data_atualizacao && " · editada"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
