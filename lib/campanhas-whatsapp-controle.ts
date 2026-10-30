// Os blocos de CONTROLE do motor das campanhas em blocos (lib/campanhas-whatsapp.ts
// explica o motor inteiro), de 2026-10-28 (pedido dele: "crie mais blocos"):
//
//   · Condição: pergunta sobre o contato na hora em que ele chega (tag,
//     segmento, etapa da oportunidade aberta num funil, campo personalizado) e
//     segue por "sim" ou "nao". O evento 'bloco' leva a saída, como no Aguardar:
//     é por ele que as métricas contam cada caminho.
//   · Horário de envio: dentro da janela (dias e horas, no fuso de Brasília)
//     passa direto; fora, a execução espera em 'em_andamento' até a próxima
//     abertura e, ao vencer, confere de novo (uma pausa longa não solta ninguém
//     de madrugada).
//   · Permissão de passagem: deixa passar X contatos a cada intervalo, em janela
//     deslizante por campanha+bloco, contada pelo evento 'passagem' {bloco}.
//     Cheia, a execução espera até a vaga abrir e passa na ordem de chegada. Sem
//     tabela nova: estado, prazo e eventos que o motor já tem.
//   · Alternar (2026-10-30, pedido dele: variar os templates de uma campanha):
//     reveza os contatos entre os caminhos na ordem de chegada, contando os
//     eventos 'bloco' dele (executarAlternar).
//
// EVENTOS, como no "Esperar": quem passa direto deixa um evento 'bloco' com a
// saída; quem espera deixa um 'bloco' sem saída ao chegar (conta em "passaram"
// e, pelo bloco_atual, em "agora") e o da saída quando passa.
import "server-only";
import { sql } from "@/lib/db";
import { minutosDoHorario, normalizarResposta, type BlocoCampanha, type RegraCondicao } from "@/lib/campanhas-fluxo";
import { estacionarAte, eventoBloco, jaComecou, PAROU, segue, type Execucao, type Passo } from "@/lib/campanhas-whatsapp-base";

// ── Condição ────────────────────────────────────────────────────────────────

/** A regra vale para o contato agora? Id vazio (fluxo que não passou na conferência) é "não". */
async function regraVale(e: Execucao, r: RegraCondicao): Promise<boolean> {
  switch (r.tipo) {
    case "tem_tag": {
      if (!r.tagId) return false;
      const [x] = await sql`SELECT 1 FROM contato_tags WHERE contato_id = ${e.contato_id}::uuid AND tag_id = ${r.tagId}::uuid`;
      return !!x;
    }
    case "no_segmento": {
      if (!r.segmentoId) return false;
      const [x] = await sql`SELECT 1 FROM contato_segmentos WHERE contato_id = ${e.contato_id}::uuid AND segmento_id = ${r.segmentoId}::uuid`;
      return !!x;
    }
    case "na_etapa": {
      if (!r.funilId || !r.etapaId) return false;
      // A mesma oportunidade que o "Mover oportunidade" moveria: a aberta mais recente do contato neste funil.
      const [op] = await sql`
        SELECT etapa_id::text FROM oportunidades
         WHERE contato_id = ${e.contato_id}::uuid AND funil_id = ${r.funilId}::uuid AND status = 'aberta'
         ORDER BY data_criacao DESC LIMIT 1`;
      return op?.etapa_id === r.etapaId;
    }
    case "campo": {
      if (!r.chave) return false;
      const [c] = await sql`SELECT campos->>${r.chave} AS valor FROM contatos WHERE id = ${e.contato_id}::uuid`;
      // Sem acento, sem maiúscula e sem espaço sobrando dos dois lados.
      const valor = normalizarResposta(String(c?.valor ?? ""));
      if (r.operador === "preenchido") return valor !== "";
      const alvo = normalizarResposta(r.valor);
      return r.operador === "igual" ? valor === alvo : alvo !== "" && valor.includes(alvo);
    }
  }
}

export async function executarCondicao(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "condicao" }>): Promise<Passo> {
  const vale = await regraVale(e, b.regra);
  await eventoBloco(e, id, b, { saida: vale ? "sim" : "nao", ok: true });
  return segue(vale ? b.sim : b.nao);
}

// ── Horário de envio ────────────────────────────────────────────────────────

const FUSO = "America/Sao_Paulo";
const DIA_DA_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const RELOGIO = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

/** Data, hora e dia da semana de um instante no relógio de Brasília. */
function emBrasilia(t: Date) {
  const p = Object.fromEntries(RELOGIO.formatToParts(t).map((x) => [x.type, x.value]));
  const [ano, mes, dia, hora, minuto, segundo] = [p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number);
  return { ano, mes, dia, diaDaSemana: DIA_DA_SEMANA[p.weekday], minutoDoDia: hora * 60 + minuto, comoUtc: Date.UTC(ano, mes - 1, dia, hora, minuto, segundo) };
}

/**
 * O instante em que o relógio de Brasília marca `minutoDoDia` na data dada.
 * Pela diferença do fuso NAQUELE instante (sem horário de verão desde 2019, mas
 * sem supor isso), conferida duas vezes para a virada de um eventual horário de verão.
 */
function instanteEmBrasilia(ano: number, mes: number, dia: number, minutoDoDia: number): Date {
  const alvo = Date.UTC(ano, mes - 1, dia, 0, minutoDoDia);
  let t = alvo;
  for (let i = 0; i < 2; i++) t = alvo - (emBrasilia(new Date(t)).comoUtc - t);
  return new Date(t);
}

/**
 * Quando a janela do "Horário de envio" abre de novo, ou null se `agora` já
 * está dentro dela (dia permitido, das <= hora < ate, no fuso de Brasília).
 * Procura de hoje até o mesmo dia da semana seguinte: com um dia só
 * permitido, passada a janela de hoje, a próxima é daqui a sete dias.
 */
export function proximaAbertura(agora: Date, dias: number[], das: string, ate: string): Date | null {
  const inicio = minutosDoHorario(das);
  const fim = minutosDoHorario(ate);
  if (inicio === null || fim === null || fim <= inicio || !dias.length) throw new Error("Horário de envio inválido.");
  const r = emBrasilia(agora);
  if (dias.includes(r.diaDaSemana) && r.minutoDoDia >= inicio && r.minutoDoDia < fim) return null;
  for (let k = 0; k <= 7; k++) {
    // Aritmética de calendário: a data de Brasília + k dias, sem fuso.
    const d = new Date(Date.UTC(r.ano, r.mes - 1, r.dia + k));
    if (!dias.includes(d.getUTCDay())) continue;
    if (k === 0 && r.minutoDoDia >= inicio) continue; // a abertura de hoje já passou
    return instanteEmBrasilia(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), inicio);
  }
  throw new Error("Horário de envio sem próxima abertura.");
}

export async function executarHorario(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "horario" }>): Promise<Passo> {
  let abre: Date | null;
  try {
    abre = proximaAbertura(new Date(), b.dias, b.das, b.ate);
  } catch (erro) {
    // Fluxo que não passou na conferência: registra e segue, como uma ação que falhou.
    await eventoBloco(e, id, b, { saida: "proximo", ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
    return segue(b.proximo);
  }
  if (!abre) {
    await eventoBloco(e, id, b, { saida: "proximo", ok: true });
    return segue(b.proximo);
  }
  if (!(await jaComecou(e, id))) await eventoBloco(e, id, b, { ok: true });
  await estacionarAte(e, id, abre);
  return PAROU;
}

// ── Permissão de passagem ───────────────────────────────────────────────────

/**
 * A folga de relógio da janela, em segundos: uma passagem ocupa a vaga por
 * (janela − 15 s). Ver janelaDaPassagem.
 */
export const FOLGA_PASSAGEM_S = 15;

/**
 * A janela que o motor CONTA, a partir do que a pessoa pediu (X contatos a
 * cada N segundos). A REGRA DA VAZÃO:
 *
 *   · o motor roda a cada 1 minuto (o agendador do n8n chama o /processar), e
 *     cada rodada anda as execuções em rajada. Janela abaixo de 60 s vira a
 *     mesma TAXA por minuto: X × 60 / N vagas (para baixo) a cada 60 s. "5 a
 *     cada 10 s" deixa passar até 30 por minuto, na rodada; contar 10 s de
 *     verdade soltaria só 5 por minuto, um sexto do pedido;
 *   · a vaga fica ocupada pela janela menos FOLGA_PASSAGEM_S: as rodadas não
 *     caem exatamente a 60 s uma da outra, e as passagens de uma rodada se
 *     espalham pelos segundos em que ela roda. Sem a folga, a janela de 60 s
 *     ainda estaria cheia quando a rodada seguinte chega, e a vazão cairia até
 *     pela metade. Em janela longa (uma hora, um dia) a folga não se nota; na
 *     de um minuto, quem passa fora da rodada (pela resposta, no webhook) pode
 *     somar até X a cada 45 s;
 *   · o teto da rodada continua valendo: até 100 execuções e 45 s por chamada
 *     do /processar, por campanha. Pedir mais que isso por minuto não acelera.
 */
export function janelaDaPassagem(quantidade: number, janelaSegundos: number): { vagas: number; segundos: number } {
  const porMinuto = janelaSegundos < 60;
  return {
    vagas: porMinuto ? Math.max(1, Math.floor((quantidade * 60) / janelaSegundos)) : quantidade,
    segundos: (porMinuto ? 60 : janelaSegundos) - FOLGA_PASSAGEM_S,
  };
}

/**
 * Pede a vaga, sob pg_advisory_xact_lock da campanha+bloco (duas rodadas, ou a
 * rodada e o webhook, não contam a mesma vaga). Com vaga, grava a 'passagem'
 * na mesma transação. Sem vaga, devolve quando ela abre — quando sai da janela
 * a passagem que estoura a conta (com a janela cheia, a mais antiga) — e põe
 * quem já espera neste bloco na mesma hora: ninguém é reservado à toa antes
 * dela, e o empate sai pela ordem de inscrição (processarFila), a mesma da
 * chegada quando a passagem vem logo no início do fluxo.
 */
async function pedirPassagem(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "limitar_passagem" }>): Promise<Date | null> {
  const { vagas, segundos } = janelaDaPassagem(b.quantidade, b.janela_segundos);
  return sql.begin(async (tx: typeof sql) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`passagem|${e.campanha_id}|${id}`}::text))`;
    // clock_timestamp e não now(): now() é o começo da transação, que pode ter esperado a trava.
    const naJanela = () => tx`
      campanha_id = ${e.campanha_id}::uuid AND tipo = 'passagem' AND detalhe->>'bloco' = ${id}
      AND data_criacao > clock_timestamp() - make_interval(secs => ${segundos}::int)`;
    const [{ n }] = (await tx`SELECT count(*)::int AS n FROM campanha_whatsapp_eventos WHERE ${naJanela()}`) as unknown as Array<{ n: number }>;
    if (n < vagas) {
      await tx`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe, data_criacao)
               VALUES (${e.campanha_id}::uuid, ${e.id}::uuid, 'passagem', ${sql.json({ bloco: id } as never)}, clock_timestamp())`;
      return null;
    }
    const [vaga] = (await tx`
      SELECT data_criacao + make_interval(secs => ${segundos}::int) AS abre FROM campanha_whatsapp_eventos
       WHERE ${naJanela()}
       ORDER BY data_criacao OFFSET ${n - vagas} LIMIT 1`) as unknown as Array<{ abre: Date }>;
    // Entre as duas leituras a passagem pode ter saído da janela (o relógio anda
    // dentro da transação): a vaga já abriu, e a próxima rodada confere de novo.
    const abre = vaga?.abre ?? new Date();
    await tx`
      UPDATE campanha_whatsapp_execucoes SET prazo_resposta = ${abre}
       WHERE campanha_id = ${e.campanha_id}::uuid AND bloco_atual = ${id}
         AND estado = 'em_andamento' AND prazo_resposta < ${abre}`;
    return abre;
  });
}

export async function executarPassagem(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "limitar_passagem" }>): Promise<Passo> {
  const abre = await pedirPassagem(e, id, b);
  if (!abre) {
    await eventoBloco(e, id, b, { saida: "proximo", ok: true });
    return segue(b.proximo);
  }
  if (!(await jaComecou(e, id))) await eventoBloco(e, id, b, { ok: true });
  await estacionarAte(e, id, abre);
  return PAROU;
}

// ── Alternar ────────────────────────────────────────────────────────────────

/**
 * O caminho da vez: quantos contatos já passaram por este bloco, módulo o
 * número de caminhos. Sob pg_advisory_xact_lock da campanha+bloco, com o
 * evento 'bloco' {saida: "caminho:<i>"} gravado na mesma transação: duas
 * rodadas (ou a rodada e o webhook) não pegam a mesma vez. A execução que já
 * passou aqui (a rodada caiu depois do evento) segue pelo caminho gravado e
 * não conta de novo.
 */
export async function executarAlternar(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "alternar" }>): Promise<Passo> {
  const total = b.saidas.length;
  if (!total) return segue(null);
  const vez = await sql.begin(async (tx: typeof sql) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`alternar|${e.campanha_id}|${id}`}::text))`;
    const doBloco = () => tx`campanha_id = ${e.campanha_id}::uuid AND tipo = 'bloco' AND detalhe->>'bloco' = ${id}`;
    const [antes] = (await tx`
      SELECT detalhe->>'saida' AS saida FROM campanha_whatsapp_eventos
       WHERE ${doBloco()} AND execucao_id = ${e.id}::uuid LIMIT 1`) as unknown as Array<{ saida: string | null }>;
    const gravada = Number(/^caminho:(\d+)$/.exec(antes?.saida ?? "")?.[1] ?? NaN);
    if (Number.isInteger(gravada)) return gravada % total;
    const [{ n }] = (await tx`SELECT count(*)::int AS n FROM campanha_whatsapp_eventos WHERE ${doBloco()}`) as unknown as Array<{ n: number }>;
    const i = n % total;
    await tx`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
             VALUES (${e.campanha_id}::uuid, ${e.id}::uuid, 'bloco', ${sql.json({ bloco: id, tipo: b.tipo, saida: `caminho:${i}`, ok: true } as never)})`;
    return i;
  });
  return segue(b.saidas[vez]);
}
