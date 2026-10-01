"use client";

// O fluxo de uma campanha de WhatsApp desenhado como diagrama: o envio do
// template à esquerda e dois ramos — quem respondeu e quem não respondeu no
// prazo — com as ações de cada um em sequência.
//
// `editavel` liga os campos dentro dos blocos e a paleta de "Adicionar bloco";
// sem ele é só leitura (a campanha já ativada).
import { type ReactNode } from "react";
import { Background, BackgroundVariant, Controls, MarkerType, Panel, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch, MessageSquareText, Plus, Tag, Trash2, UserRoundPlus } from "lucide-react";

type Acao =
  | { tipo: "registrar_lead" }
  | { tipo: "adicionar_tag"; tagId: string }
  | { tipo: "adicionar_segmento"; segmentoId: string }
  | { tipo: "criar_oportunidade"; funilId: string; etapaId: string; nome: string };
type Opcao = { id: string; nome: string };
type EtapaOpcao = Opcao & { funil_id: string };
type Ramo = "respondeu" | "expirou";
type Props = {
  template: string;
  idioma?: string;
  espera: number;
  aoResponder: Acao[];
  aoExpirar: Acao[];
  editavel?: boolean;
  templates?: Array<{ name: string; language: string; status: string }>;
  tags?: Opcao[];
  segmentos?: Opcao[];
  funis?: Opcao[];
  etapas?: EtapaOpcao[];
  mudarTemplate?: (nome: string, idioma: string) => void;
  mudarEspera?: (minutos: number) => void;
  mudarResponder?: (acoes: Acao[]) => void;
  mudarExpirar?: (acoes: Acao[]) => void;
};

// nodrag/nopan: sem eles, clicar num campo dentro do bloco arrasta o diagrama.
const campo =
  "nodrag nopan w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200";
const rotuloCampo = "block text-[10px] font-medium text-zinc-500 dark:text-zinc-400";
const aresta = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } } as const;

const IDIOMA: Record<string, string> = { pt_BR: "Português (BR)", en_US: "Inglês (EUA)", es: "Espanhol" };

const ESPERAS = [
  { minutos: 60, rotulo: "1 hora" },
  { minutos: 360, rotulo: "6 horas" },
  { minutos: 1440, rotulo: "1 dia" },
  { minutos: 4320, rotulo: "3 dias" },
  { minutos: 10080, rotulo: "7 dias" },
  { minutos: 43200, rotulo: "30 dias" },
];

function duracao(minutos: number) {
  if (minutos % 1440 === 0) return `${minutos / 1440} dia${minutos === 1440 ? "" : "s"}`;
  if (minutos % 60 === 0) return `${minutos / 60} hora${minutos === 60 ? "" : "s"}`;
  return `${minutos} minutos`;
}

const TITULO: Record<Acao["tipo"], string> = {
  registrar_lead: "Registrar conversão",
  adicionar_tag: "Adicionar tag",
  adicionar_segmento: "Adicionar ao segmento",
  criar_oportunidade: "Criar oportunidade",
};

const PALETA = [
  { tipo: "registrar_lead", nome: "Conversão" },
  { tipo: "adicionar_tag", nome: "Tag" },
  { tipo: "adicionar_segmento", nome: "Segmento" },
  { tipo: "criar_oportunidade", nome: "Oportunidade" },
] as const;

function Cartao({
  icone,
  titulo,
  subtitulo,
  cor = "zinc",
  children,
}: {
  icone: ReactNode;
  titulo: string;
  subtitulo?: string;
  cor?: "zinc" | "emerald" | "amber" | "blue";
  children?: ReactNode;
}) {
  const cores = {
    zinc: "border-zinc-200 dark:border-zinc-700",
    emerald: "border-emerald-300 dark:border-emerald-800",
    amber: "border-amber-300 dark:border-amber-800",
    blue: "border-blue-300 dark:border-blue-800",
  };
  return (
    <div className={`w-[230px] rounded-xl border bg-white p-3 text-left shadow-sm dark:bg-zinc-900 ${cores[cor]}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-zinc-500">{icone}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</p>
          {subtitulo && <p className="mt-0.5 truncate text-[10px] text-zinc-500">{subtitulo}</p>}
        </div>
      </div>
      {children && <div className="mt-2 space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">{children}</div>}
    </div>
  );
}

export default function FluxoCampanha({
  template,
  idioma = "pt_BR",
  espera,
  aoResponder,
  aoExpirar,
  editavel = false,
  templates = [],
  tags = [],
  segmentos = [],
  funis = [],
  etapas = [],
  mudarTemplate,
  mudarEspera,
  mudarResponder,
  mudarExpirar,
}: Props) {
  const mudar = (ramo: Ramo) => (ramo === "respondeu" ? mudarResponder : mudarExpirar);
  const lista = (ramo: Ramo) => (ramo === "respondeu" ? aoResponder : aoExpirar);
  const atualizar = (ramo: Ramo, indice: number, acao: Acao) => mudar(ramo)?.(lista(ramo).map((item, i) => (i === indice ? acao : item)));
  const remover = (ramo: Ramo, indice: number) => mudar(ramo)?.(lista(ramo).filter((_, i) => i !== indice));

  function adicionar(ramo: Ramo, tipo: Acao["tipo"]) {
    let nova: Acao | null = tipo === "registrar_lead" ? { tipo } : null;
    if (tipo === "adicionar_tag" && tags[0]) nova = { tipo, tagId: tags[0].id };
    if (tipo === "adicionar_segmento" && segmentos[0]) nova = { tipo, segmentoId: segmentos[0].id };
    if (tipo === "criar_oportunidade" && funis[0]) {
      const etapa = etapas.find((item) => item.funil_id === funis[0].id);
      if (etapa) nova = { tipo, funilId: funis[0].id, etapaId: etapa.id, nome: "Oportunidade · {{nome}}" };
    }
    if (nova) mudar(ramo)?.([...lista(ramo), nova]);
  }

  // Sem tag, segmento ou funil cadastrado, o bloco correspondente não tem o que
  // escolher — o botão sai desligado e diz por quê.
  const indisponivel = (tipo: Acao["tipo"]) =>
    tipo === "adicionar_tag" && !tags.length
      ? "Nenhuma tag cadastrada"
      : tipo === "adicionar_segmento" && !segmentos.length
        ? "Nenhum segmento cadastrado"
        : tipo === "criar_oportunidade" && !funis.length
          ? "Nenhum funil cadastrado"
          : null;

  function editor(acao: Acao, ramo: Ramo, indice: number) {
    if (!editavel) return null;
    return (
      <>
        {acao.tipo === "adicionar_tag" && (
          <label className={rotuloCampo}>
            Tag
            <select className={`${campo} mt-1`} value={acao.tagId} onChange={(e) => atualizar(ramo, indice, { ...acao, tagId: e.target.value })}>
              {tags.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        {acao.tipo === "adicionar_segmento" && (
          <label className={rotuloCampo}>
            Segmento
            <select
              className={`${campo} mt-1`}
              value={acao.segmentoId}
              onChange={(e) => atualizar(ramo, indice, { ...acao, segmentoId: e.target.value })}
            >
              {segmentos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        {acao.tipo === "criar_oportunidade" && (
          <>
            <label className={rotuloCampo}>
              Funil
              <select
                className={`${campo} mt-1`}
                value={acao.funilId}
                onChange={(e) => {
                  const etapa = etapas.find((x) => x.funil_id === e.target.value);
                  if (etapa) atualizar(ramo, indice, { ...acao, funilId: e.target.value, etapaId: etapa.id });
                }}
              >
                {funis.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className={rotuloCampo}>
              Etapa
              <select className={`${campo} mt-1`} value={acao.etapaId} onChange={(e) => atualizar(ramo, indice, { ...acao, etapaId: e.target.value })}>
                {etapas
                  .filter((x) => x.funil_id === acao.funilId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
              </select>
            </label>
            <label className={rotuloCampo}>
              Nome da oportunidade
              <input className={`${campo} mt-1`} value={acao.nome} onChange={(e) => atualizar(ramo, indice, { ...acao, nome: e.target.value })} />
              <span className="mt-0.5 block font-normal text-zinc-400">{"{{nome}}"} vira o nome do contato</span>
            </label>
          </>
        )}
        <button
          type="button"
          onClick={() => remover(ramo, indice)}
          className="nodrag nopan flex items-center gap-1 rounded text-[10px] font-medium text-red-500 hover:text-red-600"
        >
          <Trash2 className="size-3" aria-hidden="true" />
          Remover bloco
        </button>
      </>
    );
  }

  const { nodes, edges } = (() => {
    const envioEditor = editavel ? (
      <>
        <label className={rotuloCampo}>
          Template aprovado
          <select
            className={`${campo} mt-1`}
            value={`${template}::${idioma}`}
            onChange={(e) => {
              const [nome, ...resto] = e.target.value.split("::");
              mudarTemplate?.(nome, resto.join("::"));
            }}
          >
            <option value="::">Selecione…</option>
            {templates
              .filter((t) => t.status === "APPROVED")
              .map((t) => (
                <option key={`${t.name}-${t.language}`} value={`${t.name}::${t.language}`}>
                  {t.name} · {IDIOMA[t.language] ?? t.language}
                </option>
              ))}
          </select>
        </label>
        <label className={rotuloCampo}>
          Esperar resposta por
          <select className={`${campo} mt-1`} value={espera} onChange={(e) => mudarEspera?.(Number(e.target.value))}>
            {ESPERAS.map((o) => (
              <option key={o.minutos} value={o.minutos}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </label>
      </>
    ) : null;

    const estiloNo = { padding: 0, border: "none", background: "transparent", width: 230 };
    const nodes: Node[] = [
      {
        id: "envio",
        position: { x: 40, y: 235 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: estiloNo,
        data: {
          label: (
            <Cartao
              cor="blue"
              icone={<MessageSquareText className="size-4" />}
              titulo="Enviar template"
              subtitulo={!editavel ? `${template || "Sem template"} · espera ${duracao(espera)}` : undefined}
            >
              {envioEditor}
            </Cartao>
          ),
        },
        draggable: false,
      },
    ];
    const edges: Edge[] = [];
    const ramos: Array<{ chave: Ramo; acoes: Acao[]; y: number; titulo: string; cor: "emerald" | "amber" }> = [
      { chave: "respondeu", acoes: aoResponder, y: 90, titulo: "Respondeu", cor: "emerald" },
      { chave: "expirou", acoes: aoExpirar, y: 390, titulo: `Sem resposta em ${duracao(espera)}`, cor: "amber" },
    ];

    for (const ramo of ramos) {
      let anterior = "envio";
      (ramo.acoes.length ? ramo.acoes : [null]).forEach((acao, indice) => {
        const id = `${ramo.chave}-${indice}`;
        const titulo = acao ? TITULO[acao.tipo] : "Encerrar fluxo";
        const subtitulo = !acao
          ? "Nenhuma ação adicional"
          : acao.tipo === "adicionar_tag"
            ? tags.find((x) => x.id === acao.tagId)?.nome
            : acao.tipo === "adicionar_segmento"
              ? segmentos.find((x) => x.id === acao.segmentoId)?.nome
              : acao.tipo === "criar_oportunidade"
                ? acao.nome
                : "Conta como resultado da campanha";
        const icone =
          acao?.tipo === "adicionar_tag" ? (
            <Tag className="size-4" />
          ) : acao?.tipo === "criar_oportunidade" ? (
            <UserRoundPlus className="size-4" />
          ) : (
            <GitBranch className="size-4" />
          );
        nodes.push({
          id,
          position: { x: 360 + indice * 290, y: ramo.y },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          style: estiloNo,
          data: {
            label: (
              <Cartao cor={ramo.cor} icone={icone} titulo={titulo} subtitulo={subtitulo}>
                {acao ? editor(acao, ramo.chave, indice) : null}
              </Cartao>
            ),
          },
          draggable: false,
        });
        edges.push({
          id: `${anterior}-${id}`,
          source: anterior,
          target: id,
          label: anterior === "envio" ? ramo.titulo : undefined,
          labelStyle: { fontSize: 10, fill: ramo.cor === "emerald" ? "#059669" : "#d97706" },
          ...aresta,
        });
        anterior = id;
      });
    }
    return { nodes, edges };
  })();

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Fluxo da campanha</p>
        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {editavel
            ? "Adicione blocos em cada ramo pela paleta, ou descreva a campanha para a IA no botão do canto."
            : "O que acontece depois do envio, para quem respondeu e para quem não respondeu."}
        </p>
      </div>
      <div className="h-[610px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.55}
          maxZoom={1.2}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} />
          {editavel && (
            <Panel position="top-left">
              <div className="nodrag nopan w-52 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <p className="px-0.5 pb-2 text-[11px] font-semibold text-zinc-900 dark:text-zinc-50">Adicionar bloco</p>
                {(
                  [
                    { ramo: "respondeu", titulo: "Quando responder" },
                    { ramo: "expirou", titulo: "Sem resposta" },
                  ] as const
                ).map((grupo) => (
                  <div key={grupo.ramo} className="mb-2.5 last:mb-0">
                    <p className="px-0.5 pb-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{grupo.titulo}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {PALETA.map((acao) => {
                        const motivo = indisponivel(acao.tipo);
                        return (
                          <button
                            type="button"
                            key={acao.tipo}
                            disabled={Boolean(motivo)}
                            title={motivo ?? `Adicionar “${TITULO[acao.tipo]}” em “${grupo.titulo}”`}
                            onClick={() => adicionar(grupo.ramo, acao.tipo)}
                            className="flex items-center gap-1 rounded-md border border-zinc-200 px-1.5 py-1.5 text-left text-[11px] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            <Plus className="size-3 shrink-0" aria-hidden="true" />
                            {acao.nome}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </section>
  );
}
