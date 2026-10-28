"use client";

// O CONSTRUTOR das campanhas de WhatsApp oficial, em blocos (pedido dele,
// 2026-10-27: "o envio aguarda resposta e faz algo depois"). Paleta à
// esquerda, canvas no meio, painel do bloco selecionado à direita. O mesmo
// canvas, sem `mudar`, mostra a campanha no ar com quantos estão em cada bloco
// e quantos tomaram cada saída.
//
// O FLUXO É A FONTE ÚNICA: nós e ligações são derivados dele a cada render, e
// toda mudança (arrastar, ligar, apagar, editar no painel) volta como um
// FluxoCampanha novo. Sem cópia do grafo no estado do React Flow, não há duas
// versões para divergir. `mudar` recebe uma função, como o setState: apagar um
// bloco pelo teclado dispara a mudança das ligações e a do bloco no mesmo
// tique, e as duas precisam se somar, não uma sobrescrever a outra.
//
// Do React Flow o estado guarda só o que é dele: a medida de cada cartão (sem
// ela o nó volta a ficar invisível até ser medido de novo a cada render) e a
// seleção.
//
// SEM LAÇO: ligar uma saída a um bloco que já chega até ela é recusado na hora,
// com o aviso de montar a repetição em sequência (ver lib/campanhas-fluxo.ts).
//
// LIGAÇÕES EM CURVA (pedido dele, 2026-10-28: "linhas fluidas, não
// quadradas"): bezier, também a linha que acompanha o arrasto. A cor sai das
// variáveis do React Flow no wrapper (o tema segue a classe `dark` do <html>,
// não o sistema); a seta usa a mesma variável (defaultMarkerColor null), e a
// ligação selecionada, e as do bloco selecionado, ganham um marcador próprio
// com a cor forte. "Organizar" refaz o desenho (organizarFluxo, ./fluxo/grafo)
// com a altura medida de cada cartão.
//
// A VISTA (vistaLegivel, 2026-10-28): ao abrir, depois do Organizar e do
// desenho da IA, o fluxo inteiro só se ele couber com os cartões legíveis;
// senão, o começo, legível, ancorado no início. O "ajustar" dos controles
// continua mostrando tudo.
//
// As peças moram em ./fluxo/: grafo.ts (o que a tela faz com o fluxo: bloco
// novo, ligar, apagar, botões do Aguardar, pendências, revisão), no-campanha
// (os cartões), paleta, painel-lateral + painel-bloco + editor-template (a
// direita), editor-campanha e ver-campanha (a campanha nova ou editada, e a
// campanha no ar) e confirmar-ativacao (a revisão antes de ativar).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  getViewportForBounds,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CATALOGO_CAMPANHA, NO_INICIO, saidasDe, type FluxoCampanha, type Posicao, type ProblemaDoFluxo, type TipoBloco } from "@/lib/campanhas-fluxo";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { CheckCircle2, ListTree, TriangleAlert, X } from "@/app/components/icones";
import {
  COLUNA,
  acharTemplate,
  apagarBloco,
  balaoDoTemplate,
  blocoNovo,
  fechaLaco,
  idNovo,
  ligarSaida,
  organizarFluxo,
  resumoDoBloco,
  revisaoDoTexto,
  sincronizarBotoes,
  type MetricasFluxo,
  type OpcoesFluxo,
} from "./fluxo/grafo";
import {
  TIPOS_DE_NO,
  type DadosDoBloco,
  type DadosDoInicio,
  type NoDoBloco,
  type NoDoInicio,
  type PendenciaDoNo,
} from "./fluxo/no-campanha";
import PainelLateral from "./fluxo/painel-lateral";
import Paleta, { MIME_BLOCO_CAMPANHA } from "./fluxo/paleta";

export type AtualizarFluxo = (atualizar: (f: FluxoCampanha) => FluxoCampanha) => void;

type Props = {
  fluxo: FluxoCampanha;
  /** Sem `mudar`, só leitura (a campanha no ar). */
  mudar?: AtualizarFluxo;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  /** Do pai, que também decide o botão de ativar (fluxo/grafo.ts, problemasDaTela). */
  problemas: ProblemaDoFluxo[];
  metricas?: MetricasFluxo | null;
  /** O nó fixo de entrada: o resumo do cartão e o que o painel mostra com ele selecionado. */
  inicio: { resumo: string; detalhe: string; painel: React.ReactNode };
  /** O painel sem nada selecionado, na leitura. */
  semSelecao?: React.ReactNode;
  /** Uma faixa no alto do canvas, ao lado das pendências (o "A IA desenhou o fluxo · Desfazer" do editor). */
  faixa?: React.ReactNode;
  /**
   * Depois de medir os cartões pela primeira vez, refaz o desenho com a altura
   * real de cada um. O desenho da IA chega organizado pela altura estimada
   * (o teto: balão cheio, resumo em duas linhas); medido, encosta. Vem por
   * fora de `mudar` porque não é mudança de quem usa.
   */
  reorganizarAoMedir?: AtualizarFluxo;
  /** Sem a paleta: o editor põe o chat "Montar com IA" no lugar dela. */
  semPaleta?: boolean;
};

// A seta acompanha a cor da linha pela variável (ver defaultMarkerColor). A
// ligação em destaque tem marcador próprio: os marcadores são compartilhados
// por todas as ligações, e a cor de um não muda só para uma delas.
const SETA = { type: MarkerType.ArrowClosed, width: 12, height: 12 } as const;
const SETA_FORTE = { ...SETA, color: "var(--xy-edge-stroke-selected)" } as const;
const ROTULO_ARESTA = {
  labelStyle: { fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  labelBgStyle: { stroke: "var(--borda-do-rotulo)", strokeWidth: 1 },
  labelBgPadding: [6, 3] as [number, number],
  labelBgBorderRadius: 999,
};

// O tema do React Flow pelas variáveis dele, com a variante `dark` do projeto:
// o `colorMode` do pacote só segue o sistema, não o botão de sol e lua da
// barra (classe no <html>). O CSS do pacote fica fora das camadas do Tailwind
// e venceria qualquer utilitário; variável não, porque ele mesmo a lê. Por isso
// o hover e o destaque mudam a variável na ligação (o <g>), e o traço dentro
// dela herda.
const TEMA_DO_CANVAS = [
  "[--xy-background-color:transparent]",
  "[--xy-background-pattern-color:#d4d4d8] dark:[--xy-background-pattern-color:#3f3f46]",
  "[--xy-edge-stroke:#a1a1aa] dark:[--xy-edge-stroke:#52525b]",
  "[--xy-edge-stroke-width:1.6]",
  "[--xy-edge-stroke-selected:#18181b] dark:[--xy-edge-stroke-selected:#f4f4f5]",
  "[&_.react-flow__edge:hover]:[--xy-edge-stroke:#52525b] dark:[&_.react-flow__edge:hover]:[--xy-edge-stroke:#a1a1aa]",
  "[&_.react-flow__edge.selected]:[--xy-edge-stroke-width:2.4] [&_.react-flow__edge.em-destaque]:[--xy-edge-stroke-width:2]",
  "[&_.react-flow__edge.em-destaque]:[--xy-edge-stroke:var(--xy-edge-stroke-selected)]",
  "[--xy-connectionline-stroke:#71717a] dark:[--xy-connectionline-stroke:#a1a1aa] [--xy-connectionline-stroke-width:1.6]",
  "[--xy-edge-label-background-color:#ffffff] dark:[--xy-edge-label-background-color:#09090b]",
  "[--xy-edge-label-color:#3f3f46] dark:[--xy-edge-label-color:#e4e4e7]",
  "[--borda-do-rotulo:#e4e4e7] dark:[--borda-do-rotulo:#3f3f46]",
  "[--xy-controls-box-shadow:0_1px_2px_rgb(0_0_0/0.06)]",
  "[--xy-controls-button-background-color:#ffffff] dark:[--xy-controls-button-background-color:#18181b]",
  "[--xy-controls-button-background-color-hover:#f4f4f5] dark:[--xy-controls-button-background-color-hover:#27272a]",
  "[--xy-controls-button-color:#3f3f46] dark:[--xy-controls-button-color:#e4e4e7]",
  "[--xy-controls-button-color-hover:#18181b] dark:[--xy-controls-button-color-hover:#fafafa]",
  "[--xy-controls-button-border-color:#e4e4e7] dark:[--xy-controls-button-border-color:#27272a]",
].join(" ");

// O traço da linha que acompanha o arrasto: tracejada até soltar num bloco.
const LINHA_DO_ARRASTO = { strokeDasharray: "5 4" };

// Os botões soltos no canvas (pendências, Organizar): a mesma pílula.
const PILULA =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:focus-visible:ring-zinc-100/20";

const AVISO_LACO = "Essa ligação faria o fluxo voltar a um bloco anterior. Para repetir, monte em sequência: template, aguardar, esperar, template.";

const AJUSTE = { padding: 0.15, maxZoom: 1 };
// O zoom mínimo é o do fluxo largo inteiro à vista em 1024x768 (o canvas tem
// ~650px ali): com 0,3, o ajuste travava no mínimo e cortava as duas pontas.
const ZOOM_MINIMO = 0.2;

type Medida = { width: number; height: number };

const alturasDe = (medidas: Record<string, Medida>) => Object.fromEntries(Object.entries(medidas).map(([id, m]) => [id, m.height]));

// ── A vista ─────────────────────────────────────────────────────────────────

/** Abaixo disto o texto dos cartões não se lê (conferido nos prints em 1024x768). */
const ZOOM_LEGIVEL = 0.7;
const MARGEM_ESQUERDA = 40;
/** Abaixo da fileira de pílulas (pendências, Organizar). */
const MARGEM_DE_CIMA = 56;
/** A folga embaixo e dos lados quando o fluxo inteiro cabe. */
const MARGEM = 24;

type Caixa = { x: number; y: number; w: number; h: number };

/**
 * A vista ao abrir, depois do Organizar e do desenho da IA (pedido de
 * 2026-10-28: com o fluxo inteiro em 1024x768 o zoom caía a ~0,3 e os cartões
 * viravam traços). Se tudo cabe com zoom legível, mostra tudo (centrado, mesmo
 * que só sem a folga do ajuste); senão fica no
 * zoom legível, com o início perto da esquerda e o caminho principal — do
 * início pela primeira saída ligada de cada bloco, até onde a vista alcança —
 * no meio da altura. A pessoa lê o começo e anda arrastando; o botão de
 * ajustar dos controles continua mostrando o fluxo inteiro.
 *
 * Calculada pelas posições do fluxo e pelas medidas, não pelo estado do React
 * Flow, que só alcança a posição nova um quadro depois de organizar.
 */
function vistaLegivel(f: FluxoCampanha, caixas: Map<string, Caixa>, largura: number, altura: number): Viewport | null {
  const todas = [...caixas.values()];
  if (!todas.length || !largura || !altura) return null;
  const x0 = Math.min(...todas.map((c) => c.x));
  const y0 = Math.min(...todas.map((c) => c.y));
  const limites = { x: x0, y: y0, width: Math.max(...todas.map((c) => c.x + c.w)) - x0, height: Math.max(...todas.map((c) => c.y + c.h)) - y0 };
  const tudo = getViewportForBounds(limites, largura, altura, ZOOM_MINIMO, AJUSTE.maxZoom, AJUSTE.padding);
  const inicio = caixas.get(NO_INICIO);
  if (tudo.zoom >= ZOOM_LEGIVEL || !inicio) return tudo;

  const z = ZOOM_LEGIVEL;
  const util = altura - MARGEM_DE_CIMA - MARGEM;
  // Cabe a 0,7 só sem a folga do ajuste: centrado, no zoom legível.
  if (limites.width * z <= largura - 2 * MARGEM && limites.height * z <= util)
    return {
      x: (largura - limites.width * z) / 2 - limites.x * z,
      y: MARGEM_DE_CIMA + (util - limites.height * z) / 2 - limites.y * z,
      zoom: z,
    };
  const alcance = inicio.x + (largura - MARGEM_ESQUERDA) / z;
  const caminho = [inicio];
  const vistos = new Set<string>();
  let id: string | null = f.inicio;
  while (id && Object.hasOwn(f.blocos, id) && !vistos.has(id)) {
    vistos.add(id);
    const c = caixas.get(id);
    if (!c || c.x > alcance) break;
    caminho.push(c);
    id = saidasDe(f.blocos[id]).find((s) => s.destino)?.destino ?? null;
  }
  const topo = Math.min(...caminho.map((c) => c.y));
  const fundo = Math.max(...caminho.map((c) => c.y + c.h));
  // Caminho mais alto que a vista: o alto dele no topo, em vez de cortar os dois lados.
  const y = (fundo - topo) * z <= util ? MARGEM_DE_CIMA + util / 2 - ((topo + fundo) / 2) * z : MARGEM_DE_CIMA - topo * z;
  return { x: MARGEM_ESQUERDA - inicio.x * z, y, zoom: z };
}

// Bloco sem posição (um rascunho escrito sem desenho): em grade, abaixo do resto.
const posicaoDeReserva = (i: number): Posicao => ({ x: 300 + (i % 4) * 320, y: 320 + Math.floor(i / 4) * 220 });

/** Desce o lugar do bloco novo até não cair em cima de outro cartão. */
function lugarLivre(f: FluxoCampanha, p: Posicao): Posicao {
  const ocupados = Object.values(f.posicoes);
  let y = p.y;
  // 180: o "Aguardar resposta" com várias saídas é mais alto que os outros cartões.
  for (let i = 0; i < 12 && ocupados.some((o) => Math.abs(o.x - p.x) < 280 && Math.abs(o.y - y) < 180); i++) y += 180;
  return { x: Math.round(p.x), y: Math.round(y) };
}

/**
 * De onde um clique na paleta liga o bloco novo: do selecionado, se ele tem
 * uma saída livre sem dúvida de qual (o Aguardar tem várias, fica de fora); sem
 * seleção, do início ainda solto. Senão, o bloco entra sem ligação.
 */
function origemDoClique(f: FluxoCampanha, selecionado: string | null): string | null {
  if (!selecionado) return f.inicio ? null : NO_INICIO;
  if (selecionado === NO_INICIO) return f.inicio ? null : NO_INICIO;
  const b = f.blocos[selecionado];
  return b && b.tipo !== "aguardar_resposta" && !b.proximo ? selecionado : null;
}

export default function FluxoCampanha(props: Props) {
  // O provider deixa usar screenToFlowPosition e fitView fora do <ReactFlow>:
  // clique na paleta, item da lista de pendências.
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

/**
 * A pendência como o cartão mostra. A frase que só repete o resumo ("Escolha a
 * tag." sob "Escolha a tag") não vira faixa: o resumo fica âmbar no lugar.
 */
function pendenciaDoNo(texto: string | undefined, resumo: string | null): PendenciaDoNo | null {
  if (!texto) return null;
  return { texto, noResumo: !!resumo && texto.replace(/\.$/, "") === resumo };
}

function Canvas({ fluxo, mudar, templates, opcoes, problemas, metricas = null, inicio, semSelecao, faixa, reorganizarAoMedir, semPaleta = false }: Props) {
  const editavel = !!mudar;
  const { screenToFlowPosition, getViewport, setViewport, getInternalNode } = useReactFlow();
  const areaRef = useRef<HTMLDivElement>(null);
  const painelRef = useRef<HTMLElement>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [arestaSelecionada, setArestaSelecionada] = useState<string | null>(null);
  const [verPendencias, setVerPendencias] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [medidas, setMedidas] = useState<Record<string, Medida>>({});
  // O ajuste da vista espera TODOS os cartões medidos. O `fitView` do pacote
  // dispara na primeira medição e, com os nós controlados, saía em zoom 1
  // cortando as pontas do fluxo (conferido em 1024x768).
  const ajustou = useRef(false);

  // Selecionado que deixou de existir (bloco apagado) some sozinho, sem efeito.
  const atual = selecionado === NO_INICIO || (selecionado && fluxo.blocos[selecionado]) ? selecionado : null;

  // O fluxo num ref: a vista e o observador de tamanho não podem nascer de novo
  // a cada quadro de arrasto (o fluxo muda a cada quadro).
  const fluxoRef = useRef(fluxo);
  useEffect(() => {
    fluxoRef.current = fluxo;
  });

  const aplicarVista = useCallback(
    (posicoes: Record<string, Posicao>, tamanhos: Record<string, Medida>, duracao: number) => {
      const area = areaRef.current?.getBoundingClientRect();
      if (!area) return;
      const caixas = new Map<string, Caixa>();
      for (const [id, p] of Object.entries(posicoes)) {
        const t = tamanhos[id];
        if (t) caixas.set(id, { x: p.x, y: p.y, w: t.width, h: t.height });
      }
      const vp = vistaLegivel(fluxoRef.current, caixas, area.width, area.height);
      if (vp) void setViewport(vp, { duration: duracao });
    },
    [setViewport],
  );

  // A vista sai com a largura do momento, e a lista de campanhas ainda pode
  // estar recolhendo (transição de largura ao entrar no editor): por 1 s, ela
  // acompanha o tamanho novo do canvas. Conferido em 1920px, onde sem isto o
  // fluxo que cabia inteiro saía encostado à esquerda. Quem move a vista à mão
  // (arrastar o canvas, `mostrar` um bloco) encerra a janela.
  const vistaRecente = useRef<{ posicoes: Record<string, Posicao>; tamanhos: Record<string, Medida>; ate: number } | null>(null);
  const ajustarVista = useCallback(
    (posicoes: Record<string, Posicao>, tamanhos: Record<string, Medida>, duracao = 0) => {
      vistaRecente.current = { posicoes, tamanhos, ate: performance.now() + 1000 };
      aplicarVista(posicoes, tamanhos, duracao);
    },
    [aplicarVista],
  );
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const observador = new ResizeObserver(() => {
      const v = vistaRecente.current;
      if (v && performance.now() < v.ate) aplicarVista(v.posicoes, v.tamanhos, 0);
    });
    observador.observe(el);
    return () => observador.disconnect();
    // aplicarVista só depende de setViewport, que não muda: o observador nasce uma vez.
  }, [aplicarVista]);

  // O bloco escolhido fica à vista: num construtor estreito o painel abre por
  // cima da direita do canvas e cobriria justamente o bloco que se acabou de
  // clicar; o item da lista de pendências pode estar fora da tela. Desliza o
  // canvas o mínimo, sem mudar o zoom.
  const mostrar = useCallback(
    (id: string) => {
      vistaRecente.current = null;
      requestAnimationFrame(() => {
        const area = areaRef.current?.getBoundingClientRect();
        const no = getInternalNode(id);
        if (!area || !no) return;
        const vp = getViewport();
        // O painel cobre o canvas quando é sobreposto (construtor estreito, ver painel-lateral.tsx).
        const painel = painelRef.current;
        const cobre = painel && getComputedStyle(painel).position === "absolute" ? painel.offsetWidth : 0;
        const desloca = (inicio: number, tamanho: number, fim: number) => {
          if (inicio + tamanho > fim) return Math.max(fim - (inicio + tamanho), 24 - inicio);
          return inicio < 24 ? 24 - inicio : 0;
        };
        const dx = desloca(
          no.internals.positionAbsolute.x * vp.zoom + vp.x,
          (no.measured.width ?? 256) * vp.zoom,
          area.width - cobre - 24,
        );
        const dy = desloca(no.internals.positionAbsolute.y * vp.zoom + vp.y, (no.measured.height ?? 80) * vp.zoom, area.height - 24);
        if (dx || dy) void setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy }, { duration: 200 });
      });
    },
    [getInternalNode, getViewport, setViewport],
  );

  // Toda mudança passa por aqui: depois dela, os botões de cada "Aguardar
  // resposta" voltam a acompanhar o template de antes.
  const aplicar = useCallback(
    (atualizar: (f: FluxoCampanha) => FluxoCampanha) => mudar?.((f) => sincronizarBotoes(atualizar(f), templates)),
    [mudar, templates],
  );

  // Problema sem bloco ("ligue o início…") aparece no início.
  const problemaDe = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of problemas) {
      const chave = p.blocoId && fluxo.blocos[p.blocoId] ? p.blocoId : NO_INICIO;
      if (!m.has(chave)) m.set(chave, p.mensagem);
    }
    return m;
  }, [problemas, fluxo.blocos]);

  // Os dados de cada cartão mudam só quando o bloco muda — arrastar mexe na
  // posição, não aqui, e os cartões (memo) não redesenham a cada quadro.
  const dadosDosBlocos = useMemo(() => {
    const m = new Map<string, DadosDoBloco>();
    for (const [id, b] of Object.entries(fluxo.blocos)) {
      const t = b.tipo === "enviar_template" ? acharTemplate(templates, b.template_nome, b.template_idioma) : null;
      const texto = b.tipo === "enviar_texto" ? revisaoDoTexto(b.texto) : "";
      // O texto livre é só o balão; o template, o nome em cima e o balão embaixo.
      const resumo = texto ? null : resumoDoBloco(b, opcoes);
      m.set(id, {
        tipo: b.tipo,
        resumo,
        mensagem:
          b.tipo === "enviar_template" && t
            ? balaoDoTemplate(t, b.variaveis)
            : texto
              ? { midia: null, cabecalho: null, corpo: texto, rodape: null, botoes: [] }
              : null,
        saidas: saidasDe(b).map((s) => ({
          id: s.id,
          rotulo: s.rotulo,
          ligada: !!s.destino,
          fim: metricas && !s.destino ? (metricas.porSaida[`${id}|${s.id}`] ?? 0) : null,
        })),
        problema: pendenciaDoNo(problemaDe.get(id), resumo),
        metrica: metricas ? (metricas.porBloco[id] ?? { agora: 0, passaram: 0 }) : null,
      });
    }
    return m;
  }, [fluxo.blocos, templates, opcoes, metricas, problemaDe]);

  const dadosDoInicio = useMemo<DadosDoInicio>(
    () => ({
      resumo: inicio.resumo,
      detalhe: inicio.detalhe,
      ligado: !!fluxo.inicio,
      problema: pendenciaDoNo(problemaDe.get(NO_INICIO), inicio.resumo),
    }),
    [inicio.resumo, inicio.detalhe, fluxo.inicio, problemaDe],
  );

  const nos = useMemo<Array<NoDoBloco | NoDoInicio>>(
    () => [
      {
        id: NO_INICIO,
        type: NO_INICIO,
        position: fluxo.posicoes[NO_INICIO] ?? { x: 0, y: 0 },
        data: dadosDoInicio,
        deletable: false,
        selected: atual === NO_INICIO,
        measured: medidas[NO_INICIO],
      },
      ...Object.keys(fluxo.blocos).map((id, i) => ({
        id,
        type: "bloco" as const,
        position: fluxo.posicoes[id] ?? posicaoDeReserva(i),
        data: dadosDosBlocos.get(id)!,
        deletable: editavel,
        selected: atual === id,
        measured: medidas[id],
      })),
    ],
    [fluxo.posicoes, fluxo.blocos, dadosDoInicio, dadosDosBlocos, atual, medidas, editavel],
  );

  const arestas = useMemo<Edge[]>(() => {
    const lista: Edge[] = [];
    const contagem = (chave: string) => (metricas ? (metricas.porSaida[chave] ?? 0).toLocaleString("pt-BR") : undefined);
    const ligar = (origem: string, saida: string, destino: string, rotulo: string | undefined) => {
      const selecionada = arestaSelecionada === `${origem}|${saida}`;
      // As ligações do bloco selecionado se destacam: dá para seguir de onde ele vem e para onde vai.
      const doSelecionado = !!atual && (origem === atual || destino === atual);
      lista.push({
        id: `${origem}|${saida}`,
        type: "default", // bezier
        source: origem,
        sourceHandle: saida,
        target: destino,
        selected: selecionada,
        deletable: editavel,
        label: rotulo,
        className: doSelecionado ? "em-destaque" : undefined,
        markerEnd: selecionada || doSelecionado ? SETA_FORTE : SETA,
        ...ROTULO_ARESTA,
      });
    };
    if (fluxo.inicio && fluxo.blocos[fluxo.inicio]) ligar(NO_INICIO, "proximo", fluxo.inicio, undefined);
    for (const [id, b] of Object.entries(fluxo.blocos))
      for (const s of saidasDe(b)) if (s.destino && fluxo.blocos[s.destino]) ligar(id, s.id, s.destino, contagem(`${id}|${s.id}`));
    return lista;
  }, [fluxo.inicio, fluxo.blocos, metricas, arestaSelecionada, editavel, atual]);

  const aoMudarNos = useCallback(
    (mudancas: NodeChange<NoDoBloco | NoDoInicio>[]) => {
      const novasMedidas: Record<string, Medida> = {};
      const posicoes: Record<string, Posicao> = {};
      const apagados: string[] = [];
      for (const m of mudancas) {
        if (m.type === "dimensions" && m.dimensions) novasMedidas[m.id] = m.dimensions;
        else if (m.type === "position" && m.position) posicoes[m.id] = { x: Math.round(m.position.x), y: Math.round(m.position.y) };
        else if (m.type === "remove" && m.id !== NO_INICIO) apagados.push(m.id);
        else if (m.type === "select") {
          if (m.selected) {
            setSelecionado(m.id);
            setArestaSelecionada(null);
            setVerPendencias(false);
            setAviso(null);
          } else setSelecionado((s) => (s === m.id ? null : s));
        }
      }
      if (Object.keys(novasMedidas).length) {
        setMedidas((a) => ({ ...a, ...novasMedidas }));
        if (!ajustou.current && nos.every((n) => novasMedidas[n.id] || medidas[n.id])) {
          ajustou.current = true;
          const tamanhos = { ...medidas, ...novasMedidas };
          let lugares = Object.fromEntries(nos.map((n) => [n.id, n.position]));
          if (reorganizarAoMedir) {
            lugares = organizarFluxo(fluxo, alturasDe(tamanhos)).posicoes;
            reorganizarAoMedir((f) => ({ ...f, posicoes: lugares }));
          }
          ajustarVista(lugares, tamanhos);
        }
      }
      if (!editavel || (!Object.keys(posicoes).length && !apagados.length)) return;
      aplicar((f) => {
        let novo = Object.keys(posicoes).length ? { ...f, posicoes: { ...f.posicoes, ...posicoes } } : f;
        for (const id of apagados) novo = apagarBloco(novo, id);
        return novo;
      });
    },
    [aplicar, editavel, nos, medidas, fluxo, reorganizarAoMedir, ajustarVista],
  );

  const aoMudarArestas = useCallback(
    (mudancas: EdgeChange[]) => {
      const soltas: Edge[] = [];
      for (const m of mudancas) {
        if (m.type === "select") {
          if (m.selected) setArestaSelecionada(m.id);
          else setArestaSelecionada((a) => (a === m.id ? null : a));
        } else if (m.type === "remove") {
          const a = arestas.find((x) => x.id === m.id);
          if (a) soltas.push(a);
        }
      }
      if (editavel && soltas.length)
        aplicar((f) => soltas.reduce((acc, a) => ligarSaida(acc, a.source, a.sourceHandle ?? "proximo", null), f));
    },
    [arestas, aplicar, editavel],
  );

  const aoLigar = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      if (fechaLaco(fluxo, c.source, c.target)) {
        setAviso(AVISO_LACO);
        return;
      }
      setAviso(null);
      aplicar((f) => ligarSaida(f, c.source, c.sourceHandle ?? "proximo", c.target));
    },
    [fluxo, aplicar],
  );

  const ligarPeloPainel = (origem: string, saidaId: string, destino: string | null) => {
    if (destino && fechaLaco(fluxo, origem, destino)) {
      setAviso(AVISO_LACO);
      return;
    }
    aplicar((f) => ligarSaida(f, origem, saidaId, destino));
  };

  const depoisDe = editavel ? origemDoClique(fluxo, atual) : null;
  const nomeDoDepois = !depoisDe ? null : depoisDe === NO_INICIO ? "Início" : CATALOGO_CAMPANHA[fluxo.blocos[depoisDe].tipo].rotulo;

  function adicionar(tipo: TipoBloco, solto?: Posicao) {
    if (!editavel) return;
    const id = idNovo(fluxo);
    const ligarDe = solto ? null : depoisDe;
    let posicao = solto;
    if (!posicao && ligarDe) {
      const p = fluxo.posicoes[ligarDe] ?? { x: 0, y: 0 };
      posicao = { x: p.x + COLUNA, y: p.y };
    }
    if (!posicao) {
      // Sem onde encaixar: no meio do que está à vista, não numa coordenada
      // fixa que pode estar fora da tela depois de dar zoom ou arrastar.
      const r = areaRef.current?.getBoundingClientRect();
      posicao = r ? screenToFlowPosition({ x: r.x + r.width / 2 - 128, y: r.y + r.height / 2 - 40 }) : { x: 0, y: 0 };
    }
    const onde = solto ? { x: Math.round(solto.x), y: Math.round(solto.y) } : lugarLivre(fluxo, posicao);
    aplicar((f) => {
      const comBloco = { ...f, blocos: { ...f.blocos, [id]: blocoNovo(tipo, opcoes) }, posicoes: { ...f.posicoes, [id]: onde } };
      return ligarDe ? ligarSaida(comBloco, ligarDe, "proximo", id) : comBloco;
    });
    setSelecionado(id);
    setVerPendencias(false);
    setAviso(null);
    mostrar(id);
  }

  function aoSoltar(e: React.DragEvent) {
    const tipo = e.dataTransfer.getData(MIME_BLOCO_CAMPANHA);
    if (!Object.hasOwn(CATALOGO_CAMPANHA, tipo)) return; // arrastaram outra coisa para cá
    e.preventDefault();
    // Desconta metade do cartão: o bloco nasce sob o cursor.
    adicionar(tipo as TipoBloco, screenToFlowPosition({ x: e.clientX - 128, y: e.clientY - 24 }));
  }

  function irPara(blocoId: string | null) {
    const id = blocoId && fluxo.blocos[blocoId] ? blocoId : NO_INICIO;
    setSelecionado(id);
    setVerPendencias(false);
    mostrar(id);
  }

  function fechar() {
    setSelecionado(null);
    setVerPendencias(false);
    setAviso(null);
  }

  // Com a altura medida de cada cartão (a estimada só para o que ainda não
  // foi medido); depois, a vista vai para o desenho novo (vistaLegivel).
  function organizar() {
    const alturas = alturasDe(medidas);
    aplicar((f) => organizarFluxo(f, alturas));
    setAviso(null);
    ajustarVista(organizarFluxo(fluxo, alturas).posicoes, medidas, 250);
  }

  const aberto = atual !== null || verPendencias;

  return (
    // @container: o painel da direita vira coluna pela largura do construtor,
    // não da janela (ver painel-lateral.tsx).
    <div className="@container relative flex min-h-0 min-w-0 flex-1">
      {editavel && !semPaleta && <Paleta aoAdicionar={(tipo) => adicionar(tipo)} depoisDe={nomeDoDepois} />}

      <div
        ref={areaRef}
        className="relative min-w-0 flex-1 bg-zinc-50/70 dark:bg-zinc-900/30"
        onDrop={aoSoltar}
        onDragOver={(e) => {
          if (!editavel) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
      >
        <ReactFlow<NoDoBloco | NoDoInicio, Edge>
          nodes={nos}
          edges={arestas}
          nodeTypes={TIPOS_DE_NO}
          onNodesChange={aoMudarNos}
          onEdgesChange={aoMudarArestas}
          onConnect={aoLigar}
          isValidConnection={(c) => c.source !== c.target}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={LINHA_DO_ARRASTO}
          // Soltar perto da entrada já liga: a alça é pequena e o tablet não tem mira fina.
          connectionRadius={32}
          defaultMarkerColor={null}
          // No clique e não na seleção: arrastar também seleciona, e deslizar o
          // canvas no meio do arrasto tiraria o chão de quem arrasta.
          onNodeClick={(_, no) => mostrar(no.id)}
          onPaneClick={fechar}
          // Mover a vista à mão (o evento só existe quando é a pessoa) encerra o acompanhar do tamanho.
          onMoveStart={(e) => {
            if (e) vistaRecente.current = null;
          }}
          nodesDraggable={editavel}
          nodesConnectable={editavel}
          edgesFocusable={editavel}
          deleteKeyCode={editavel ? ["Backspace", "Delete"] : null}
          minZoom={ZOOM_MINIMO}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          className={TEMA_DO_CANVAS}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          {/* O "ajustar" dos controles mostra sempre o fluxo inteiro, mesmo pequeno. */}
          <Controls
            showInteractive={false}
            position="bottom-left"
            fitViewOptions={AJUSTE}
            className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
          />
          {editavel && (
            <Panel position="top-left" className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelecionado(null);
                  setVerPendencias(true);
                }}
                className={`${PILULA} ${
                  problemas.length
                    ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                    : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                }`}
              >
                {problemas.length ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
                {problemas.length ? `${problemas.length} ${problemas.length === 1 ? "pendência" : "pendências"}` : "Sem pendências"}
              </button>
              {Object.keys(fluxo.blocos).length > 0 && (
                <button
                  type="button"
                  onClick={organizar}
                  title="Arruma os blocos da esquerda para a direita, na ordem do fluxo"
                  className={`${PILULA} border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:hover:text-zinc-50`}
                >
                  <ListTree className="size-3.5 -rotate-90" aria-hidden="true" />
                  Organizar
                </button>
              )}
              {faixa}
            </Panel>
          )}
          {aviso && (
            // Abaixo da fileira de pílulas: em 1024px elas e o aviso não cabem lado a lado.
            <Panel position="top-center" className="!top-12">
              <p role="alert" className="flex max-w-md items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 py-2 pl-3 pr-1.5 text-[12px] leading-snug text-amber-800 shadow-sm dark:border-amber-500/40 dark:bg-zinc-950 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{aviso}</span>
                <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/10">
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </p>
            </Panel>
          )}
          {editavel && !Object.keys(fluxo.blocos).length && (
            <Panel position="top-center" className="!top-14">
              <p className="pointer-events-none max-w-xs text-center text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                {semPaleta
                  ? "Diga na conversa ao lado o template e o que fazer com cada resposta: a IA desenha aqui."
                  : "Clique num bloco da coluna à esquerda: ele entra já ligado ao início. Ou peça o fluxo em “Montar com IA”."}
              </p>
            </Panel>
          )}
        </ReactFlow>
      </div>

      <PainelLateral
        ref={painelRef}
        aberto={aberto}
        atual={atual}
        fluxo={fluxo}
        editavel={editavel}
        templates={templates}
        opcoes={opcoes}
        problemas={problemas}
        metricas={metricas}
        painelDoInicio={inicio.painel}
        semSelecao={semSelecao}
        fechar={fechar}
        irPara={irPara}
        apagar={(id) => aplicar((f) => apagarBloco(f, id))}
        mudarBloco={(id, b) => aplicar((f) => (f.blocos[id] ? { ...f, blocos: { ...f.blocos, [id]: b } } : f))}
        ligar={ligarPeloPainel}
      />
    </div>
  );
}
