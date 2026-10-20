"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, MessageCircle, Pause, Play, Trash2, Workflow, X } from "lucide-react";
import type {
  Anotacao,
  Atendimento,
  CampoPersonalizado,
  Contato,
  Etapa,
  Funil,
  Historico,
  Oportunidade,
  Segmento,
  Tag,
  Usuario,
} from "../data";
import type { Ia } from "@/lib/ia/catalogo";
import { brl, dataCurta, dataHora } from "../formato";
import { telefoneLegivel } from "@/lib/telefone";
import {
  automacoesDaOportunidade,
  excluirOportunidade,
  moverParaResponsavel,
  mudarStatusOportunidade,
  pausarAutomacao,
  retomarAutomacao,
} from "./actions";
import { STATUS_OPORTUNIDADE, type StatusOportunidade } from "./status";
import type { AutomacaoDaEntidade } from "@/lib/automacoes/repositorio";
import { ListaCampos } from "../components/campos-personalizados";
import {
  Avatar,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  BotaoCopiar,
  BotaoIcone,
  Carregando,
  CascaGaveta,
  CorpoGaveta,
  IconeLinha,
  LINHA_FIXA,
  Propriedade,
  Propriedades,
  ReguaEtapas,
  Secao,
  Vazio,
} from "../components/gaveta";
import { CamposContato, SecoesContato } from "../contatos/detalhes";
import IaDoContato from "../inicio/ia-contato";
import ReunioesDaOportunidade from "./reunioes-oportunidade";

// A ficha da oportunidade, a gaveta que abre ao clicar num card do quadro.
// Redesenhada em 2026-10-20 com o kit de app/components/gaveta.tsx.
//
// O cabeçalho fica parado e responde, sem rolar, às quatro perguntas de quem
// abre um card: onde está (funil, etapa, há quanto tempo, a régua), quanto vale
// e em que pé está, com quem é (nome e número) — e o "Conversar", que é o que
// se vem fazer aqui na maior parte das vezes. Embaixo, duas abas de verdade:
// o NEGÓCIO (status, responsável, reuniões, automações, campos) e o CLIENTE
// (o que se sabe da pessoa). As automações moraram na aba Cliente, mas são
// desta oportunidade — voltaram para cá.

// A cor de cada status, e só quando ele está SELECIONADO. Verde e vermelho aqui
// não são série de gráfico, são estado — vêm com a palavra ao lado, nunca
// sozinhos, que é o que os mantém legíveis em daltonismo e em print cinza.
const CLASSE_STATUS: Record<StatusOportunidade, string> = {
  aberta: "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:text-zinc-50 dark:ring-white/5",
  ganha: "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500 dark:text-zinc-950",
  perdida: "bg-rose-600 text-white shadow-sm dark:bg-rose-500 dark:text-zinc-950",
};

// Estado da inscrição em palavras. 'pendente' quase nunca aparece — é a janela
// entre criar a linha e o motor dar o primeiro sinal —, mas quando aparece,
// "pendente" sozinho não diz nada a quem está olhando a ficha.
const ESTADO_EXECUCAO: Record<string, string> = {
  pendente: "Entrando no fluxo",
  rodando: "Em execução",
  esperando: "Aguardando",
  pausada: "Pausada",
};

type Aba = "oportunidade" | "cliente";

/** A conversa do botão "Conversar": a aberta mais recente, ou a última que houve. */
function conversaPrincipal(atendimentos: Atendimento[]): Atendimento | null {
  const recentes = [...atendimentos].sort((a, b) => b.data_criacao.localeCompare(a.data_criacao));
  return recentes.find((a) => a.status !== "encerrado") ?? recentes[0] ?? null;
}

export default function FichaOportunidade({
  oportunidade,
  contato,
  etapaPorId,
  funilPorId,
  usuarioPorId,
  oportunidadesDoContato,
  historicoDoContato,
  anotacoesDoContato,
  segmentosDoContato,
  tagsDoContato,
  atendimentosDoContato,
  camposContato,
  camposOportunidade,
  ias,
  aoAbrirOportunidade,
  aoFechar,
}: {
  oportunidade: Oportunidade;
  contato: Contato | undefined;
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
  oportunidadesDoContato: Map<string, Oportunidade[]>;
  historicoDoContato: Map<string, Historico[]>;
  anotacoesDoContato: Map<string, Anotacao[]>;
  segmentosDoContato: Map<string, Segmento[]>;
  tagsDoContato: Map<string, Tag[]>;
  atendimentosDoContato: Map<string, Atendimento[]>;
  camposContato: CampoPersonalizado[];
  camposOportunidade: CampoPersonalizado[];
  ias: Ia[];
  aoAbrirOportunidade?: (id: string) => void;
  aoFechar: () => void;
}) {
  const [aba, setAba] = useState<Aba>("oportunidade");

  const etapa = etapaPorId.get(oportunidade.etapa_id);
  const funil = funilPorId.get(oportunidade.funil_id);
  const etapasDoFunil = [...etapaPorId.values()]
    .filter((e) => e.funil_id === oportunidade.funil_id)
    .sort((a, b) => a.ordem - b.ordem);
  const responsavel = oportunidade.responsavel_id ? usuarioPorId.get(oportunidade.responsavel_id) : undefined;

  // Dados do cliente, só carregados quando há contato vinculado.
  const oportunidades = contato ? (oportunidadesDoContato.get(contato.id) ?? []) : [];
  const historico = contato ? (historicoDoContato.get(contato.id) ?? []) : [];
  const anotacoes = contato ? (anotacoesDoContato.get(contato.id) ?? []) : [];
  const segmentos = contato ? (segmentosDoContato.get(contato.id) ?? []) : [];
  const tags = contato ? (tagsDoContato.get(contato.id) ?? []) : [];
  const atendimentos = contato ? (atendimentosDoContato.get(contato.id) ?? []) : [];
  const conversa = conversaPrincipal(atendimentos);

  // ── Automações em que este lead está ──────────────────────────────────────
  // Buscadas ao abrir a ficha, não junto do funil: é uma consulta por
  // oportunidade, e a raiz já carrega a base inteira (mesma decisão dos campos
  // personalizados). null = ainda carregando, e a tela diz isso.
  // A carga guarda de QUAL oportunidade é a lista. Assim "carregando" é
  // derivado (id guardado ≠ id em tela) em vez de um setState(null) no corpo do
  // efeito — que dispara render em cascata e é o que o
  // react-hooks/set-state-in-effect reclama. De quebra, resposta atrasada de
  // uma ficha anterior não consegue se passar pela desta.
  const [carga, setCarga] = useState<{
    opId: string;
    lista: AutomacaoDaEntidade[];
  } | null>(null);
  const automacoes = carga?.opId === oportunidade.id ? carga.lista : null;

  const [mexendo, setMexendo] = useState<string | null>(null);
  const [avisoAuto, setAvisoAuto] = useState<string | null>(null);

  // ── Status ────────────────────────────────────────────────────────────────
  // Guarda de QUAL oportunidade é a mudança, pelo mesmo motivo de `carga`: a
  // ficha é reaproveitada ao abrir outro card, e um estado local solto mostraria
  // nela o status do anterior até o servidor responder.
  const [mudanca, setMudanca] = useState<{
    opId: string;
    status: StatusOportunidade;
  } | null>(null);
  const status = mudanca?.opId === oportunidade.id ? mudanca.status : oportunidade.status;

  const [salvandoStatus, salvarStatus] = useTransition();
  const [avisoStatus, setAvisoStatus] = useState<string | null>(null);

  function mudarStatus(novo: StatusOportunidade) {
    // Otimista: o botão acende na hora. O revalidatePath da action traz o valor
    // do banco logo atrás, e é ele que vale — se a escrita falhar, o aviso
    // aparece e a prop devolve o status verdadeiro.
    setMudanca({ opId: oportunidade.id, status: novo });
    setAvisoStatus(null);
    salvarStatus(async () => {
      const r = await mudarStatusOportunidade(oportunidade.id, novo);
      if (!r.ok) {
        setMudanca(null);
        setAvisoStatus(r.mensagem);
      }
    });
  }

  // ── Excluir ───────────────────────────────────────────────────────────────
  const [excluindo, excluirAgora] = useTransition();
  const [avisoExcluir, setAvisoExcluir] = useState<string | null>(null);

  function excluir() {
    if (
      !window.confirm(
        `Excluir a oportunidade "${oportunidade.nome}"?\n\nO CONTATO NÃO é excluído — ele continua na base com as anotações, as conversas e as outras oportunidades.\n\nO que some: este negócio, o histórico dele e as automações em que ele estava inscrito.`,
      )
    ) {
      return;
    }
    setAvisoExcluir(null);
    excluirAgora(async () => {
      const r = await excluirOportunidade(oportunidade.id);
      // Fecha só no sucesso: fechar em cima de um erro esconderia o motivo.
      if (r.ok) aoFechar();
      else setAvisoExcluir(r.mensagem);
    });
  }

  useEffect(() => {
    let vivo = true;
    const opId = oportunidade.id;
    automacoesDaOportunidade(opId)
      .then((lista) => vivo && setCarga({ opId, lista }))
      // Falhar aqui vira "nenhuma automação", não uma ficha quebrada: a
      // consulta é acessória, o resto da ficha já está na tela.
      .catch(() => vivo && setCarga({ opId, lista: [] }));
    return () => {
      vivo = false;
    };
  }, [oportunidade.id]);

  async function alternarAutomacao(a: AutomacaoDaEntidade) {
    setMexendo(a.execucao_id);
    setAvisoAuto(null);
    const r = a.estado === "pausada" ? await retomarAutomacao(a.execucao_id) : await pausarAutomacao(a.execucao_id);
    setAvisoAuto(r.mensagem);
    // Relê em vez de mexer no estado local: o retomar decide entre 'esperando'
    // e 'pendente' no banco, e adivinhar isso aqui daria uma tela que discorda
    // do que ficou gravado.
    setCarga({
      opId: oportunidade.id,
      lista: await automacoesDaOportunidade(oportunidade.id),
    });
    setMexendo(null);
  }

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const dias = oportunidade.dias_na_etapa;
  const telefone = contato ? telefoneLegivel(contato.whatsapp) : "";

  return (
    <CascaGaveta rotulo={`Oportunidade ${oportunidade.nome}`} aoFechar={aoFechar}>
      <header className="shrink-0 px-5 pt-4">
        {/* Onde está: funil › etapa · há quanto tempo. O nome do funil e o da
            etapa aparecem UMA vez — a seção "Pipeline" que repetia isso saiu. */}
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-zinc-500 dark:text-zinc-400">
            <span className={`size-2 shrink-0 rounded-full ${etapa?.cor ?? "bg-zinc-300"}`} aria-hidden="true" />
            <span className="truncate">{funil?.nome}</span>
            <ChevronRight className="size-3 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
            <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{etapa?.nome}</span>
            <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">
              · {dias} {dias === 1 ? "dia" : "dias"}
            </span>
          </p>
          <BotaoIcone Icone={X} rotulo="Fechar" onClick={aoFechar} className="-mr-2" />
        </div>

        <div className="mt-1 flex items-start justify-between gap-4">
          <h2 className="line-clamp-2 text-[19px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            {oportunidade.nome}
          </h2>
          <p
            className="shrink-0 pt-px text-[19px] font-semibold leading-snug tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50"
            title={brl(oportunidade.valor)}
          >
            {oportunidade.valor > 0 ? (
              brl(oportunidade.valor)
            ) : (
              <span className="text-[13px] font-medium text-zinc-400 dark:text-zinc-500">Sem valor</span>
            )}
          </p>
        </div>

        <div className="mt-3">
          <ReguaEtapas etapas={etapasDoFunil} atualId={oportunidade.etapa_id} />
        </div>

        {contato && (
          <div className="mt-4 flex items-center gap-3">
            <Avatar nome={contato.nome} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{contato.nome}</p>
              <p className="flex items-center text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {telefone ? (
                  <>
                    <span className="truncate">{telefone}</span>
                    <BotaoCopiar texto={contato.whatsapp.replace(/\D/g, "")} rotulo="número" />
                  </>
                ) : (
                  "Sem WhatsApp"
                )}
              </p>
            </div>
            {conversa && (
              <Link href={`/chat?atendimento=${conversa.id}`} className={BOTAO_PRIMARIO}>
                <MessageCircle className="size-3.5" aria-hidden="true" />
                Conversar
              </Link>
            )}
          </div>
        )}

        <div role="tablist" aria-label="Seções da ficha" className="mt-4 flex gap-6 border-b border-zinc-100 dark:border-zinc-900">
          {(["oportunidade", "cliente"] as const).map((chave) => {
            const ativo = aba === chave;
            const desativado = chave === "cliente" && !contato;
            return (
              <button
                key={chave}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => setAba(chave)}
                disabled={desativado}
                className={`relative -mb-px border-b-2 pb-2.5 text-[13px] font-medium transition disabled:opacity-40 ${
                  ativo
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {chave === "cliente" ? "Cliente" : "Oportunidade"}
                {chave === "cliente" && anotacoes.length > 0 && (
                  <span className="ml-1.5 tabular-nums text-zinc-400 dark:text-zinc-500" title={`${anotacoes.length} anotações`}>
                    {anotacoes.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <CorpoGaveta>
        {aba === "oportunidade" && (
          <>
            {/* O status é controle, não selo: clicar em "Ganha" É marcar como
                ganha; não há Salvar. A cor só aparece no escolhido — três
                botões coloridos ao mesmo tempo seriam decoração. */}
            <div className="px-5 py-4">
              <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900" role="group" aria-label="Status da oportunidade">
                {STATUS_OPORTUNIDADE.map((s) => {
                  const ativo = status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => mudarStatus(s)}
                      disabled={salvandoStatus || ativo}
                      aria-pressed={ativo}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium capitalize transition disabled:cursor-default ${
                        ativo
                          ? CLASSE_STATUS[s]
                          : "text-zinc-500 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-50"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              {avisoStatus && <p className="mt-2 text-[11.5px] text-red-500">{avisoStatus}</p>}
            </div>

            <Secao titulo="Detalhes">
              <Propriedades>
                <Propriedade rotulo="Responsável">
                  <CampoResponsavel
                    oportunidadeId={oportunidade.id}
                    responsavel={responsavel ?? null}
                    usuarios={[...usuarioPorId.values()]}
                  />
                </Propriedade>
                <Propriedade rotulo="Criada em">{dataCurta(oportunidade.data_criacao)}</Propriedade>
                {!contato && <Propriedade rotulo="Cliente">Sem contato vinculado</Propriedade>}
              </Propriedades>
            </Secao>

            <ReunioesDaOportunidade oportunidadeId={oportunidade.id} usuarioPorId={usuarioPorId} />

            <Secao titulo="Automações" contagem={automacoes?.length ?? 0}>
              {automacoes === null ? (
                <Carregando />
              ) : automacoes.length === 0 ? (
                <Vazio>Fora de qualquer automação</Vazio>
              ) : (
                <ul className="flex flex-col">
                  {automacoes.map((a) => {
                    const pausada = a.estado === "pausada";
                    return (
                      <li key={a.execucao_id} className={LINHA_FIXA}>
                        <IconeLinha Icone={Workflow} tom={pausada ? "neutro" : "ativo"} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{a.fluxo_nome}</span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500 dark:text-zinc-400">
                            {a.etapa_id ? "Cadência da etapa · " : ""}
                            {pausada
                              ? "Pausada"
                              : a.retomar_em
                                ? `Próximo passo ${dataHora(a.retomar_em)}`
                                : (ESTADO_EXECUCAO[a.estado] ?? a.estado)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => alternarAutomacao(a)}
                          disabled={mexendo === a.execucao_id}
                          className={`${BOTAO_SECUNDARIO} ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800`}
                          title={pausada ? "Voltar a rodar para este lead" : "Parar esta automação só para este lead"}
                        >
                          {pausada ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
                          {pausada ? "Retomar" : "Pausar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {avisoAuto && <p className="mt-2 text-[11.5px] text-zinc-500 dark:text-zinc-400">{avisoAuto}</p>}
            </Secao>

            <ListaCampos definicoes={camposOportunidade} valores={oportunidade.campos} titulo="Campos da oportunidade" />

            {/* No fim e discreto de propósito: é destrutivo e não é o que se vem
                fazer aqui. A confirmação diz o que NÃO acontece (o contato
                fica), que é a dúvida real de quem clica. */}
            <div className="border-t border-zinc-100 px-5 pt-4 dark:border-zinc-900">
              <button
                type="button"
                onClick={excluir}
                disabled={excluindo}
                className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                {excluindo ? "Excluindo…" : "Excluir oportunidade"}
              </button>
              {avisoExcluir && <p className="mt-1 text-[11.5px] text-red-500">{avisoExcluir}</p>}
            </div>
          </>
        )}

        {aba === "cliente" && contato && (
          <>
            {/* Nome e número já estão no cabeçalho: aqui só o resto. */}
            <CamposContato contato={contato} segmentos={segmentos} tags={tags} semTelefone />
            <IaDoContato
              // Remonta por contato: o valor otimista é do contato aberto.
              key={contato.id}
              contato={contato}
              oportunidades={oportunidades}
              etapaPorId={etapaPorId}
              funilPorId={funilPorId}
              ias={ias}
            />
            <SecoesContato
              contato={contato}
              oportunidades={oportunidades}
              anotacoes={anotacoes}
              historico={historico}
              atendimentos={atendimentos}
              camposContato={camposContato}
              oportunidadeAtualId={oportunidade.id}
              etapaPorId={etapaPorId}
              funilPorId={funilPorId}
              usuarioPorId={usuarioPorId}
              aoAbrirOportunidade={aoAbrirOportunidade}
            />
          </>
        )}
      </CorpoGaveta>
    </CascaGaveta>
  );
}

/**
 * Quem cuida desta oportunidade — e a troca, ali mesmo.
 *
 * O responsável SÓ PODE SER UMA CONTA DO SISTEMA: a lista sai de `usuarios`, a
 * mesma que alimenta a barra de seleção do quadro. Não há campo livre, e a
 * razão é que este campo decidiu virar permissão — com o módulo Dashboard no
 * escopo "próprio", é ele que diz quem enxerga a oportunidade. Nome digitado à
 * mão não dá acesso a ninguém e esconderia a oportunidade de todo mundo.
 *
 * Reusa `moverParaResponsavel`, a ação que o quadro já usava para o lote: a
 * mesma escrita, o mesmo registro no histórico. Uma segunda ação para "uma só"
 * divergiria na primeira mudança de regra.
 *
 * Um <select> nativo de verdade (teclado, leitor de tela, roda do tablet), mas
 * sem moldura: parece texto com a pessoa ao lado e acende no hover.
 */
function CampoResponsavel({
  oportunidadeId,
  responsavel,
  usuarios,
}: {
  oportunidadeId: string;
  responsavel: Usuario | null;
  usuarios: Usuario[];
}) {
  const [salvando, salvar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function trocar(id: string) {
    setErro(null);
    salvar(async () => {
      const r = await moverParaResponsavel([oportunidadeId], id || null);
      if (!r.ok) setErro(r.mensagem);
    });
  }

  return (
    <span className="flex min-w-0 flex-col">
      <label className="relative -ml-2 inline-flex min-w-0 max-w-full items-center gap-2 self-start rounded-lg py-0.5 pl-2 pr-7 transition hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-zinc-900/10 dark:hover:bg-zinc-900 dark:focus-within:ring-white/15">
        {responsavel ? (
          <Avatar nome={responsavel.nome} tamanho="sm" equipe />
        ) : (
          <span className="size-6 shrink-0 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700" aria-hidden="true" />
        )}
        <select
          value={responsavel?.id ?? ""}
          onChange={(e) => trocar(e.target.value)}
          disabled={salvando}
          aria-label="Responsável pela oportunidade"
          className="min-w-0 cursor-pointer appearance-none truncate bg-transparent text-[13px] text-zinc-900 outline-none disabled:opacity-50 dark:text-zinc-100 [&>option]:bg-white dark:[&>option]:bg-zinc-900"
        >
          <option value="">Sem responsável</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-zinc-400" aria-hidden="true" />
      </label>
      {erro && <span className="text-[11.5px] text-red-500">{erro}</span>}
    </span>
  );
}
