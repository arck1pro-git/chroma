"use client";

// Funis e as etapas de cada um — a seção que o quadro da raiz lê.
//
// A cor é do FUNIL: as etapas recebem tons dela, da mais clara na primeira à
// mais escura na última (lib/cores-funil.ts). Trocar a cor aqui repinta o
// quadro inteiro; `etapas.cor` continua na tabela sem ninguém ler.
import { useEffect, useState, useTransition } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, FolderPlus, GripVertical, Layers, Pencil, Plus, X } from "lucide-react";
import type { Etapa, Funil } from "../../data";
import { amostraDoTom, TOM_PADRAO, TONS_FUNIL } from "@/lib/cores-funil";
import { criarEtapa, criarFunil, editarCorDoFunil, editarEtapa, reordenarEtapas } from "../actions";
import { botao, campoTexto } from "./ui";

export function SecaoFunis({
  funis,
  etapasPorFunil,
}: {
  funis: Funil[];
  etapasPorFunil: Map<string, Etapa[]>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          Funis
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Crie um funil e defina as etapas do quadro (kanban).
        </p>
      </div>

      <NovoFunil />

      {funis.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-[13px] text-zinc-400 dark:border-zinc-700">
          Nenhum funil ainda. Crie o primeiro acima.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {funis.map((funil) => (
            <FunilCard
              key={funil.id}
              funil={funil}
              etapas={etapasPorFunil.get(funil.id) ?? []}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NovoFunil() {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  // A cor é do funil. As etapas dele recebem tons dela — da mais clara na
  // primeira à mais escura na última (lib/cores-funil.ts).
  const [cor, setCor] = useState<string>(TOM_PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarFunil(n, descricao, cor);
        setNome("");
        setDescricao("");
        setCor(TOM_PADRAO);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar funil");
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Nome do funil
          </span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder="Ex.: Vendas B2B"
            className={campoTexto}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Descrição (opcional)
          </span>
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder="Ciclo comercial para contas corporativas"
            className={campoTexto}
          />
        </label>
        <div className="flex shrink-0 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Cor
          </span>
          <div className="flex h-[38px] items-center">
            <PaletaCores valor={cor} aoMudar={setCor} />
          </div>
        </div>

        <button
          type="button"
          onClick={criar}
          disabled={!nome.trim() || salvando}
          className={botao}
        >
          <FolderPlus className="size-4" aria-hidden="true" />
          Criar funil
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}
    </div>
  );
}

function FunilCard({ funil, etapas }: { funil: Funil; etapas: Etapa[] }) {
  // Otimista: a cor é uma escolha visual, e esperar o servidor para repintar as
  // bolinhas faria o clique parecer engasgado. O revalidatePath da action traz
  // o quadro junto logo em seguida.
  const [cor, setCor] = useState(funil.cor);
  const [, trocarCor] = useTransition();

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-2">
        <Layers className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
            {funil.nome}
          </h3>
          {funil.descricao && (
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {funil.descricao}
            </p>
          )}
        </div>

        {/* Trocar aqui repinta TODAS as etapas do funil de uma vez: os tons são
            derivados da cor dele, não gravados por etapa. */}
        <PaletaCores
          valor={cor}
          aoMudar={(nova) => {
            setCor(nova);
            trocarCor(() => {
              void editarCorDoFunil(funil.id, nova);
            });
          }}
        />
      </div>

      {/* Etapas em ordem — arraste pela alça, clique no nome ou na cor pra
          editar. Ver EtapasDoFunil mais abaixo. */}
      <div className="mt-3">
        {etapas.length === 0 ? (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Sem etapas — adicione a primeira abaixo.
          </span>
        ) : (
          <EtapasDoFunil etapas={etapas} />
        )}
      </div>

      <NovaEtapa funilId={funil.id} />
    </li>
  );
}

function NovaEtapa({ funilId }: { funilId: string }) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarEtapa(funilId, n);
        setNome("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar etapa");
      }
    });
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && criar()}
          placeholder="Nova etapa (ex.: Qualificação)"
          className={`${campoTexto} min-w-0 flex-1`}
        />

        <button
          type="button"
          onClick={criar}
          disabled={!nome.trim() || salvando}
          className={botao}
        >
          <Plus className="size-4" aria-hidden="true" />
          Etapa
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}
    </div>
  );
}

// Compartilhada entre criar (NovaEtapa) e editar (EtapaLinha) — mesma paleta,
// mesmo visual, só o que acontece ao clicar muda.
function PaletaCores({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (cor: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1" role="radiogroup" aria-label="Cor do funil">
      {TONS_FUNIL.map(({ id, rotulo }) => {
        const ativo = id === valor;
        const c = amostraDoTom(id);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={ativo}
            aria-label={rotulo}
            title={rotulo}
            onClick={() => aoMudar(id)}
            className={`size-5 rounded-full ${c} transition ${
              ativo
                ? "ring-2 ring-zinc-900 ring-offset-1 dark:ring-zinc-100 dark:ring-offset-zinc-950"
                : "opacity-70 hover:opacity-100"
            }`}
          />
        );
      })}
    </div>
  );
}

// ── Etapas: arrastar reordena, clique edita nome/cor ────────────────────────
// Lista LOCAL (igual ao quadro do kanban): arraste é otimista, ordem só grava
// no soltar. O efeito abaixo resincroniza quando `etapas` mudar por outro
// caminho (revalidate de uma edição, por exemplo).
function EtapasDoFunil({ etapas }: { etapas: Etapa[] }) {
  const [ordem, setOrdem] = useState(etapas);
  const [, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => setOrdem(etapas), [etapas]);

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function aoSoltar({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;

    const de = ordem.findIndex((e) => e.id === active.id);
    const para = ordem.findIndex((e) => e.id === over.id);
    if (de < 0 || para < 0) return;

    const nova = arrayMove(ordem, de, para);
    setOrdem(nova); // otimista: a tela já mostra a ordem nova
    setErro(null);
    startTransition(async () => {
      try {
        await reordenarEtapas(nova.map((e) => e.id));
      } catch (e) {
        setOrdem(etapas); // volta pro que o banco realmente tem
        setErro(e instanceof Error ? e.message : "Falha ao reordenar");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <DndContext
        sensors={sensores}
        collisionDetection={closestCenter}
        onDragEnd={aoSoltar}
      >
        <SortableContext items={ordem.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {ordem.map((e) => (
              <EtapaLinha key={e.id} etapa={e} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </div>
  );
}

function EtapaLinha({ etapa }: { etapa: Etapa }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: etapa.id });
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(etapa.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await editarEtapa(etapa.id, n);
        setEditando(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function cancelar() {
    setNome(etapa.nome);
    setErro(null);
    setEditando(false);
  }

  const estilo = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={estilo}
      className={`flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950 ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Arrastar para reordenar ${etapa.nome}`}
        className="shrink-0 cursor-grab touch-none text-zinc-300 transition hover:text-zinc-500 active:cursor-grabbing dark:text-zinc-700 dark:hover:text-zinc-400"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      {editando ? (
        <>
          <input
            value={nome}
            onChange={(ev) => setNome(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") salvar();
              if (ev.key === "Escape") cancelar();
            }}
            autoFocus
            aria-label="Nome da etapa"
            className={`${campoTexto} min-w-0 flex-1 py-1`}
          />
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              aria-label="Salvar"
              className="text-zinc-400 transition hover:text-emerald-600"
            >
              <Check className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={cancelar}
              aria-label="Cancelar"
              className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <>
          <span className={`size-2.5 shrink-0 rounded-full ${etapa.cor}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-900 dark:text-zinc-50">
            {etapa.nome}
          </span>
          <button
            type="button"
            onClick={() => setEditando(true)}
            aria-label={`Editar ${etapa.nome}`}
            className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </button>
        </>
      )}
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </li>
  );
}

