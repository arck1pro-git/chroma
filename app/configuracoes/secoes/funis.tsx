"use client";

// Funis e as etapas de cada um — a seção que o quadro da raiz lê.
//
// A cor é do FUNIL: as etapas recebem tons dela, da mais clara na primeira à
// mais escura na última (lib/cores-funil.ts). Trocar a cor aqui repinta o
// quadro inteiro; `etapas.cor` continua na tabela sem ninguém ler — e por isso
// esta tela também não lê mais: as bolinhas das etapas mostravam a cor velha
// gravada na linha (vermelho, verde, roxo misturados) enquanto o quadro já
// pintava tudo no tom do funil.
//
// O DESENHO (redesenho de 2026-10-08):
// · cada funil abre com a FAIXA das etapas no topo — a mesma rampa de tons que
//   o quadro mostra, uma fatia por etapa. Dá para ver o funil antes de ler;
// · as etapas são uma lista numerada, com fio entre as linhas (era uma caixa
//   com borda por etapa); alça de arrastar e lápis aparecem no hover;
// · cada etapa mostra quantas oportunidades estão nela — é o número que diz se
//   renomear ou reordenar mexe com alguém;
// · a cor de um funil já criado é UMA amostra que abre a paleta. As 13
//   bolinhas fixas no cabeçalho eram o objeto mais barulhento da tela;
// · criar funil é um botão no cabeçalho da aba, e não um formulário sempre
//   aberto em cima da lista.
import { useState, useTransition } from "react";
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
  Check,
  ChevronDown,
  Columns3,
  GripVertical,
  Layers,
  Megaphone,
  Pencil,
  Plus,
  Users,
  X,
} from "lucide-react";
import type { Etapa, Funil } from "../../data";
import { TOM_PADRAO, tomDaEtapa } from "@/lib/cores-funil";
import { EVENTOS_META_PADRAO, ehEventoPadrao, NOME_EVENTO_META } from "@/lib/meta-eventos-nomes";
import {
  criarEtapa,
  criarFunil,
  definirEventoMetaDaEtapa,
  editarCorDoFunil,
  editarEtapa,
  editarFunil,
  reordenarEtapas,
} from "../actions";
import { botao, botaoFantasma, campoTexto, rotuloCampo } from "./ui";
import {
  BotaoIcone,
  Cabecalho,
  Erro,
  Painel,
  PainelTopo,
  PaletaCores,
  SeletorCor,
} from "./pecas";

export function SecaoFunis({
  funis,
  etapasPorFunil,
  oportunidadesPorEtapa,
}: {
  funis: Funil[];
  etapasPorFunil: Map<string, Etapa[]>;
  oportunidadesPorEtapa: Record<string, number>;
}) {
  // Sem funil nenhum, o formulário já vem aberto: não há o que mostrar além
  // dele, e um botão "Novo funil" sobre uma tela vazia seria um clique a mais.
  const [criando, setCriando] = useState(funis.length === 0);

  return (
    <section className="flex flex-col gap-6">
      <Cabecalho
        Icone={Layers}
        titulo="Funis e etapas"
        contagem={funis.length}
        descricao="Cada funil é um quadro do Dashboard e as etapas são as colunas dele, na ordem desta lista. A cor do funil pinta as etapas do claro ao escuro — quanto mais escura, mais perto do fechamento."
        acao={
          !criando && (
            <button type="button" onClick={() => setCriando(true)} className={botao}>
              <Plus className="size-4" aria-hidden="true" />
              Novo funil
            </button>
          )
        }
      />

      {criando && (
        <NovoFunil aoFechar={funis.length > 0 ? () => setCriando(false) : undefined} />
      )}

      {funis.length > 0 && (
        <ul className="flex flex-col gap-5">
          {funis.map((funil) => (
            <FunilCard
              key={funil.id}
              funil={funil}
              etapas={etapasPorFunil.get(funil.id) ?? []}
              oportunidadesPorEtapa={oportunidadesPorEtapa}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Criar ───────────────────────────────────────────────────────────────────

/** A rampa de tons como uma faixa — o "assim fica o quadro" do funil. */
function FaixaDoFunil({
  cor,
  total,
  className = "h-1.5",
}: {
  cor: string;
  total: number;
  className?: string;
}) {
  if (total === 0) {
    return <div className={`${className} bg-zinc-100 dark:bg-zinc-800`} aria-hidden="true" />;
  }
  return (
    <div className={`flex gap-px ${className}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`flex-1 transition-colors duration-300 ${tomDaEtapa(cor, i, total)}`} />
      ))}
    </div>
  );
}

function NovoFunil({ aoFechar }: { aoFechar?: () => void }) {
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
        aoFechar?.();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar funil");
      }
    });
  }

  return (
    <Painel className="surge overflow-hidden">
      <FaixaDoFunil cor={cor} total={6} />
      <PainelTopo
        titulo="Novo funil"
        descricao="Nome, cor e etapas mudam depois — o que importa agora é o nome."
        acao={
          aoFechar && (
            <BotaoIcone rotulo="Fechar" onClick={aoFechar}>
              <X className="size-4" aria-hidden="true" />
            </BotaoIcone>
          )
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={rotuloCampo}>Nome</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            autoFocus
            placeholder="Ex.: Vendas B2B"
            className={campoTexto}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={rotuloCampo}>
            Descrição <span className="font-normal text-zinc-400">· opcional</span>
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
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className={rotuloCampo}>Cor</span>
          <PaletaCores valor={cor} aoMudar={setCor} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/30">
        {erro && (
          <div className="mr-auto">
            <Erro>{erro}</Erro>
          </div>
        )}
        {aoFechar && (
          <button type="button" onClick={aoFechar} className={botaoFantasma}>
            Cancelar
          </button>
        )}
        <button type="button" onClick={criar} disabled={!nome.trim() || salvando} className={botao}>
          <Plus className="size-4" aria-hidden="true" />
          {salvando ? "Criando…" : "Criar funil"}
        </button>
      </div>
    </Painel>
  );
}

// ── Um funil ────────────────────────────────────────────────────────────────

function FunilCard({
  funil,
  etapas,
  oportunidadesPorEtapa,
}: {
  funil: Funil;
  etapas: Etapa[];
  oportunidadesPorEtapa: Record<string, number>;
}) {
  // Otimista: a cor é uma escolha visual, e esperar o servidor para repintar a
  // faixa faria o clique parecer engasgado. O revalidatePath da action traz o
  // quadro junto logo em seguida.
  const [cor, setCor] = useState(funil.cor);
  const [, trocarCor] = useTransition();

  // Edição do NOME (e da descrição) no mesmo gesto da etapa logo abaixo:
  // lápis, campo no lugar do título, Enter salva e Esc cancela. Era a única
  // coisa do funil que não se corrigia na tela — errou o nome ao criar, e só
  // restava criar outro e mover as oportunidades à mão.
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(funil.nome);
  const [descricao, setDescricao] = useState(funil.descricao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const oportunidades = etapas.reduce((s, e) => s + (oportunidadesPorEtapa[e.id] ?? 0), 0);

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await editarFunil(funil.id, n, descricao);
        setEditando(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function cancelar() {
    setNome(funil.nome);
    setDescricao(funil.descricao ?? "");
    setErro(null);
    setEditando(false);
  }

  return (
    <li>
      <Painel className="overflow-hidden">
        <FaixaDoFunil cor={cor} total={etapas.length} />

        <div className="flex items-start gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0 flex-1">
            {editando ? (
              <div className="flex flex-col gap-2">
                <input
                  value={nome}
                  onChange={(ev) => setNome(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") salvar();
                    if (ev.key === "Escape") cancelar();
                  }}
                  autoFocus
                  aria-label="Nome do funil"
                  className={`${campoTexto} font-medium`}
                />
                <input
                  value={descricao}
                  onChange={(ev) => setDescricao(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") salvar();
                    if (ev.key === "Escape") cancelar();
                  }}
                  placeholder="Descrição (opcional)"
                  aria-label="Descrição do funil"
                  className={campoTexto}
                />
                {erro && <Erro>{erro}</Erro>}
              </div>
            ) : (
              <>
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {funil.nome}
                </h2>
                {funil.descricao && (
                  <p className="mt-0.5 truncate text-[13px] text-zinc-500 dark:text-zinc-400">
                    {funil.descricao}
                  </p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex items-center gap-1.5">
                    <Columns3 className="size-3.5 text-zinc-400" aria-hidden="true" />
                    <span className="tabular-nums">{etapas.length}</span>
                    {etapas.length === 1 ? "etapa" : "etapas"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5 text-zinc-400" aria-hidden="true" />
                    <span className="tabular-nums">{oportunidades}</span>
                    {oportunidades === 1 ? "oportunidade" : "oportunidades"}
                  </span>
                </p>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {editando ? (
              <>
                <button type="button" onClick={cancelar} className={botaoFantasma}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvar}
                  disabled={salvando || !nome.trim()}
                  className={botao}
                >
                  <Check className="size-4" aria-hidden="true" />
                  Salvar
                </button>
              </>
            ) : (
              <>
                <BotaoIcone rotulo={`Renomear ${funil.nome}`} onClick={() => setEditando(true)}>
                  <Pencil className="size-3.5" aria-hidden="true" />
                </BotaoIcone>
                {/* Trocar aqui repinta TODAS as etapas do funil de uma vez: os
                    tons são derivados da cor dele, não gravados por etapa. */}
                <SeletorCor
                  valor={cor}
                  aoMudar={(nova) => {
                    setCor(nova);
                    trocarCor(() => {
                      void editarCorDoFunil(funil.id, nova);
                    });
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* Etapas em ordem — arraste pela alça, clique no lápis pra renomear.
            Ver EtapasDoFunil mais abaixo. */}
        <div className="border-t border-zinc-100 dark:border-zinc-800/80">
          {etapas.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-zinc-400 dark:text-zinc-500">
              Nenhuma etapa ainda. A primeira que você criar vira a primeira coluna do quadro.
            </p>
          ) : (
            <EtapasDoFunil
              etapas={etapas}
              cor={cor}
              oportunidadesPorEtapa={oportunidadesPorEtapa}
            />
          )}
          <NovaEtapa funilId={funil.id} />
        </div>
      </Painel>
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

  // Uma linha da própria lista, no fim dela: adicionar etapa é escrever a
  // próxima linha, e não preencher um formulário à parte.
  return (
    <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-2 dark:border-zinc-800/80 dark:bg-zinc-900/20">
      <div className="flex items-center gap-3">
        <span className="size-5 shrink-0" aria-hidden="true" />
        <span className="flex w-5 shrink-0 justify-end">
          <Plus className="size-3.5 text-zinc-400" aria-hidden="true" />
        </span>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") criar();
            if (e.key === "Escape") setNome("");
          }}
          placeholder="Adicionar etapa"
          aria-label="Nome da nova etapa"
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
        />
        {nome.trim() && (
          <button
            type="button"
            onClick={criar}
            disabled={salvando}
            className={`${botao} h-8 px-3`}
          >
            {salvando ? "Adicionando…" : "Adicionar"}
          </button>
        )}
      </div>
      {erro && (
        <div className="pb-1 pt-2">
          <Erro>{erro}</Erro>
        </div>
      )}
    </div>
  );
}

// ── Etapas: arrastar reordena, lápis renomeia ───────────────────────────────
// Lista LOCAL (igual ao quadro do kanban): arraste é otimista, ordem só grava
// no soltar. O bloco abaixo resincroniza quando `etapas` mudar por outro
// caminho (revalidate de uma edição, por exemplo).
function EtapasDoFunil({
  etapas,
  cor,
  oportunidadesPorEtapa,
}: {
  etapas: Etapa[];
  cor: string;
  oportunidadesPorEtapa: Record<string, number>;
}) {
  const [ordem, setOrdem] = useState(etapas);
  const [, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Resincroniza durante o render quando `etapas` troca (revalidate): o padrão
  // do React para estado que depende de prop, sem o quadro extra de um efeito.
  const [etapasVistas, setEtapasVistas] = useState(etapas);
  if (etapasVistas !== etapas) {
    setEtapasVistas(etapas);
    setOrdem(etapas);
  }

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

  // @container: a coluna do evento da Meta aparece pela largura do cartão, não
  // da janela; estreito, o evento desce para uma linha própria sob a etapa.
  return (
    <div className="@container">
      {/* O cabeçalho das colunas da lista: sem ele, "6" ao lado de uma etapa
          não diz o que conta. */}
      <div className="flex items-center gap-3 px-5 pb-1.5 pt-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
        <span className="w-[52px] shrink-0" aria-hidden="true" />
        <span className="flex-1 pl-[22px]">Etapa</span>
        <span className="w-24 shrink-0 text-right">Oportunidades</span>
        <span className="hidden w-52 shrink-0 @2xl:block">Evento na Meta</span>
        <span className="w-8 shrink-0" aria-hidden="true" />
      </div>

      <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
        <SortableContext items={ordem.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <ol className="pb-1">
            {ordem.map((e, i) => (
              <EtapaLinha
                key={e.id}
                etapa={e}
                posicao={i}
                tom={tomDaEtapa(cor, i, ordem.length)}
                oportunidades={oportunidadesPorEtapa[e.id] ?? 0}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {erro && (
        <div className="px-5 pb-3">
          <Erro>{erro}</Erro>
        </div>
      )}
    </div>
  );
}

function EtapaLinha({
  etapa,
  posicao,
  tom,
  oportunidades,
}: {
  etapa: Etapa;
  posicao: number;
  tom: string;
  oportunidades: number;
}) {
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

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative px-5 py-1.5 ${
        isDragging
          ? "z-10 bg-white shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* A alça aparece no hover; em tela de toque (sem hover) fica sempre. */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Arrastar para reordenar ${etapa.nome}`}
          className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-zinc-300 opacity-0 transition hover:text-zinc-600 focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100 [@media(hover:none)]:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {String(posicao + 1).padStart(2, "0")}
        </span>
        <span className={`size-2.5 shrink-0 rounded-full ${tom}`} aria-hidden="true" />

        {editando ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              value={nome}
              onChange={(ev) => setNome(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") salvar();
                if (ev.key === "Escape") cancelar();
              }}
              autoFocus
              aria-label="Nome da etapa"
              className={`${campoTexto} h-8 min-w-0 flex-1`}
            />
            <BotaoIcone rotulo="Salvar" onClick={salvar} disabled={salvando || !nome.trim()}>
              <Check className="size-4" aria-hidden="true" />
            </BotaoIcone>
            <BotaoIcone rotulo="Cancelar" onClick={cancelar}>
              <X className="size-4" aria-hidden="true" />
            </BotaoIcone>
          </div>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate py-1.5 text-[13px] text-zinc-900 dark:text-zinc-50">
              {etapa.nome}
            </span>
            <span
              className={`w-24 shrink-0 text-right text-[13px] tabular-nums ${
                oportunidades > 0 ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"
              }`}
              title={`${oportunidades} ${oportunidades === 1 ? "oportunidade" : "oportunidades"} nesta etapa agora`}
            >
              {oportunidades}
            </span>
            {/* key pelo valor gravado: se ele mudar por fora (revalidate), o
                seletor remonta com o valor novo em vez de guardar o antigo */}
            <div className="hidden w-52 shrink-0 @2xl:block">
              <EventoMetaDaEtapa key={etapa.meta_evento ?? ""} etapa={etapa} />
            </div>
            <BotaoIcone
              rotulo={`Renomear ${etapa.nome}`}
              onClick={() => setEditando(true)}
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </BotaoIcone>
          </>
        )}
      </div>
      {/* Em cartão estreito o evento da Meta desce para uma linha própria. */}
      {!editando && (
        <div className="mt-1 max-w-64 pl-[86px] @2xl:hidden">
          <EventoMetaDaEtapa key={etapa.meta_evento ?? ""} etapa={etapa} />
        </div>
      )}
      {erro && (
        <div className="mt-1.5 pl-[86px]">
          <Erro>{erro}</Erro>
        </div>
      )}
    </li>
  );
}

const PERSONALIZADO = "__personalizado__";

/**
 * Qual evento da Meta sai quando uma oportunidade ENTRA nesta etapa.
 *
 * Os padrões gravam no ato da escolha. "Personalizado…" abre um campo e só
 * grava no ✓: gravar a cada tecla mandaria nome pela metade para o banco — e,
 * com o pixel ligado, um card que entrasse no meio da digitação levaria
 * "Agend" para a Meta.
 */
function EventoMetaDaEtapa({ etapa }: { etapa: Etapa }) {
  const gravado = etapa.meta_evento ?? null;
  // Um personalizado gravado ganha opção PRÓPRIA no seletor. Se ele ficasse
  // dentro de "Personalizado…", não daria para editá-lo: escolher de novo a
  // opção já selecionada não dispara onChange.
  const personalizadoGravado = gravado !== null && !ehEventoPadrao(gravado) ? gravado : null;
  const [escolha, setEscolha] = useState(gravado ?? "");
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function gravar(valor: string | null) {
    setErro(null);
    iniciar(async () => {
      try {
        await definirEventoMetaDaEtapa(etapa.id, valor);
        setEscolha(valor ?? "");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function aoEscolher(valor: string) {
    setEscolha(valor);
    setErro(null);
    if (valor === PERSONALIZADO) {
      setNome(personalizadoGravado ?? ""); // parte do atual, para corrigir
      return; // espera o ✓
    }
    gravar(valor || null);
  }

  function salvarPersonalizado() {
    const n = nome.trim();
    if (!NOME_EVENTO_META.test(n)) {
      setErro("Comece com letra; só letras, números e _ (até 50).");
      return;
    }
    gravar(n);
  }

  function desistir() {
    setEscolha(gravado ?? "");
    setErro(null);
  }

  const ativo = escolha !== "" && escolha !== PERSONALIZADO;

  if (escolha === PERSONALIZADO) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <input
            value={nome}
            onChange={(ev) => setNome(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") salvarPersonalizado();
              if (ev.key === "Escape") desistir();
            }}
            autoFocus
            placeholder="NomeDoEvento"
            aria-label="Nome do evento personalizado"
            className={`${campoTexto} h-7 min-w-0 flex-1 px-2 font-mono text-[12px]`}
          />
          <BotaoIcone rotulo="Salvar evento" onClick={salvarPersonalizado} disabled={salvando || !nome.trim()}>
            <Check className="size-3.5" aria-hidden="true" />
          </BotaoIcone>
          <BotaoIcone rotulo="Cancelar" onClick={desistir}>
            <X className="size-3.5" aria-hidden="true" />
          </BotaoIcone>
        </div>
        {erro && <p className="text-[11px] leading-tight text-red-500">{erro}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Megaphone
          className={`pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 ${
            ativo ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"
          }`}
          aria-hidden="true"
        />
        <select
          value={escolha}
          onChange={(ev) => aoEscolher(ev.target.value)}
          disabled={salvando}
          aria-label={`Evento da Meta quando uma oportunidade entra em ${etapa.nome}`}
          title="Evento enviado à Meta quando uma oportunidade entra nesta etapa"
          className={`h-7 w-full appearance-none truncate rounded-md border py-0 pl-7 pr-6 text-[12px] outline-none transition focus-visible:ring-4 focus-visible:ring-zinc-900/5 disabled:opacity-50 dark:bg-zinc-950 dark:focus-visible:ring-zinc-100/5 ${
            ativo
              ? "border-zinc-200 bg-zinc-50 font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              : "border-transparent bg-transparent text-zinc-400 hover:border-zinc-200 hover:bg-white dark:hover:border-zinc-800 dark:hover:bg-zinc-900"
          }`}
        >
          <option value="">Nenhum evento</option>
          {EVENTOS_META_PADRAO.map((e) => (
            <option key={e.nome} value={e.nome}>
              {e.rotulo}
            </option>
          ))}
          {personalizadoGravado && (
            // Só o nome: com o sufixo " · personalizado" ele não cabia na
            // coluna. O que diz que é personalizado é a opção de editar abaixo.
            <option value={personalizadoGravado}>{personalizadoGravado}</option>
          )}
          <option value={PERSONALIZADO}>
            {personalizadoGravado ? "Editar personalizado…" : "Personalizado…"}
          </option>
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-zinc-400"
          aria-hidden="true"
        />
      </div>
      {erro && <p className="text-[11px] leading-tight text-red-500">{erro}</p>}
    </div>
  );
}
