"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import {
  type Anotacao,
  type Contato,
  type Etapa,
  type Funil,
  type Historico,
  type Oportunidade,
  type Segmento,
  type Tag,
  type Usuario,
} from "../data";
import {
  adicionarSegmento,
  adicionarTag,
  atualizarContato,
  removerSegmento,
  removerTag,
} from "./actions";
import { iniciais } from "../formato";
import { CamposContato, ChipsContato, SecoesContato } from "./detalhes";
import type { NovoContato } from "./actions";

// Contato → campos editáveis do formulário.
function vazio(c: Contato): NovoContato {
  return {
    nome: c.nome,
    whatsapp: c.whatsapp,
    email: c.email,
    cidade: c.cidade,
    estado: c.estado,
    pais: c.pais,
  };
}

const inputFicha =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function CampoEdit({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </span>
      {children}
    </label>
  );
}

// Vínculo é sempre {id, nome}, seja tag ou segmento — o reducer otimista abaixo
// serve os dois.
type Vinculo = { id: string; nome: string };

// Aplica o efeito do clique na hora, antes da action responder. Só acrescenta
// no fim (a query do servidor não ordena os vínculos, então inserir ordenado
// faria o chip pular de lugar quando os dados reais chegassem).
function reduzirVinculos<T extends Vinculo>(
  atual: T[],
  acao: { tipo: "add" | "rem"; item: T },
) {
  return acao.tipo === "add"
    ? [...atual, acao.item]
    : atual.filter((v) => v.id !== acao.item.id);
}

// Editor de vínculos (Tags ou Segmentos) do contato: chips removíveis + um
// select "+ adicionar" com os que ainda não estão vinculados.
function VinculoEditor({
  titulo,
  itens,
  faltando,
  escuro = false,
  aoAdicionar,
  aoRemover,
}: {
  titulo: string;
  itens: { id: string; nome: string }[];
  faltando: { id: string; nome: string }[];
  escuro?: boolean;
  aoAdicionar: (id: string) => void;
  aoRemover: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {titulo}
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {itens.length === 0 && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {/* sem nada vinculado E sem nada a vincular = a base não tem nenhum
                cadastrado; dizer só "nenhum ainda" faria procurar um botão que
                não existe nesta tela */}
            {faltando.length === 0
              ? `Nenhum ${titulo.toLowerCase()} cadastrado na base.`
              : "Nenhum ainda."}
          </span>
        )}
        {/* surge: só o chip recém-montado anima. Os que já estavam na tela têm
            a mesma key, o React reaproveita o nó e a animação não reinicia. */}
        {itens.map((it) => (
          <span
            key={it.id}
            className={
              escuro
                ? "surge inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "surge inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700"
            }
          >
            {it.nome}
            <button
              type="button"
              onClick={() => aoRemover(it.id)}
              aria-label={`Remover ${it.nome}`}
              className={
                escuro
                  ? "text-white/60 transition hover:text-white dark:text-zinc-900/60 dark:hover:text-zinc-900"
                  : "text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
              }
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {faltando.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) aoAdicionar(e.target.value);
            }}
            aria-label={`Adicionar ${titulo.toLowerCase()}`}
            className="rounded-full border border-dashed border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-500 outline-none transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            <option value="">+ adicionar</option>
            {faltando.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

export default function Ficha({
  contato,
  oportunidades,
  historico,
  anotacoes,
  segmentos,
  tags,
  segmentosDisponiveis,
  tagsDisponiveis,
  etapaPorId,
  funilPorId,
  usuarioPorId,
  aoFechar,
}: {
  contato: Contato;
  oportunidades: Oportunidade[];
  historico: Historico[];
  anotacoes: Anotacao[];
  segmentos: Segmento[];
  tags: Tag[];
  segmentosDisponiveis: Segmento[];
  tagsDisponiveis: Tag[];
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
  aoFechar: () => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<NovoContato>(vazio(contato));

  // Marcar uma tag custava um round-trip (INSERT + revalidatePath + payload RSC
  // novo) antes do chip aparecer. Com useOptimistic o chip entra no clique e o
  // React descarta o palpite quando o servidor responde — se a gravação falhar,
  // a lista volta sozinha ao que o banco diz.
  const [segmentosVis, mexerSegmento] = useOptimistic(
    segmentos,
    reduzirVinculos<Segmento>,
  );
  const [tagsVis, mexerTag] = useOptimistic(tags, reduzirVinculos<Tag>);

  // O update otimista tem que rodar dentro da transition, junto da action.
  function vincularSegmento(id: string) {
    const item = segmentosDisponiveis.find((s) => s.id === id);
    if (!item) return;
    iniciar(async () => {
      mexerSegmento({ tipo: "add", item });
      await adicionarSegmento(contato.id, id);
    });
  }
  function desvincularSegmento(id: string) {
    const item = segmentosVis.find((s) => s.id === id);
    if (!item) return;
    iniciar(async () => {
      mexerSegmento({ tipo: "rem", item });
      await removerSegmento(contato.id, id);
    });
  }
  function vincularTag(id: string) {
    const item = tagsDisponiveis.find((t) => t.id === id);
    if (!item) return;
    iniciar(async () => {
      mexerTag({ tipo: "add", item });
      await adicionarTag(contato.id, id);
    });
  }
  function desvincularTag(id: string) {
    const item = tagsVis.find((t) => t.id === id);
    if (!item) return;
    iniciar(async () => {
      mexerTag({ tipo: "rem", item });
      await removerTag(contato.id, id);
    });
  }

  function abrirEdicao() {
    setForm(vazio(contato)); // parte sempre dos dados atuais
    setEditando(true);
  }
  function salvarEdicao() {
    if (!form.nome.trim()) return;
    iniciar(async () => {
      await atualizarContato(contato.id, form);
      setEditando(false);
    });
  }

  // Tags/segmentos ainda não vinculados — o que sobra pra adicionar. Sai da
  // lista otimista, senão o item recém-marcado continuaria no select até o
  // servidor responder.
  const tagsFaltando = tagsDisponiveis.filter(
    (t) => !tagsVis.some((x) => x.id === t.id),
  );
  const segmentosFaltando = segmentosDisponiveis.filter(
    (s) => !segmentosVis.some((x) => x.id === s.id),
  );

  // Flutuando por cima da tabela, a ficha esconde parte dela: Esc devolve a
  // tabela (ou sai da edição primeiro, pra não perder o que foi digitado).
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (editando) setEditando(false);
      else aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, editando]);

  return (
    <>
      {/* Painel de tela cheia por cima de tudo (filtros e menu inclusive), daí
          fixed + z alto. O véu escurece o resto e fecha ao clicar fora. */}
      <div
        className="veu-surge fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={aoFechar}
        aria-hidden="true"
      />

      {/* flutua à direita com folga das bordas e cantos arredondados; por isso
          fixed com offsets em vez de colar em inset-y-0. */}
      <aside
        className="ficha-entra fixed bottom-4 right-4 top-4 z-50 flex w-[26rem] max-w-[92vw] flex-col overflow-y-auto rounded-4xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        aria-label={`Ficha de ${contato.nome}`}
      >
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          {iniciais(contato.nome)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {contato.nome}
          </h2>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {contato.cidade}/{contato.estado}
          </p>
        </div>
        {!editando && (
          <button
            type="button"
            onClick={abrirEdicao}
            aria-label="Editar contato"
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar ficha"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {editando ? (
        <div className="flex flex-col gap-3 px-5 py-4">
          <CampoEdit rotulo="Nome">
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              autoFocus
              className={inputFicha}
            />
          </CampoEdit>
          <div className="grid grid-cols-2 gap-3">
            <CampoEdit rotulo="WhatsApp">
              <input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="+55 11 90000-0000"
                className={inputFicha}
              />
            </CampoEdit>
            <CampoEdit rotulo="E-mail">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="nome@empresa.com"
                className={inputFicha}
              />
            </CampoEdit>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <CampoEdit rotulo="Cidade">
              <input
                value={form.cidade}
                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                className={inputFicha}
              />
            </CampoEdit>
            <CampoEdit rotulo="Estado">
              <input
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value })}
                className={inputFicha}
              />
            </CampoEdit>
            <CampoEdit rotulo="País">
              <input
                value={form.pais}
                onChange={(e) => setForm({ ...form, pais: e.target.value })}
                className={inputFicha}
              />
            </CampoEdit>
          </div>
          {/* Vínculo não passa pelo Salvar: cada chip é uma linha em
              contato_tags/contato_segmentos e grava na hora (por isso o
              Cancelar abaixo não desfaz o que foi marcado aqui). Separado dos
              campos por uma borda para essa diferença ficar visível. */}
          {/* aria-busy sem esmaecer: o chip já reflete o clique, escurecer o
              bloco só faria parecer que ainda está carregando. */}
          <div
            aria-busy={pendente}
            className="mt-1 flex flex-col gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800"
          >
            <VinculoEditor
              titulo="Segmentos"
              itens={segmentosVis}
              faltando={segmentosFaltando}
              escuro
              aoAdicionar={vincularSegmento}
              aoRemover={desvincularSegmento}
            />
            <VinculoEditor
              titulo="Tags"
              itens={tagsVis}
              faltando={tagsFaltando}
              aoAdicionar={vincularTag}
              aoRemover={desvincularTag}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvarEdicao}
              disabled={!form.nome.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Check className="size-3.5" aria-hidden="true" />
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <CamposContato contato={contato} />
      )}

      {/* na edição os mesmos chips já aparecem editáveis acima — repetir aqui
          só duplicaria a lista */}
      {!editando && <ChipsContato segmentos={segmentosVis} tags={tagsVis} />}

      <SecoesContato
        oportunidades={oportunidades}
        anotacoes={anotacoes}
        historico={historico}
        etapaPorId={etapaPorId}
        funilPorId={funilPorId}
        usuarioPorId={usuarioPorId}
      />
      </aside>
    </>
  );
}
