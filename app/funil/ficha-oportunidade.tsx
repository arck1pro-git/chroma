"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AtSign,
  CalendarDays,
  Camera,
  ChevronRight,
  Clock,
  Layers,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Pause,
  Paperclip,
  Play,
  Workflow,
  Phone,
  User,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
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
import { brl, dataCurta, dataHora } from "../formato";
import {
  anexarAtendimento,
  automacoesDaOportunidade,
  pausarAutomacao,
  retomarAutomacao,
} from "./actions";
import type { AutomacaoDaEntidade } from "@/lib/automacoes/repositorio";
import { CamposDoContato, ListaCampos } from "../components/campos-personalizados";

// Mesmo mapa do /chat (app/chat/chat.tsx) — duplicado de propósito: são só 3
// linhas e os dois lados vivem em módulos diferentes o bastante pra uma
// abstração compartilhada custar mais do que economiza aqui.
const CANAL: Record<
  Atendimento["canal"],
  { rotulo: string; Icone: LucideIcon }
> = {
  whatsapp: { rotulo: "WhatsApp", Icone: MessageCircle },
  whatsapp_oficial: { rotulo: "WhatsApp API", Icone: MessageCircle },
  instagram: { rotulo: "Instagram", Icone: Camera },
  email: { rotulo: "E-mail", Icone: Mail },
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

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return (partes[0][0] + (partes.at(-1)?.[0] ?? "")).toUpperCase();
}

function Secao({
  Icone,
  titulo,
  contagem,
  children,
}: {
  Icone: LucideIcon;
  titulo: string;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        <Icone className="size-3.5" aria-hidden="true" />
        {titulo}
        {contagem !== undefined && contagem > 0 && (
          <span className="tabular-nums text-zinc-300 dark:text-zinc-600">
            {contagem}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
      {children}
    </p>
  );
}

function Campo({
  Icone,
  children,
}: {
  Icone: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-300">
      <Icone className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </p>
  );
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
  aoFechar: () => void;
}) {
  const [aba, setAba] = useState<"oportunidade" | "cliente">("oportunidade");
  const [, startTransition] = useTransition();

  const etapa = etapaPorId.get(oportunidade.etapa_id);
  const funil = funilPorId.get(oportunidade.funil_id);
  const responsavel = oportunidade.responsavel_id
    ? usuarioPorId.get(oportunidade.responsavel_id)
    : undefined;

  // Dados do cliente, só carregados quando há contato vinculado.
  const oportunidades = contato ? (oportunidadesDoContato.get(contato.id) ?? []) : [];
  const historico = contato ? (historicoDoContato.get(contato.id) ?? []) : [];
  const anotacoes = contato ? (anotacoesDoContato.get(contato.id) ?? []) : [];
  const segmentos = contato ? (segmentosDoContato.get(contato.id) ?? []) : [];
  const tags = contato ? (tagsDoContato.get(contato.id) ?? []) : [];
  const atendimentos = contato ? (atendimentosDoContato.get(contato.id) ?? []) : [];

  function aoAnexar(atendimentoId: string) {
    startTransition(() => anexarAtendimento(atendimentoId, oportunidade.id));
  }

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
    const r =
      a.estado === "pausada"
        ? await retomarAutomacao(a.execucao_id)
        : await pausarAutomacao(a.execucao_id);
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

  const noCliente = aba === "cliente" && contato;

  return (
    <>
      <div
        className="veu-surge fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={aoFechar}
        aria-hidden="true"
      />

      <aside
        className="ficha-entra fixed bottom-4 right-4 top-4 z-50 flex w-[26rem] max-w-[92vw] flex-col overflow-y-auto rounded-4xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        aria-label={`Oportunidade ${oportunidade.nome}`}
      >
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              {noCliente ? (
                <span className="text-xs font-semibold">
                  {contato ? iniciais(contato.nome) : "—"}
                </span>
              ) : (
                <Wallet className="size-4" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {noCliente ? contato?.nome : oportunidade.nome}
              </h2>
              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {noCliente
                  ? `${contato?.cidade}/${contato?.estado}`
                  : `${funil?.nome} · ${etapa?.nome}`}
              </p>
            </div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* Alterna entre os dados da oportunidade e os do cliente. */}
          <div className="mt-3 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            {(["oportunidade", "cliente"] as const).map((chave) => {
              const ativo = aba === chave;
              const desativado = chave === "cliente" && !contato;
              return (
                <button
                  key={chave}
                  type="button"
                  onClick={() => setAba(chave)}
                  disabled={desativado}
                  className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition disabled:opacity-40 ${
                    ativo
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                  }`}
                >
                  {chave === "cliente" ? "Cliente" : "Oportunidade"}
                </button>
              );
            })}
          </div>
        </header>

        {aba === "oportunidade" && (
          <>
            <div className="px-5 py-4">
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
                {brl(oportunidade.valor)}
              </p>
              <span className="mt-2 inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium capitalize text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                {oportunidade.status}
              </span>
            </div>

            <Secao Icone={Layers} titulo="Pipeline">
              <div className="flex flex-col gap-2">
                <Campo Icone={Layers}>
                  {funil?.nome} · {etapa?.nome}
                </Campo>
                <Campo Icone={Clock}>
                  {oportunidade.dias_na_etapa}{" "}
                  {oportunidade.dias_na_etapa === 1 ? "dia" : "dias"} na etapa
                </Campo>
                <Campo Icone={CalendarDays}>
                  Criada em {dataCurta(oportunidade.data_criacao)}
                </Campo>
              </div>
            </Secao>

            <Secao Icone={User} titulo="Responsável">
              {responsavel ? (
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {responsavel.iniciais}
                  </span>
                  <span className="text-[13px] text-zinc-700 dark:text-zinc-200">
                    {responsavel.nome}
                  </span>
                </div>
              ) : (
                <Vazio>Sem responsável</Vazio>
              )}
            </Secao>

            <Secao Icone={User} titulo="Cliente">
              {contato ? (
                <button
                  type="button"
                  onClick={() => setAba("cliente")}
                  className="group flex w-full items-center gap-3 rounded-xl border border-zinc-200 p-3 text-left transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {iniciais(contato.nome)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                      {contato.nome}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {contato.cidade}/{contato.estado} · ver dados do cliente
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-400"
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <Vazio>Sem contato vinculado</Vazio>
              )}
            </Secao>

            <ListaCampos
              definicoes={camposOportunidade}
              valores={oportunidade.campos}
            />
          </>
        )}

        {noCliente && (
          <>
            <div className="flex flex-col gap-2 px-5 py-4">
              <Campo Icone={Phone}>{contato.whatsapp}</Campo>
              <Campo Icone={AtSign}>{contato.email}</Campo>
              <Campo Icone={MapPin}>
                {contato.cidade}/{contato.estado} · {contato.pais}
              </Campo>
              <Campo Icone={CalendarDays}>
                Criado em {dataCurta(contato.data_criacao)}
              </Campo>
            </div>

            {(segmentos.length > 0 || tags.length > 0) && (
              <div className="flex flex-wrap gap-1.5 px-5 pb-4">
                {segmentos.map((s) => (
                  <span
                    key={s.id}
                    className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    {s.nome}
                  </span>
                ))}
                {tags.map((t) => (
                  <span
                    key={t.id}
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700"
                  >
                    {t.nome}
                  </span>
                ))}
              </div>
            )}

            <CamposDoContato contatoId={contato.id} definicoes={camposContato} />

            <Secao Icone={Wallet} titulo="Oportunidades" contagem={oportunidades.length}>
              {oportunidades.length === 0 ? (
                <Vazio>Nenhuma oportunidade para este contato</Vazio>
              ) : (
                <ul className="flex flex-col gap-2">
                  {oportunidades.map((o) => {
                    const et = etapaPorId.get(o.etapa_id);
                    const fu = funilPorId.get(o.funil_id);
                    const atual = o.id === oportunidade.id;

                    return (
                      <li
                        key={o.id}
                        className={`rounded-xl border p-3 ${
                          atual
                            ? "border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900"
                            : "border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                            {o.nome}
                          </p>
                          <p className="shrink-0 text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                            {brl(o.valor)}
                          </p>
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <span className={`size-1.5 rounded-full ${et?.cor}`} aria-hidden="true" />
                          <span className="truncate">
                            {fu?.nome} · {et?.nome}
                          </span>
                          {atual && (
                            <span className="ml-auto shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                              esta
                            </span>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>

            <Secao
              Icone={Workflow}
              titulo="Automações"
              contagem={automacoes?.length ?? 0}
            >
              {automacoes === null ? (
                <Vazio>Carregando…</Vazio>
              ) : automacoes.length === 0 ? (
                <Vazio>Este lead não está em nenhuma automação</Vazio>
              ) : (
                <ul className="flex flex-col gap-2">
                  {automacoes.map((a) => {
                    const pausada = a.estado === "pausada";
                    return (
                      <li
                        key={a.execucao_id}
                        className="flex items-center gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                            {a.fluxo_nome}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                            {a.etapa_id ? "Cadência da etapa · " : ""}
                            {pausada
                              ? "Pausada"
                              : a.retomar_em
                                ? `Retoma ${dataHora(a.retomar_em)}`
                                : ESTADO_EXECUCAO[a.estado] ?? a.estado}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => alternarAutomacao(a)}
                          disabled={mexendo === a.execucao_id}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          title={
                            pausada
                              ? "Voltar a rodar para este lead"
                              : "Parar esta automação só para este lead"
                          }
                        >
                          {pausada ? (
                            <Play className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Pause className="size-3.5" aria-hidden="true" />
                          )}
                          {pausada ? "Retomar" : "Pausar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {avisoAuto && (
                <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {avisoAuto}
                </p>
              )}
            </Secao>

            <Secao Icone={MessageCircle} titulo="Atendimentos" contagem={atendimentos.length}>
              {atendimentos.length === 0 ? (
                <Vazio>Nenhum atendimento com este contato</Vazio>
              ) : (
                <ul className="flex flex-col gap-2">
                  {atendimentos.map((a) => {
                    const { rotulo, Icone: IconeCanal } = CANAL[a.canal];
                    const anexado = a.oportunidade_id === oportunidade.id;

                    return (
                      <li
                        key={a.id}
                        className={`flex items-center gap-2 rounded-xl border p-3 ${
                          anexado
                            ? "border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900"
                            : "border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        {/* Link em vez de envolver a linha inteira: o botão de
                            anexar ao lado precisa do próprio clique, e <button>
                            dentro de <a> não é HTML válido. */}
                        <Link
                          href={`/chat?atendimento=${a.id}`}
                          className="group flex min-w-0 flex-1 items-center gap-2.5"
                        >
                          <IconeCanal
                            className="size-4 shrink-0 text-zinc-400 transition group-hover:text-zinc-600 dark:group-hover:text-zinc-300"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                              {rotulo}
                              {a.numero_instancia ? ` · ${a.numero_instancia}` : ""}
                            </span>
                            <span className="block truncate text-[11px] capitalize text-zinc-500 dark:text-zinc-400">
                              {a.status.replace("_", " ")}
                            </span>
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => aoAnexar(a.id)}
                          aria-label={
                            anexado
                              ? "Desanexar desta oportunidade"
                              : "Anexar a esta oportunidade"
                          }
                          title={
                            anexado
                              ? "Desanexar desta oportunidade"
                              : "Anexar a esta oportunidade"
                          }
                          className={`flex size-7 shrink-0 items-center justify-center rounded-md transition ${
                            anexado
                              ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                              : "text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                          }`}
                        >
                          <Paperclip className="size-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>

            <Secao Icone={MessageSquare} titulo="Anotações" contagem={anotacoes.length}>
              {anotacoes.length === 0 ? (
                <Vazio>Nada anotado sobre este contato</Vazio>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {anotacoes.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-inset ring-amber-100 dark:bg-amber-500/5 dark:ring-amber-500/15"
                    >
                      <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                        {a.texto}
                      </p>
                      <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                        {usuarioPorId.get(a.autor_id)?.nome ?? "Autor desconhecido"} ·{" "}
                        {dataHora(a.data_criacao)}
                        {a.data_atualizacao && " · editada"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>

            <Secao Icone={Clock} titulo="Histórico" contagem={historico.length}>
              {historico.length === 0 ? (
                <Vazio>Sem movimentações registradas</Vazio>
              ) : (
                <ul className="flex flex-col">
                  {historico.map((h, i) => (
                    <li key={h.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600"
                          aria-hidden="true"
                        />
                        {i < historico.length - 1 && (
                          <span
                            className="w-px flex-1 bg-zinc-200 dark:bg-zinc-800"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                      <div className="pb-4">
                        <p className="text-[13px] leading-snug text-zinc-700 dark:text-zinc-200">
                          {h.descricao}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                          {usuarioPorId.get(h.autor_id)?.nome ?? "Sistema"} ·{" "}
                          {dataHora(h.data_criacao)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </>
        )}
      </aside>
    </>
  );
}
