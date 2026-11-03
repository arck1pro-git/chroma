// A IA RETOMA A CONVERSA quando o contato não responde.
//
// PEDIDO (2026-10-06): "se o contato não responder uma pergunta, posso
// determinar que horas voltar a entrar em contato". Decisões dele:
//
//   · QUANDO: cada IA tem a sua lista de tempos (ias.retomar_apos, em minutos)
//     e uma janela de horário (ias.retomar_das/retomar_ate, Brasília). Cada
//     tempo conta da mensagem ANTERIOR da IA: {180, 1440} = 3h depois da
//     pergunta, e 1 dia depois da primeira retomada. Venceu fora da janela, sai
//     na abertura seguinte.
//   · O QUÊ: a própria IA escreve, lendo a conversa (gerarRetomada), uma
//     mensagem só.
//   · SEM RESPOSTA A NENHUMA: ESPERA_DESISTIR depois da última, o responsável
//     da oportunidade é avisado no WhatsApp, como no "lead quer um humano"
//     (lib/ia/atendente.ts). A IA continua ligada: se o cliente voltar, ela
//     responde.
//
// QUANDO A CONVERSA ENTRA: a última mensagem dela (sem contar envio que falhou)
// é da IA, e alguma mensagem da IA desde a última do cliente tem pergunta ("?").
// Resposta sem pergunta não pede retomada. Qualquer outra voz depois da IA (o
// cliente, alguém da equipe, a cadência) tira a conversa daqui sozinha, porque
// a última mensagem deixa de ser dela.
//
// O ESTADO mora nas mensagens, sem tabela: mensagens.retomada numera as que
// saíram desde a última do cliente, e a resposta dele zera a conta (só conta o
// que veio depois dela). O "parou" é uma linha do histórico com MARCA_PAROU,
// depois da última mensagem do cliente: a desistência e também a falha de
// envio, para não tentar de novo a cada rodada.
//
// RETORNO COMBINADO (2026-11-03, lib/ia/retorno.ts): o cliente pediu para
// falar em outro dia ou hora e a IA anotou. A mesma rodada retoma no horário
// (retornosCombinados), ANTES das retomadas por silêncio, e a retomada por
// silêncio não cutuca quem tem retorno marcado: ele já disse quando quer falar.
// Não retoma, e fecha o combinado, quando o cliente voltou a falar sozinho ou
// alguém da equipe está na conversa; quando não tem como (contato fora da IA,
// janela da Meta fechada, a hora passou longe), avisa o responsável.
//
// QUEM CHAMA: o agendador do n8n (NOME_AGENDADOR), de 5 em 5 minutos, em
// /api/ia/retomar. É ligado ao salvar uma IA com retomadas ou com o retorno
// combinado pelo endereço público (app/inicio/acoes-ia.ts). Rodadas não se
// atropelam: a trava do banco deixa uma por vez.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { destinoDa, enviarTextoNaConversa, foraDaJanela } from "@/lib/conversa-envio";
import {
  acharWorkflowPorNome,
  ativarWorkflow,
  criarWorkflow,
  type WorkflowMotor,
} from "@/lib/automacoes/motores/n8n/adaptador";
import { garantirCredencialDoCrm } from "@/lib/campanhas-workflow";
import { rotuloDoHorario } from "@/lib/agenda";
import {
  avisarNoWhatsApp,
  blocoDaFuncao,
  conversaDoAviso,
  conversaParaPrompt,
  dadosDoLead,
  fmtAgora,
  HISTORICO,
  iaQueAtende,
  linhaDoCanal,
  MODELO,
  regras,
  semTravessao,
  sistemaDoCanal,
  situacao,
  type LinhaHistorico,
  type Situacao,
} from "./atendente";
import { fecharRetorno, LIKE_FIM, LIKE_RETORNO, MAXIMO_DIAS, quandoDoRetorno } from "./retorno";

/** Depois da última retomada sem resposta, quanto esperar para avisar o responsável. */
const ESPERA_DESISTIR_MS = 24 * 60 * 60 * 1000;
/**
 * Venceu há mais do que isto: não manda. Cobre a noite fora da janela, e barra
 * o caso perigoso: ligar as retomadas numa IA e ela sair cutucando, de uma vez,
 * todo mundo que ficou calado nos últimos meses.
 */
const ATRASO_MAXIMO_MS = 30 * 60 * 60 * 1000;
/** Conversas por rodada: cada retomada é uma chamada ao modelo e um envio. Os retornos combinados contam junto. */
const POR_RODADA = 10;
/**
 * O cliente escreveu depois do combinado, e nesta janela antes da hora: a
 * conversa já voltou sozinha. O "ok" logo depois da confirmação não conta
 * (ACK). Intervalos do Postgres.
 */
const VOLTOU = "2 hours";
const ACK = "10 minutes";
/** O começo da linha do histórico que encerra as retomadas de uma conversa. */
export const MARCA_PAROU = "IA parou de retomar";

type IaRetomada = {
  id: string;
  nome: string;
  prompt: string;
  acoes: string[];
  retomar_apos: number[];
  retomar_das: number;
  retomar_ate: number;
};

type Candidata = {
  id: string;
  /** Quantas retomadas já saíram desde a última mensagem do cliente. */
  feitas: number;
  /** A última mensagem da IA (a pergunta ou a última retomada). */
  ultima_ia: Date;
};

export type ResumoRetomada = {
  ocupado?: boolean;
  retomadas: number;
  /** Retornos combinados que saíram nesta rodada. */
  retornos: number;
  avisos: number;
  falhas: number;
};

/** A hora cheia agora em Brasília (0 a 23). */
function horaEmBrasilia(agora: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(agora),
  );
}

/** "3 horas", "1 dia", "40 minutos": há quanto tempo a IA falou, para o modelo. */
function duracao(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} minuto${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hora${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} dias`;
}

/**
 * Uma rodada: acha as conversas vencidas e retoma (ou desiste de) até
 * POR_RODADA delas. Nunca lança por causa de uma conversa: o erro dela vai
 * para o log e a rodada segue.
 */
export async function retomarConversas(): Promise<ResumoRetomada> {
  // A trava vive na transação: some sozinha no fim, mesmo se a função cair.
  // Duas rodadas ao mesmo tempo (o agendador chama de 5 em 5 minutos, e uma
  // rodada cheia pode passar disso) mandariam a mesma retomada duas vezes.
  return sql.begin(async (tx: typeof sql) => {
    const [trava] = await tx`SELECT pg_try_advisory_xact_lock(hashtext('chroma:ia-retomada')) AS ok`;
    if (!trava.ok) return { ocupado: true, retomadas: 0, retornos: 0, avisos: 0, falhas: 0 };
    const resumo: ResumoRetomada = { retomadas: 0, retornos: 0, avisos: 0, falhas: 0 };
    // O combinado tem hora marcada: vai primeiro, e o silêncio usa o que sobrar.
    const usados = await retornosCombinados(resumo);
    await rodada(resumo, POR_RODADA - usados);
    return resumo;
  });
}

async function rodada(resumo: ResumoRetomada, limite: number): Promise<void> {
  if (limite <= 0) return;
  const ias = (await sql`
    SELECT id, nome, prompt, to_jsonb(acoes) AS acoes, to_jsonb(retomar_apos) AS retomar_apos,
           retomar_das, retomar_ate
      FROM ias WHERE cardinality(retomar_apos) > 0`) as unknown as IaRetomada[];
  // Nenhuma IA retoma: a rodada nem procura conversa.
  if (ias.length === 0) return;
  const iaPorId = new Map(ias.map((i) => [i.id, i]));

  const candidatas = (await sql`
    SELECT a.id, x.feitas, x.ultima_ia
      FROM atendimentos a
      -- Quem falou por último. Envio que falhou não conta: não chegou ao cliente.
      CROSS JOIN LATERAL (
        SELECT m.enviada_por FROM mensagens m
         WHERE m.atendimento_id = a.id AND m.status <> 'erro'
         ORDER BY m.data_criacao DESC, m.id DESC LIMIT 1
      ) ultima
      CROSS JOIN LATERAL (
        SELECT max(m.data_criacao) AS em FROM mensagens m
         WHERE m.atendimento_id = a.id AND m.origem = 'contato'
      ) cliente
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE m.retomada IS NOT NULL)::int AS feitas,
               max(m.data_criacao) FILTER (WHERE m.enviada_por = 'ia') AS ultima_ia,
               coalesce(bool_or(m.enviada_por = 'ia' AND m.retomada IS NULL AND m.texto LIKE '%?%'), false) AS pergunta
          FROM mensagens m
         WHERE m.atendimento_id = a.id AND m.data_criacao > cliente.em
      ) x
     WHERE a.status <> 'encerrado'
       -- Todo envio carimba data_atualizacao: conversa parada há mais de um mês
       -- não tem retomada vencendo (o maior tempo é 30 dias).
       AND a.data_atualizacao > now() - interval '32 days'
       AND ultima.enviada_por = 'ia'
       AND cliente.em IS NOT NULL
       AND x.pergunta
       AND NOT EXISTS (
         SELECT 1 FROM historico h
          WHERE h.contato_id = a.contato_id
            AND h.descricao LIKE ${`${MARCA_PAROU}%`}
            AND h.data_criacao > cliente.em)
       -- Retorno combinado aberto (a última linha dele é o combinado): o
       -- cliente já disse quando quer falar.
       AND NOT coalesce((
         SELECT h.descricao LIKE ${LIKE_RETORNO} FROM historico h
          WHERE h.contato_id = a.contato_id
            AND (h.descricao LIKE ${LIKE_RETORNO} OR h.descricao LIKE ${LIKE_FIM})
          ORDER BY h.data_criacao DESC LIMIT 1), false)
     ORDER BY x.ultima_ia`) as unknown as Candidata[];

  const agora = new Date();
  const hora = horaEmBrasilia(agora);
  let feitasNaRodada = 0;

  for (const c of candidatas) {
    if (feitasNaRodada >= limite) break;
    try {
      const s = await situacao(c.id);
      const iaId = s && iaQueAtende(s);
      const ia = iaId ? iaPorId.get(iaId) : undefined;
      // A IA que atende AGORA manda: a etapa pode ter mudado desde a pergunta.
      if (!s || !ia || s.humano_recente) continue;
      if (hora < ia.retomar_das || hora >= ia.retomar_ate) continue;

      const ultimaIa = new Date(c.ultima_ia).getTime();
      const total = ia.retomar_apos.length;
      const espera = c.feitas < total ? ia.retomar_apos[c.feitas] * 60_000 : ESPERA_DESISTIR_MS;
      const atraso = agora.getTime() - (ultimaIa + espera);
      if (atraso < 0 || atraso > ATRASO_MAXIMO_MS) continue;

      feitasNaRodada += 1;
      if (c.feitas >= total) {
        await desistir(c.id, s, `${s.contato_nome} não respondeu a ${total} retomada${total === 1 ? "" : "s"}.`, true);
        resumo.avisos += 1;
        continue;
      }
      const r = await retomar(c.id, s, ia, c.feitas + 1, agora.getTime() - ultimaIa);
      if (r === "enviada") resumo.retomadas += 1;
      else resumo.falhas += 1;
    } catch (e) {
      resumo.falhas += 1;
      console.error("[ia retomada] falhou:", c.id, e);
    }
  }
}

// ── O retorno combinado ─────────────────────────────────────────────────────

type RetornoVencido = { contato_id: string; data_criacao: Date; quando: Date };

/**
 * Os combinados vencidos, do mais antigo ao mais novo, até POR_RODADA.
 * Devolve quantos tentou: é o que sai da conta das retomadas por silêncio.
 */
async function retornosCombinados(resumo: ResumoRetomada): Promise<number> {
  // A última linha de retorno de cada contato. O combinado vai até MAXIMO_DIAS
  // à frente: uma linha mais velha que isso não tem o que vencer.
  const linhas = (await sql`
    SELECT DISTINCT ON (h.contato_id) h.contato_id, h.descricao, h.data_criacao
      FROM historico h
     WHERE h.contato_id IS NOT NULL
       AND h.data_criacao > now() - ${`${MAXIMO_DIAS + 1} days`}::interval
       AND (h.descricao LIKE ${LIKE_RETORNO} OR h.descricao LIKE ${LIKE_FIM})
     ORDER BY h.contato_id, h.data_criacao DESC`) as unknown as Array<{ contato_id: string; descricao: string; data_criacao: Date }>;
  const agora = Date.now();
  const vencidos: RetornoVencido[] = [];
  for (const l of linhas) {
    const quando = quandoDoRetorno(l.descricao);
    if (quando && quando.getTime() <= agora) vencidos.push({ contato_id: l.contato_id, data_criacao: l.data_criacao, quando });
  }
  vencidos.sort((a, b) => a.quando.getTime() - b.quando.getTime());

  const daVez = vencidos.slice(0, POR_RODADA);
  for (const r of daVez) {
    try {
      const saiu = await retornar(r, resumo);
      if (saiu) resumo.retornos += 1;
    } catch (e) {
      resumo.falhas += 1;
      console.error("[ia retorno] falhou:", r.contato_id, e);
    }
  }
  return daVez.length;
}

/**
 * Cumpre (ou fecha) um combinado vencido. Devolve se a mensagem saiu. Toda
 * saída sem mensagem fecha o combinado com o motivo, para não voltar na rodada
 * seguinte — menos a corrida com o cliente ou a equipe no meio da escrita, que
 * a próxima rodada reavalia.
 */
async function retornar(r: RetornoVencido, resumo: ResumoRetomada): Promise<boolean> {
  const rotulo = rotuloDoHorario(r.quando);
  // A conversa mais recente do contato que a equipe não encerrou.
  const [conversa] = await sql`
    SELECT a.id FROM atendimentos a
     WHERE a.contato_id = ${r.contato_id} AND a.status <> 'encerrado'
     ORDER BY a.data_atualizacao DESC NULLS LAST, a.data_criacao DESC LIMIT 1`;
  const s = conversa ? await situacao(conversa.id as string) : null;
  if (!conversa || !s) {
    await fecharRetorno(r.contato_id, null, `não feito (${rotulo}): o contato não tem conversa aberta.`);
    return false;
  }
  const atendimentoId = conversa.id as string;
  const fechar = async (motivo: string, avisar: boolean) => {
    const aviso = avisar
      ? await avisarResponsavelDaConversa(atendimentoId, s, `⏰ Um lead pediu para ser atendido agora (${rotulo}), e a IA não pôde retomar: ${motivo}`)
      : null;
    if (aviso) resumo.avisos += 1;
    await fecharRetorno(s.contato_id, s.op_id, `não feito (${rotulo}): ${motivo}${aviso ? ` (${aviso})` : ""}`);
    return false;
  };

  // Em todas as conversas do contato: o cliente pode ter voltado pela outra.
  const [voltou] = await sql`
    SELECT 1 FROM mensagens m JOIN atendimentos a ON a.id = m.atendimento_id
     WHERE a.contato_id = ${r.contato_id} AND m.origem = 'contato'
       AND m.data_criacao > ${r.data_criacao}::timestamptz + ${ACK}::interval
       AND m.data_criacao > now() - ${VOLTOU}::interval
     LIMIT 1`;
  if (voltou) return fechar("o cliente voltou a falar antes do horário.", false);
  if (s.humano_recente) return fechar("alguém da equipe está na conversa.", false);

  const iaId = iaQueAtende(s);
  const [ia] = iaId ? await sql`SELECT nome, prompt, to_jsonb(acoes) AS acoes FROM ias WHERE id = ${iaId}` : [];
  if (!ia) return fechar("o contato não está mais com a IA.", true);
  if (Date.now() - r.quando.getTime() > ATRASO_MAXIMO_MS) return fechar("a hora passou sem a rodada das retomadas rodar.", true);
  const destino = await destinoDa(atendimentoId);
  if (destino && foraDaJanela(destino)) {
    return fechar(
      destino.canal === "instagram"
        ? "a janela de 24h do direct do Instagram fechou."
        : "a janela de 24h do número oficial fechou, e fora dela só sai template.",
      true,
    );
  }

  const texto = await escreverRetomada(atendimentoId, s, ia as IaQueEscreve, [
    `RETORNO COMBINADO. O cliente pediu para você voltar a falar com ele neste horário (${rotulo}, horário de Brasília). Escreva UMA mensagem curta para retomar a conversa:`,
    "- Lembre de leve que ele pediu para falar agora, sem cobrar.",
    "- Retome do ponto em que a conversa parou e deixe uma pergunta simples para ele seguir.",
    "- Uma ou duas frases, numa mensagem só, sem linha em branco.",
    "Escreva só a mensagem ao cliente.",
  ]);
  if (!texto) return fechar("o modelo não escreveu a mensagem.", true);

  // Enquanto o modelo escrevia, o cliente ou alguém da equipe pode ter falado:
  // a rodada seguinte decide com a conversa nova.
  const agora = await situacao(atendimentoId);
  if (!agora || agora.ultima_do_contato !== s.ultima_do_contato || agora.humano_recente) return false;

  const envio = await enviarTextoNaConversa({ atendimentoId, texto, autorId: null, enviadaPor: "ia" });
  if (envio.erro) {
    console.error("[ia retorno] envio falhou:", atendimentoId, envio.erro);
    return fechar(`o envio falhou (${envio.erro}).`, true);
  }
  await fecharRetorno(s.contato_id, s.op_id, `feito (${rotulo}): a IA retomou a conversa no horário que o cliente pediu.`);
  console.info(`[ia retorno] retomou ${atendimentoId} (${rotulo})`);
  return true;
}

/** Escreve e manda a retomada `numero`. Falhou: para as retomadas da conversa. */
async function retomar(
  atendimentoId: string,
  s: Situacao,
  ia: IaRetomada,
  numero: number,
  silencioMs: number,
): Promise<"enviada" | "parou"> {
  // Pela Meta (API oficial e direct do Instagram), texto livre só dentro das
  // 24h abertas pela última mensagem do cliente. Fechada, nenhuma retomada sai
  // mais: vale desistir agora. A regra por canal mora em lib/conversa-envio.ts.
  const destino = await destinoDa(atendimentoId);
  if (destino && foraDaJanela(destino)) {
    const porque =
      destino.canal === "instagram"
        ? "a janela de 24h do direct do Instagram fechou."
        : "a janela de 24h do número oficial fechou, e fora dela só sai template.";
    await desistir(atendimentoId, s, porque, true);
    return "parou";
  }

  const total = ia.retomar_apos.length;
  const texto = await escreverRetomada(atendimentoId, s, ia, [
    `RETOMADA ${numero} DE ${total}. O cliente não respondeu à sua última mensagem, de ${duracao(silencioMs)} atrás. Escreva UMA mensagem curta para retomar a conversa:`,
    "- Volte ao assunto que ficou sem resposta com outras palavras. Não copie a pergunta anterior nem repita uma retomada que já foi.",
    '- Leve e sem cobrança: nada de "sumiu?", "não me respondeu" ou "fico no aguardo".',
    "- Uma ou duas frases, numa mensagem só, sem linha em branco.",
    ...(numero === total
      ? ["- É a última vez que você retoma: deixe a conversa aberta para quando ele quiser seguir, sem pressionar."]
      : []),
    "Escreva só a mensagem ao cliente.",
  ]);
  if (!texto) {
    await desistir(atendimentoId, s, "o modelo não escreveu a retomada.", false);
    return "parou";
  }

  // Enquanto o modelo escrevia, o cliente ou alguém da equipe pode ter falado.
  const [ainda] = await sql`
    SELECT m.enviada_por FROM mensagens m
     WHERE m.atendimento_id = ${atendimentoId} AND m.status <> 'erro'
     ORDER BY m.data_criacao DESC, m.id DESC LIMIT 1`;
  if (ainda?.enviada_por !== "ia") return "parou";

  const r = await enviarTextoNaConversa({ atendimentoId, texto, autorId: null, enviadaPor: "ia" });
  // Numera também a que falhou: a tentativa foi feita.
  if (r.mensagemId) await sql`UPDATE mensagens SET retomada = ${numero} WHERE id = ${r.mensagemId}`;
  if (r.erro) {
    console.error("[ia retomada] envio falhou:", atendimentoId, r.erro);
    await desistir(atendimentoId, s, `o envio da retomada ${numero} falhou (${r.erro}).`, false);
    return "parou";
  }
  console.info(`[ia retomada] retomada ${numero}/${ia.retomar_apos.length} em ${atendimentoId}`);
  return "enviada";
}

/**
 * Encerra as retomadas da conversa: a linha no histórico (com MARCA_PAROU, que
 * é o que tira a conversa das próximas rodadas) e, quando `avisar`, o aviso ao
 * responsável da oportunidade no WhatsApp.
 */
async function desistir(atendimentoId: string, s: Situacao, motivo: string, avisar: boolean) {
  const aviso = avisar ? await avisarResponsavelDaConversa(atendimentoId, s, "🤖 Um lead parou de responder à IA.") : null;
  await sql`
    INSERT INTO historico (contato_id, oportunidade_id, descricao)
    VALUES (${s.contato_id}, ${s.op_id}, ${`${MARCA_PAROU}: ${motivo}${aviso ? ` (${aviso})` : ""}`.slice(0, 1000)})`;
}

/**
 * O aviso ao responsável da oportunidade, no formato dos outros avisos da IA:
 * `titulo` e os dados do lead. Nunca lança.
 */
async function avisarResponsavelDaConversa(atendimentoId: string, s: Situacao, titulo: string): Promise<string> {
  try {
    if (!s.op_id) return "responsável não avisado: contato sem oportunidade aberta";
    const c = await conversaDoAviso(atendimentoId, s);
    if (!c) return "responsável não avisado: conversa não encontrada";
    const [u] = await sql`
      SELECT u.nome, u.whatsapp FROM oportunidades o JOIN usuarios u ON u.id = o.responsavel_id
       WHERE o.id = ${s.op_id}`;
    if (!u) return "responsável não avisado: oportunidade sem responsável";
    const texto = [
      titulo,
      "",
      ...dadosDoLead(s, c, null),
      ...(s.op_nome ? [`*Oportunidade:* ${s.op_nome}`] : []),
    ].join("\n");
    return await avisarNoWhatsApp(c, u as { nome: string; whatsapp: string | null }, texto);
  } catch (e) {
    console.error("[ia retomada] não avisou o responsável:", atendimentoId, e);
    return `responsável não avisado: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
  }
}

/** O que escreverRetomada precisa da IA. */
type IaQueEscreve = { nome: string; prompt: string; acoes: string[] };

/**
 * A retomada (por silêncio ou no retorno combinado), escrita pela IA da
 * conversa: mesmas regras fixas, mesma função e mesma base da resposta normal
 * (o prefixo em cache é o mesmo), a conversa inteira e, no fim, `instrucoes`.
 * Devolve uma mensagem só, ou "" se o modelo não escreveu.
 */
async function escreverRetomada(
  atendimentoId: string,
  s: Situacao,
  ia: IaQueEscreve,
  instrucoes: string[],
): Promise<string> {
  const [historico, oportunidades] = await Promise.all([
    sql`
      SELECT m.origem, m.enviada_por, u.nome AS autor, m.texto, m.tipo, m.midia_nome, m.data_criacao
      FROM mensagens m
      LEFT JOIN usuarios u ON u.id = m.autor_id
      WHERE m.atendimento_id = ${atendimentoId} AND m.status <> 'erro'
      ORDER BY m.data_criacao DESC
      LIMIT ${HISTORICO}`,
    sql`
      SELECT f.nome AS funil, e.nome AS etapa, o.nome
      FROM oportunidades o
      JOIN etapas e ON e.id = o.etapa_id
      JOIN funis f ON f.id = o.funil_id
      WHERE o.contato_id = ${s.contato_id} AND o.status = 'aberta'
      ORDER BY o.data_criacao DESC
      LIMIT 5`,
  ]);

  const { nome, linhas } = conversaParaPrompt(s.canal, s.contato_nome, (historico as unknown as LinhaHistorico[]).reverse());
  const pedido = [
    `Contato: ${nome}`,
    linhaDoCanal(s.canal),
    `No CRM: ${oportunidades.length ? oportunidades.map((o) => `${o.funil} › ${o.etapa} (${o.nome})`).join("; ") : "sem oportunidade aberta"}`,
    `Agora: ${fmtAgora.format(new Date())}`,
    "",
    "<conversa>",
    ...linhas,
    "</conversa>",
    "",
    ...instrucoes,
  ].join("\n");

  const cliente = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  const resposta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 8_000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: [
      { type: "text", text: regras(ia.acoes.includes("passar_para_humano")) },
      { type: "text", text: blocoDaFuncao(ia) },

      ...sistemaDoCanal(s.canal),
    ],
    messages: [{ role: "user", content: pedido }],
  });
  if (resposta.stop_reason === "refusal" || resposta.stop_reason === "max_tokens") return "";
  const texto = resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  // Uma mensagem só: blocos que o modelo separou viram linhas da mesma.
  return texto
    .split(/\n\s*\n/)
    .map((b) => semTravessao(b).trim())
    .filter(Boolean)
    .join("\n");
}

// ── O agendador no n8n ──────────────────────────────────────────────────────

/** Nome fixo: é a chave de "já existe?" (acharWorkflowPorNome). */
export const NOME_AGENDADOR = "[Chroma] IA · retomar conversas";

function montarAgendador(crmBaseUrl: string, credencialId: string): WorkflowMotor {
  const gatilho = "De 5 em 5 minutos";
  const chamar = "Retomar conversas";
  return {
    name: NOME_AGENDADOR,
    settings: { executionOrder: "v1" },
    nodes: [
      {
        id: "gatilho",
        name: gatilho,
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } },
      },
      {
        id: "retomar",
        name: chamar,
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          method: "POST",
          url: `${crmBaseUrl.replace(/\/+$/, "")}/api/ia/retomar`,
          authentication: "genericCredentialType",
          genericAuthType: "httpHeaderAuth",
          // Uma rodada cheia são até 10 chamadas ao modelo; o teto é o mesmo
          // maxDuration da rota. A rodada seguinte recomeça de onde parou.
          options: { timeout: 300000, response: { response: { neverError: true } } },
        },
        credentials: { httpHeaderAuth: { id: credencialId, name: "Chroma · CRM (token de serviço)" } },
      },
    ],
    connections: { [gatilho]: { main: [[{ node: chamar, type: "main", index: 0 }]] } },
  };
}

/**
 * Deixa o agendador existindo e ligado. Idempotente: já existindo, só liga se
 * estiver desligado — não cria um segundo (duas rodadas ao mesmo tempo só
 * esbarrariam na trava, mas não há por que ter dois).
 */
export async function garantirAgendadorDeRetomada(crmBaseUrl: string): Promise<void> {
  const existente = await acharWorkflowPorNome(NOME_AGENDADOR);
  if (existente) {
    if (!existente.active) await ativarWorkflow(existente.id);
    return;
  }
  const credencial = await garantirCredencialDoCrm();
  const id = await criarWorkflow(montarAgendador(crmBaseUrl, credencial.id));
  await ativarWorkflow(id);
}
