"use client";

// O CONSTRUTOR das campanhas de WhatsApp oficial, em blocos (pedido dele,
// 2026-10-27: "o envio aguarda resposta e faz algo depois"). Paleta à
// esquerda e o canvas; o painel do bloco selecionado FLUTUA sobre a direita
// do canvas, sem encolhê-lo (2026-10-28, "o canvas fica espremido"). O mesmo
// canvas, sem `mudar`, mostra a campanha no ar com quantos estão em cada bloco
// e quantos tomaram cada saída.
//
// ESC: fecha o painel; sem painel aberto, chama `aoSair` (o editor sai, com a
// confirmação de mudança não salva). Não age com o foco num campo de texto ou
// lista (lá o Esc é do campo) nem dentro de [data-esc-proprio] (o chat da IA,
// que fecha a si mesmo), nem quando outra peça já tratou (defaultPrevented:
// o modal de ativar, a faixa de confirmação, o balão da dica).
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
// A VISTA (vistaLegivel, ./fluxo/vista.ts, 2026-10-28): ao abrir, depois do
// Organizar e do desenho da IA, o fluxo inteiro só se ele couber com os
// cartões legíveis; senão, o começo, legível, ancorado no início. O "ajustar"
// dos controles continua mostrando tudo.
//
// Aqui fica o estado do canvas, o que cada gesto faz e a composição. As peças
// moram em ./fluxo/ (divididas por assunto em 2026-10-28): vista.ts (a vista e
// o lugar do bloco novo), use-vista.ts (ajustar a vista, acompanhar o tamanho
// e deslizar até o bloco), use-nos-e-arestas.ts (do fluxo para os nós e as
// ligações), tema-canvas.ts (o visual do React Flow), barra-do-canvas.tsx (as
// pílulas e avisos no alto), grafo.ts (o que a tela faz com o fluxo: bloco
// novo, ligar, apagar, botões do Aguardar, pendências, revisão), no-campanha
// (os cartões), paleta, painel-lateral + painel-bloco + editor-template (a
// direita), editor-campanha e ver-campanha (a campanha nova ou editada, e a
// campanha no ar) e confirmar-ativacao (a revisão antes de ativar).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CATALOGO_CAMPANHA, NO_INICIO, type FluxoCampanha, type Posicao, type ProblemaDoFluxo, type TipoBloco } from "@/lib/campanhas-fluxo";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import BarraDoCanvas from "./fluxo/barra-do-canvas";
import {
  COLUNA,
  apagarBloco,
  blocoNovo,
  fechaLaco,
  idNovo,
  ligarSaida,
  organizarFluxo,
  sincronizarBotoes,
  type MetricasFluxo,
  type OpcoesFluxo,
} from "./fluxo/grafo";
import { TIPOS_DE_NO, type NoDoBloco, type NoDoInicio } from "./fluxo/no-campanha";
import PainelLateral from "./fluxo/painel-lateral";
import Paleta, { MIME_BLOCO_CAMPANHA } from "./fluxo/paleta";
import { LINHA_DO_ARRASTO, TEMA_DO_CANVAS } from "./fluxo/tema-canvas";
import { useNosEArestas } from "./fluxo/use-nos-e-arestas";
import { useVista } from "./fluxo/use-vista";
import { AJUSTE, ZOOM_MINIMO, alturasDe, lugarLivre, origemDoClique, type Medida } from "./fluxo/vista";

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
  /** O Esc sem painel aberto (ver o cabeçalho): o editor sai. Sem ele, o Esc só fecha o painel. */
  aoSair?: () => void;
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

const AVISO_LACO = "Não dá para voltar a um bloco anterior. Para repetir, monte em sequência.";

/** Onde o Esc é de quem tem o foco, não do canvas (ver o cabeçalho). */
const ESC_PROPRIO = "input, textarea, select, [contenteditable='true'], [data-esc-proprio]";

/** Meia largura e meia altura de um cartão (w-60): o bloco novo nasce centrado no ponto. */
const MEIO_DO_CARTAO = { x: 120, y: 28 };

export default function FluxoCampanha(props: Props) {
  // O provider deixa usar screenToFlowPosition e fitView fora do <ReactFlow>:
  // clique na paleta, item da lista de pendências.
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ fluxo, mudar, templates, opcoes, problemas, metricas = null, inicio, aoSair, faixa, reorganizarAoMedir, semPaleta = false }: Props) {
  const editavel = !!mudar;
  const { screenToFlowPosition } = useReactFlow();
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

  const { ajustarVista, mostrar, soltarVista } = useVista({ fluxo, areaRef, painelRef, larguraDoCartao: 2 * MEIO_DO_CARTAO.x });

  // Toda mudança passa por aqui: depois dela, os botões de cada "Aguardar
  // resposta" voltam a acompanhar o template de antes.
  const aplicar = useCallback(
    (atualizar: (f: FluxoCampanha) => FluxoCampanha) => mudar?.((f) => sincronizarBotoes(atualizar(f), templates)),
    [mudar, templates],
  );

  const { nos, arestas } = useNosEArestas({ fluxo, templates, opcoes, problemas, metricas, inicio, atual, arestaSelecionada, medidas, editavel });

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
      posicao = r ? screenToFlowPosition({ x: r.x + r.width / 2 - MEIO_DO_CARTAO.x, y: r.y + r.height / 2 - MEIO_DO_CARTAO.y }) : { x: 0, y: 0 };
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
    adicionar(tipo as TipoBloco, screenToFlowPosition({ x: e.clientX - MEIO_DO_CARTAO.x, y: e.clientY - MEIO_DO_CARTAO.y }));
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

  // O Esc (ver o cabeçalho). Pelo ref, o ouvinte nasce uma vez, e não a cada
  // quadro de arrasto. Os ouvintes do React (o modal, a faixa de confirmação)
  // rodam antes, no mesmo document, e marcam defaultPrevented.
  const esc = useRef({ aberto, fechar, aoSair });
  useEffect(() => {
    esc.current = { aberto, fechar, aoSair };
  });
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(ESC_PROPRIO)) return;
      const { aberto, fechar, aoSair } = esc.current;
      if (aberto) {
        e.preventDefault();
        fechar();
      } else if (aoSair) {
        e.preventDefault();
        aoSair();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, []);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
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
            if (e) soltarVista();
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
          <BarraDoCanvas
            editavel={editavel}
            pendencias={problemas.length}
            temBlocos={Object.keys(fluxo.blocos).length > 0}
            semPaleta={semPaleta}
            faixa={faixa}
            aviso={aviso}
            verPendencias={() => {
              setSelecionado(null);
              setVerPendencias(true);
            }}
            organizar={organizar}
            fecharAviso={() => setAviso(null)}
          />
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
        fechar={fechar}
        irPara={irPara}
        apagar={(id) => aplicar((f) => apagarBloco(f, id))}
        mudarBloco={(id, b) => aplicar((f) => (f.blocos[id] ? { ...f, blocos: { ...f.blocos, [id]: b } } : f))}
        ligar={ligarPeloPainel}
      />
    </div>
  );
}
