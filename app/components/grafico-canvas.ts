// O chart.js do app num lugar só (2026-10-06, no lugar do recharts): os pedaços
// registrados — o pacote inteiro carrega controlador de pizza, radar e afins que
// ninguém usa —, o ciclo de vida do <canvas> num hook e o que o SVG fazia de
// graça e o canvas não: ler var(--…) do CSS, o degradê embaixo da linha e a
// linha vertical do dia sob o mouse.
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type ChartType,
  type Plugin,
  type ScriptableContext,
} from "chart.js";

declare module "chart.js" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a assinatura tem de bater com a do chart.js
  interface PluginOptionsByType<TType extends ChartType> {
    /** A linha vertical do dia sob o mouse; sem cor, não desenha. */
    cursor?: { cor?: string };
  }
}

// Antes das linhas, para os pontos ativos ficarem por cima dela.
const cursor: Plugin<"line", { cor?: string }> = {
  id: "cursor",
  beforeDatasetsDraw(chart, _args, opcoes) {
    const ativo = chart.getActiveElements()[0];
    if (!ativo || !opcoes.cor) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = opcoes.cor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ativo.element.x, chartArea.top);
    ctx.lineTo(ativo.element.x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, cursor);

export type Desenho = Pick<ChartConfiguration<"line">, "data" | "options">;

// O canvas não resolve var(--…): a cor sai do CSS computado do próprio
// <canvas>, que está dentro do .viz e já segue o tema.
export function corDoCss(el: Element, cor: string) {
  const v = /^var\((--[\w-]+)\)$/.exec(cor.trim());
  return v ? getComputedStyle(el).getPropertyValue(v[1]).trim() : cor;
}

// Cor com transparência para o degradê. O canvas normaliza qualquer cor opaca
// para #rrggbb, e daí sai o rgba — vale para o hex do .viz e para nome de cor.
let normalizador: CanvasRenderingContext2D | null = null;
function comAlfa(cor: string, alfa: number) {
  normalizador ??= document.createElement("canvas").getContext("2d");
  if (!normalizador) return cor;
  normalizador.fillStyle = cor;
  const hex = String(normalizador.fillStyle);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

// A sombra embaixo da linha: forte no pico DA SÉRIE e sumindo até a base, como
// o degradê do SVG (que media a própria área). Medida pela área do gráfico, uma
// série baixa — erro colado no chão — ficaria só com um fiapo apagado.
export function degrade(cor: string, alfa: number) {
  return ({ chart, dataset }: ScriptableContext<"line">) => {
    const area = chart.chartArea;
    const escala = chart.scales[dataset.yAxisID ?? "y"];
    if (!area || !escala) return "transparent"; // primeiro passe, antes do layout
    const pico = Math.max(0, ...(dataset.data as number[]));
    const topo = Math.min(escala.getPixelForValue(pico), area.bottom - 1);
    const g = chart.ctx.createLinearGradient(0, topo, 0, area.bottom);
    g.addColorStop(0, comAlfa(cor, alfa));
    g.addColorStop(1, comAlfa(cor, 0));
    return g;
  };
}

const ESCURO = "(prefers-color-scheme: dark)";

function assinarTema(avisar: () => void) {
  const m = matchMedia(ESCURO);
  m.addEventListener("change", avisar);
  return () => m.removeEventListener("change", avisar);
}

// O <canvas> do gráfico. Cria uma vez e, a cada `desenhar` novo, troca dados e
// opções no lugar: o chart.js anima de um estado para o outro em vez de
// redesenhar do zero a cada consulta. Quem chama memoriza `desenhar` com
// useCallback — é a identidade dele que diz quando redesenhar.
//
// O tema entra aqui porque o canvas não acompanha o CSS sozinho: trocou o
// modo do sistema, `desenhar` roda de novo e relê as variáveis.
//
// O pai do <canvas> tem de ser só dele, com position relative e altura
// definida: é dele que o chart.js tira o tamanho.
export function useGrafico(desenhar: (canvas: HTMLCanvasElement) => Desenho) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const grafico = useRef<Chart<"line"> | null>(null);
  const escuro = useSyncExternalStore(assinarTema, () => matchMedia(ESCURO).matches, () => false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const { data, options } = desenhar(el);
    const g = grafico.current;
    if (g) {
      g.data = data;
      g.options = options ?? {};
      g.update();
      return;
    }
    // A fonte da página (Inter), e não a Helvetica padrão do chart.js.
    Chart.defaults.font.family = getComputedStyle(el).fontFamily;
    grafico.current = new Chart(el, { type: "line", data, options });
  }, [desenhar, escuro]);

  useEffect(
    () => () => {
      grafico.current?.destroy();
      grafico.current = null;
    },
    [],
  );

  return canvas;
}
