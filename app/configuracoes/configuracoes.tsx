"use client";

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
import {
  Boxes,
  Check,
  FolderPlus,
  GripVertical,
  Layers,
  Pencil,
  Plug,
  Plus,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Tag as TagIcon,
  Trash2,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Etapa, Funil, Usuario } from "../data";
import { amostraDoTom, TOM_PADRAO, TONS_FUNIL } from "@/lib/cores-funil";
import type { CampoPersonalizado, DadosConfig, InstanciaUazapi } from "./dados";
import {
  conectarInstancia,
  criarCampoPersonalizado,
  criarEtapa,
  criarFunil,
  criarSegmento,
  criarTag,
  criarUsuario,
  deletarSegmento,
  deletarTag,
  desconectarInstancia,
  editarCampoPersonalizado,
  editarCorDoFunil,
  editarEtapa,
  editarSegmento,
  editarTag,
  editarUsuario,
  excluirCampoPersonalizado,
  renomearInstancia,
  reordenarEtapas,
} from "./actions";

// A paleta agora é do FUNIL, e vive em lib/cores-funil.ts (TONS_FUNIL) junto da
// regra que deriva o tom de cada etapa. Aqui só se escolhe a cor-base; quem
// decide o tom de cada coluna é a posição dela no funil.

const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

const botao =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

export default function Configuracoes({ dados }: { dados: DadosConfig }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
      <header className="border-b border-zinc-200 px-6 py-3 xl:px-16 dark:border-zinc-800">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Settings className="size-4 text-zinc-500" aria-hidden="true" />
          <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Configurações
          </h1>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6 xl:px-16">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
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

            {dados.funis.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-[13px] text-zinc-400 dark:border-zinc-700">
                Nenhum funil ainda. Crie o primeiro acima.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {dados.funis.map((funil) => (
                  <FunilCard
                    key={funil.id}
                    funil={funil}
                    etapas={dados.etapasPorFunil.get(funil.id) ?? []}
                  />
                ))}
              </ul>
            )}
          </section>

          <SecaoNomes
            titulo="Tags"
            descricao="Rótulos para classificar contatos."
            Icone={TagIcon}
            itens={dados.tags}
            rotuloItem="tag"
            avisoExcluir="Ela será removida de todos os contatos."
            aoCriar={criarTag}
            aoEditar={editarTag}
            aoExcluir={deletarTag}
          />

          <SecaoNomes
            titulo="Segmentos"
            descricao="Grupos para segmentar a base de contatos."
            Icone={Boxes}
            itens={dados.segmentos}
            rotuloItem="segmento"
            avisoExcluir="Ele será removido de todos os contatos."
            aoCriar={criarSegmento}
            aoEditar={editarSegmento}
            aoExcluir={deletarSegmento}
          />

          <UsuariosSection usuarios={dados.usuarios} />

          <CamposSection campos={dados.campos} />

          <InstanciasSection instancias={dados.instancias} />
        </div>
      </main>
    </div>
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

// Deriva iniciais do nome (1ª letra das 2 primeiras palavras) — só pra sugerir.
function iniciaisDe(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

// ── Lista de nomes com CRUD (Tags e Segmentos compartilham) ──────────────────
function SecaoNomes({
  titulo,
  descricao,
  Icone,
  itens,
  rotuloItem,
  avisoExcluir,
  aoCriar,
  aoEditar,
  aoExcluir,
}: {
  titulo: string;
  descricao: string;
  Icone: LucideIcon;
  itens: { id: string; nome: string }[];
  rotuloItem: string;
  avisoExcluir: string;
  aoCriar: (nome: string) => Promise<unknown>;
  aoEditar: (id: string, nome: string) => Promise<unknown>;
  aoExcluir: (id: string) => Promise<unknown>;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await aoCriar(n);
        setNome("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <Icone className="size-3.5 text-zinc-400" aria-hidden="true" />
          {titulo}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{descricao}</p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex gap-2">
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder={`Novo ${rotuloItem}`}
            className={`${campoTexto} flex-1`}
          />
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
        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {itens.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhum {rotuloItem} ainda.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {itens.map((it) => (
              <LinhaNome
                key={it.id}
                item={it}
                rotuloItem={rotuloItem}
                avisoExcluir={avisoExcluir}
                aoEditar={aoEditar}
                aoExcluir={aoExcluir}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LinhaNome({
  item,
  rotuloItem,
  avisoExcluir,
  aoEditar,
  aoExcluir,
}: {
  item: { id: string; nome: string };
  rotuloItem: string;
  avisoExcluir: string;
  aoEditar: (id: string, nome: string) => Promise<unknown>;
  aoExcluir: (id: string) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(item.nome);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    iniciar(async () => {
      try {
        await aoEditar(item.id, n);
        setEditando(false);
      } catch {
        // mantém em edição
      }
    });
  }

  function remover() {
    if (!window.confirm(`Excluir "${item.nome}"? ${avisoExcluir}`)) return;
    iniciar(() => {
      aoExcluir(item.id);
    });
  }

  if (editando) {
    return (
      <li className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-900">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") {
              setNome(item.nome);
              setEditando(false);
            }
          }}
          autoFocus
          className="w-28 bg-transparent text-xs text-zinc-900 outline-none dark:text-zinc-50"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          aria-label="Salvar"
          className="text-zinc-400 transition hover:text-emerald-600"
        >
          <Check className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setNome(item.nome);
            setEditando(false);
          }}
          aria-label="Cancelar"
          className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </li>
    );
  }

  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
      <span>{item.nome}</span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${rotuloItem} ${item.nome}`}
        className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        <Pencil className="size-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={remover}
        disabled={salvando}
        aria-label={`Excluir ${rotuloItem} ${item.nome}`}
        className="text-zinc-400 transition hover:text-red-500"
      >
        <Trash2 className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
}

// ── Usuários ─────────────────────────────────────────────────────────────────
function UsuariosSection({ usuarios }: { usuarios: Usuario[] }) {
  const [nome, setNome] = useState("");
  const [iniciais, setIniciais] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarUsuario(n, iniciais);
        setNome("");
        setIniciais("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar usuário");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <Users className="size-3.5 text-zinc-400" aria-hidden="true" />
          Usuários
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Quem aparece como responsável e autor. (Ainda não é login.)
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Nome
            </span>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="Ex.: Renan Sampaio"
              className={campoTexto}
            />
          </label>
          <label className="flex w-full flex-col gap-1.5 sm:w-24">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Iniciais
            </span>
            <input
              type="text"
              value={iniciais}
              onChange={(e) => setIniciais(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder={iniciaisDe(nome) || "AB"}
              className={`${campoTexto} text-center uppercase`}
            />
          </label>
          <button
            type="button"
            onClick={criar}
            disabled={!nome.trim() || salvando}
            className={botao}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            Criar
          </button>
        </div>
        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {usuarios.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhum usuário ainda — crie ao menos um para o chat ter identidade.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {usuarios.map((u) => (
              <UsuarioRow key={u.id} usuario={u} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function UsuarioRow({ usuario }: { usuario: Usuario }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(usuario.nome);
  const [iniciais, setIniciais] = useState(usuario.iniciais);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    iniciar(async () => {
      try {
        await editarUsuario(usuario.id, n, iniciais);
        setEditando(false);
      } catch {
        // mantém em edição
      }
    });
  }

  function cancelar() {
    setNome(usuario.nome);
    setIniciais(usuario.iniciais);
    setEditando(false);
  }

  if (editando) {
    return (
      <li className="flex items-center gap-2 py-2">
        <input
          value={iniciais}
          onChange={(e) => setIniciais(e.target.value.toUpperCase())}
          maxLength={4}
          aria-label="Iniciais"
          className={`${campoTexto} w-14 shrink-0 text-center uppercase`}
        />
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") cancelar();
          }}
          autoFocus
          aria-label="Nome"
          className={`${campoTexto} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          aria-label="Salvar"
          className="shrink-0 text-zinc-400 transition hover:text-emerald-600"
        >
          <Check className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={cancelar}
          aria-label="Cancelar"
          className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        {usuario.iniciais}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-900 dark:text-zinc-50">
        {usuario.nome}
      </span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${usuario.nome}`}
        className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

// ── Campos personalizados ────────────────────────────────────────────────────
const TIPOS_CAMPO = [
  { valor: "texto", rotulo: "Texto" },
  { valor: "numero", rotulo: "Número" },
  { valor: "data", rotulo: "Data" },
  { valor: "opcao", rotulo: "Opções" },
] as const;

function CamposSection({ campos }: { campos: CampoPersonalizado[] }) {
  const [entidade, setEntidade] = useState<"contato" | "oportunidade">("contato");
  const [rotulo, setRotulo] = useState("");
  const [tipo, setTipo] = useState<string>("texto");
  const [opcoes, setOpcoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const daEntidade = campos.filter((c) => c.entidade === entidade);

  function criar() {
    const r = rotulo.trim();
    if (!r) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarCampoPersonalizado(entidade, r, tipo, opcoes);
        setRotulo("");
        setOpcoes("");
        setTipo("texto");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar campo");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <SlidersHorizontal className="size-3.5 text-zinc-400" aria-hidden="true" />
          Campos personalizados
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Informação que varia de contato para contato e não cabe numa coluna
          fixa — perguntas de formulário, origem, qualificação.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {/* Cada ficha tem sua própria lista: um campo de contato não aparece na
            oportunidade e vice-versa. */}
        <div className="mb-3 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {(["contato", "oportunidade"] as const).map((chave) => {
            const ativo = entidade === chave;
            const quantos = campos.filter((c) => c.entidade === chave).length;
            return (
              <button
                key={chave}
                type="button"
                onClick={() => setEntidade(chave)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition ${
                  ativo
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {chave === "contato" ? "Contato" : "Oportunidade"}
                <span className="ml-1.5 tabular-nums text-zinc-400">{quantos}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Nome do campo
            </span>
            <input
              type="text"
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="Ex.: Faixa de investimento"
              className={campoTexto}
            />
          </label>
          <label className="flex w-full flex-col gap-1.5 sm:w-32">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Tipo
            </span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className={campoTexto}
            >
              {TIPOS_CAMPO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={criar}
            disabled={!rotulo.trim() || salvando}
            className={botao}
          >
            <Plus className="size-4" aria-hidden="true" />
            Criar
          </button>
        </div>

        {tipo === "opcao" && (
          <label className="mt-2 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Opções (separadas por vírgula)
            </span>
            <input
              type="text"
              value={opcoes}
              onChange={(e) => setOpcoes(e.target.value)}
              placeholder="até 50 mil, 50 a 100 mil, acima de 100 mil"
              className={campoTexto}
            />
          </label>
        )}

        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {daEntidade.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhum campo nesta ficha ainda.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {daEntidade.map((c) => (
              <CampoRow key={c.id} campo={c} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CampoRow({ campo }: { campo: CampoPersonalizado }) {
  const [editando, setEditando] = useState(false);
  const [rotulo, setRotulo] = useState(campo.rotulo);
  const [tipo, setTipo] = useState<string>(campo.tipo);
  const [opcoes, setOpcoes] = useState(campo.opcoes.join(", "));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const r = rotulo.trim();
    if (!r) return;
    setErro(null);
    iniciar(async () => {
      try {
        await editarCampoPersonalizado(campo.id, r, tipo, opcoes);
        setEditando(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function cancelar() {
    setRotulo(campo.rotulo);
    setTipo(campo.tipo);
    setOpcoes(campo.opcoes.join(", "));
    setErro(null);
    setEditando(false);
  }

  function remover() {
    if (
      !window.confirm(
        `Excluir o campo "${campo.rotulo}"? Ele some das fichas, mas os valores já preenchidos continuam guardados — recriar um campo com o mesmo nome traz tudo de volta.`,
      )
    )
      return;
    iniciar(() => {
      excluirCampoPersonalizado(campo.id);
    });
  }

  if (editando) {
    return (
      <li className="flex flex-col gap-2 py-2.5">
        <div className="flex items-center gap-2">
          <input
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
              if (e.key === "Escape") cancelar();
            }}
            autoFocus
            aria-label="Nome do campo"
            className={`${campoTexto} min-w-0 flex-1 py-1`}
          />
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo"
            className={`${campoTexto} w-28 shrink-0 py-1`}
          >
            {TIPOS_CAMPO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            aria-label="Salvar"
            className="shrink-0 text-zinc-400 transition hover:text-emerald-600"
          >
            <Check className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={cancelar}
            aria-label="Cancelar"
            className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {tipo === "opcao" && (
          <input
            value={opcoes}
            onChange={(e) => setOpcoes(e.target.value)}
            placeholder="Opções separadas por vírgula"
            aria-label="Opções"
            className={`${campoTexto} py-1`}
          />
        )}
        {erro && <p className="text-xs text-red-500">{erro}</p>}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          {campo.rotulo}
        </p>
        {/* A chave é o que está gravado no banco — mostro porque ela não muda
            no rename, e é por ela que a IA e as consultas encontram o valor. */}
        <p className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          {campo.chave}
          {campo.opcoes.length > 0 && ` · ${campo.opcoes.join(" / ")}`}
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {TIPOS_CAMPO.find((t) => t.valor === campo.tipo)?.rotulo ?? campo.tipo}
      </span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${campo.rotulo}`}
        className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={remover}
        disabled={salvando}
        aria-label={`Excluir ${campo.rotulo}`}
        className="shrink-0 text-zinc-400 transition hover:text-red-500"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

// ── Instâncias uazapi ────────────────────────────────────────────────────────
// "Conectar" (não "criar"): o botão de baixo bate na uazapi de verdade antes
// de gravar (ver conectarInstancia em ./actions.ts) — errar URL ou token dá
// erro ali na hora, não um cadastro fantasma que só falha no primeiro envio.
function InstanciasSection({ instancias }: { instancias: InstanciaUazapi[] }) {
  const [nome, setNome] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [conectando, iniciar] = useTransition();

  function conectar() {
    if (!nome.trim() || !baseUrl.trim() || !token.trim()) return;
    setErro(null);
    iniciar(async () => {
      try {
        await conectarInstancia(nome, baseUrl, token);
        setNome("");
        setBaseUrl("");
        setToken("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao conectar instância");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <Smartphone className="size-3.5 text-zinc-400" aria-hidden="true" />
          Instâncias uazapi
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Números de WhatsApp ligados ao CRM. O nome é só um rótulo interno —
          não muda nada na uazapi.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Nome
            </span>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && conectar()}
              placeholder="Ex.: Comercial"
              className={campoTexto}
            />
          </label>
          <label className="flex min-w-0 flex-[1.4] flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              URL da instância
            </span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && conectar()}
              placeholder="https://sua-instancia.uazapi.com"
              className={campoTexto}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Token
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && conectar()}
              placeholder="Token da instância"
              className={campoTexto}
            />
          </label>
          <button
            type="button"
            onClick={conectar}
            disabled={!nome.trim() || !baseUrl.trim() || !token.trim() || conectando}
            className={botao}
          >
            <Plug className="size-4" aria-hidden="true" />
            {conectando ? "Conectando…" : "Conectar"}
          </button>
        </div>
        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {instancias.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhuma instância conectada ainda.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {instancias.map((i) => (
              <InstanciaRow key={i.id} instancia={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function InstanciaRow({ instancia }: { instancia: InstanciaUazapi }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(instancia.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await renomearInstancia(instancia.id, n);
        setEditando(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao renomear");
      }
    });
  }

  function cancelar() {
    setNome(instancia.nome);
    setErro(null);
    setEditando(false);
  }

  function remover() {
    if (
      !window.confirm(
        `Desconectar "${instancia.nome}"? O CRM não vai mais reconhecer esse rótulo — os atendimentos já gravados continuam com o número, só perdem o nome.`,
      )
    )
      return;
    iniciar(() => {
      desconectarInstancia(instancia.id);
    });
  }

  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <Smartphone className="size-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          {editando ? (
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") cancelar();
              }}
              autoFocus
              aria-label="Nome da instância"
              className={`${campoTexto} py-1`}
            />
          ) : (
            <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
              {instancia.nome}
            </p>
          )}
          <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {instancia.numero ?? "sem número pareado"} · {instancia.token_mascarado} ·{" "}
            {instancia.base_url}
          </p>
        </div>

        {editando ? (
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
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label={`Renomear ${instancia.nome}`}
              className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={remover}
              disabled={salvando}
              aria-label={`Desconectar ${instancia.nome}`}
              className="text-zinc-400 transition hover:text-red-500"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </li>
  );
}
