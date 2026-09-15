import type { Oportunidade } from "../data";
import type { Subetapa } from "@/lib/automacoes/cadencia";

// A regra do quadro de subetapas. Só cálculo — nada aqui toca o banco, porque
// quem importa este módulo é um componente de cliente.
//
// Subetapas de uma etapa são uma CADÊNCIA DE MENSAGENS, e a cadência é uma
// AUTOMAÇÃO (lib/automacoes/cadencia.ts): cada coluna é um bloco de mensagem
// do fluxo amarrado à etapa.
//
// ONDE cada oportunidade cai, em duas fontes e nesta ordem de confiança:
//
//   1. o bloco que o motor executou por último para ela (`posicao`). É FATO, e
//      é o que muda na hora quando alguém arrasta o card de uma coluna para
//      outra — o arraste move a inscrição no motor, não só o desenho.
//   2. o COMEÇO, para quem está no fluxo e ainda não tem passo marcado: foi
//      inscrito agora, ou o workflow publicado é velho e não grava passo. A
//      régua de dias não serve a esses — ela apontaria a última mensagem para
//      uma oportunidade antiga que acabou de entrar na primeira.
//   3. a régua de dias, para quem nunca entrou no fluxo: a última mensagem
//      cujo `dia` já venceu para a idade da oportunidade. É PREVISÃO — onde
//      ela cairia se a cadência disparasse agora.
//
// A régua sozinha era a regra antiga, de quando a posição não podia ser
// mudada. Ela continua valendo para quem está fora do fluxo e mentiria para
// quem está dentro: a oportunidade de 40 dias movida para a 2ª mensagem
// continuaria desenhada na última.

export type { Subetapa };

export type ColunaSubetapa = {
  subetapa: Subetapa;
  oportunidades: Oportunidade[];
  // só na última coluna: quantas dessas já passaram do dia da última mensagem.
  // Elas ficam aqui em vez de sumirem da tela.
  alemDaUltima: number;
};

/**
 * O quadro inteiro: as colunas de mensagem e quem está parado nas AÇÕES entre
 * elas.
 *
 * A espera é um passo como os outros — e é o único em que o lead realmente
 * fica. Mostrá-lo na mensagem anterior dizia que ele tinha acabado de receber
 * aquela mensagem quando, na verdade, ele está esperando a próxima.
 */
export type QuadroCadencia = {
  colunas: ColunaSubetapa[];
  /** id do bloco de ação -> quem está parado nele. */
  porAcao: Map<string, Oportunidade[]>;
};

// Meia-noite local do dia de `data`. Sem passar a string por new Date(): o
// construtor lê "2026-09-02" como UTC e, em Brasília, isso é dia 1º — a
// oportunidade cairia uma coluna adiante. Mesmo motivo do dataCurta em
// app/formato.ts.
function meiaNoite(data: string) {
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

// Diferença em DIAS DE CALENDÁRIO, não em 24h corridas: quem foi criado ontem
// às 23h está a 2 horas de distância e ainda assim é "ontem". Por isso as duas
// pontas viram meia-noite antes da subtração, e o round absorve o dia de 23h
// ou 25h do horário de verão.
export function diasDesde(data_criacao: string, hoje: Date) {
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const criada = meiaNoite(data_criacao);
  return Math.round((inicioHoje.getTime() - criada.getTime()) / 86_400_000);
}

// Índice da última coluna cujo `dia` já venceu para essa idade. -1 quando nem a
// primeira venceu (cadência que só começa no 3º dia, oportunidade de hoje).
function indicePorIdade(subetapas: Subetapa[], idade: number) {
  let alvo = -1;
  for (let i = 0; i < subetapas.length; i++) {
    if (subetapas[i].dia <= idade) alvo = i;
    else break; // vêm ordenadas por dia; a primeira futura encerra a busca
  }
  return alvo;
}

/**
 * Coluna em que a oportunidade cai: o bloco em que ela está, se estiver no
 * fluxo; o começo, se estiver dentro sem passo marcado; senão, a régua de dias.
 *
 * `posicao` mapeia oportunidade → id do bloco. Um id que não existe mais nas
 * colunas (a mensagem foi apagada depois que ela passou por lá) cai nas regras
 * seguintes em vez de sumir do quadro.
 *
 * `dentro` são as que têm inscrição viva. Elas NÃO passam pela régua de dias:
 * quem está no fluxo começa na primeira mensagem, não importa há quanto tempo a
 * oportunidade existe — e era exatamente isso que punha todo mundo na última
 * coluna quando a posição não chegava.
 */
export function colunaDe(
  oportunidade: Oportunidade,
  subetapas: Subetapa[],
  hoje: Date,
  posicao?: Map<string, string>,
  dentro?: Set<string>,
) {
  if (subetapas.length === 0) return 0;

  const noId = posicao?.get(oportunidade.id);
  if (noId) {
    const i = subetapas.findIndex((s) => s.id === noId);
    if (i >= 0) return i;
  }

  if (dentro?.has(oportunidade.id)) return 0;

  const idade = diasDesde(oportunidade.data_criacao, hoje);
  return Math.max(0, indicePorIdade(subetapas, idade));
}

// A regra do quadro. Quem passou da última mensagem (pela régua de dias) se
// acumula na última coluna e é contado em `alemDaUltima`, em vez de sumir.
export function distribuir(
  subetapas: Subetapa[],
  oportunidades: Oportunidade[],
  hoje: Date,
  posicao?: Map<string, string>,
  dentro?: Set<string>,
  /** Ids dos blocos de ação do fluxo — quem estiver num deles sai das colunas. */
  acoes?: Set<string>,
): QuadroCadencia {
  const colunas: ColunaSubetapa[] = subetapas.map((subetapa) => ({
    subetapa,
    oportunidades: [],
    alemDaUltima: 0,
  }));
  const porAcao = new Map<string, Oportunidade[]>();
  if (colunas.length === 0) return { colunas, porAcao };

  const ultima = colunas.length - 1;
  const diaFinal = subetapas[ultima].dia;

  for (const o of oportunidades) {
    // Parado numa ação (quase sempre um "Esperar"): o lugar dele é ali, e não
    // numa coluna. Sem esta saída ele apareceria na mensagem que já recebeu.
    const no = posicao?.get(o.id);
    if (no && acoes?.has(no)) {
      porAcao.set(no, [...(porAcao.get(no) ?? []), o]);
      continue;
    }

    const alvo = colunaDe(o, subetapas, hoje, posicao, dentro);
    colunas[alvo].oportunidades.push(o);
    // "já passou da última" é leitura da RÉGUA: quem está no fluxo tem lugar
    // próprio, e contá-lo aqui misturaria de novo fato com previsão.
    if (
      !posicao?.has(o.id) &&
      !dentro?.has(o.id) &&
      diasDesde(o.data_criacao, hoje) > diaFinal
    ) {
      colunas[ultima].alemDaUltima += 1;
    }
  }
  return { colunas, porAcao };
}

// ── Cor da etapa ao longo da cadência ──────────────────────────────────────
//
// etapas.cor guarda uma classe do Tailwind ("bg-sky-500"), e a coluna precisa
// da COR, não da classe: cada uma das colunas recebe um degrau diferente da
// mesma tinta. Como toda classe `bg-<familia>-500` da paleta está no @source
// inline do globals.css, a variável correspondente existe no :root — daí a
// tradução direta de classe para var(). O fallback é o zinc-500 literal, para
// uma cor fora da paleta não apagar a coluna.
export function corDaEtapa(cor: string) {
  const familia = cor.startsWith("bg-") ? cor.slice(3) : "";
  return familia ? `var(--color-${familia}, #71717b)` : "#71717b";
}

// Onde a coluna `indice` está na cadência, de 0 (1ª mensagem) a 100 (última).
// É POSIÇÃO, não a porcentagem da mistura: quanto de cor isso vira é decisão da
// classe .subetapa no globals.css, que tem faixas diferentes no claro e no
// escuro. Misturar aqui obrigaria este módulo a saber o tema — e ele não sabe.
export function passoDaCadencia(indice: number, total: number) {
  if (total <= 1) return 0;
  const posicao = Math.min(Math.max(indice, 0), total - 1);
  return Math.round((posicao / (total - 1)) * 100);
}

// Rótulo do dia de uma coluna, dito em português. É a régua da cadência no
// lugar em que o usuário precisa dela.
export function rotuloDoDia(dia: number) {
  if (dia <= 0) return "No dia da entrada";
  if (dia === 1) return "1 dia depois";
  return `${dia} dias depois`;
}
