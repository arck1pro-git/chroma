// Leitura das Automações para as telas. Só importado por page.tsx (server).
// Substituiu o demo.ts: as mesmas formas, agora vindas do banco.

import { blocoPorTipo } from "@/lib/automacoes/catalogo";
import {
  buscarFluxo,
  definicaoDoFluxo,
  execucoesPorDia,
  execucoesRecentes,
  leadsNoFluxo,
  listarFluxos,
  passosPorBloco,
  segmentosParaDisparo,
} from "@/lib/automacoes/repositorio";
import { NO_ENTRADA, type DefinicaoFluxo } from "@/lib/automacoes/tipos";

export type { Fluxo, EstadoFluxo } from "@/lib/automacoes/repositorio";
export type { SegmentoParaDisparo } from "@/lib/automacoes/repositorio";
export { segmentosParaDisparo };

export type ExecucaoNoDia = { dia: string; sucesso: number; erro: number };

export type PassoAgregado = {
  no_id: string;
  no_tipo: string;
  rotulo: string;
  passaram: number;
  erros: number;
};

export type LeadNoFluxo = {
  execucao_id: string;
  contato_nome: string;
  no_tipo: string;
  rotulo_no: string;
  parado_desde: string;
  retomar_em: string | null;
};

export type LeadNoBloco = {
  contato_nome: string;
  quando: string;
  estado: "sucesso" | "erro" | "esperando";
};

export type ExecucaoLog = {
  id: string;
  contato_nome: string;
  estado: "sucesso" | "erro" | "esperando";
  iniciado_em: string;
  duracao_ms: number | null;
  erro_no: string | null;
  erro_msg: string | null;
};

export type ArestaDoFluxo = { de: string; para: string; ramo?: string };

export type DetalheFluxo = {
  porDia: ExecucaoNoDia[];
  porBloco: PassoAgregado[];
  layout: Record<string, { x: number; y: number }>;
  arestas: ArestaDoFluxo[];
  leadsPorBloco: Record<string, { total: number; amostra: LeadNoBloco[] }>;
  leads: LeadNoFluxo[];
  execucoes: ExecucaoLog[];
  definicao: DefinicaoFluxo;
};

export { listarFluxos, buscarFluxo };

// Rótulo do bloco: do catálogo, com o id do nó como reserva para tipo que saiu
// do catálogo depois que o fluxo foi publicado.
function rotuloDoNo(tipo: string, noId: string) {
  if (noId === NO_ENTRADA) return "Entrada do fluxo";
  return blocoPorTipo(tipo)?.rotulo ?? tipo;
}

export async function detalheDoFluxo(id: string): Promise<DetalheFluxo> {
  const [definicao, porDia, agregados, execucoes, leads] = await Promise.all([
    definicaoDoFluxo(id),
    execucoesPorDia(id),
    passosPorBloco(id),
    execucoesRecentes(id),
    leadsNoFluxo(id),
  ]);

  const contagem = new Map(agregados.map((a) => [a.no_id, a]));

  // O canvas de métricas desenha a DEFINIÇÃO, não só o que já executou: bloco
  // que nunca rodou precisa aparecer com zero, senão o desenho fica com buraco
  // e ninguém entende onde o funil parou.
  const porBloco: PassoAgregado[] = [
    {
      no_id: NO_ENTRADA,
      no_tipo: NO_ENTRADA,
      rotulo: "Entrada do fluxo",
      passaram: contagem.get(NO_ENTRADA)?.passaram ?? 0,
      erros: 0,
    },
    ...Object.entries(definicao.nos).map(([noId, no]) => ({
      no_id: noId,
      no_tipo: no.tipo,
      rotulo: rotuloDoNo(no.tipo, noId),
      passaram: contagem.get(noId)?.passaram ?? 0,
      erros: contagem.get(noId)?.erros ?? 0,
    })),
  ];

  return {
    porDia,
    porBloco,
    layout: definicao.layout,
    arestas: definicao.arestas.map((a) => ({
      de: a.de,
      para: a.para,
      ramo: a.ramo,
    })),
    // Amostra por bloco só faz sentido quando houver execução gravada; a
    // consulta entra junto com a ingestão de passos (callback do motor).
    leadsPorBloco: {},
    leads: leads.map((l) => ({
      execucao_id: l.execucao_id,
      contato_nome: l.entidade_nome,
      no_tipo: definicao.nos[l.no_id]?.tipo ?? "esperar",
      rotulo_no: rotuloDoNo(definicao.nos[l.no_id]?.tipo ?? "", l.no_id),
      parado_desde: l.parado_desde,
      retomar_em: l.retomar_em,
    })),
    execucoes: execucoes.map((e) => ({
      id: e.id,
      contato_nome: e.entidade_nome,
      estado:
        e.estado === "sucesso" || e.estado === "erro" ? e.estado : "esperando",
      iniciado_em: e.iniciado_em,
      duracao_ms: e.duracao_ms,
      erro_no: e.erro_no,
      erro_msg: e.erro_msg,
    })),
    definicao,
  };
}
