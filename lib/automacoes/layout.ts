import { NO_ENTRADA, type DefinicaoFluxo, type Posicao } from "./tipos";

// Posições calculadas para um fluxo que NÃO passou pelo builder.
//
// O §3.5 do documento recusa layout automático como caminho — as posições vêm
// de onde o usuário arrastou — e abre a exceção exata deste arquivo: "Layout
// calculado é para o caso em que o fluxo foi criado por API sem passar pelo
// builder — um fallback, não o caminho". Hoje quem cai nessa exceção é a IA
// (lib/ia/automacoes.ts).
//
// De cima para baixo, e não da esquerda para a direita: uma cadência de 18
// mensagens é uma corrente de ~54 blocos, e na horizontal isso vira um canvas
// de 15 mil pixels que ninguém lê. Profundidade vira linha; irmãos se abrem
// lado a lado, centrados no zero.

const PASSO_Y = 130;
const PASSO_X = 280;

export function dispor(definicao: DefinicaoFluxo): Record<string, Posicao> {
  const saindoDe = new Map<string, string[]>();
  for (const a of definicao.arestas) {
    saindoDe.set(a.de, [...(saindoDe.get(a.de) ?? []), a.para]);
  }

  // Largura em nível: cada nó fica na PRIMEIRA profundidade em que é
  // alcançado — daí a fila ser FIFO. Dois ramos que voltam a se encontrar não
  // empurram o nó comum para baixo duas vezes.
  const profundidade = new Map<string, number>([[NO_ENTRADA, 0]]);
  const fila = [NO_ENTRADA];
  while (fila.length) {
    const atual = fila.shift()!;
    const nivel = profundidade.get(atual)!;
    for (const proximo of saindoDe.get(atual) ?? []) {
      if (profundidade.has(proximo)) continue;
      profundidade.set(proximo, nivel + 1);
      fila.push(proximo);
    }
  }

  // Nó solto não chega aqui pela IA — o compilador o recusa antes. Ainda assim
  // empilha embaixo, um por linha, em vez de largar todos em (0,0) sobrepostos.
  const alcancados = new Map(profundidade);
  let sobra = 0;
  const maior = Math.max(0, ...alcancados.values());
  for (const id of Object.keys(definicao.nos)) {
    if (!profundidade.has(id)) profundidade.set(id, maior + 1 + sobra++);
  }

  const porNivel = new Map<number, string[]>();
  for (const [id, nivel] of profundidade) {
    porNivel.set(nivel, [...(porNivel.get(nivel) ?? []), id]);
  }

  const layout: Record<string, Posicao> = {};
  for (const [nivel, ids] of porNivel) {
    ids.forEach((id, i) => {
      layout[id] = {
        x: Math.round((i - (ids.length - 1) / 2) * PASSO_X),
        y: nivel * PASSO_Y,
      };
    });
  }
  return layout;
}
