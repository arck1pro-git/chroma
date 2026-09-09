"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
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
  ChevronDown,
  Layers,
  Plus,
  SearchX,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type {
  Contato,
  Etapa,
  Oportunidade,
  Tag,
  Usuario,
} from "../data";
import type { DadosFunil } from "./dados";
import { criarOportunidade, moverOportunidade } from "./actions";
import { filtrosVazios, passaNoFiltro, type Filtros } from "./filtros";
import BarraFiltros from "./barra-filtros";
import FormOportunidade, { type DadosOportunidade } from "./form-oportunidade";
import FichaOportunidade from "./ficha-oportunidade";
import CartaoOportunidade from "./cartao";
import { brl } from "../formato";

type Quadro = Record<string, Oportunidade[]>;

// Mapas que os cards (fundo da árvore) precisam, sem enfiar props por 3 níveis
// de DnD. A ficha e a barra recebem por prop mesmo, que são rasas.
type CardCtx = {
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  tagsDoContato: Map<string, Tag[]>;
};
const CartaoContexto = createContext<CardCtx | null>(null);
function useCartaoCtx() {
  const ctx = useContext(CartaoContexto);
  if (!ctx) throw new Error("CartaoContexto ausente");
  return ctx;
}

function quadroDe(oportunidades: Oportunidade[], etapas: Etapa[]): Quadro {
  // TODA etapa entra no mapa, mesmo vazia — senão etapaDe() não resolve o
  // droppable de uma coluna vazia e soltar um card nela vira no-op silencioso.
  const mapa: Quadro = {};
  for (const e of etapas) mapa[e.id] = [];
  for (const o of oportunidades) {
    mapa[o.etapa_id] = [...(mapa[o.etapa_id] ?? []), o];
  }
  return mapa;
}

// Resolve contato/responsável/tags pelo contexto e entrega o cartão comum
// (./cartao.tsx), que a tela inicial também usa. São 3 níveis de DnD entre o
// topo do quadro e o card — passar os Maps por prop até aqui é justamente o
// que o contexto veio evitar.
function CartaoDoQuadro({
  oportunidade,
  arrastando = false,
}: {
  oportunidade: Oportunidade;
  arrastando?: boolean;
}) {
  const { contatoPorId, usuarioPorId, tagsDoContato } = useCartaoCtx();
  const contato = contatoPorId.get(oportunidade.contato_id);

  return (
    <CartaoOportunidade
      oportunidade={oportunidade}
      contato={contato}
      responsavel={
        oportunidade.responsavel_id
          ? usuarioPorId.get(oportunidade.responsavel_id)
          : undefined
      }
      tags={contato ? (tagsDoContato.get(contato.id) ?? []) : []}
      arrastando={arrastando}
    />
  );
}

function CartaoArrastavel({
  oportunidade,
  destacado = false,
  aoAbrir,
}: {
  oportunidade: Oportunidade;
  destacado?: boolean;
  aoAbrir: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: oportunidade.id });

  return (
    <article
      ref={setNodeRef}
      id={`op-${oportunidade.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => aoAbrir(oportunidade.id)}
      className={`touch-none rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100 ${
        isDragging ? "opacity-40" : "cursor-grab active:cursor-grabbing"
      } ${
        destacado
          ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-zinc-100 dark:ring-zinc-100 dark:ring-offset-zinc-900"
          : ""
      }`}
      {...attributes}
      {...listeners}
    >
      <CartaoDoQuadro oportunidade={oportunidade} />
    </article>
  );
}

function ColunaEtapa({
  id,
  nome,
  cor,
  oportunidades,
  ocultos,
  destacadoId,
  aoAdicionar,
  aoAbrir,
}: {
  id: string;
  nome: string;
  cor: string;
  oportunidades: Oportunidade[];
  ocultos: number;
  destacadoId: string | null;
  aoAdicionar: (etapaId: string) => void;
  aoAbrir: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const total = oportunidades.reduce((soma, o) => soma + o.valor, 0);

  const areaRef = useRef<HTMLDivElement | null>(null);
  const [temMaisAbaixo, setTemMaisAbaixo] = useState(false);

  const guardarArea = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    areaRef.current = node;
  };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;

    const atualizar = () => {
      setTemMaisAbaixo(area.scrollTop + area.clientHeight < area.scrollHeight - 1);
    };

    atualizar();
    area.addEventListener("scroll", atualizar, { passive: true });
    const observador = new ResizeObserver(atualizar);
    observador.observe(area);
    return () => {
      area.removeEventListener("scroll", atualizar);
      observador.disconnect();
    };
  }, [oportunidades.length]);

  return (
    <section
      className="flex max-h-full w-80 shrink-0 flex-col rounded-2xl bg-zinc-200/70 dark:bg-zinc-900/60"
      aria-label={nome}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${cor}`} aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {nome}
          </h2>
          <span className="min-w-6 shrink-0 rounded-full bg-zinc-200 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {oportunidades.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
            {brl(total)}
          </span>
          <button
            type="button"
            onClick={() => aoAdicionar(id)}
            aria-label={`Adicionar oportunidade em ${nome}`}
            title="Adicionar oportunidade"
            className="flex size-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-300/70 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-50"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <SortableContext
        items={oportunidades.map((o) => o.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="relative flex min-h-0 flex-col overflow-hidden rounded-b-2xl">
          <div
            ref={guardarArea}
            className={`rolagem-oculta grid min-h-24 grid-cols-1 content-start gap-3 overflow-y-auto p-3 transition ${
              isOver ? "bg-zinc-200/60 dark:bg-zinc-800/40" : ""
            }`}
          >
            {oportunidades.map((oportunidade) => (
              <CartaoArrastavel
                key={oportunidade.id}
                oportunidade={oportunidade}
                destacado={oportunidade.id === destacadoId}
                aoAbrir={aoAbrir}
              />
            ))}

            {oportunidades.length === 0 && (
              <p className="flex items-center justify-center rounded-xl border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-400 dark:border-zinc-700">
                {ocultos > 0
                  ? "Nada aqui com esses filtros"
                  : "Solte uma oportunidade aqui"}
              </p>
            )}
          </div>

          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-gradient-to-t from-black/40 via-black/10 to-transparent pb-2 transition-opacity duration-200 ${
              temMaisAbaixo ? "opacity-100" : "opacity-0"
            }`}
          >
            <ChevronDown className="size-5 text-white drop-shadow" aria-hidden="true" />
          </div>
        </div>
      </SortableContext>

      {ocultos > 0 && oportunidades.length > 0 && (
        <p className="shrink-0 px-3 pb-2.5 pt-1 text-center text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {ocultos} {ocultos === 1 ? "oculto" : "ocultos"} pelos filtros
        </p>
      )}
    </section>
  );
}

function Indicador({
  Icone,
  rotulo,
  valor,
  detalhe,
}: {
  Icone: typeof Users;
  rotulo: string;
  valor: string;
  detalhe: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
      <Icone className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {rotulo}
      </span>
      <span className="ml-auto flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-sm font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
          {valor}
        </span>
        <span className="hidden truncate text-[11px] text-zinc-500 lg:block dark:text-zinc-400">
          {detalhe}
        </span>
      </span>
    </div>
  );
}

export default function Funil({ dados }: { dados: DadosFunil }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const {
    funis,
    etapas: todasEtapas,
    contatoPorId,
    usuarioPorId,
    segmentosDoContato,
    tagsDoContato,
  } = dados;

  const cardCtx = useMemo<CardCtx>(
    () => ({ contatoPorId, usuarioPorId, tagsDoContato }),
    [contatoPorId, usuarioPorId, tagsDoContato],
  );

  const [funilId, setFunilId] = useState(funis[0]?.id ?? "");
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios);
  const [quadro, setQuadro] = useState<Quadro>(() =>
    quadroDe(dados.oportunidades, dados.etapas),
  );
  const [idAtivo, setIdAtivo] = useState<UniqueIdentifier | null>(null);
  const [destacadoId, setDestacadoId] = useState<string | null>(null);
  const [etapaNova, setEtapaNova] = useState<string | null>(null);
  const [opAbertaId, setOpAbertaId] = useState<string | null>(null);
  // Etapa de onde o card saiu, pra saber se a mover mudou de coluna (e persistir).
  const etapaInicialRef = useRef<string | undefined>(undefined);

  // Fonte da verdade = servidor. Quando uma action revalida, dados.oportunidades
  // muda e o quadro é reconstruído (a ordem dentro da etapa volta a ser a do
  // banco — reordenar dentro da coluna não persiste, ver migration-front.sql).
  useEffect(() => {
    setQuadro(quadroDe(dados.oportunidades, dados.etapas));
  }, [dados.oportunidades, dados.etapas]);

  // Dois jeitos de chegar aqui por link: ?op=<id> (de um contato ou da home,
  // abre o pipeline da oportunidade e destaca o card) e ?funil=<id> (da home,
  // que lista um quadro por funil e precisa abrir o certo). A URL é limpa
  // depois pra um F5 não repetir o destaque.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const op = params.get("op");
    const funilAlvo = params.get("funil");
    if (!op && !funilAlvo) return;

    const alvo = op ? dados.oportunidades.find((o) => o.id === op) : undefined;
    if (alvo) {
      setFunilId(alvo.funil_id);
      setDestacadoId(alvo.id);
    } else if (funilAlvo && funis.some((f) => f.id === funilAlvo)) {
      setFunilId(funilAlvo);
    } else {
      return; // id que não existe mais: deixa a URL como está pra não esconder o erro
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [dados.oportunidades, funis]);

  useEffect(() => {
    if (!destacadoId) return;
    document
      .getElementById(`op-${destacadoId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const tempo = setTimeout(() => setDestacadoId(null), 2600);
    return () => clearTimeout(tempo);
  }, [destacadoId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const funil = useMemo(
    () => funis.find((f) => f.id === funilId) ?? funis[0],
    [funis, funilId],
  );

  const etapas = useMemo(
    () => todasEtapas.filter((e) => e.funil_id === funil?.id),
    [todasEtapas, funil],
  );

  const colunas = useMemo(
    () =>
      etapas.map((etapa) => {
        const todas = quadro[etapa.id] ?? [];
        const visiveis = todas.filter((o) =>
          passaNoFiltro(o, filtros, contatoPorId, segmentosDoContato, tagsDoContato),
        );
        return { etapa, visiveis, ocultos: todas.length - visiveis.length };
      }),
    [etapas, quadro, filtros, contatoPorId, segmentosDoContato, tagsDoContato],
  );

  const resumo = useMemo(() => {
    const lista = colunas.flatMap((c) => c.visiveis);
    const total = lista.reduce((soma, o) => soma + o.valor, 0);
    const ultima = colunas[colunas.length - 1];
    const conversao = lista.length
      ? Math.round(((ultima?.visiveis.length ?? 0) / lista.length) * 100)
      : 0;
    return {
      quantidade: lista.length,
      total,
      ticket: lista.length ? Math.round(total / lista.length) : 0,
      conversao,
      ultimaEtapa: ultima?.etapa.nome ?? "—",
    };
  }, [colunas]);

  const totalDoFunil = useMemo(
    () => etapas.reduce((soma, e) => soma + (quadro[e.id] ?? []).length, 0),
    [etapas, quadro],
  );

  const oportunidadeAtiva = useMemo(() => {
    if (!idAtivo) return null;
    return Object.values(quadro).flat().find((o) => o.id === idAtivo) ?? null;
  }, [idAtivo, quadro]);

  const oportunidadeAberta = useMemo(() => {
    if (!opAbertaId) return null;
    return Object.values(quadro).flat().find((o) => o.id === opAbertaId) ?? null;
  }, [opAbertaId, quadro]);

  // Cria a oportunidade pela server action; o revalidate traz ela pro quadro.
  function aoCriarOportunidade(d: DadosOportunidade) {
    if (!etapaNova || !funil) return;
    const etapaId = etapaNova;
    setEtapaNova(null);
    startTransition(async () => {
      try {
        const id = await criarOportunidade(d, funil.id, etapaId);
        setOpAbertaId(id);
      } catch (e) {
        // Sem contato selecionado a action recusa (contato_id é obrigatório).
        alert(e instanceof Error ? e.message : "Falha ao criar oportunidade");
      }
    });
  }

  function etapaDe(id: UniqueIdentifier, mapa: Quadro) {
    const chave = String(id);
    if (chave in mapa) return chave;
    return Object.keys(mapa).find((etapaId) =>
      mapa[etapaId].some((o) => o.id === chave),
    );
  }

  function aoIniciarArraste({ active }: DragStartEvent) {
    setIdAtivo(active.id);
    etapaInicialRef.current = etapaDe(active.id, quadro);
  }

  function aoPassarPor({ active, over }: DragOverEvent) {
    if (!over) return;
    setQuadro((anterior) => {
      const origem = etapaDe(active.id, anterior);
      const destino = etapaDe(over.id, anterior);
      if (!origem || !destino || origem === destino) return anterior;

      const item = anterior[origem].find((o) => o.id === String(active.id));
      if (!item) return anterior;

      const indiceAlvo = anterior[destino].findIndex(
        (o) => o.id === String(over.id),
      );
      const posicao = indiceAlvo >= 0 ? indiceAlvo : anterior[destino].length;

      return {
        ...anterior,
        [origem]: anterior[origem].filter((o) => o.id !== String(active.id)),
        [destino]: [
          ...anterior[destino].slice(0, posicao),
          { ...item, etapa_id: destino },
          ...anterior[destino].slice(posicao),
        ],
      };
    });
  }

  function aoSoltar({ active, over }: DragEndEvent) {
    setIdAtivo(null);

    // Persiste a mudança de etapa. O destino vem do `over` do evento (não do
    // estado, que pode estar um render atrás do último aoPassarPor); sem over,
    // cai no que o quadro mostra.
    const destinoFinal =
      (over ? etapaDe(over.id, quadro) : undefined) ??
      etapaDe(active.id, quadro);
    const mudouEtapa =
      destinoFinal && destinoFinal !== etapaInicialRef.current;
    if (mudouEtapa && funil) {
      startTransition(async () => {
        try {
          await moverOportunidade(String(active.id), destinoFinal, funil.id);
        } catch (e) {
          alert(e instanceof Error ? e.message : "Falha ao mover oportunidade");
          router.refresh(); // volta o quadro pro estado do banco
        }
      });
    }
    etapaInicialRef.current = undefined;

    if (!over) return;
    // Reordenar dentro da mesma etapa (só local — não há coluna de ordem).
    setQuadro((anterior) => {
      const origem = etapaDe(active.id, anterior);
      const destino = etapaDe(over.id, anterior);
      if (!origem || !destino || origem !== destino) return anterior;

      const de = anterior[origem].findIndex((o) => o.id === String(active.id));
      const para = anterior[origem].findIndex((o) => o.id === String(over.id));
      if (de < 0 || para < 0 || de === para) return anterior;

      return { ...anterior, [origem]: arrayMove(anterior[origem], de, para) };
    });
  }

  // Sem nenhum funil cadastrado não há quadro pra mostrar (e não há tela de criar
  // funil/etapas ainda). Empty-state em vez de quebrar.
  if (funis.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-conteudo px-6 text-center">
        <Layers className="size-9 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Nenhum funil cadastrado
        </p>
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          Cadastre um funil com suas etapas no banco para o quadro aparecer. (A
          criação de funil pela interface ainda não existe.)
        </p>
      </div>
    );
  }

  return (
    <CartaoContexto.Provider value={cardCtx}>
      <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
        <BarraFiltros
          funis={funis}
          usuarios={dados.usuarios}
          segmentos={dados.segmentos}
          tags={dados.tags}
          contatos={dados.contatos}
          funilId={funilId}
          aoTrocarFunil={setFunilId}
          filtros={filtros}
          aoMudarFiltros={setFiltros}
          visiveis={resumo.quantidade}
          total={totalDoFunil}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="bg-white px-6 py-3 xl:px-16 dark:bg-zinc-950">
            <div className="flex max-w-[1600px] flex-col">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <Indicador
                  Icone={Users}
                  rotulo="Leads no funil"
                  valor={String(resumo.quantidade)}
                  detalhe={`${etapas.length} etapas ativas`}
                />
                <Indicador
                  Icone={Wallet}
                  rotulo="Valor total"
                  valor={brl(resumo.total)}
                  detalhe="Soma das oportunidades visíveis"
                />
                <Indicador
                  Icone={TrendingUp}
                  rotulo="Ticket médio"
                  valor={brl(resumo.ticket)}
                  detalhe="Por oportunidade"
                />
                <Indicador
                  Icone={Target}
                  rotulo="Conversão"
                  valor={`${resumo.conversao}%`}
                  detalhe={`Leads em "${resumo.ultimaEtapa}"`}
                />
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-x-scroll px-6 py-6 xl:px-16">
            {resumo.quantidade === 0 && totalDoFunil > 0 ? (
              <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-2 py-20 text-center">
                <SearchX className="size-8 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  Nenhuma oportunidade com esses filtros
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  As {totalDoFunil} deste funil continuam aqui — só estão fora do
                  recorte. Limpe os filtros na barra acima.
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={aoIniciarArraste}
                onDragOver={aoPassarPor}
                onDragEnd={aoSoltar}
                onDragCancel={() => setIdAtivo(null)}
              >
                <div className="flex h-full max-w-[1600px] items-start gap-4">
                  {colunas.map(({ etapa, visiveis, ocultos }) => (
                    <ColunaEtapa
                      key={etapa.id}
                      id={etapa.id}
                      nome={etapa.nome}
                      cor={etapa.cor}
                      oportunidades={visiveis}
                      ocultos={ocultos}
                      destacadoId={destacadoId}
                      aoAdicionar={setEtapaNova}
                      aoAbrir={setOpAbertaId}
                    />
                  ))}
                </div>

                <DragOverlay>
                  {oportunidadeAtiva && (
                    <div className="w-80 rotate-2 cursor-grabbing">
                      <CartaoDoQuadro oportunidade={oportunidadeAtiva} arrastando />
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
          </main>
        </div>

        {etapaNova && (
          <FormOportunidade
            etapaNome={etapas.find((e) => e.id === etapaNova)?.nome ?? ""}
            contatos={dados.contatos}
            usuarios={dados.usuarios}
            aoCriar={aoCriarOportunidade}
            aoFechar={() => setEtapaNova(null)}
          />
        )}

        {oportunidadeAberta && (
          <FichaOportunidade
            key={oportunidadeAberta.id}
            oportunidade={oportunidadeAberta}
            contato={contatoPorId.get(oportunidadeAberta.contato_id)}
            etapaPorId={dados.etapaPorId}
            funilPorId={dados.funilPorId}
            usuarioPorId={usuarioPorId}
            oportunidadesDoContato={dados.oportunidadesDoContato}
            historicoDoContato={dados.historicoDoContato}
            anotacoesDoContato={dados.anotacoesDoContato}
            segmentosDoContato={segmentosDoContato}
            tagsDoContato={tagsDoContato}
            atendimentosDoContato={dados.atendimentosDoContato}
            camposContato={dados.camposContato}
            camposOportunidade={dados.camposOportunidade}
            aoFechar={() => setOpAbertaId(null)}
          />
        )}
      </div>
    </CartaoContexto.Provider>
  );
}
