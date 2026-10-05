// Onde cada evento cai na tela. Funções puras: recebem eventos e dias, devolvem
// posições — a grade só desenha.
import type { EventoAgenda } from "@/lib/agenda";
import { diaDe, meiaNoite, somarDias } from "./tempo";

const DIA_MS = 24 * 3600_000;

/**
 * Vai para a faixa de cima ("dia inteiro") e não para a grade de horas: o
 * evento de dia inteiro e o que dura 24h ou mais. Um de 22h às 2h continua na
 * grade, partido em dois pedaços.
 */
export const ehDeFaixa = (e: EventoAgenda) =>
  e.diaInteiro || new Date(e.fim).getTime() - new Date(e.inicio).getTime() >= DIA_MS;

/** O último dia que o evento ocupa (o fim do Google é exclusivo). */
function ultimoDia(e: EventoAgenda): string {
  return e.diaInteiro ? somarDias(diaDe(e.fim), -1) : diaDe(new Date(new Date(e.fim).getTime() - 1));
}

/** Os eventos que tocam o dia: os de faixa primeiro, depois por horário. */
export function eventosDoDia(eventos: EventoAgenda[], dia: string): EventoAgenda[] {
  return eventos
    .filter((e) => diaDe(e.inicio) <= dia && ultimoDia(e) >= dia)
    .sort((a, b) => Number(ehDeFaixa(b)) - Number(ehDeFaixa(a)) || a.inicio.localeCompare(b.inicio));
}

// ── Grade de horas ────────────────────────────────────────────────────────────

/** Um pedaço de evento dentro de um dia da grade, em minutos desde 0h. */
export type Pedaco = {
  evento: EventoAgenda;
  inicioMin: number;
  fimMin: number;
  /** Começou no dia anterior / continua no seguinte. */
  vemDeAntes: boolean;
  segueDepois: boolean;
  /** Coluna dentro do grupo de sobrepostos, e quantas colunas o grupo tem. */
  coluna: number;
  colunas: number;
};

/**
 * Menor duração que um evento ocupa na DISPOSIÇÃO: um de 15 min desenha um
 * cartão de ~25 min de altura (senão o título não cabe), e o vizinho que
 * começa logo depois precisa ir para a coluna ao lado, não por baixo dele.
 */
const MINIMO_VISUAL = 25;

/**
 * Os pedaços de evento do dia, com as colunas dos que se sobrepõem — o mesmo
 * arranjo do Google: um grupo de eventos encavalados divide a largura em
 * colunas, e cada um vai na primeira coluna livre.
 */
export function pedacosDoDia(eventos: EventoAgenda[], dia: string): Pedaco[] {
  const ini = meiaNoite(dia).getTime();
  const fim = meiaNoite(somarDias(dia, 1)).getTime();
  const total = (fim - ini) / 60_000;

  const pedacos: Pedaco[] = [];
  for (const e of eventos) {
    if (ehDeFaixa(e)) continue;
    const a = new Date(e.inicio).getTime();
    const b = new Date(e.fim).getTime();
    if (b <= ini || a >= fim) continue;
    pedacos.push({
      evento: e,
      inicioMin: Math.max(0, (a - ini) / 60_000),
      fimMin: Math.min(total, (b - ini) / 60_000),
      vemDeAntes: a < ini,
      segueDepois: b > fim,
      coluna: 0,
      colunas: 1,
    });
  }

  // Mais cedo primeiro; no empate, o mais longo à esquerda.
  pedacos.sort((p, q) => p.inicioMin - q.inicioMin || q.fimMin - q.inicioMin - (p.fimMin - p.inicioMin));

  let grupo: Pedaco[] = [];
  let colunas: number[] = []; // onde termina o último de cada coluna
  let fimDoGrupo = -1;
  const fechar = () => {
    for (const p of grupo) p.colunas = colunas.length;
    grupo = [];
    colunas = [];
    fimDoGrupo = -1;
  };

  for (const p of pedacos) {
    const fimVisual = Math.max(p.fimMin, p.inicioMin + MINIMO_VISUAL);
    if (grupo.length && p.inicioMin >= fimDoGrupo) fechar();
    let c = colunas.findIndex((f) => f <= p.inicioMin);
    if (c === -1) {
      c = colunas.length;
      colunas.push(fimVisual);
    } else {
      colunas[c] = fimVisual;
    }
    p.coluna = c;
    grupo.push(p);
    fimDoGrupo = Math.max(fimDoGrupo, fimVisual);
  }
  fechar();
  return pedacos;
}

// ── Faixa de dia inteiro ──────────────────────────────────────────────────────

export type Faixa = {
  evento: EventoAgenda;
  /** Colunas (índices em `dias`) onde começa e termina, inclusive. */
  de: number;
  ate: number;
  linha: number;
  vemDeAntes: boolean;
  segueDepois: boolean;
};

/**
 * As barras de dia inteiro dos dias mostrados. Um evento de três dias é UMA
 * barra atravessando as três colunas; barras que se cruzam vão para linhas
 * diferentes.
 */
export function faixasDosDias(eventos: EventoAgenda[], dias: string[]): Faixa[] {
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];
  const faixas: Faixa[] = [];

  for (const e of eventos) {
    if (!ehDeFaixa(e)) continue;
    const comeca = diaDe(e.inicio);
    const termina = ultimoDia(e);
    if (termina < primeiro || comeca > ultimo) continue;
    faixas.push({
      evento: e,
      de: dias.indexOf(comeca < primeiro ? primeiro : comeca),
      ate: dias.indexOf(termina > ultimo ? ultimo : termina),
      linha: 0,
      vemDeAntes: comeca < primeiro,
      segueDepois: termina > ultimo,
    });
  }

  faixas.sort((a, b) => a.de - b.de || b.ate - b.de - (a.ate - a.de));
  const fimDaLinha: number[] = [];
  for (const f of faixas) {
    let l = fimDaLinha.findIndex((fim) => fim < f.de);
    if (l === -1) {
      l = fimDaLinha.length;
      fimDaLinha.push(f.ate);
    } else {
      fimDaLinha[l] = f.ate;
    }
    f.linha = l;
  }
  return faixas;
}
