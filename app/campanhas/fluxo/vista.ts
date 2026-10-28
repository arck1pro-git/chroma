// Onde fica cada coisa no canvas da campanha: a vista ao abrir (vistaLegivel),
// o lugar do bloco novo (lugarLivre, posicaoDeReserva) e de onde o clique na
// paleta liga o bloco novo (origemDoClique). Puro, sem React: o canvas
// (../fluxo-campanha.tsx) mede e chama. Saiu de lá em 2026-10-28, na divisão
// por assunto.
import { getViewportForBounds, type Viewport } from "@xyflow/react";
import { NO_INICIO, saidasDe, type FluxoCampanha, type Posicao } from "@/lib/campanhas-fluxo";

export type Medida = { width: number; height: number };

export const alturasDe = (medidas: Record<string, Medida>) => Object.fromEntries(Object.entries(medidas).map(([id, m]) => [id, m.height]));

export const AJUSTE = { padding: 0.15, maxZoom: 1 };
// O zoom mínimo é o do fluxo largo inteiro à vista em 1024x768 (o canvas tinha
// ~650px ali, antes do modo foco): com 0,3, o ajuste travava no mínimo e
// cortava as duas pontas.
export const ZOOM_MINIMO = 0.2;

// ── A vista ─────────────────────────────────────────────────────────────────

/**
 * Abaixo disto o texto dos cartões não se lê. Era 0,7 (prints em 1024x768) e o
 * texto saía com ~8px (pedido dele, 2026-10-28: "ilegível"); com o cartão
 * novo (título de 14px, resumo de 12px) e o construtor na largura toda, 0,8
 * deixa o resumo perto de 10px.
 */
const ZOOM_LEGIVEL = 0.8;
const MARGEM_ESQUERDA = 40;
/** Abaixo da fileira de pílulas (pendências, Organizar). */
const MARGEM_DE_CIMA = 56;
/** A folga embaixo e dos lados quando o fluxo inteiro cabe. */
const MARGEM = 24;

export type Caixa = { x: number; y: number; w: number; h: number };

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
export function vistaLegivel(f: FluxoCampanha, caixas: Map<string, Caixa>, largura: number, altura: number): Viewport | null {
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
  // Cabe no zoom legível só sem a folga do ajuste: centrado, nele.
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

// ── O lugar do bloco novo ───────────────────────────────────────────────────

// Bloco sem posição (um rascunho escrito sem desenho): em grade, abaixo do resto.
export const posicaoDeReserva = (i: number): Posicao => ({ x: 300 + (i % 4) * 320, y: 320 + Math.floor(i / 4) * 220 });

/** Desce o lugar do bloco novo até não cair em cima de outro cartão. */
export function lugarLivre(f: FluxoCampanha, p: Posicao): Posicao {
  const ocupados = Object.values(f.posicoes);
  let y = p.y;
  // 180: o "Aguardar resposta" com várias saídas é mais alto que os outros cartões.
  for (let i = 0; i < 12 && ocupados.some((o) => Math.abs(o.x - p.x) < 280 && Math.abs(o.y - y) < 180); i++) y += 180;
  return { x: Math.round(p.x), y: Math.round(y) };
}

/**
 * De onde um clique na paleta liga o bloco novo: do selecionado, se ele tem
 * uma saída livre sem dúvida de qual (o Aguardar e a Condição têm várias,
 * ficam de fora); sem seleção, do início ainda solto. Senão, o bloco entra sem
 * ligação.
 */
export function origemDoClique(f: FluxoCampanha, selecionado: string | null): string | null {
  if (!selecionado) return f.inicio ? null : NO_INICIO;
  if (selecionado === NO_INICIO) return f.inicio ? null : NO_INICIO;
  const b = f.blocos[selecionado];
  const saidas = b ? saidasDe(b) : [];
  return saidas.length === 1 && saidas[0].id === "proximo" && !saidas[0].destino ? selecionado : null;
}
