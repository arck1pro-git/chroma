"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Check, CloudUpload, MousePointerClick, Save, TriangleAlert } from "lucide-react";
import { blocoPorTipo } from "@/lib/automacoes/catalogo";
import { NO_ENTRADA, type DefinicaoFluxo } from "@/lib/automacoes/tipos";
import {
  paraCanvas as definicaoParaCanvas,
  paraDefinicao as canvasParaDefinicao,
} from "@/lib/automacoes/canvas";
import ChatIa from "../components/chat-ia";
import { publicar, salvarRascunho } from "./acoes";
import NoBloco, { type NoDeBloco } from "./no-bloco";
import Paleta, { MIME_BLOCO } from "./paleta";

// Fora do componente: recriar este objeto a cada render faz o React Flow
// remontar todos os nós e reclamar no console.
const tiposDeNo: NodeTypes = { bloco: NoBloco };

const arestaPadrao = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
} as const;

// Adaptadores finos entre as formas puras de lib/automacoes/canvas e os tipos
// do React Flow. A lógica de conversão vive lá, testável; aqui só a costura.
function paraDefinicao(nos: NoDeBloco[], arestas: Edge[]): DefinicaoFluxo {
  return canvasParaDefinicao(
    nos.map((n) => ({
      id: n.id,
      tipo: n.data.tipo,
      config: n.data.config,
      posicao: n.position,
    })),
    arestas.map((a) => ({
      origem: a.source,
      destino: a.target,
      saida: a.sourceHandle,
    })),
  );
}

function paraCanvas(d: DefinicaoFluxo): { nos: NoDeBloco[]; arestas: Edge[] } {
  const puro = definicaoParaCanvas(d);
  return {
    nos: puro.nos.map((n) => ({
      id: n.id,
      type: "bloco" as const,
      position: n.posicao,
      data: { tipo: n.tipo, config: n.config },
      deletable: !n.fixo,
    })),
    arestas: puro.arestas.map((a) => ({
      id: a.id,
      source: a.origem,
      target: a.destino,
      sourceHandle: a.saida,
      ...arestaPadrao,
    })),
  };
}

function novoId() {
  return `n_${crypto.randomUUID().slice(0, 8)}`;
}

// Ligar A→B fecha ciclo se B já alcança A. Percorre as arestas existentes a
// partir do alvo; se chegar na origem, a conexão é recusada.
function criaCiclo(origem: string, alvo: string, arestas: Edge[]) {
  const visitados = new Set<string>();
  const fila = [alvo];

  while (fila.length) {
    const atual = fila.pop()!;
    if (atual === origem) return true;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    for (const a of arestas) if (a.source === atual) fila.push(a.target);
  }
  return false;
}

function Canvas({
  fluxoId,
  definicaoInicial,
  conversaInicial = null,
}: {
  fluxoId: string;
  definicaoInicial: DefinicaoFluxo;
  conversaInicial?: string | null;
}) {
  const inicial = paraCanvas(definicaoInicial);
  const [nos, setNos, aoMudarNos] = useNodesState<NoDeBloco>(inicial.nos);
  const [arestas, setArestas, aoMudarArestas] = useEdgesState<Edge>(inicial.arestas);
  const { screenToFlowPosition } = useReactFlow();
  const areaRef = useRef<HTMLDivElement>(null);

  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(
    null,
  );
  const [noComErro, setNoComErro] = useState<string | null>(null);

  // A IA grava direto no banco, não no estado desta tela: quando ela avisa que
  // gravou, o router.refresh() traz a definição nova e este efeito a joga no
  // canvas — sem F5 e sem duplicar aqui a leitura do rascunho.
  //
  // O porteiro é o ref, e não a mudança de `definicaoInicial` sozinha. Salvar e
  // Publicar chamam revalidatePath, que também entrega uma prop nova: sem o
  // porteiro, um Salvar seguido de arrastar um bloco veria o arrasto sumir
  // quando a revalidação chegasse. Trocar o canvas por baixo do usuário só é
  // aceitável quando foi ele quem acabou de pedir, por uma frase no chat.
  const esperandoIa = useRef(false);

  useEffect(() => {
    if (!esperandoIa.current) return;
    esperandoIa.current = false;
    const { nos: n, arestas: a } = paraCanvas(definicaoInicial);
    setNos(n);
    setArestas(a);
  }, [definicaoInicial, setNos, setArestas]);

  function salvar() {
    setAviso(null);
    iniciar(async () => {
      const n = await salvarRascunho(fluxoId, paraDefinicao(nos, arestas));
      setAviso({ tipo: "ok", texto: `Rascunho salvo - versao ${n}` });
    });
  }

  function publicarAgora() {
    setAviso(null);
    setNoComErro(null);
    iniciar(async () => {
      // Salva antes: publicar o que esta na tela, nao a ultima versao gravada.
      await salvarRascunho(fluxoId, paraDefinicao(nos, arestas));
      const r = await publicar(fluxoId);
      if (r.ok) {
        setAviso({ tipo: "ok", texto: r.mensagem });
      } else {
        setAviso({ tipo: "erro", texto: r.erro });
        if (r.noId) setNoComErro(r.noId);
      }
    });
  }

  const adicionar = useCallback(
    (tipo: string, posicao: { x: number; y: number }) => {
      if (!blocoPorTipo(tipo)) return;
      setNos((atuais) => [
        ...atuais,
        {
          id: novoId(),
          type: "bloco",
          position: posicao,
          data: { tipo, config: {} },
        },
      ]);
    },
    [setNos],
  );

  // Clique na paleta: cai no centro do que está visível, não numa coordenada
  // fixa que pode estar fora da tela depois de dar zoom ou arrastar o canvas.
  const adicionarNoCentro = useCallback(
    (tipo: string) => {
      const area = areaRef.current?.getBoundingClientRect();
      if (!area) return;
      adicionar(
        tipo,
        screenToFlowPosition({
          x: area.x + area.width / 2,
          y: area.y + area.height / 2,
        }),
      );
    },
    [adicionar, screenToFlowPosition],
  );

  const aoSoltar = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const tipo = e.dataTransfer.getData(MIME_BLOCO);
      if (!tipo) return; // arrastaram outra coisa pra cá
      adicionar(
        tipo,
        // desconta metade do cartão: o bloco nasce sob o cursor, não com o
        // canto superior esquerdo nele
        screenToFlowPosition({ x: e.clientX - 112, y: e.clientY - 24 }),
      );
    },
    [adicionar, screenToFlowPosition],
  );

  const validarConexao = useCallback<IsValidConnection<Edge>>(
    (c) => {
      if (!c.source || !c.target) return false;
      if (c.source === c.target) return false;
      if (criaCiclo(c.source, c.target, arestas)) return false;
      return true;
    },
    [arestas],
  );

  const aoConectar = useCallback(
    (c: Connection) =>
      setArestas((atuais) => addEdge({ ...c, ...arestaPadrao }, atuais)),
    [setArestas],
  );

  // Erro de compilacao aponta um no: selecionar esse no e o jeito mais direto
  // de mostrar QUAL bloco impediu a publicacao.
  const nosExibidos = noComErro
    ? nos.map((n) => (n.id === noComErro ? { ...n, selected: true } : n))
    : nos;

  // Uma frase do que está montado. Não vai config nem texto de mensagem — o
  // modelo pede isso com ler_fluxo quando precisar, e mandar em toda pergunta
  // pagaria o fluxo inteiro de novo a cada troca.
  const resumoDoFluxo =
    nos.length <= 1
      ? "fluxo vazio, só com o nó de entrada"
      : `${nos.length - 1} blocos (${[
          ...new Set(
            nos
              .filter((n) => n.data.tipo !== NO_ENTRADA)
              .map((n) => n.data.tipo),
          ),
        ].join(", ")}) e ${arestas.length} ligações`;

  const selecionado = nos.find((n) => n.selected);
  const blocoSelecionado = selecionado && blocoPorTipo(selecionado.data.tipo);
  const soTemInicio = nos.length === 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        {aviso && (
          <p
            className={`surge flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium ${
              aviso.tipo === "ok"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-700 dark:text-rose-400"
            }`}
          >
            {aviso.tipo === "ok" ? (
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{aviso.texto}</span>
          </p>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Save className="size-3.5" aria-hidden="true" />
            Salvar
          </button>
          <button
            type="button"
            onClick={publicarAgora}
            disabled={salvando}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <CloudUpload className="size-3.5" aria-hidden="true" />
            {salvando ? "Publicando..." : "Publicar"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <Paleta aoAdicionar={adicionarNoCentro} />

        <div
          ref={areaRef}
          className="relative min-w-0 flex-1"
          onDrop={aoSoltar}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
        >
          <ReactFlow
            nodes={nosExibidos}
            edges={arestas}
            onNodesChange={aoMudarNos}
            onEdgesChange={aoMudarArestas}
            onConnect={aoConectar}
            isValidConnection={validarConexao}
            nodeTypes={tiposDeNo}
            defaultEdgeOptions={arestaPadrao}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode="system"
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            className="bg-conteudo"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
            {/* !bottom-20: abre espaço para o botão flutuante da IA, que fica
              em bottom-5 no mesmo canto */}
          <MiniMap pannable zoomable className="!bottom-20 !right-4" />

            {soTemInicio && (
              <Panel position="top-center" className="!top-4">
                <p className="surge pointer-events-none max-w-xs text-center text-xs text-zinc-400 dark:text-zinc-500">
                  Arraste as ações da coluna à esquerda e ligue-as ao bloco de
                  entrada.
                </p>
              </Panel>
            )}

          </ReactFlow>
        </div>

        {/* Inspetor: por enquanto só lê o contrato do catálogo. O painel de
            configuração de cada bloco entra na Fase 3 do documento. */}
        <aside className="hidden w-64 shrink-0 flex-col border-l border-zinc-200 bg-white p-4 xl:flex dark:border-zinc-800 dark:bg-zinc-950">
          {blocoSelecionado ? (
            <div className="surge">
              <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                {blocoSelecionado.rotulo}
              </h2>
              <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                {blocoSelecionado.descricao}
              </p>

              <dl className="mt-4 flex flex-col gap-2 border-t border-zinc-200 pt-3 text-[11px] dark:border-zinc-800">
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400 dark:text-zinc-500">Identificador</dt>
                  <dd className="truncate font-mono text-zinc-600 dark:text-zinc-300">
                    {blocoSelecionado.tipo}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400 dark:text-zinc-500">Durabilidade</dt>
                  <dd className="text-zinc-600 dark:text-zinc-300">
                    {blocoSelecionado.contrato.durabilidade === "imediata"
                      ? "Imediata"
                      : "Sobrevive a reinício"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400 dark:text-zinc-500">Efeito externo</dt>
                  <dd className="text-zinc-600 dark:text-zinc-300">
                    {blocoSelecionado.contrato.efeitoColateral ? "Sim" : "Não"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400 dark:text-zinc-500">Saídas</dt>
                  <dd className="text-zinc-600 dark:text-zinc-300">
                    {blocoSelecionado.saidas.length === 0
                      ? "nenhuma"
                      : blocoSelecionado.saidas
                          .map((s) => s.rotulo || "seguir")
                          .join(", ")}
                  </dd>
                </div>
              </dl>

              {Object.keys(selecionado.data.config ?? {}).length > 0 && (
                <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    Configuração
                  </p>
                  {/* Só leitura, e cru de propósito: o painel de edição por
                      bloco é da Fase 3. Até lá quem escreve config é a IA, e
                      esconder o que ela gravou seria pedir confiança cega. */}
                  <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-2 font-mono text-[10px] leading-snug text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {JSON.stringify(selecionado.data.config, null, 2)}
                  </pre>
                </div>
              )}

              {blocoSelecionado.indisponivel && (
                <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  {blocoSelecionado.indisponivel}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <MousePointerClick
                className="size-5 text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Selecione um bloco para ver o que ele garante.
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* A IA do editor. Escreve RASCUNHO deste fluxo e nada além disso —
          publicar continua sendo o botão lá em cima, porque é ele que fala com
          o n8n compartilhado com produção. Ver lib/ia/automacoes.ts. */}
      <ChatIa
        endpoint="/api/ia/automacoes"
        // Com o id do fluxo: sem ele, a conversa não sabe a qual editor
        // pertence e a sidebar não consegue reabri-la no lugar certo
        // (lib/ia/navegacao.ts).
        escopo={`automacoes:${fluxoId}`}
        conversaInicial={conversaInicial}
        extra={{ fluxo_id: fluxoId }}
        titulo="Montar com IA"
        rotulo="Montar este fluxo com IA"
        dica="Descreva a automação em português. A IA monta o rascunho aqui no canvas; publicar continua sendo você."
        sugestoes={[
          "Cadência de 18 mensagens, uma por dia, parando quem responder",
          "Boas-vindas no WhatsApp e, se não responder em 2 dias, um e-mail",
          "O que este fluxo faz hoje?",
        ]}
        campo="Descreva a automação…"
        contexto={`editor do fluxo "${fluxoId}": ${resumoDoFluxo}`}
        aoAplicar={() => {
          setAviso({ tipo: "ok", texto: "A IA gravou um rascunho novo." });
          esperandoIa.current = true;
          router.refresh();
        }}
      />
    </div>
  );
}

export default function Builder({
  fluxoId,
  definicaoInicial,
  conversaInicial = null,
}: {
  fluxoId: string;
  definicaoInicial: DefinicaoFluxo;
  conversaInicial?: string | null;
}) {
  // O provider é obrigatório para screenToFlowPosition funcionar fora do
  // <ReactFlow>, que é o caso do clique na paleta.
  return (
    <ReactFlowProvider>
      <Canvas
        fluxoId={fluxoId}
        definicaoInicial={definicaoInicial}
        conversaInicial={conversaInicial}
      />
    </ReactFlowProvider>
  );
}
