"use client";

// Acessos: quem vê o quê. A tela do departamento que administra.
//
// DUAS PARTES, e a ordem entre elas é a pergunta que a pessoa chega fazendo:
// primeiro "o que cada departamento alcança" (a grade), depois "de que
// departamento é o fulano" (os participantes). Inverter obrigaria a decidir o
// destino de alguém antes de saber o que aquele destino dá.
//
// A GRADE (redesenho de 2026-10-08): eram três cartões empilhados, cada um com
// as mesmas 18 caixinhas — para saber se o Comercial vê Automações era preciso
// rolar até o terceiro cartão e achar a linha. Agora módulo é LINHA e
// departamento é COLUNA: comparar dois departamentos é olhar para o lado, e a
// pergunta "quem vê Webhooks?" é uma linha só. Interruptor no lugar de caixa:
// ligar vale na hora, não espera um "salvar".
//
// Nada aqui decide acesso de verdade: isto grava linha em
// `departamento_modulos`. Quem barra é a DAL, a cada render de cada página
// (lib/auth/dal.ts). Desligar aqui fecha a porta no próximo carregamento da
// pessoa, mesmo com ela já logada.
import { useState, useTransition } from "react";
import {
  Check,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { MODULOS } from "@/lib/auth/modulos";
import type { ChaveModulo, Escopo } from "@/lib/auth/modulos";
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
import { botao, botaoFantasma, campoTexto, rotuloCampo } from "./ui";
import {
  Avatar,
  BotaoIcone,
  Cabecalho,
  Erro,
  Interruptor,
  Painel,
  PainelTopo,
} from "./pecas";

/**
 * O que a pessoa acabou de pedir e o servidor ainda não confirmou, por chave
 * (`depto:modulo`, `depto:escopo:modulo`, `depto:portaria`). A tela mostra o
 * pedido na hora; quando a action volta, o revalidate traz o valor real e a
 * chave sai daqui. Sem isso, cada interruptor ficaria parado até o servidor
 * responder — e a grade inteira parece travada.
 */
type Pendentes = Record<string, boolean | Escopo>;

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
  // Um único lugar de erro para a tela toda: as ações são muitas e pequenas, e
  // um aviso por interruptor encheria a grade de espaço vazio esperando por
  // mensagem que quase nunca vem.
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [pendentes, setPendentes] = useState<Pendentes>({});
  const [, iniciar] = useTransition();

  function rodar(chave: string, alvo: boolean | Escopo, acao: () => Promise<unknown>, queixa: string) {
    setErro(null);
    setPendentes((p) => ({ ...p, [chave]: alvo }));
    iniciar(async () => {
      try {
        await acao();
      } catch (e) {
        setErro(e instanceof Error ? e.message : queixa);
      } finally {
        setPendentes((p) => {
          const resto = { ...p };
          delete resto[chave];
          return resto;
        });
      }
    });
  }

  const departamentos = dados.departamentos;

  return (
    <section className="flex flex-col gap-6">
      <Cabecalho
        Icone={ShieldCheck}
        titulo="Acessos"
        descricao="Quem vê o quê. Cada departamento libera módulos, e cada pessoa pertence a um departamento. Departamento novo nasce sem nenhum módulo."
        acao={
          !criando && (
            <button type="button" onClick={() => setCriando(true)} className={botao}>
              <Plus className="size-4" aria-hidden="true" />
              Novo departamento
            </button>
          )
        }
      />

      {erro && <Erro>{erro}</Erro>}

      {criando && <NovoDepartamento aoFalhar={setErro} aoFechar={() => setCriando(false)} />}

      <Painel className="overflow-hidden">
        <PainelTopo
          titulo="Módulos por departamento"
          descricao="Desligar fecha a porta no próximo carregamento da pessoa, mesmo com ela já logada."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 shadow-[1px_0_0_0_#f4f4f5] dark:shadow-[1px_0_0_0_#27272a] w-[240px] min-w-[200px] bg-white px-5 pb-3 pt-4 align-bottom text-[11px] font-medium text-zinc-400 dark:bg-zinc-950 dark:text-zinc-500"
                >
                  Módulo
                </th>
                {departamentos.map((d) => (
                  <th
                    key={d.id}
                    scope="col"
                    className={`min-w-[180px] border-l border-zinc-100 px-4 pb-3 pt-4 align-top font-normal dark:border-zinc-800/80 ${
                      d.id === departamentoIdAtual ? "bg-zinc-50/70 dark:bg-zinc-900/40" : ""
                    }`}
                  >
                    <CabecaDepartamento
                      departamento={d}
                      ehOMeu={d.id === departamentoIdAtual}
                      pessoas={dados.participantes.filter((p) => p.departamentoId === d.id).length}
                      pendentes={pendentes}
                      rodar={rodar}
                      aoFalhar={setErro}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULOS.map((m) => (
                <tr key={m.chave} className="group border-t border-zinc-100 dark:border-zinc-800/80">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 shadow-[1px_0_0_0_#f4f4f5] dark:shadow-[1px_0_0_0_#27272a] bg-white px-5 py-2.5 align-middle font-normal transition-colors group-hover:bg-zinc-50 dark:bg-zinc-950 dark:group-hover:bg-zinc-900"
                  >
                    <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">{m.rotulo}</p>
                    <p className="max-w-[220px] truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={m.descricao}>
                      {m.descricao}
                    </p>
                  </th>
                  {departamentos.map((d) => (
                    <td
                      key={d.id}
                      className={`border-l border-zinc-100 px-4 py-2.5 align-middle transition-colors group-hover:bg-zinc-50/80 dark:border-zinc-800/80 dark:group-hover:bg-zinc-900/60 ${
                        d.id === departamentoIdAtual ? "bg-zinc-50/70 dark:bg-zinc-900/40" : ""
                      }`}
                    >
                      <CelulaModulo
                        departamento={d}
                        chave={m.chave}
                        rotuloModulo={m.rotulo}
                        escopavel={m.escopavel}
                        pendentes={pendentes}
                        rodar={rodar}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 dark:border-zinc-800">
                <th
                  scope="row"
                  className="sticky left-0 z-10 shadow-[1px_0_0_0_#f4f4f5] dark:shadow-[1px_0_0_0_#27272a] bg-white px-5 py-3 text-[12px] font-medium text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400"
                >
                  Liberados
                </th>
                {departamentos.map((d) => {
                  const n = Object.keys(d.modulos).length;
                  return (
                    <td
                      key={d.id}
                      className={`border-l border-zinc-100 px-4 py-3 dark:border-zinc-800/80 ${
                        d.id === departamentoIdAtual ? "bg-zinc-50/70 dark:bg-zinc-900/40" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] tabular-nums text-zinc-600 dark:text-zinc-300">
                          {n} de {MODULOS.length}
                        </span>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <span
                            className="block h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
                            style={{ width: `${(n / MODULOS.length) * 100}%` }}
                          />
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </Painel>

      <Participantes
        participantes={dados.participantes}
        departamentos={departamentos}
        usuarioIdAtual={usuarioIdAtual}
        aoFalhar={setErro}
      />
    </section>
  );
}

// ── Criar ────────────────────────────────────────────────────────────────────

function NovoDepartamento({
  aoFalhar,
  aoFechar,
}: {
  aoFalhar: (e: string | null) => void;
  aoFechar: () => void;
}) {
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
        aoFechar();
      } catch (e) {
        aoFalhar(e instanceof Error ? e.message : "Falha ao criar departamento");
      }
    });
  }

  return (
    <Painel className="surge overflow-hidden">
      <PainelTopo
        titulo="Novo departamento"
        descricao="Nasce sem nenhum módulo — ligue o que ele deve ver na grade, depois de criado."
        acao={
          <BotaoIcone rotulo="Fechar" onClick={aoFechar}>
            <X className="size-4" aria-hidden="true" />
          </BotaoIcone>
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_120px]">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={rotuloCampo}>Nome</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            autoFocus
            placeholder="Ex.: Suporte"
            className={campoTexto}
          />
        </label>
        {/* O nível ordena a grade e diz a hierarquia; NÃO é ele que libera
            módulo. Um departamento nível 9 sem nenhum interruptor ligado
            continua sem ver nada. */}
        <label className="flex flex-col gap-1.5">
          <span className={rotuloCampo}>Nível</span>
          <input
            type="number"
            min={1}
            max={99}
            value={nivel}
            onChange={(e) => setNivel(e.target.value)}
            className={`${campoTexto} tabular-nums`}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/30">
        <p className="mr-auto text-[12px] text-zinc-500 dark:text-zinc-400">
          O nível só ordena — quem libera é a grade.
        </p>
        <button type="button" onClick={aoFechar} className={botaoFantasma}>
          Cancelar
        </button>
        <button type="button" onClick={criar} disabled={!nome.trim() || salvando} className={botao}>
          <Plus className="size-4" aria-hidden="true" />
          {salvando ? "Criando…" : "Criar departamento"}
        </button>
      </div>
    </Painel>
  );
}

// ── Cabeça de coluna: um departamento ───────────────────────────────────────

function CabecaDepartamento({
  departamento: d,
  ehOMeu,
  pessoas,
  pendentes,
  rodar,
  aoFalhar,
}: {
  departamento: DepartamentoConfig;
  ehOMeu: boolean;
  pessoas: number;
  pendentes: Pendentes;
  rodar: (chave: string, alvo: boolean | Escopo, acao: () => Promise<unknown>, queixa: string) => void;
  aoFalhar: (e: string | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(d.nome);
  const [apagando, iniciarApagar] = useTransition();

  const chavePortaria = `${d.id}:portaria`;
  const portaria =
    pendentes[chavePortaria] !== undefined ? pendentes[chavePortaria] === true : d.gerenciaAcessos;

  function salvarNome() {
    const n = nome.trim();
    setEditando(false);
    if (!n || n === d.nome) {
      setNome(d.nome);
      return;
    }
    rodar(`${d.id}:nome`, true, () => renomearDepartamento(d.id, n), "Falha ao renomear");
  }

  function apagar() {
    if (!window.confirm(`Apagar o departamento "${d.nome}"? Os módulos dele vão junto.`)) return;
    aoFalhar(null);
    iniciarApagar(async () => {
      try {
        await apagarDepartamento(d.id);
      } catch (e) {
        aoFalhar(e instanceof Error ? e.message : "Falha ao apagar");
      }
    });
  }

  return (
    <div className="group/cabeca flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-1">
        {editando ? (
          <>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvarNome();
                if (e.key === "Escape") {
                  setNome(d.nome);
                  setEditando(false);
                }
              }}
              autoFocus
              aria-label="Nome do departamento"
              className={`${campoTexto} h-8 min-w-0 flex-1 px-2`}
            />
            <BotaoIcone rotulo="Salvar nome" onClick={salvarNome}>
              <Check className="size-4" aria-hidden="true" />
            </BotaoIcone>
          </>
        ) : (
          <>
            <span className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
              {d.nome}
            </span>
            {ehOMeu && (
              <span className="shrink-0 rounded-full bg-zinc-900 px-1.5 py-px text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                o seu
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover/cabeca:opacity-100 [@media(hover:none)]:opacity-100">
              <BotaoIcone rotulo={`Renomear ${d.nome}`} onClick={() => setEditando(true)} className="size-7">
                <Pencil className="size-3.5" aria-hidden="true" />
              </BotaoIcone>
              {!d.sistema && (
                <BotaoIcone rotulo={`Apagar ${d.nome}`} onClick={apagar} disabled={apagando} perigo className="size-7">
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </BotaoIcone>
              )}
            </div>
          </>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>nível {d.nivel}</span>
        <span aria-hidden="true">·</span>
        <span>
          {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"}
        </span>
        {d.sistema && (
          <span title="Departamento do sistema — não se apaga" className="text-zinc-300 dark:text-zinc-600">
            <Lock className="size-3" aria-label="do sistema" />
          </span>
        )}
      </p>

      {/* A chave da própria portaria. Fica na cabeça da coluna e não entre os
          módulos de propósito: não é um módulo — é o direito de editar esta
          tela. Ver o comentário da coluna em migration-departamentos.sql. */}
      <div
        className="flex items-center gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800/80"
        title="Pode criar departamentos e mudar permissões — inclusive as suas"
      >
        <KeyRound className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="flex-1 whitespace-nowrap text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
          Administra acessos
        </span>
        <Interruptor
          ligado={portaria}
          rotulo={`${d.nome} administra acessos`}
          aoMudar={(v) =>
            rodar(chavePortaria, v, () => definirGerenciaAcessos(d.id, v), "Falha ao mudar a administração de acessos")
          }
        />
      </div>
    </div>
  );
}

// ── Cruzamento: um módulo num departamento ──────────────────────────────────

function CelulaModulo({
  departamento: d,
  chave,
  rotuloModulo,
  escopavel,
  pendentes,
  rodar,
}: {
  departamento: DepartamentoConfig;
  chave: ChaveModulo;
  rotuloModulo: string;
  escopavel: boolean;
  pendentes: Pendentes;
  rodar: (chave: string, alvo: boolean | Escopo, acao: () => Promise<unknown>, queixa: string) => void;
}) {
  const chaveLigado = `${d.id}:${chave}`;
  const chaveEscopo = `${d.id}:escopo:${chave}`;
  const gravado = d.modulos[chave];
  const ligado =
    pendentes[chaveLigado] !== undefined ? pendentes[chaveLigado] === true : gravado !== undefined;
  const escopo = (pendentes[chaveEscopo] as Escopo | undefined) ?? gravado ?? "proprio";

  return (
    <div className="flex items-center gap-2">
      <Interruptor
        ligado={ligado}
        rotulo={`${rotuloModulo} em ${d.nome}`}
        aoMudar={(v) => rodar(chaveLigado, v, () => definirModulo(d.id, chave, v), "Falha ao mudar o módulo")}
      />
      {/* O escopo só existe pra módulo que sabe filtrar por dono, e só quando
          ele está ligado. Mostrar "próprio/todos" numa tela que não filtra
          seria prometer o que o dado não cumpre — ver `escopavel` em
          lib/auth/modulos.ts. */}
      {escopavel && ligado && (
        <select
          value={escopo}
          aria-label={`Escopo de ${rotuloModulo} em ${d.nome}`}
          onChange={(e) => {
            const novo = e.target.value as Escopo;
            rodar(chaveEscopo, novo, () => definirEscopoDoModulo(d.id, chave, novo), "Falha ao mudar o escopo");
          }}
          className="h-6 min-w-0 rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] font-medium text-zinc-600 outline-none transition hover:border-zinc-300 focus-visible:ring-4 focus-visible:ring-zinc-900/5 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <option value="todos">de todos</option>
          <option value="proprio">só o próprio</option>
        </select>
      )}
    </div>
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
  const departamentoPorId = new Map(departamentos.map((d) => [d.id, d]));

  return (
    <Painel className="overflow-hidden">
      <PainelTopo
        titulo={
          <span className="flex items-center gap-1.5">
            <UserCog className="size-3.5 text-zinc-400" aria-hidden="true" />
            Participantes
          </span>
        }
        contagem={participantes.length}
        descricao="Só quem tem login. Quem existe apenas para assinar card e mensagem não entra em departamento — não entra no sistema."
      />
      {participantes.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">
          Nenhuma conta com login ainda.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {participantes.map((p) => {
            const atual = p.departamentoId ? departamentoPorId.get(p.departamentoId) : undefined;
            return (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar nome={p.nome} iniciais={p.iniciais} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                    <span className="truncate">{p.nome}</span>
                    {p.id === usuarioIdAtual && (
                      <span className="shrink-0 rounded-full bg-zinc-900 px-1.5 py-px text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                        você
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">{p.email}</p>
                </div>

                <div className="relative w-48 shrink-0">
                  {atual?.gerenciaAcessos && (
                    <KeyRound
                      className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                      aria-hidden="true"
                    />
                  )}
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
                          aoFalhar(err instanceof Error ? err.message : "Falha ao mover");
                        }
                      });
                    }}
                    className={`${campoTexto} h-8 ${atual?.gerenciaAcessos ? "pl-8" : ""} ${
                      p.departamentoId ? "" : "text-zinc-400"
                    }`}
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Painel>
  );
}
