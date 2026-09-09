// Conversão canvas ⇄ definição. Puro e sem React Flow de propósito: é lógica
// de dados, e fora do componente dá para testar o ida-e-volta.
//
// CONTRATO com os componentes de nó: toda saída tem um id, e o id da saída
// única é "padrao". Se um <Handle type="source"> for renderizado sem `id`, a
// aresta remontada aqui não acha o conector e o React Flow a descarta em
// silêncio — foi exatamente esse o bug da ligação da entrada.

import { NO_ENTRADA, type DefinicaoFluxo } from "./tipos";

export const SAIDA_PADRAO = "padrao";

export type NoCanvas = {
  id: string;
  tipo: string;
  // Configuração do bloco (texto da mensagem, prazo da espera, condição...).
  // Ela FAZ a volta inteira canvas ⇄ definição: enquanto o inspetor não edita
  // config, quem a escreve é a IA (lib/ia/automacoes.ts), e um `config: {}`
  // fixo aqui apagaria esse trabalho no primeiro "Salvar" do builder.
  config: Record<string, unknown>;
  posicao: { x: number; y: number };
  fixo: boolean;
};

export type ArestaCanvas = {
  id: string;
  origem: string;
  destino: string;
  saida: string;
};

export function paraDefinicao(
  nos: {
    id: string;
    tipo: string;
    config?: Record<string, unknown>;
    posicao: { x: number; y: number };
  }[],
  arestas: { origem: string; destino: string; saida: string | null | undefined }[],
): DefinicaoFluxo {
  const mapaNos: DefinicaoFluxo["nos"] = {};
  const layout: DefinicaoFluxo["layout"] = {};

  for (const n of nos) {
    layout[n.id] = { x: Math.round(n.posicao.x), y: Math.round(n.posicao.y) };
    // A entrada é a raiz do grafo, não um bloco: entra no layout, não em `nos`.
    if (n.id === NO_ENTRADA) continue;
    mapaNos[n.id] = { tipo: n.tipo, config: n.config ?? {} };
  }

  return {
    schema: "chroma.flow/v1",
    nos: mapaNos,
    arestas: arestas.map((a) => ({
      de: a.origem,
      para: a.destino,
      // `ramo` só é gravado quando não é a saída única — o JSON fica limpo e o
      // diff entre versões não enche de "ramo": "padrao".
      ...(a.saida && a.saida !== SAIDA_PADRAO ? { ramo: a.saida } : {}),
    })),
    layout,
  };
}

export function paraCanvas(d: DefinicaoFluxo): {
  nos: NoCanvas[];
  arestas: ArestaCanvas[];
} {
  const nos: NoCanvas[] = [
    {
      id: NO_ENTRADA,
      tipo: NO_ENTRADA,
      config: {},
      posicao: d.layout[NO_ENTRADA] ?? { x: 0, y: 0 },
      fixo: true,
    },
    ...Object.entries(d.nos).map(([id, no]) => ({
      id,
      tipo: no.tipo,
      config: no.config ?? {},
      posicao: d.layout[id] ?? { x: 0, y: 0 },
      fixo: false,
    })),
  ];

  const arestas: ArestaCanvas[] = d.arestas.map((a) => {
    const saida = a.ramo ?? SAIDA_PADRAO;
    return {
      id: `${a.de}-${saida}-${a.para}`,
      origem: a.de,
      destino: a.para,
      saida,
    };
  });

  return { nos, arestas };
}
