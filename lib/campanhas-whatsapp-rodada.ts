// A RODADA do motor das campanhas em blocos (lib/campanhas-whatsapp.ts explica
// o motor inteiro): a fila que o /processar anda, a reserva de cada execução, o
// percurso bloco a bloco até uma espera, a entrada do "Aguardar resposta" e as
// execuções presas. Os blocos que mandam mensagem moram em
// lib/campanhas-whatsapp-envios.ts, as ações em lib/campanhas-whatsapp-acoes.ts
// e Condição, Horário e Permissão de passagem em lib/campanhas-whatsapp-controle.ts.
// Dividido do motor em 2026-10-28. O empate na fila sai pela ordem de inscrição
// (a Permissão de passagem põe quem espera na mesma hora).
import "server-only";
import { sql } from "@/lib/db";
import { soDigitos } from "@/lib/telefone";
import { ehUuid } from "@/lib/validacao";
import { ehDescadastro, LIMITES_FLUXO, saidaDaResposta, type BlocoCampanha, type Destino, type FluxoCampanha } from "@/lib/campanhas-fluxo";
import { lerDefinicao } from "@/lib/campanhas-fluxo-entrada";
import {
  ADIAR_MINUTOS,
  concluir,
  ehBloco,
  estacionar,
  evento,
  eventoBloco,
  falhar,
  FOLGA_RELOGIO_MS,
  jaComecou,
  motivo,
  MOTIVO_PRESA,
  PAROU,
  RESERVA,
  respostaRepetida,
  segue,
  type Efeitos,
  type Execucao,
  type Passo,
} from "@/lib/campanhas-whatsapp-base";
import { enviarArquivo, enviarTemplate, enviarTexto, novaRodada, type Rodada } from "@/lib/campanhas-whatsapp-envios";
import { executarAcao, type Resultado } from "@/lib/campanhas-whatsapp-acoes";
import { executarCondicao, executarHorario, executarPassagem } from "@/lib/campanhas-whatsapp-controle";
import { atualizarTotais } from "@/lib/campanhas-whatsapp-totais";

/**
 * Outra execução do mesmo contato, no mesmo número, está FALANDO com ele:
 * aguardando resposta, rodando agora ou em andamento (inclusive parada num
 * "Esperar"). Só de campanha ativa ou pausada: a de outro estado não volta a
 * andar e prenderia o contato para sempre. Fragmento com os aliases `e` (a
 * execução) e `cw` (a campanha dela).
 */
const outraFalandoNoNumero = (db: typeof sql) => db`EXISTS (
  SELECT 1 FROM campanha_whatsapp_execucoes x
    JOIN campanhas_whatsapp cx ON cx.id = x.campanha_id
   WHERE x.contato_id = e.contato_id AND x.id <> e.id
     AND x.estado IN ('aguardando_resposta', 'enviando', 'em_andamento')
     AND cx.status IN ('ativa', 'pausada')
     AND cx.telefone_id = cw.telefone_id)`;

/**
 * Roda a fila: as inscritas (na_fila) e as que têm hora de continuar
 * (em_andamento vencidas). Teto por chamada: `limite` execuções e `prazoMs`
 * (para caber no tempo da função); o resto fica para a próxima. A inscrita só
 * começa quando nenhuma outra campanha está falando com o contato no mesmo
 * número (ver o cabeçalho).
 */
export async function processarFila(limite = 50, campanhaId?: string, prazoMs = 45_000) {
  const comeco = Date.now();
  const ids = (await sql`
    SELECT e.id FROM campanha_whatsapp_execucoes e
      JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
     WHERE cw.status = 'ativa'
       AND (${campanhaId ?? null}::uuid IS NULL OR cw.id = ${campanhaId ?? null}::uuid)
       AND ((e.estado = 'em_andamento' AND e.prazo_resposta <= now())
         OR (e.estado = 'na_fila' AND NOT ${outraFalandoNoNumero(sql)}))
     ORDER BY COALESCE(e.prazo_resposta, e.data_criacao), e.data_criacao
     LIMIT ${limite}`) as Array<{ id: string }>;
  const rodada = novaRodada();
  let executadas = 0;
  for (const { id } of ids) {
    if (Date.now() - comeco > prazoMs) break;
    if (!(await reservar(id))) continue;
    await executarReservada(id, rodada);
    executadas++;
  }
  await atualizarTotais();
  return { encontrados: ids.length, executadas };
}

/** Continua UMA execução já com hora (a que acabou de receber resposta). O webhook chama depois de responder à Meta. */
export async function avancarExecucao(id: string): Promise<Efeitos> {
  if (!ehUuid(id) || !(await reservar(id))) return { ligouIa: false };
  return executarReservada(id, novaRodada());
}

/**
 * Reserva com UPDATE … RETURNING: duas rodadas ao mesmo tempo (o n8n a cada
 * minuto, a criação, o webhook) nunca andam a mesma execução — sem isto, a
 * mensagem oficial saía em dobro. A segunda espera a trava da linha e, relida,
 * já não está na fila.
 *
 * Duas execuções DIFERENTES do mesmo contato no mesmo número (campanhas
 * diferentes, rodadas diferentes) não se travam pela linha: por isso a reserva
 * corre sob pg_advisory_xact_lock do par contato+número. A segunda espera a
 * primeira terminar a transação e, quando lê, já a vê 'enviando'.
 */
async function reservar(id: string): Promise<boolean> {
  return sql.begin(async (tx: typeof sql) => {
    const [par] = (await tx`
      SELECT e.contato_id::text AS contato, cw.telefone_id
        FROM campanha_whatsapp_execucoes e JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
       WHERE e.id = ${id}::uuid`) as unknown as Array<{ contato: string; telefone_id: string }>;
    if (!par) return false;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${par.contato}|${par.telefone_id}`}::text))`;
    const [r] = await tx`
      UPDATE campanha_whatsapp_execucoes e
         SET estado = 'enviando', prazo_resposta = now() + ${RESERVA}::interval
        FROM campanhas_whatsapp cw
       WHERE e.id = ${id}::uuid AND cw.id = e.campanha_id AND cw.status = 'ativa'
         AND ((e.estado = 'em_andamento' AND e.prazo_resposta <= now())
           OR (e.estado = 'na_fila' AND NOT ${outraFalandoNoNumero(tx)}))
      RETURNING e.id`;
    return !!r;
  });
}

async function carregar(id: string): Promise<Execucao | null> {
  const [e] = (await sql`
    SELECT e.id, e.campanha_id, cw.nome AS campanha_nome, e.contato_id, e.bloco_atual,
           c.nome AS contato_nome, c.whatsapp, c.email, c.cidade,
           cw.telefone_id, cw.telefone_exibicao, cw.waba_id, cw.template_nome, cw.template_idioma, cw.definicao
      FROM campanha_whatsapp_execucoes e
      JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
      JOIN contatos c ON c.id = e.contato_id
     WHERE e.id = ${id}::uuid`) as Execucao[];
  return e ?? null;
}

async function executarReservada(id: string, rodada: Rodada): Promise<Efeitos> {
  const efeitos: Efeitos = { ligouIa: false };
  const e = await carregar(id);
  if (!e) return efeitos;
  try {
    await percorrer(e, lerDefinicao(e.definicao, e), rodada, efeitos);
  } catch (erro) {
    console.error("[campanhas] execução", id, erro);
    await falhar(e, null, `Erro inesperado: ${motivo(erro)}`);
  }
  return efeitos;
}

/**
 * Anda a execução bloco a bloco até um bloco de espera, o fim ou uma falha. Até
 * LIMITES_FLUXO.passosPorRodada blocos imediatos: passou disso, falha (não
 * continua na próxima). Antes de cada bloco, a campanha ainda tem de estar
 * ativa: pausada no meio, a execução estaciona onde está.
 */
async function percorrer(e: Execucao, fluxo: FluxoCampanha, rodada: Rodada, efeitos: Efeitos) {
  if (!Object.keys(fluxo.blocos).length) return falhar(e, null, "A definição da campanha não pôde ser lida.");
  let id: Destino = e.bloco_atual ?? fluxo.inicio;
  // De volta a um "Esperar" que já começou: a espera acabou, segue pelo próximo.
  if (id && ehBloco(fluxo, id)) {
    const b = fluxo.blocos[id];
    if (b.tipo === "esperar" && (await jaComecou(e, id))) {
      await eventoBloco(e, id, b, { saida: "proximo", ok: true });
      id = b.proximo;
    }
  }
  for (let passos = 0; ; passos++) {
    if (id === null) return concluir(e);
    if (!ehBloco(fluxo, id)) return falhar(e, null, "O fluxo aponta para um bloco que não existe mais.");
    const b = fluxo.blocos[id];
    if (passos >= LIMITES_FLUXO.passosPorRodada)
      return falhar(e, { id, b }, `Passou de ${LIMITES_FLUXO.passosPorRodada} blocos seguidos sem espera.`);
    const situacao = await podeSeguir(e);
    if (situacao === "parar") return;
    if (situacao === "pausada") return estacionar(e, id, 0);
    const passo = await executarBloco(e, id, b, rodada, efeitos);
    if (passo.tipo === "parou") return;
    id = passo.destino;
  }
}

async function executarBloco(e: Execucao, id: string, b: BlocoCampanha, rodada: Rodada, efeitos: Efeitos): Promise<Passo> {
  switch (b.tipo) {
    case "enviar_template":
      return enviarTemplate(e, id, b, rodada);
    case "enviar_texto":
      return enviarTexto(e, id, b);
    case "enviar_arquivo":
      return enviarArquivo(e, id, b);
    case "condicao":
      return executarCondicao(e, id, b);
    case "horario":
      return executarHorario(e, id, b);
    case "limitar_passagem":
      return executarPassagem(e, id, b);
    case "aguardar_resposta": {
      // Outra campanha já aguarda este contato neste número (execução de antes
      // da trava, ou corrida): espera a vez em vez de disputar a resposta.
      if (await outraAguardandoNoNumero(e)) {
        await evento(e.campanha_id, e.id, "adiado", { bloco: id, motivo: "Outra campanha aguarda a resposta deste contato neste número." });
        await estacionar(e, id, ADIAR_MINUTOS);
        return PAROU;
      }
      await eventoBloco(e, id, b, { ok: true });
      // A resposta que chegou enquanto esta rodada enviava não teve dono no
      // webhook: vale aqui, uma vez só.
      const adiantada = await respostaAdiantada(e);
      if (adiantada) {
        const saida = ehDescadastro(adiantada.texto)
          ? { saidaId: "descadastro", destino: null }
          : saidaDaResposta(b, { texto: adiantada.texto, botao: adiantada.texto });
        if (await gravarRespostaAdiantada(e, saida.saidaId, adiantada.id)) {
          await eventoBloco(e, id, b, { saida: saida.saidaId, ok: true });
          return segue(saida.destino);
        }
      }
      await sql`
        UPDATE campanha_whatsapp_execucoes
           SET estado = 'aguardando_resposta', bloco_atual = ${id},
               prazo_resposta = now() + make_interval(mins => ${b.prazo_minutos}::int)
         WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
      return PAROU;
    }
    case "esperar":
      await eventoBloco(e, id, b, { ok: true });
      await estacionar(e, id, b.minutos);
      return PAROU;
    default: {
      let r: Resultado;
      try {
        r = await executarAcao(e, b, efeitos);
      } catch (erro) {
        console.error("[campanhas] bloco", id, "da execução", e.id, erro);
        r = { ok: false, erro: motivo(erro) };
      }
      // Ação que falhou fica registrada e o contato segue: era assim no formato
      // antigo, e travar o fluxo por uma tag apagada deixaria o resto sem rodar.
      await eventoBloco(e, id, b, { saida: "proximo", ...r });
      return segue(b.proximo);
    }
  }
}

/**
 * Antes de cada bloco: a campanha ainda está ativa e a execução ainda é desta
 * rodada. 'parar' = alguém a encerrou no meio (o descadastro conclui todas as
 * do contato no número, inclusive a que está enviando): não roda mais nada.
 */
async function podeSeguir(e: Execucao): Promise<"segue" | "pausada" | "parar"> {
  const [c] = (await sql`
    SELECT cw.status, x.estado FROM campanha_whatsapp_execucoes x JOIN campanhas_whatsapp cw ON cw.id = x.campanha_id
     WHERE x.id = ${e.id}::uuid`) as unknown as Array<{ status: string; estado: string }>;
  if (!c || c.estado !== "enviando") return "parar";
  return c.status === "ativa" ? "segue" : "pausada";
}

/** Outra execução do contato já aguarda resposta neste número (a entrada do Aguardar confere de novo). */
async function outraAguardandoNoNumero(e: Execucao): Promise<boolean> {
  const [r] = await sql`
    SELECT 1 FROM campanha_whatsapp_execucoes x JOIN campanhas_whatsapp cx ON cx.id = x.campanha_id
     WHERE x.contato_id = ${e.contato_id}::uuid AND x.id <> ${e.id}::uuid
       AND x.estado = 'aguardando_resposta' AND cx.status IN ('ativa', 'pausada')
       AND cx.telefone_id = ${e.telefone_id}
     LIMIT 1`;
  return !!r;
}

/**
 * A mensagem do contato que chegou NESTA rodada, depois do último envio da
 * execução, e que nenhuma execução consumiu: o webhook a viu com a execução
 * 'enviando' e não tinha a quem entregar. Só desde o começo da reserva
 * (prazo_resposta − 15 min): a conversa de antes, num "Esperar" por exemplo,
 * não vira resposta do Aguardar. Pela conversa do número da campanha, com a
 * mesma folga de relógio do webhook. Botão e texto chegam iguais na conversa:
 * o texto do botão vale como clique.
 */
async function respostaAdiantada(e: Execucao): Promise<{ id: string; texto: string } | null> {
  const [m] = (await sql`
    SELECT m.id_externo AS id, m.texto FROM mensagens m
      JOIN atendimentos a ON a.id = m.atendimento_id
     WHERE a.contato_id = ${e.contato_id}::uuid AND a.canal = 'whatsapp_oficial'
       AND a.numero_instancia = ${soDigitos(e.telefone_exibicao)}
       AND m.origem = 'contato' AND m.id_externo IS NOT NULL
       AND m.data_criacao >= (SELECT max(ev.data_criacao) FROM campanha_whatsapp_eventos ev
                               WHERE ev.execucao_id = ${e.id}::uuid AND ev.tipo = 'enviando')
                             - make_interval(secs => ${FOLGA_RELOGIO_MS / 1000}::int)
       AND m.data_criacao >= (SELECT x.prazo_resposta - ${RESERVA}::interval FROM campanha_whatsapp_execucoes x
                               WHERE x.id = ${e.id}::uuid AND x.estado = 'enviando')
                             - make_interval(secs => ${FOLGA_RELOGIO_MS / 1000}::int)
       AND NOT EXISTS (SELECT 1 FROM campanha_whatsapp_execucoes x WHERE x.resposta_id = m.id_externo)
     ORDER BY m.data_criacao LIMIT 1`) as unknown as Array<{ id: string; texto: string }>;
  return m ?? null;
}

/** A saída da resposta adiantada, só se ela ainda não andou fluxo nenhum (índice único em resposta_id). */
async function gravarRespostaAdiantada(e: Execucao, saida: string, respostaId: string): Promise<boolean> {
  try {
    const [r] = await sql`
      UPDATE campanha_whatsapp_execucoes x
         SET resposta_saida = ${saida}, resposta_id = ${respostaId}, respondeu_em = now()
       WHERE x.id = ${e.id}::uuid AND x.estado = 'enviando'
         AND NOT EXISTS (SELECT 1 FROM campanha_whatsapp_execucoes y WHERE y.resposta_id = ${respostaId})
      RETURNING x.id`;
    return !!r;
  } catch (erro) {
    if (respostaRepetida(erro)) return false;
    throw erro;
  }
}

/**
 * 'enviando' além da reserva vira 'falhou'. A execução do formato antigo presa
 * em 'enviando' não tem reserva: o relógio dela começa na primeira vez que esta
 * função a vê (a instância antiga pode estar terminando o envio dela agora).
 */
export async function recuperarPresas(): Promise<{ presas: number }> {
  await sql`UPDATE campanha_whatsapp_execucoes SET prazo_resposta = now() + ${RESERVA}::interval
             WHERE estado = 'enviando' AND prazo_resposta IS NULL`;
  const presas = (await sql`
    UPDATE campanha_whatsapp_execucoes SET estado = 'falhou', erro = ${MOTIVO_PRESA}, finalizado_em = now()
     WHERE estado = 'enviando' AND prazo_resposta <= now()
    RETURNING id, campanha_id, bloco_atual`) as Array<{ id: string; campanha_id: string; bloco_atual: string | null }>;
  for (const p of presas) await evento(p.campanha_id, p.id, "falhou", { bloco: p.bloco_atual, erro: MOTIVO_PRESA });
  return { presas: presas.length };
}
