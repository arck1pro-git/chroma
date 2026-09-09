"use client";

// Tela dos Contextos: a lista à esquerda, o editor à direita.
//
// Dois painéis e não um modal porque editar prompt é escrever texto longo, e um
// modal transformaria "comparar dois blocos" em abrir/fechar duas vezes. A
// lista fica visível o tempo todo.
import { useState } from "react";
import { Blocks, Check, Plus, Power } from "lucide-react";
import { ESCOPOS, type Contexto, type EscopoContexto } from "@/lib/contextos-tipos";
import { dataCurta } from "../formato";
import { ligarContexto, salvarContexto } from "./actions";

type Rascunho = {
  id?: string;
  nome: string;
  descricao: string;
  conteudo: string;
  escopo: EscopoContexto;
};

const VAZIO: Rascunho = {
  nome: "",
  descricao: "",
  conteudo: "",
  escopo: "analise",
};

function deContexto(c: Contexto): Rascunho {
  return {
    id: c.id,
    nome: c.nome,
    descricao: c.descricao ?? "",
    conteudo: c.conteudo,
    escopo: c.escopo,
  };
}

export default function PainelContextos({ contextos }: { contextos: Contexto[] }) {
  // null = nada aberto no editor. O rascunho é local até Salvar: escrever
  // prompt é rasurar muito, e gravar a cada tecla encheria contexto_versoes de
  // versões que ninguém quis registrar.
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function gravar() {
    if (!rascunho) return;
    setSalvando(true);
    const r = await salvarContexto(rascunho);
    setAviso({ ok: r.ok, texto: r.mensagem });
    // Fecha o editor só quando deu certo — no erro, o texto continua na tela
    // para a pessoa corrigir em vez de reescrever.
    if (r.ok) setRascunho(null);
    setSalvando(false);
  }

  async function alternar(c: Contexto) {
    const r = await ligarContexto(c.id, !c.ativo);
    setAviso({ ok: r.ok, texto: r.mensagem });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      {/* ── Lista ─────────────────────────────────────────────────────────── */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <header className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            <Blocks className="size-4" aria-hidden="true" />
            Contextos
          </h1>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Blocos de prompt do projeto. Os ligados aparecem para escolher no
            painel de IA e entram na instrução do modelo.
          </p>
          <button
            type="button"
            onClick={() => {
              setRascunho({ ...VAZIO });
              setAviso(null);
            }}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Novo contexto
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {contextos.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
              Nenhum contexto ainda.
            </p>
          ) : (
            ESCOPOS.filter((e) => contextos.some((c) => c.escopo === e.id)).map(
              (escopo) => (
                <section key={escopo.id} className="mb-3">
                  <h2 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {escopo.rotulo}
                  </h2>
                  <ul className="flex flex-col gap-1">
                    {contextos
                      .filter((c) => c.escopo === escopo.id)
                      .map((c) => (
                        <li key={c.id}>
                          <div
                            className={`flex items-start gap-2 rounded-lg px-2 py-1.5 transition ${
                              rascunho?.id === c.id
                                ? "bg-zinc-100 dark:bg-zinc-800"
                                : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setRascunho(deContexto(c));
                                setAviso(null);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span
                                className={`block truncate text-[13px] font-medium ${
                                  c.ativo
                                    ? "text-zinc-900 dark:text-zinc-50"
                                    : "text-zinc-400 line-through dark:text-zinc-500"
                                }`}
                              >
                                {c.nome}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                                v{c.versao} · {dataCurta(c.data_atualizacao)}
                                {c.descricao ? ` · ${c.descricao}` : ""}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => alternar(c)}
                              title={c.ativo ? "Desligar" : "Ligar"}
                              aria-label={
                                c.ativo
                                  ? `Desligar ${c.nome}`
                                  : `Ligar ${c.nome}`
                              }
                              className={`mt-0.5 shrink-0 rounded p-1 transition ${
                                c.ativo
                                  ? "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                                  : "text-zinc-300 hover:bg-zinc-100 dark:text-zinc-600 dark:hover:bg-zinc-800"
                              }`}
                            >
                              <Power className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      ))}
                  </ul>
                </section>
              ),
            )
          )}
        </div>
      </aside>

      {/* ── Editor ────────────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {!rascunho ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-xs text-center text-xs text-zinc-400 dark:text-zinc-500">
              Escolha um contexto à esquerda para editar, ou crie um novo. Um
              contexto é um pedaço de instrução que você reaproveita nas
              análises com IA.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="ctx-nome"
                className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
              >
                Nome
              </label>
              <input
                id="ctx-nome"
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                maxLength={80}
                placeholder="Auditoria de proposta"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="ctx-desc"
                className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
              >
                Descrição <span className="normal-case">(opcional)</span>
              </label>
              <input
                id="ctx-desc"
                value={rascunho.descricao}
                onChange={(e) =>
                  setRascunho({ ...rascunho, descricao: e.target.value })
                }
                maxLength={200}
                placeholder="O que este bloco faz, em uma linha"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Onde vale
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ESCOPOS.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setRascunho({ ...rascunho, escopo: e.id })}
                    title={e.dica}
                    className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition ${
                      rascunho.escopo === e.id
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                        : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {e.rotulo}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="ctx-conteudo"
                className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
              >
                Bloco de prompt
              </label>
              <textarea
                id="ctx-conteudo"
                value={rascunho.conteudo}
                onChange={(e) =>
                  setRascunho({ ...rascunho, conteudo: e.target.value })
                }
                maxLength={8000}
                rows={14}
                placeholder={
                  "Ao auditar uma proposta, confira sempre:\n- prazo combinado\n- escopo descrito\n- forma de pagamento"
                }
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {rascunho.conteudo.length}/8000 · vai inteiro na instrução de
                cada pergunta, então texto curto sai mais barato.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={gravar}
                disabled={salvando}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Check className="size-3.5" aria-hidden="true" />
                {salvando ? "Salvando…" : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => setRascunho(null)}
                className="rounded-lg px-3 py-2 text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              {rascunho.id && (
                <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
                  Editar o texto cria uma versão nova
                </span>
              )}
            </div>
          </div>
        )}

        {aviso && (
          <p
            className={`mx-auto mt-3 max-w-2xl text-[11px] ${
              aviso.ok
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-amber-700 dark:text-amber-500"
            }`}
          >
            {aviso.texto}
          </p>
        )}
      </main>
    </div>
  );
}
