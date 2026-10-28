// Do fluxo para o que o React Flow desenha: os nós (o início e um cartão por
// bloco, com resumo, balão, saídas, pendência e números) e as ligações. O
// fluxo é a fonte única (ver o cabeçalho de ../fluxo-campanha.tsx): tudo aqui
// é derivado a cada render, memorizado pelo que cada parte lê. Saiu de lá em
// 2026-10-28, na divisão por assunto.
import { useMemo } from "react";
import type { Edge } from "@xyflow/react";
import { NO_INICIO, saidasDe, type FluxoCampanha, type ProblemaDoFluxo } from "@/lib/campanhas-fluxo";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { acharTemplate, balaoDoArquivo, balaoDoTemplate, resumoDoBloco, revisaoDoTexto, type MetricasFluxo, type OpcoesFluxo } from "./grafo";
import type { DadosDoBloco, DadosDoInicio, NoDoBloco, NoDoInicio, PendenciaDoNo } from "./no-campanha";
import { ROTULO_ARESTA, SETA, SETA_FORTE } from "./tema-canvas";
import { posicaoDeReserva, type Medida } from "./vista";

/**
 * A pendência como o cartão mostra (o ponto âmbar, com a frase no title).
 * Quando a frase só repete o resumo ("Escolha a tag." sob "Escolha a tag"), o
 * resumo também fica âmbar.
 */
function pendenciaDoNo(texto: string | undefined, resumo: string | null): PendenciaDoNo | null {
  if (!texto) return null;
  return { texto, noResumo: !!resumo && texto.replace(/\.$/, "") === resumo };
}

export function useNosEArestas({
  fluxo,
  templates,
  opcoes,
  problemas,
  metricas,
  inicio,
  atual,
  arestaSelecionada,
  medidas,
  editavel,
}: {
  fluxo: FluxoCampanha;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  problemas: ProblemaDoFluxo[];
  metricas: MetricasFluxo | null;
  inicio: { resumo: string; detalhe: string };
  /** O nó selecionado (bloco ou NO_INICIO), ou null. */
  atual: string | null;
  arestaSelecionada: string | null;
  medidas: Record<string, Medida>;
  editavel: boolean;
}) {
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
            ? balaoDoTemplate(t, b.variaveis, opcoes)
            : b.tipo === "enviar_arquivo"
              ? balaoDoArquivo(b, opcoes)
              : texto
                ? { midia: null, anexo: null, arquivo: null, cabecalho: null, corpo: texto, rodape: null, botoes: [] }
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

  return { nos, arestas };
}
