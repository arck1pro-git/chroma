"use client";

// Acessos: quem vê o quê. A tela do departamento que administra.
//
// DUAS LISTAS, e a ordem entre elas é a pergunta que a pessoa chega fazendo:
// primeiro "o que cada departamento alcança" (os cartões), depois "de que
// departamento é o fulano" (os participantes). Inverter obrigaria a decidir o
// destino de alguém antes de saber o que aquele destino dá.
//
// Nada aqui decide acesso de verdade: isto grava linha em
// `departamento_modulos`. Quem barra é a DAL, a cada render de cada página
// (lib/auth/dal.ts). Desmarcar uma caixa aqui fecha a porta no próximo
// carregamento da pessoa, mesmo com ela já logada.
import { useState, useTransition } from "react";
import {
  Check,
  KeyRound,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { MODULOS } from "@/lib/auth/modulos";
import type { Escopo } from "@/lib/auth/modulos";
import type {
  DadosAcessos,
  DepartamentoConfig,
  ParticipanteConfig,
} from "../dados";
import {
  apagarDepartamento,
  criarDepartamento,
  definirEscopoDoModulo,
  definirGerenciaAcessos,
  definirModulo,
  moverParticipante,
  renomearDepartamento,
} from "../acoes-acessos";
import { botao, campoTexto } from "./ui";

export function AcessosSection({
  dados,
  departamentoIdAtual,
  usuarioIdAtual,
}: {
  dados: DadosAcessos;
  /** Pra marcar "você está aqui" e explicar por que alguns botões não abrem. */
  departamentoIdAtual: string | null;
  usuarioIdAtual: string;
}) {
  const [erro, setErro] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <ShieldCheck className="size-3.5 text-zinc-400" aria-hidden="true" />
          Acessos
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Os módulos de cada departamento e a que departamento cada pessoa
          pertence. Departamento novo nasce sem nenhum módulo.
        </p>
      </div>

      {/* Um único lugar de erro para a tela toda: as ações são muitas e
          pequenas, e um aviso por botão encheria o cartão de espaço vazio
          esperando por mensagem que quase nunca vem. */}
      {erro && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
        >
          {erro}
        </p>
      )}

      <NovoDepartamento aoFalhar={setErro} />

      <div className="flex flex-col gap-3">
        {dados.departamentos.map((d) => (
          <CartaoDepartamento
            key={d.id}
            departamento={d}
            ehOMeu={d.id === departamentoIdAtual}
            pessoas={dados.participantes.filter(
              (p) => p.departamentoId === d.id,
            )}
            aoFalhar={setErro}
          />
        ))}
      </div>

      <Participantes
        participantes={dados.participantes}
        departamentos={dados.departamentos}
        usuarioIdAtual={usuarioIdAtual}
        aoFalhar={setErro}
      />
    </section>
  );
}

// ── Criar ────────────────────────────────────────────────────────────────────

function NovoDepartamento({ aoFalhar }: { aoFalhar: (e: string | null) => void }) {
  const [nome, setNome] = useState("");
  const [nivel, setNivel] = useState("1");
  const [salvando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n) return;
    aoFalhar(null);
    iniciar(async () => {
      try {
        await criarDepartamento(n, Number(nivel) || 1);
        setNome("");
        setNivel("1");
      } catch (e) {
        aoFalhar(e instanceof Error ? e.message : "Falha ao criar departamento");
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Novo departamento
          </span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder="Ex.: Suporte"
            className={campoTexto}
          />
        </label>

        {/* O nível ordena a lista e diz a hierarquia; NÃO é ele que libera
            módulo. Um departamento nível 9 sem nenhuma caixa marcada continua
            sem ver nada — quem libera são as caixas do cartão. */}
        <label className="flex w-full flex-col gap-1.5 sm:w-24">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Nível
          </span>
          <input
            type="number"
            min={1}
            max={99}
            value={nivel}
            onChange={(e) => setNivel(e.target.value)}
            className={`${campoTexto} text-center`}
          />
        </label>

        <button
          type="button"
          onClick={criar}
          disabled={!nome.trim() || salvando}
          className={botao}
        >
          <Plus className="size-4" aria-hidden="true" />
          Criar
        </button>
      </div>
    </div>
  );
}

// ── Cartão de um departamento ────────────────────────────────────────────────

function CartaoDepartamento({
  departamento: d,
  ehOMeu,
  pessoas,
  aoFalhar,
}: {
  departamento: DepartamentoConfig;
  ehOMeu: boolean;
  pessoas: ParticipanteConfig[];
  aoFalhar: (e: string | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(d.nome);
  const [salvando, iniciar] = useTransition();

  function rodar(acao: () => Promise<unknown>, queixa: string) {
    aoFalhar(null);
    iniciar(async () => {
      try {
        await acao();
      } catch (e) {
        aoFalhar(e instanceof Error ? e.message : queixa);
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800/70">
        {editando ? (
          <>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  rodar(
                    () => renomearDepartamento(d.id, nome),
                    "Falha ao renomear",
                  );
                  setEditando(false);
                }
                if (e.key === "Escape") {
                  setNome(d.nome);
                  setEditando(false);
                }
              }}
              autoFocus
              aria-label="Nome do departamento"
              className={`${campoTexto} max-w-56`}
            />
            <button
              type="button"
              aria-label="Salvar nome"
              onClick={() => {
                rodar(() => renomearDepartamento(d.id, nome), "Falha ao renomear");
                setEditando(false);
              }}
              className="text-zinc-400 transition hover:text-emerald-600"
            >
              <Check className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Cancelar"
              onClick={() => {
                setNome(d.nome);
                setEditando(false);
              }}
              className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
              {d.nome}
            </h3>
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label={`Renomear ${d.nome}`}
              className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </button>
          </>
        )}

        <Etiqueta>nível {d.nivel}</Etiqueta>
        <Etiqueta>
          {pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}
        </Etiqueta>
        {ehOMeu && <Etiqueta destaque>o seu</Etiqueta>}
        {d.sistema && <Etiqueta>do sistema</Etiqueta>}

        <div className="ml-auto flex items-center gap-2">
          {/* A chave da própria portaria. Fica no cabeçalho e não entre os
              módulos de propósito: não é um módulo — é o direito de editar esta
              tela. Ver o comentário da coluna em migration-departamentos.sql. */}
          <label
            className="flex items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-300"
            title="Pode criar departamentos e mudar permissões — inclusive as suas"
          >
            <input
              type="checkbox"
              checked={d.gerenciaAcessos}
              disabled={salvando}
              onChange={(e) =>
                rodar(
                  () => definirGerenciaAcessos(d.id, e.target.checked),
                  "Falha ao mudar a administração de acessos",
                )
              }
              className="size-3.5 accent-zinc-900 dark:accent-zinc-100"
            />
            <KeyRound className="size-3.5 text-zinc-400" aria-hidden="true" />
            Administra acessos
          </label>

          {!d.sistema && (
            <button
              type="button"
              disabled={salvando}
              onClick={() =>
                rodar(() => apagarDepartamento(d.id), "Falha ao apagar")
              }
              aria-label={`Apagar ${d.nome}`}
              className="text-zinc-400 transition hover:text-red-600 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-x-4 gap-y-1 p-4 sm:grid-cols-2">
        {MODULOS.map((m) => {
          const escopo = d.modulos[m.chave];
          const ligado = escopo !== undefined;
          return (
            <div
              key={m.chave}
              className="flex items-center gap-2 py-1"
              title={m.descricao}
            >
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={ligado}
                  disabled={salvando}
                  onChange={(e) =>
                    rodar(
                      () => definirModulo(d.id, m.chave, e.target.checked),
                      "Falha ao mudar o módulo",
                    )
                  }
                  className="size-3.5 shrink-0 accent-zinc-900 dark:accent-zinc-100"
                />
                <span className="truncate text-[13px] text-zinc-700 dark:text-zinc-300">
                  {m.rotulo}
                </span>
              </label>

              {/* O seletor de escopo só existe pra módulo que sabe filtrar por
                  dono, e só quando ele está ligado. Mostrar "próprio/todos"
                  numa tela que não filtra seria prometer o que o dado não
                  cumpre — ver `escopavel` em lib/auth/modulos.ts. */}
              {m.escopavel && ligado && (
                <select
                  value={escopo}
                  disabled={salvando}
                  aria-label={`Escopo de ${m.rotulo}`}
                  onChange={(e) =>
                    rodar(
                      () =>
                        definirEscopoDoModulo(
                          d.id,
                          m.chave,
                          e.target.value as Escopo,
                        ),
                      "Falha ao mudar o escopo",
                    )
                  }
                  className="shrink-0 rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-[12px] text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <option value="proprio">só o próprio</option>
                  <option value="todos">de todos</option>
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Etiqueta({
  children,
  destaque,
}: {
  children: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        destaque
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
      }`}
    >
      {children}
    </span>
  );
}

// ── Participantes ────────────────────────────────────────────────────────────

function Participantes({
  participantes,
  departamentos,
  usuarioIdAtual,
  aoFalhar,
}: {
  participantes: ParticipanteConfig[];
  departamentos: DepartamentoConfig[];
  usuarioIdAtual: string;
  aoFalhar: (e: string | null) => void;
}) {
  const [salvando, iniciar] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <UserCog className="size-3.5 text-zinc-400" aria-hidden="true" />
          Participantes
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Só quem tem login aparece aqui. Usuário que existe apenas para assinar
          card e mensagem não entra em departamento — ele não entra no sistema.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {participantes.length === 0 ? (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhuma conta com login ainda.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {participantes.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  {p.iniciais}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-zinc-900 dark:text-zinc-50">
                    {p.nome}
                    {p.id === usuarioIdAtual && (
                      <span className="text-zinc-400 dark:text-zinc-500"> · você</span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                    {p.email}
                  </span>
                </span>

                <select
                  value={p.departamentoId ?? ""}
                  disabled={salvando}
                  aria-label={`Departamento de ${p.nome}`}
                  onChange={(e) => {
                    const destino = e.target.value || null;
                    aoFalhar(null);
                    iniciar(async () => {
                      try {
                        await moverParticipante(p.id, destino);
                      } catch (err) {
                        aoFalhar(
                          err instanceof Error ? err.message : "Falha ao mover",
                        );
                      }
                    });
                  }}
                  className="shrink-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-[13px] text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  {/* "Sem departamento" é opção de verdade, não erro: é o
                      estado de quem saiu do time e cujo histórico fica. Quem
                      está aqui não vê módulo nenhum. */}
                  <option value="">Sem departamento</option>
                  {departamentos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
