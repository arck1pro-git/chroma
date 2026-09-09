"use client";

import {
  useCallback,
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
import { Check, Funnel, Layers, ListTree, Plus, Users } from "lucide-react";
import type { Contato, Etapa, Oportunidade, Tag, Usuario } from "../data";
import type { DadosFunil } from "../funil/dados";
import { brl } from "../formato";
import CartaoOportunidade from "../funil/cartao";
import BarraSelecao, { type FluxoDisponivel } from "../funil/barra-selecao";
import FichaOportunidade from "../funil/ficha-oportunidade";
import FormOportunidade, { type DadosOportunidade } from "../funil/form-oportunidade";
import { criarOportunidade, moverOportunidade } from "../funil/actions";
import { SeletorMenu } from "../components/filtros-ui";
import BarraFiltros from "../funil/barra-filtros";
import {
  contarFiltrosAtivos,
  filtrosVazios,
  passaNoFiltro,
  type Filtros,
} from "../funil/filtros";
import GavetaContatos from "./gaveta-contatos";
import ChatIa from "../components/chat-ia";
import { metricasDoFunil, type Conversao, type MetricaEtapa } from "./metricas";
import PainelSubetapas from "./painel-subetapas";
import type { CadenciaDaEtapa, DadosCadencias } from "./cadencias";

// Tela inicial e ÚNICA tela do CRM. /dashboard, /funil e /contatos não existem
// mais como rota: tudo acontece aqui, em painéis sobrepostos.
//
// Não há mais faixa de gráficos no topo. Os números que ela mostrava moram
// AGORA DENTRO DO QUADRO, onde o dado já está: a conversão entre duas etapas
// vive no espaço entre as duas colunas, e o tempo médio e o ticket médio da
// etapa ficam à vista sob o nome dela. Menos altura gasta e nada que exija
// casar o rótulo de um gráfico com a coluna correspondente.
//
// Clicar num card abre a ficha da oportunidade (a mesma do funil); arrastar
// move entre etapas e persiste via moverOportunidade — ver o comentário do
// estado `quadro`, mais abaixo.

// Oportunidades agrupadas por etapa. É o estado que o arraste mexe.
type Quadro = Record<string, Oportunidade[]>;

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

function etapaDe(id: UniqueIdentifier, mapa: Quadro) {
  const chave = String(id);
  if (chave in mapa) return chave;
  return Object.keys(mapa).find((etapaId) =>
    mapa[etapaId].some((o) => o.id === chave),
  );
}

// Card arrastável. O clique continua abrindo a ficha: o sensor só considera
// arraste depois de 6px de movimento, então clicar não vira drag.
function CartaoArrastavel({
  oportunidade,
  cor,
  destacado,
  contato,
  responsavel,
  tags,
  aoAbrir,
  selecionado,
  aoSelecionar,
}: {
  oportunidade: Oportunidade;
  cor: string;
  destacado: boolean;
  contato?: Contato;
  responsavel?: Usuario;
  tags: Tag[];
  aoAbrir: (id: string) => void;
  selecionado: boolean;
  aoSelecionar: (id: string, marcado: boolean) => void;
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
      // id usado pelo scrollIntoView de quem chega por ?op=<id>
      id={`op-${oportunidade.id}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => aoAbrir(oportunidade.id)}
      // pl-1 + fundo na cor da etapa = lombada colorida: o cartão branco por
      // cima cobre o resto e sobra a faixa da esquerda
      className={`group/cartao relative touch-none rounded-xl pl-1 outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100 ${cor} ${
        isDragging ? "opacity-40" : "cursor-grab active:cursor-grabbing"
      } ${
        destacado
          ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-zinc-100 dark:ring-zinc-100 dark:ring-offset-zinc-900"
          : ""
      }`}
      {...attributes}
      {...listeners}
    >
      {/* A caixa fica DENTRO do article arrastável, então precisa parar tanto
          o clique (que abriria a ficha) quanto o pointerdown (que o dnd-kit
          interpreta como início de arraste). Sem os dois, marcar um cartão
          abriria a ficha ou sairia arrastando. */}
      <label
        className={`absolute left-2.5 top-2.5 z-10 flex size-5 cursor-pointer items-center justify-center rounded-md border bg-white transition dark:bg-zinc-900 ${
          selecionado
            ? "border-zinc-900 dark:border-zinc-100"
            : "border-zinc-300 opacity-0 group-hover/cartao:opacity-100 dark:border-zinc-600"
        }`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selecionado}
          onChange={(e) => aoSelecionar(oportunidade.id, e.target.checked)}
          className="sr-only"
          aria-label={`Selecionar ${oportunidade.nome}`}
        />
        {selecionado && (
          <Check className="size-3.5 text-zinc-900 dark:text-zinc-100" aria-hidden="true" />
        )}
      </label>

      <CartaoOportunidade
        oportunidade={oportunidade}
        contato={contato}
        responsavel={responsavel}
        tags={tags}
      />
    </article>
  );
}

// O que ficava no gráfico "conversão para a etapa seguinte". Em vez de ocupar
// uma coluna própria entre as etapas (que as afastava), a pílula é absoluta e
// fica a cavaleiro da divisa: centrada na borda direita da etapa de origem e
// içada meia altura, ela pega a ponta das DUAS colunas. Assim as etapas podem
// ficar quase encostadas.
function PassoConversao({ conversao }: { conversao: Conversao }) {
  return (
    <span
      className="absolute right-0 top-0 z-10 -translate-y-1/2 translate-x-1/2 whitespace-nowrap rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[13px] font-semibold tabular-nums text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      // dois canais: o title pro mouse, o aria-label pro leitor de tela
      title={`${conversao.seguiram} de ${conversao.entraram} seguiram de ${conversao.origem} para ${conversao.destino}`}
      aria-label={`Conversão de ${conversao.origem} para ${conversao.destino}: ${conversao.taxa}%`}
    >
      {conversao.taxa}%
    </span>
  );
}

function ColunaResumo({
  etapa,
  oportunidades,
  metrica,
  conversao,
  contatoPorId,
  usuarioPorId,
  tagsDoContato,
  destacadoId,
  aoAbrir,
  aoAdicionar,
  cadencia,
  aoAbrirSubetapas,
  selecionados,
  aoSelecionar,
}: {
  etapa: Etapa;
  oportunidades: Oportunidade[];
  metrica: MetricaEtapa;
  // conversão DESTA etapa para a seguinte; null na última
  conversao: Conversao | null;
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  tagsDoContato: Map<string, Tag[]>;
  destacadoId: string | null;
  aoAbrir: (id: string) => void;
  aoAdicionar: (etapaId: string) => void;
  // a automação desta etapa, quando já existe; null = etapa sem cadência ainda
  cadencia: CadenciaDaEtapa | null;
  aoAbrirSubetapas: (etapa: Etapa) => void;
  selecionados: Set<string>;
  aoSelecionar: (id: string, marcado: boolean) => void;
}) {
  const total = oportunidades.reduce((soma, o) => soma + o.valor, 0);
  // a área de cards é o alvo de soltura — inclusive quando a etapa está vazia
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });

  return (
    <section
      // Fill bem mais leve que o bg-zinc-200/70 de antes: com o conteúdo agora
      // branco, aquele cinza era o objeto mais pesado da tela e brigava com os
      // cartões, que são o que a pessoa vem ler. Aqui a coluna só realça o
      // suficiente para delimitar — quem tem contorno é o cartão.
      //
      // Realce e NÃO borda: a faixa de cor da etapa é full-bleed no topo, e com
      // borda ela deixaria falhas nos cantos arredondados. Clipar com
      // overflow-hidden resolveria a faixa e cortaria a pílula de conversão,
      // que é posicionada FORA da coluna de propósito.
      className="relative flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-zinc-100/70 dark:bg-zinc-900/50"
      aria-label={etapa.nome}
    >
      {conversao && <PassoConversao conversao={conversao} />}

      {/* A cor da etapa já existia no dado e só aparecia num ponto de 8px.
          Aqui ela vira a faixa que identifica a coluna — e reaparece na lombada
          de cada card lá embaixo, amarrando card e etapa pela mesma cor. */}
      <span
        className={`h-1.5 shrink-0 rounded-t-xl ${etapa.cor}`}
        aria-hidden="true"
      />

      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">
              {etapa.nome}
            </h3>
            <span className="min-w-5 shrink-0 rounded-full bg-zinc-200 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {oportunidades.length}
            </span>
          </div>
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
            {brl(total)}
          </span>
          <button
            type="button"
            onClick={() => aoAdicionar(etapa.id)}
            aria-label={`Adicionar oportunidade em ${etapa.nome}`}
            title="Adicionar oportunidade"
            className="flex size-5 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* As duas médias da etapa, uma sob a outra e com rótulo: valor à
            direita, alinhado entre as linhas, para a coluna de números ler na
            vertical. Antes era uma linha só de valores soltos. */}
        <dl className="mt-1.5 flex flex-col gap-0.5 pl-4 text-[12px]">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="truncate text-zinc-500 dark:text-zinc-400">
              Tempo médio na etapa
            </dt>
            <dd className="shrink-0 font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
              {metrica.diasMedio} d
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="truncate text-zinc-500 dark:text-zinc-400">
              Ticket médio
            </dt>
            <dd className="shrink-0 font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
              {brl(metrica.ticketMedio)}
            </dd>
          </div>
        </dl>

        {/* Abre a cadência de mensagens desta etapa. Fica ABAIXO dos números
            porque é uma saída da coluna, não um dado dela: quem lê o cabeçalho
            de cima pra baixo termina em "e daqui, pra onde?".

            Em TODA etapa, agora. Antes ficava só na primeira porque a cadência
            era uma régua de dias fixa, igual para todo mundo; hoje ela é uma
            automação por etapa, com as mensagens e os intervalos que aquela
            etapa pedir — e a etapa que não tiver uma abre o painel vazio, com
            o botão de criar. */}
        <button
          type="button"
          onClick={() => aoAbrirSubetapas(etapa)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 py-1 text-[12px] font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <ListTree className="size-3.5 shrink-0" aria-hidden="true" />
          {cadencia ? "Cadência" : "Criar cadência"}
          {cadencia && (
            <span className="tabular-nums text-zinc-400 dark:text-zinc-500">
              {cadencia.subetapas.length}
            </span>
          )}
          {/* Ponto verde = rodando no motor. É o único sinal, no quadro, de que
              aquela etapa está mandando mensagem sozinha — e o cinza diz que a
              cadência existe mas está pausada, que é diferente de não existir. */}
          {cadencia && cadencia.publicadoAlgumaVez && (
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                cadencia.estado === "publicado" ? "bg-emerald-500" : "bg-zinc-400"
              }`}
              title={
                cadencia.estado === "publicado"
                  ? "Cadência rodando"
                  : "Cadência pausada"
              }
              aria-label={
                cadencia.estado === "publicado"
                  ? "Cadência rodando"
                  : "Cadência pausada"
              }
            />
          )}
        </button>
      </div>

      {/* a coluna vai até o pé da tela (max-h-full acima) e é AQUI que rola.
          Sem altura fixa: quanto mais tela, mais card aparece. */}
      <SortableContext
        items={oportunidades.map((o) => o.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={`rolagem-oculta flex min-h-0 flex-col gap-3 overflow-y-auto rounded-b-2xl p-3 transition ${
            isOver ? "bg-zinc-200/60 dark:bg-zinc-800/50" : ""
          }`}
        >
          {oportunidades.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-5 text-center text-xs text-zinc-400 dark:border-zinc-700">
              Solte uma oportunidade aqui
            </p>
          ) : (
            oportunidades.map((o) => {
              const contato = contatoPorId.get(o.contato_id);

              return (
                <CartaoArrastavel
                  key={o.id}
                  oportunidade={o}
                  cor={etapa.cor}
                  destacado={o.id === destacadoId}
                  contato={contato}
                  responsavel={
                    o.responsavel_id
                      ? usuarioPorId.get(o.responsavel_id)
                      : undefined
                  }
                  tags={contato ? (tagsDoContato.get(contato.id) ?? []) : []}
                  aoAbrir={aoAbrir}
                  selecionado={selecionados.has(o.id)}
                  aoSelecionar={aoSelecionar}
                />
              );
            })
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export default function Inicio({
  dados,
  cadencias,
  opInicial,
  conversaInicial,
  cadenciaInicial,
  fluxosParaInscricao,
}: {
  dados: DadosFunil;
  // A cadência de cada etapa (a automação por trás das subetapas) e as
  // instâncias de WhatsApp disponíveis. Ver app/inicio/cadencias.ts.
  cadencias: DadosCadencias;
  // ?op=<id> na URL (o chat linka a oportunidade pra cá). Resolvido no
  // servidor e entregue como prop: ler window.location num efeito abriria a
  // ficha só depois da hidratação, com um piscar da tela sem ela.
  opInicial: string | null;
  // ?ia= da URL. Vai para o painel do FUNIL quando não há cadência aberta; com
  // ?cadencia=, é a conversa daquele painel e quem a recebe é ele.
  conversaInicial: string | null;
  // ?cadencia=<fluxo_id>: abre o painel daquela etapa já na carga.
  cadenciaInicial: string | null;
  // Automações de oportunidade publicadas — o que a barra de seleção oferece
  // em "Inscrever na automação". Vem do servidor porque a lista muda quando
  // alguém publica um fluxo, e a raiz já é force-dynamic.
  fluxosParaInscricao: FluxoDisponivel[];
}) {
  const {
    funis,
    etapas,
    oportunidades,
    contatos,
    usuarios,
    segmentos,
    contatoPorId,
    usuarioPorId,
    tagsDoContato,
  } = dados;

  // ── Seleção em lote ───────────────────────────────────────────────────────
  // Set e não array: marcar/desmarcar é O(1) e o cartão pergunta "estou
  // selecionado?" a cada render, uma vez por cartão.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const aoSelecionar = useCallback((id: string, marcado: boolean) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }, []);

  const limparSelecao = useCallback(() => setSelecionados(new Set()), []);

  // O quadro nasce do banco e vive em estado: mover um card reordena aqui na
  // hora (palpite otimista, as métricas recalculam junto) e o aoSoltar grava
  // de verdade via moverOportunidade. O efeito logo abaixo resincroniza sempre
  // que `dados` mudar (revalidatePath de uma action, inclusive a nossa) — sem
  // ele, um card corrigido no banco depois de uma falha de rede não voltaria a
  // aparecer na coluna certa sem F5.
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [quadro, setQuadro] = useState<Quadro>(() =>
    quadroDe(oportunidades, etapas),
  );

  useEffect(() => {
    setQuadro(quadroDe(oportunidades, etapas));
  }, [oportunidades, etapas]);

  const oportunidadesAtuais = useMemo(
    () => Object.values(quadro).flat(),
    [quadro],
  );

  const oportunidadePorId = useMemo(
    () => new Map(oportunidadesAtuais.map((o) => [o.id, o])),
    [oportunidadesAtuais],
  );

  // Chegando por ?op=, abre já no funil daquela oportunidade — senão a ficha
  // abriria sobre o quadro errado e o card destacado nem estaria na tela.
  const [funilId, setFunilId] = useState(
    () =>
      (opInicial ? oportunidadePorId.get(opInicial)?.funil_id : undefined) ??
      funis[0]?.id ??
      "",
  );
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [opAbertaId, setOpAbertaId] = useState<string | null>(opInicial);
  const [destacadoId, setDestacadoId] = useState<string | null>(opInicial);
  // etapa onde o botão "+" foi clicado; não-nulo abre o formulário.
  const [etapaNova, setEtapaNova] = useState<string | null>(null);

  // SUBETAPAS: a cadência de mensagens de uma etapa, aberta em painel próprio
  // por cima do quadro. Não há mais estado local aqui — a cadência é uma
  // AUTOMAÇÃO gravada (app/inicio/cadencias.ts), então o que o painel edita vai
  // ao banco pelo botão Salvar e volta pelo revalidatePath. Isto aqui guarda só
  // QUAL etapa está aberta.
  // A etapa do painel de cadência. Nasce resolvida quando a URL trouxe
  // ?cadencia=<fluxo_id>: acha a etapa cuja cadência é aquele fluxo. Feito no
  // inicializador do useState, e não num efeito, para o painel já vir aberto na
  // primeira pintura em vez de piscar fechado.
  const [etapaSubetapas, setEtapaSubetapas] = useState<Etapa | null>(() => {
    if (!cadenciaInicial) return null;
    for (const [etapaId, c] of cadencias.porEtapa) {
      if (c.fluxoId === cadenciaInicial) {
        return etapas.find((e) => e.id === etapaId) ?? null;
      }
    }
    return null;
  });

  const cadenciaAberta = etapaSubetapas
    ? (cadencias.porEtapa.get(etapaSubetapas.id) ?? null)
    : null;

  const funil = funis.find((f) => f.id === funilId) ?? funis[0];

  // Cria pela server action; o revalidate + o efeito de resincronia (acima)
  // trazem a oportunidade nova pro quadro.
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

  const oportunidadeAberta = opAbertaId
    ? (oportunidadePorId.get(opAbertaId) ?? null)
    : null;

  // Tira o ?op= da barra de endereços depois de usar, senão um F5 reabre a
  // ficha que o usuário acabou de fechar. replaceState não navega.
  useEffect(() => {
    if (!opInicial) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [opInicial]);

  // Rola até o card destacado e apaga o destaque sozinho. O setState mora no
  // timeout, não no corpo do efeito.
  useEffect(() => {
    if (!destacadoId) return;
    document
      .getElementById(`op-${destacadoId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const tempo = setTimeout(() => setDestacadoId(null), 2600);
    return () => clearTimeout(tempo);
  }, [destacadoId]);

  // A oportunidade pode ser de outro funil (veio da gaveta de um contato):
  // troca o quadro junto, senão o destaque aponta pra um card fora da tela.
  function abrirOportunidade(id: string) {
    const alvo = oportunidadePorId.get(id);
    if (alvo) setFunilId(alvo.funil_id);
    setGavetaAberta(false);
    setOpAbertaId(id);
    setDestacadoId(id);
  }

  const etapasDoFunil = useMemo(
    () => etapas.filter((e) => e.funil_id === funil?.id),
    [etapas, funil],
  );

  // ── Filtros do quadro ──────────────────────────────────────────────────────
  //
  // Filtram a EXIBIÇÃO, não o estado `quadro`. O arraste continua mexendo na
  // lista inteira: se o filtro comesse o estado, soltar um card numa etapa
  // sumiria com os cards escondidos daquela coluna ao regravar.
  //
  // Limite conhecido: com filtro ativo, reordenar DENTRO de uma coluna mexe em
  // índices da lista visível, que não são os da lista completa. Não faz estrago
  // real — a ordem dentro da etapa não é persistida (não há coluna `ordem` em
  // oportunidades), só o `etapa_id`, e esse o arraste acerta sempre.
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios);
  const temFiltro = contarFiltrosAtivos(filtros) > 0;

  const quadroVisivel = useMemo(() => {
    if (!temFiltro) return quadro;
    const mapa: Quadro = {};
    for (const etapaId of Object.keys(quadro)) {
      mapa[etapaId] = quadro[etapaId].filter((o) =>
        passaNoFiltro(
          o,
          filtros,
          contatoPorId,
          dados.segmentosDoContato,
          tagsDoContato,
        ),
      );
    }
    return mapa;
  }, [quadro, temFiltro, filtros, contatoPorId, dados.segmentosDoContato, tagsDoContato]);

  // As oportunidades que o quadro mostra AGORA. É delas que saem as métricas —
  // com um filtro ligado, um ticket médio calculado sobre as 173 enquanto a
  // tela conta 3 seria número errado à vista de todos.
  const visiveisDoFunil = useMemo(
    () => etapasDoFunil.flatMap((e) => quadroVisivel[e.id] ?? []),
    [etapasDoFunil, quadroVisivel],
  );

  // Denominador do "N de M": o funil inteiro, sem filtro.
  const totalDoFunil = useMemo(
    () => etapasDoFunil.reduce((s, e) => s + (quadro[e.id]?.length ?? 0), 0),
    [etapasDoFunil, quadro],
  );

  // Conversão entre etapas, tempo médio e ticket médio por etapa. Saíram dos
  // gráficos do topo e agora alimentam o próprio quadro.
  const metricas = useMemo(
    () => metricasDoFunil(etapasDoFunil, visiveisDoFunil),
    [etapasDoFunil, visiveisDoFunil],
  );

  const colunas = useMemo(
    () =>
      etapasDoFunil.map((etapa, i) => ({
        etapa,
        oportunidades: quadroVisivel[etapa.id] ?? [],
        // metricas.etapas percorre etapasDoFunil na mesma ordem
        metrica: metricas.etapas[i],
        // conversão DESTA etapa para a seguinte; null na última
        conversao: metricas.conversoes[i] ?? null,
      })),
    [etapasDoFunil, quadroVisivel, metricas],
  );


  // ── Arrastar cards entre etapas ────────────────────────────────────────────
  const sensores = useSensors(
    // 6px de folga: sem isto todo clique viraria arraste e a ficha nunca abria
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [idArrastando, setIdArrastando] = useState<UniqueIdentifier | null>(null);
  // etapa de origem, pra saber no fim se o card realmente mudou de coluna
  const etapaInicialRef = useRef<string | undefined>(undefined);

  const emArraste = idArrastando
    ? (oportunidadePorId.get(String(idArrastando)) ?? null)
    : null;
  const contatoEmArraste = emArraste
    ? contatoPorId.get(emArraste.contato_id)
    : undefined;

  function aoIniciarArraste({ active }: DragStartEvent) {
    setIdArrastando(active.id);
    etapaInicialRef.current = etapaDe(active.id, quadro);
  }

  // Move de coluna DURANTE o arraste, pra prévia acompanhar o cursor.
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
          // o etapa_id do próprio dado acompanha: as métricas leem dele
          { ...item, etapa_id: destino },
          ...anterior[destino].slice(posicao),
        ],
      };
    });
  }

  function aoSoltar({ active, over }: DragEndEvent) {
    setIdArrastando(null);

    // Persiste a mudança de etapa. O destino vem do `over` do evento (não do
    // estado, que pode estar um render atrás do último aoPassarPor); sem over,
    // cai no que o quadro já mostra.
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

  const quantidade = colunas.reduce((s, c) => s + c.oportunidades.length, 0);
  const total = colunas.reduce(
    (s, c) => s + c.oportunidades.reduce((x, o) => x + o.valor, 0),
    0,
  );

  return (
    // Flex HORIZONTAL: a coluna de conteúdo e, ao lado dela, a conversa com a
    // IA. Abrir a IA EMPURRA o quadro em vez de cobri-lo — com um kanban de
    // rolagem horizontal, um painel flutuante escondia justamente as colunas
    // sobre as quais se está perguntando.
    // min-w-0 na coluna de conteúdo: sem ele o filho que rola na horizontal
    // (o quadro) impõe a própria largura e o flex nunca encolhe.
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Barra do topo: só o seletor de funil e o acesso aos contatos. Fica
            fora da área que rola, então o funil escolhido continua à vista. */}
        <header className="shrink-0 border-b border-zinc-200 px-6 py-2 xl:px-16 dark:border-zinc-800">
          <div className="flex max-w-[1600px] items-center gap-2">
            {/* Um controle só, não uma fileira de abas: a lista de funis cresce
                com o uso e uma aba por funil empurraria o botão de contatos pra
                fora da barra. Mesmo dropdown dos filtros do resto do app. */}
            <SeletorMenu
              Icone={Funnel}
              rotulo="Funil"
              valor={funil?.id ?? ""}
              opcoes={funis.map((f) => ({ valor: f.id, rotulo: f.nome }))}
              aoMudar={setFunilId}
              botao="w-56"
            />

            {/* Canto superior direito: abre a gaveta de contatos. aria-expanded
                porque o botão é o controle de um painel que já está na página. */}
            <button
              type="button"
              onClick={() => setGavetaAberta(true)}
              aria-expanded={gavetaAberta}
              aria-label={`Contatos (${contatos.length})`}
              title="Contatos"
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <Users className="size-4" aria-hidden="true" />
              <span className="tabular-nums">{contatos.length}</span>
            </button>
          </div>

        </header>

        {/* O quadro ocupa TODA a altura que sobra e não rola junto com a página:
            quem rola é cada coluna, por dentro. Assim o kanban mostra o máximo de
            cards que couber na tela em vez de ficar preso a uma altura fixa. */}
        {/* Sem padding à DIREITA e sem largura máxima: o quadro rola até encostar
            na borda da janela. Com px-6/xl:px-16 dos dois lados, a última coluna
            ficava cortada por uma faixa de fundo vazia. A folga da esquerda fica,
            para alinhar com o cabeçalho. */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden pb-3 pl-6 pr-0 pt-4 xl:pl-16">
          {!funil ? (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-2 py-20 text-center">
              <Layers
                className="size-8 text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Nenhum funil cadastrado
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Cadastre um funil com suas etapas na origem dos dados para os
                gráficos e o quadro aparecerem. Os contatos, ao lado, já funcionam.
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <section
                className="flex min-h-0 flex-1 flex-col"
                aria-label={`Quadro · ${funil.nome}`}
              >
                {/* Filtros no topo do quadro, e não na barra do topo da
                    página: o que eles recortam são as colunas logo abaixo, e é
                    ali que a pessoa olha ao mexer neles. Sem o seletor de funil
                    — esse já está no cabeçalho — e alinhados ao quadro, com
                    folga só à esquerda. */}
                <BarraFiltros
                  mostrarFunil={false}
                  moldura="mb-1 shrink-0 pr-6 xl:pr-16"
                  linha="flex flex-wrap items-center gap-2"
                  funis={funis}
                  usuarios={usuarios}
                  segmentos={dados.segmentos}
                  tags={dados.tags}
                  contatos={contatos}
                  funilId={funilId}
                  aoTrocarFunil={setFunilId}
                  filtros={filtros}
                  aoMudarFiltros={setFiltros}
                  visiveis={visiveisDoFunil.length}
                  total={totalDoFunil}
                />

                <div className="mb-2 flex shrink-0 items-baseline gap-2 pr-6 xl:pr-16">
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {funil.nome}
                  </h2>
                  <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {quantidade}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                    {brl(total)}
                  </span>
                  <span className="ml-auto truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                    {funil.descricao}
                  </span>
                </div>

                {colunas.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-8 text-center text-xs text-zinc-400 dark:border-zinc-700">
                    Este funil ainda não tem etapas
                  </p>
                ) : (
                  // barra de rolagem à mostra de propósito: escondê-la deixaria
                  // as etapas à direita sem nenhum sinal de que existem
                  <DndContext
                    // id fixo: sem ele o dnd-kit gera os ids de acessibilidade
                    // (aria-describedby) em runtime e eles não batem com o SSR —
                    // dá erro de hidratação no console a cada carga
                    id="quadro"
                    sensors={sensores}
                    collisionDetection={closestCorners}
                    onDragStart={aoIniciarArraste}
                    onDragOver={aoPassarPor}
                    onDragEnd={aoSoltar}
                    onDragCancel={() => setIdArrastando(null)}
                  >
                    <div className="flex min-h-0 flex-1 items-start gap-1 overflow-x-auto pb-2 pt-4">
                      {colunas.map(({ etapa, oportunidades: doEtapa, metrica, conversao }) => (
                        <ColunaResumo
                          key={etapa.id}
                          etapa={etapa}
                          oportunidades={doEtapa}
                          metrica={metrica}
                          conversao={conversao}
                          contatoPorId={contatoPorId}
                          usuarioPorId={usuarioPorId}
                          tagsDoContato={tagsDoContato}
                          destacadoId={destacadoId}
                          aoAbrir={abrirOportunidade}
                          aoAdicionar={setEtapaNova}
                          cadencia={cadencias.porEtapa.get(etapa.id) ?? null}
                          aoAbrirSubetapas={setEtapaSubetapas}
                          selecionados={selecionados}
                          aoSelecionar={aoSelecionar}
                        />
                      ))}
                    </div>

                    {/* cópia que segue o cursor; o original fica esmaecido */}
                    <DragOverlay>
                      {emArraste && (
                        <div className="w-72 rotate-2 cursor-grabbing">
                          <CartaoOportunidade
                            oportunidade={emArraste}
                            contato={contatoEmArraste}
                            responsavel={
                              emArraste.responsavel_id
                                ? usuarioPorId.get(emArraste.responsavel_id)
                                : undefined
                            }
                            tags={
                              contatoEmArraste
                                ? (tagsDoContato.get(contatoEmArraste.id) ?? [])
                                : []
                            }
                            arrastando
                          />
                        </div>
                      )}
                    </DragOverlay>
                  </DndContext>
                )}
              </section>
            </div>
          )}
        </main>
      </div>

      <BarraSelecao
        selecionados={[...selecionados]}
        usuarios={usuarios}
        segmentos={segmentos}
        fluxos={fluxosParaInscricao}
        aoLimpar={limparSelecao}
      />

      {/* Irmã da coluna de conteúdo, não sobreposta a ela: é o `modo="lateral"`
          que faz o painel ocupar espaço de verdade. A frase do contexto diz o
          que está na tela agora — não vão dados aqui, quem lê o CRM são as
          ferramentas do servidor. */}
      <ChatIa
        modo="lateral"
        escopoContexto="analise"
        // Quem abre a análise aqui é o "+" da sidebar, ao lado de "Análises".
        botaoFlutuante={false}
        // Com uma cadência aberta, o ?ia= é dela — passar aqui também abriria
        // dois painéis na mesma conversa, e o escopo do funil nem acharia a
        // linha (lerConversaIa filtra por escopo).
        conversaInicial={etapaSubetapas ? null : conversaInicial}
        contexto={
          funil
            ? `funil "${funil.nome}" (id ${funil.id}), ${quantidade} oportunidades, ${brl(total)}` +
              (oportunidadeAberta
                ? `; ficha aberta: "${oportunidadeAberta.nome}"`
                : "") +
              (gavetaAberta ? "; gaveta de contatos aberta" : "") +
              (etapaSubetapas
                ? `; subetapas da etapa "${etapaSubetapas.nome}" abertas`
                : "")
            : "nenhum funil cadastrado"
        }
      />

      {/* Por cima de tudo (z-60), com o fundo desfocado: o quadro de subetapas
          tem 18 colunas próprias e não divide a tela com o de trás. */}
      {etapaSubetapas && (
        <PainelSubetapas
          key={etapaSubetapas.id}
          etapa={etapaSubetapas}
          conversaInicial={conversaInicial}
          cadencia={cadenciaAberta}
          // as oportunidades REAIS da etapa, do mesmo estado que o quadro usa —
          // arrastar um card para cá e abrir a cadência mostra a mesma coisa
          oportunidades={quadro[etapaSubetapas.id] ?? []}
          instancias={cadencias.instancias}
          // quem tem inscrição viva: é para esses que o card mostra o botão de
          // sair da cadência
          emCadencia={cadencias.emCadencia}
          contatoPorId={contatoPorId}
          usuarioPorId={usuarioPorId}
          tagsDoContato={tagsDoContato}
          aoFechar={() => setEtapaSubetapas(null)}
        />
      )}

      {gavetaAberta && (
        <GavetaContatos
          contatos={contatos}
          segmentosDoContato={dados.segmentosDoContato}
          tagsDoContato={tagsDoContato}
          oportunidadesDoContato={dados.oportunidadesDoContato}
          historicoDoContato={dados.historicoDoContato}
          anotacoesDoContato={dados.anotacoesDoContato}
          etapaPorId={dados.etapaPorId}
          funilPorId={dados.funilPorId}
          usuarioPorId={usuarioPorId}
          camposContato={dados.camposContato}
          aoAbrirOportunidade={abrirOportunidade}
          aoFechar={() => setGavetaAberta(false)}
        />
      )}

      {/* key por oportunidade: trocar de card remonta o painel, então o slide
          de entrada roda de novo em vez de o React reaproveitar o nó */}
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
          segmentosDoContato={dados.segmentosDoContato}
          tagsDoContato={tagsDoContato}
          atendimentosDoContato={dados.atendimentosDoContato}
          camposContato={dados.camposContato}
          camposOportunidade={dados.camposOportunidade}
          aoFechar={() => setOpAbertaId(null)}
        />
      )}

      {etapaNova && (
        <FormOportunidade
          etapaNome={etapas.find((e) => e.id === etapaNova)?.nome ?? ""}
          contatos={contatos}
          usuarios={usuarios}
          aoCriar={aoCriarOportunidade}
          aoFechar={() => setEtapaNova(null)}
        />
      )}
    </div>
  );
}
