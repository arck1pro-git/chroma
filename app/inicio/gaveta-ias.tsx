"use client";

// Gaveta das IAs de atendimento — o botão IA do topo, ao lado do de contatos.
// Mesma gaveta da direita que a de contatos, com os mesmos dois níveis no
// mesmo painel: lista de IAs → formulário (criar ou editar).
//
// Criar uma IA é dar um nome, o prompt e marcar o que ela pode fazer (pedido
// dele, 2026-09-28). ONDE ela atende não é daqui: é o botão IA de cada coluna
// do quadro (etapas.ia_id) e o interruptor do contato. A lista só mostra onde
// cada uma está em uso, que é a pergunta antes de editar ou excluir.
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowRightLeft, Bot, ChevronRight, Clock3, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  ACOES_IA,
  LIMITE_NOME_IA,
  LIMITE_PALAVRA_IA,
  LIMITE_PROMPT_IA,
  MAX_RETOMADAS,
  type Ia,
} from "@/lib/ia/catalogo";
import CamadaTopo from "../components/camada-topo";
import type { Contato, Etapa, Funil } from "../data";
import { atualizarIa, criarIa, excluirIa } from "./acoes-ia";

type Uso = { etapas: string[]; contatos: number };

export default function GavetaIas({
  ias,
  etapas,
  contatos,
  funilPorId,
  aoFechar,
}: {
  ias: Ia[];
  etapas: Etapa[];
  contatos: Contato[];
  funilPorId: Map<string, Funil>;
  aoFechar: () => void;
}) {
  // null = lista; "nova" = criar; id = editar aquela IA.
  const [aberta, setAberta] = useState<"nova" | string | null>(null);
  // O que salvar deixou para avisar (o agendador das retomadas não ligou). Vai
  // na lista, para onde o formulário volta depois de salvar.
  const [aviso, setAviso] = useState<string | null>(null);
  const emEdicao = aberta && aberta !== "nova" ? (ias.find((i) => i.id === aberta) ?? null) : null;
  const noFormulario = aberta === "nova" || emEdicao !== null;

  // Onde cada IA atende: as etapas (com o funil quando há mais de um) e
  // quantos contatos a têm ligada à mão.
  const usoPorIa = useMemo(() => {
    const variosFunis = funilPorId.size > 1;
    const mapa = new Map<string, Uso>();
    const de = (id: string) => {
      const atual = mapa.get(id) ?? { etapas: [], contatos: 0 };
      mapa.set(id, atual);
      return atual;
    };
    for (const e of etapas) {
      if (!e.ia_id) continue;
      const funil = funilPorId.get(e.funil_id)?.nome;
      de(e.ia_id).etapas.push(variosFunis && funil ? `${e.nome} (${funil})` : e.nome);
    }
    for (const c of contatos) {
      if (c.ia === true && c.ia_id) de(c.ia_id).contatos += 1;
    }
    return mapa;
  }, [etapas, contatos, funilPorId]);

  // Esc desce um nível por vez, como na gaveta de contatos: do formulário
  // volta para a lista, da lista fecha. Fechar direto perderia o prompt
  // digitado sem a pessoa ter pedido.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (noFormulario) setAberta(null);
      else aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [noFormulario, aoFechar]);

  return (
    <CamadaTopo>
      <div
        className="veu-surge fixed inset-0 z-[300] bg-black/40 backdrop-blur-[1px]"
        onClick={aoFechar}
        aria-hidden="true"
      />

      <aside
        className="ficha-entra fixed bottom-4 right-4 top-4 z-[310] flex w-[25rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        aria-label="IAs de atendimento"
      >
        {noFormulario ? (
          <FormIa
            // Remonta por IA: os campos leem o valor inicial só na montagem.
            key={emEdicao?.id ?? "nova"}
            ia={emEdicao}
            uso={emEdicao ? (usoPorIa.get(emEdicao.id) ?? null) : null}
            aoVoltar={(novoAviso) => {
              setAviso(novoAviso ?? null);
              setAberta(null);
            }}
            aoFechar={aoFechar}
          />
        ) : (
          <>
            <header className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  IAs de atendimento
                </h2>
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  {ias.length}
                </span>
                <button
                  type="button"
                  onClick={() => setAberta("nova")}
                  aria-label="Nova IA"
                  title="Nova IA"
                  className="ml-auto shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={aoFechar}
                  aria-label="Fechar IAs"
                  className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                Quem responde os contatos no WhatsApp. Escolha a IA de cada etapa no botão IA da coluna.
              </p>
              {aviso && (
                <p
                  role="status"
                  className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
                >
                  <span className="min-w-0 flex-1">{aviso}</span>
                  <button
                    type="button"
                    onClick={() => setAviso(null)}
                    aria-label="Dispensar aviso"
                    className="-mr-1 shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </p>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {ias.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
                  <Bot className="size-8 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Nenhuma IA ainda</p>
                  <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Uma IA é um prompt — quem ela é e como conduz a conversa — mais o que ela pode fazer no CRM.
                  </p>
                  <button
                    type="button"
                    onClick={() => setAberta("nova")}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Criar a primeira IA
                  </button>
                </div>
              ) : (
                <ul className="flex flex-col gap-1 p-2">
                  {ias.map((ia) => (
                    <li key={ia.id}>
                      <button
                        type="button"
                        onClick={() => setAberta(ia.id)}
                        className="group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100"
                      >
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                          <Bot className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{ia.nome}</span>
                            {ia.palavra_chave && (
                              <span className="shrink-0 rounded bg-zinc-100 px-1 font-mono text-[10.5px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                {ia.palavra_chave}
                              </span>
                            )}
                            {ia.acoes.includes("mover_etapa") && (
                              <ArrowRightLeft
                                className="size-3 shrink-0 text-violet-500"
                                aria-label="Move entre etapas"
                              />
                            )}
                            {ia.retomar_apos.length > 0 && (
                              <Clock3
                                className="size-3 shrink-0 text-violet-500"
                                aria-label={`Retoma quem não responde (${ia.retomar_apos.length}×)`}
                              />
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                            {fraseUso(usoPorIa.get(ia.id))}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-[12px] leading-snug text-zinc-400 dark:text-zinc-500">
                            {ia.prompt}
                          </span>
                        </span>
                        <ChevronRight
                          className="mt-2 size-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </aside>
    </CamadaTopo>
  );
}

function fraseUso(uso: Uso | undefined): string {
  if (!uso || (uso.etapas.length === 0 && uso.contatos === 0)) return "Não está atendendo em nenhuma etapa";
  const partes: string[] = [];
  if (uso.etapas.length) partes.push(`${uso.etapas.length === 1 ? "Etapa" : "Etapas"}: ${uso.etapas.join(", ")}`);
  if (uso.contatos) partes.push(`${uso.contatos} contato${uso.contatos === 1 ? "" : "s"} à mão`);
  return partes.join(" · ");
}

// ── As retomadas ────────────────────────────────────────────────────────────

// O banco guarda minutos (ias.retomar_apos); a tela mostra na maior unidade
// que dá conta inteira: 1440 → "1 dia", 180 → "3 horas", 90 → "90 minutos".
type Unidade = "min" | "h" | "d";
type Passo = { valor: string; unidade: Unidade };
const MINUTOS: Record<Unidade, number> = { min: 1, h: 60, d: 1440 };

function paraPasso(minutos: number): Passo {
  if (minutos % 1440 === 0) return { valor: String(minutos / 1440), unidade: "d" };
  if (minutos % 60 === 0) return { valor: String(minutos / 60), unidade: "h" };
  return { valor: String(minutos), unidade: "min" };
}

/** Os minutos de cada passo, ou null se algum não é um número positivo. */
function paraMinutos(passos: Passo[]): number[] | null {
  const minutos = passos.map((p) => Math.round(Number(p.valor.replace(",", ".")) * MINUTOS[p.unidade]));
  return minutos.every((m) => Number.isFinite(m) && m > 0) ? minutos : null;
}

const CAMPO_PEQUENO =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-[13px] text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

// ── O formulário ────────────────────────────────────────────────────────────

function FormIa({
  ia,
  uso,
  aoVoltar,
  aoFechar,
}: {
  ia: Ia | null;
  uso: Uso | null;
  /** Volta para a lista; `aviso` é o que salvar deixou para dizer. */
  aoVoltar: (aviso?: string) => void;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(ia?.nome ?? "");
  const [prompt, setPrompt] = useState(ia?.prompt ?? "");
  // IA nova já nasce podendo passar para uma pessoa: era o comportamento de
  // todas antes de virar ação.
  const [acoes, setAcoes] = useState<string[]>(ia?.acoes ?? ["passar_para_humano"]);
  const [palavra, setPalavra] = useState(ia?.palavra_chave ?? "");
  const [passos, setPassos] = useState<Passo[]>(() => (ia?.retomar_apos ?? []).map(paraPasso));
  const [das, setDas] = useState(ia?.retomar_das ?? 9);
  const [ate, setAte] = useState(ia?.retomar_ate ?? 19);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const [excluindo, iniciarExclusao] = useTransition();
  const [armado, setArmado] = useState(false);

  const pronto = nome.trim().length > 0 && prompt.trim().length > 0;

  function salvar() {
    if (!pronto || salvando) return;
    setErro(null);
    const retomarApos = paraMinutos(passos);
    if (!retomarApos) {
      setErro("Preencha o tempo de cada retomada.");
      return;
    }
    const dados = { nome, prompt, acoes, palavra, retomarApos, retomarDas: das, retomarAte: ate };
    iniciar(async () => {
      const r = ia ? await atualizarIa(ia.id, dados) : await criarIa(dados);
      if (r.erro) setErro(r.erro);
      else aoVoltar(r.aviso);
    });
  }

  function mudarPasso(i: number, mudanca: Partial<Passo>) {
    setPassos((atual) => atual.map((p, j) => (j === i ? { ...p, ...mudanca } : p)));
  }

  // A primeira sugere 3 horas; as seguintes, 1 dia.
  function adicionarPasso() {
    setPassos((atual) => [...atual, atual.length === 0 ? { valor: "3", unidade: "h" } : { valor: "1", unidade: "d" }]);
  }

  function excluir() {
    if (!ia) return;
    setErro(null);
    iniciarExclusao(async () => {
      const r = await excluirIa(ia.id);
      if (r.erro) setErro(r.erro);
      else aoVoltar();
    });
  }

  function alternarAcao(chave: string, marcada: boolean) {
    setAcoes((atual) => (marcada ? [...new Set([...atual, chave])] : atual.filter((a) => a !== chave)));
  }

  // O que excluir leva junto, dito ANTES do segundo clique.
  const perda =
    uso && (uso.etapas.length || uso.contatos)
      ? `Excluir — ${[
          uso.etapas.length ? `${uso.etapas.length} etapa${uso.etapas.length === 1 ? "" : "s"} fica${uso.etapas.length === 1 ? "" : "m"} sem IA` : "",
          uso.contatos ? `${uso.contatos} contato${uso.contatos === 1 ? "" : "s"} volta${uso.contatos === 1 ? "" : "m"} a seguir a etapa` : "",
        ]
          .filter(Boolean)
          .join(", ")}`
      : "Confirmar exclusão";

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => aoVoltar()}
          aria-label="Voltar para a lista de IAs"
          className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {ia ? `Editar ${ia.nome}` : "Nova IA"}
        </h2>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar IAs"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-zinc-700 dark:text-zinc-300">Nome</span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={LIMITE_NOME_IA}
              autoFocus={!ia}
              placeholder="Ex.: Qualificação de leads"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">Prompt</span>
              <span className="text-[11px] tabular-nums text-zinc-400">
                {prompt.length.toLocaleString("pt-BR")} / {LIMITE_PROMPT_IA.toLocaleString("pt-BR")}
              </span>
            </span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={LIMITE_PROMPT_IA}
              rows={12}
              placeholder={
                "Quem ela é e como conduz a conversa. Ex.:\n\nVocê qualifica leads do lançamento. Descubra se a pessoa quer investir ou morar, o tipo de unidade e o prazo — uma pergunta por vez.\n\nQuando o cliente disser que quer visitar o decorado, mova para a etapa Visita."
              }
              className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <span className="mt-1.5 block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Por cima do prompt valem sempre as regras fixas: escreve curto, como no WhatsApp; só afirma o que está em
              Contextos; pede à equipe o que não sabe; e passa para uma pessoa quando o cliente pede.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
              Palavra para ligar e desligar pelo celular
            </span>
            <input
              value={palavra}
              onChange={(e) => setPalavra(e.target.value)}
              maxLength={LIMITE_PALAVRA_IA}
              placeholder="Ex.: #ia"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-[13px] text-zinc-900 outline-none placeholder:font-sans placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <span className="mt-1.5 block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Quando o atendente manda do celular uma mensagem que é só esta palavra, a IA desliga para aquele contato se
              estiver atendendo, ou liga se não estiver. O cliente também recebe a mensagem: use algo que ninguém
              escreveria numa conversa, como #ia. Vazio = sem palavra.
            </span>
          </label>

          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
              O que ela pode fazer
            </legend>
            <div className="flex flex-col gap-1.5">
              {ACOES_IA.map((a) => {
                const marcada = acoes.includes(a.chave);
                return (
                  <label
                    key={a.chave}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                      marcada
                        ? "border-violet-300 bg-violet-50/60 dark:border-violet-400/30 dark:bg-violet-500/10"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={(e) => alternarAcao(a.chave, e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-violet-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{a.rotulo}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                        {a.descricao}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              Conversar, pedir algo à equipe e passar para uma pessoa toda IA faz.
            </p>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
              Se o contato não responder
            </legend>
            {passos.length > 0 && (
              <ol className="flex flex-col gap-1.5">
                {passos.map((p, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-[12px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                      {i + 1}ª
                    </span>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={p.valor}
                      onChange={(e) => mudarPasso(i, { valor: e.target.value })}
                      aria-label={`Tempo da ${i + 1}ª retomada`}
                      className={`${CAMPO_PEQUENO} w-16 tabular-nums`}
                    />
                    <select
                      value={p.unidade}
                      onChange={(e) => mudarPasso(i, { unidade: e.target.value as Unidade })}
                      aria-label={`Unidade da ${i + 1}ª retomada`}
                      className={CAMPO_PEQUENO}
                    >
                      <option value="min">minutos</option>
                      <option value="h">horas</option>
                      <option value="d">dias</option>
                    </select>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-500 dark:text-zinc-400">
                      depois {i === 0 ? "da pergunta" : `da ${i}ª`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPassos((atual) => atual.filter((_, j) => j !== i))}
                      aria-label={`Tirar a ${i + 1}ª retomada`}
                      className="shrink-0 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {passos.length < MAX_RETOMADAS && (
              <button
                type="button"
                onClick={adicionarPasso}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-violet-700 transition hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/10 ${
                  passos.length ? "mt-1.5" : "-ml-2"
                }`}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {passos.length ? "Mais uma retomada" : "Retomar a conversa"}
              </button>
            )}
            {passos.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
                Só das
                <select
                  value={das}
                  onChange={(e) => setDas(Number(e.target.value))}
                  aria-label="Início do horário das retomadas"
                  className={`${CAMPO_PEQUENO} tabular-nums`}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {h}h
                    </option>
                  ))}
                </select>
                às
                <select
                  value={ate}
                  onChange={(e) => setAte(Number(e.target.value))}
                  aria-label="Fim do horário das retomadas"
                  className={`${CAMPO_PEQUENO} tabular-nums`}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h + 1} value={h + 1}>
                      {h + 1}h
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              {passos.length
                ? "Quando a última mensagem dela tem pergunta e o cliente fica calado, ela mesma escreve a retomada, lendo a conversa. Para assim que ele responde ou alguém da equipe entra. Fora do horário (de Brasília), sai na abertura seguinte. Sem resposta à última, 24h depois o responsável da oportunidade é avisado no WhatsApp."
                : "Sem retomada, ela espera o cliente voltar."}
            </p>
          </fieldset>

          {erro && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {erro}
            </p>
          )}

          {ia && (
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button
                type="button"
                disabled={excluindo || salvando}
                onBlur={() => setArmado(false)}
                onClick={() => (armado ? excluir() : setArmado(true))}
                className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition disabled:opacity-50 ${
                  armado
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                }`}
              >
                {excluindo ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                {armado ? perda : "Excluir IA"}
              </button>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => aoVoltar()}
            className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!pronto || salvando || excluindo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {salvando && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {ia ? "Salvar" : "Criar IA"}
          </button>
        </footer>
      </form>
    </>
  );
}
