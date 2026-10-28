// O MOTOR das campanhas de WhatsApp oficial em blocos. O formato do fluxo, o
// catálogo e a validação são o contrato de lib/campanhas-fluxo.ts; o que chega
// para gravar, e a leitura do que está gravado, em lib/campanhas-fluxo-entrada.ts;
// a regra de cada envio, em lib/campanhas-fluxo-envios.ts. Aqui fica o que roda:
// a inscrição, a rodada que anda cada contato, a resposta que escolhe a saída,
// os prazos vencidos, os avisos à equipe, pausar/editar/retomar e as métricas.
//
// ESTADOS DE UMA EXECUÇÃO (campanha_whatsapp_execucoes):
//   na_fila             inscrita, ainda sem rodar (começa pelo início do fluxo)
//   enviando            RESERVADA por uma rodada; prazo_resposta = até quando
//                       vale a reserva (15 min). Presa além disso vira 'falhou'
//                       (recuperarPresas): nunca reenviar no escuro.
//   aguardando_resposta parada num "Aguardar resposta" até responder ou vencer
//   em_andamento        bloco_atual roda quando prazo_resposta chegar: depois de
//                       uma resposta (prazo = agora), estacionada por pausa, ou
//                       parada num "Esperar" (ver jaComecou)
//   concluida, falhou   finais; 'respondeu' e 'expirou' são do formato antigo
//
// EXECUÇÃO DO FORMATO ANTIGO não tem bloco_atual: vale pelo estado — na fila vai
// pelo início (que no fluxo convertido É o envio), 'enviando' é envio
// interrompido (falha, não reenvia) e aguardando é o bloco ID_AGUARDAR_ANTIGO.
// Nunca recomeça do início: reenviaria o template a quem já recebeu.
//
// CADA BLOCO deixa um evento 'bloco' {bloco, tipo, saida?, ok, erro?, wamid?}
// com frase fixa — nunca o texto que o contato escreveu: o histórico de
// campanha vai ao MCP e às IAs. Sem laço no fluxo (contrato), cada bloco roda no
// máximo uma vez por execução: é o evento que diz se um envio já foi tentado e
// se um "Esperar" já começou. Por isso id que rodou não muda de tipo nem volta
// depois de apagado (travaDeIds, na edição).
//
// UMA CAMPANHA FALANDO POR CONTATO E NÚMERO (revisões de 2026-10-28): a
// execução na fila não começa enquanto outra do mesmo contato, no mesmo
// telefone_id, estiver aguardando, rodando ou em andamento (num "Esperar",
// inclusive); a reserva roda sob pg_advisory_xact_lock do par contato+número,
// e a entrada do "Aguardar resposta" confere de novo. Sem isso a resposta da
// pessoa não teria dono certo.
//
// INSCRIÇÃO SEM TETO: ativar e retomar inscrevem TODO contato com WhatsApp dos
// segmentos numa instrução (inscreverDosSegmentos); o gatilho do banco inscreve
// quem entra depois, enquanto a campanha está ativa. A vazão é a da rodada: até
// 100 execuções e 45 s por chamada do /processar, uma por minuto por campanha.
//
// PAUSADA: nada anda (cada bloco confere que a campanha está ativa). A resposta
// que chega durante a pausa grava a saída e espera a retomada.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import { enviarTemplateMeta, telefonesMeta, templatesMeta, type TemplateMeta } from "@/lib/meta";
import { registrarEnvioOficial, textoDoTemplate, type MensagemRecebida } from "@/lib/whatsapp-oficial";
import { eventoAoEntrarNaEtapa } from "@/lib/meta-eventos";
import { moverOportunidadeDeEtapa } from "@/lib/mover-etapa";
import { enviarTextoNaConversa } from "@/lib/conversa-envio";
import { gravarIaDoContato } from "@/lib/ia/contato-ia";
import { avisarEquipeNoWhatsApp, type LinhaDoAviso } from "@/lib/aviso-equipe-whatsapp";
import { registrarSegmento, registrarTag } from "@/lib/historico";
import { chaveTelefone, soDigitos } from "@/lib/telefone";
import { ehUuid } from "@/lib/validacao";
import {
  ajustarValores,
  componentesDoEnvio,
  DADOS_NA_CAMPANHA,
  dadosDoContato,
  lerTemplate,
  linksVariaveisDe,
  problemaNoEnvio,
  valoresParaContato,
  variaveisDoTemplate,
  type DadosDoContato,
} from "@/lib/templates-whatsapp";
import {
  ehDescadastro,
  ID_AGUARDAR_ANTIGO,
  ID_ENVIO_ANTIGO,
  LIMITES_FLUXO,
  primeiroTemplate,
  saidaDaResposta,
  type BlocoCampanha,
  type Destino,
  type FluxoCampanha,
  type ProblemaDoFluxo,
} from "@/lib/campanhas-fluxo";
import { fluxoGravado, lerDefinicao, travaDeIds, type Coluna } from "@/lib/campanhas-fluxo-entrada";
import { campanhaFalaAntesDeEsperar } from "@/lib/campanhas-fluxo-envios";

// ── Definição ───────────────────────────────────────────────────────────────

/** O template das colunas da campanha (listas, ficha do contato): o primeiro pelo início, senão qualquer um do fluxo. */
export function templateDaCampanha(f: FluxoCampanha): { template_nome: string; template_idioma: string } {
  const primeiro = primeiroTemplate(f);
  if (primeiro) return primeiro;
  for (const b of Object.values(f.blocos)) {
    if (b.tipo === "enviar_template") return { template_nome: b.template_nome, template_idioma: b.template_idioma };
  }
  return { template_nome: "", template_idioma: "pt_BR" };
}

/**
 * O número que envia, conferido na conta: o id vem do navegador ou da IA e
 * entra no caminho da Graph. O nome exibido sai da Meta, não de quem pediu —
 * senão a tela mostraria um número e a campanha sairia por outro.
 */
export async function numeroDaConta(wabaId: string, telefoneId: string) {
  return (await telefonesMeta(wabaId)).find((t) => t.id === telefoneId) ?? null;
}

// ── Inscrição ───────────────────────────────────────────────────────────────

/**
 * Inscreve TODO contato com WhatsApp dos segmentos da campanha, numa instrução
 * (revisões de 2026-10-28: antes eram os 250 primeiros por nome, e ninguém
 * inscrevia o resto). Quem já tem execução nesta campanha fica de fora (UNIQUE
 * campanha+contato): serve à ativação e à retomada, que pega quem entrou no
 * segmento durante a pausa (o gatilho do banco só inscreve em campanha ativa).
 * Devolve quantos entraram agora.
 */
export async function inscreverDosSegmentos(db: typeof sql, campanhaId: string): Promise<number> {
  const novas = await db`
    INSERT INTO campanha_whatsapp_execucoes (campanha_id, contato_id)
    SELECT DISTINCT ${campanhaId}::uuid, c.id
      FROM campanha_whatsapp_segmentos cws
      JOIN contato_segmentos cs ON cs.segmento_id = cws.segmento_id
      JOIN contatos c ON c.id = cs.contato_id
     WHERE cws.campanha_id = ${campanhaId}::uuid AND c.whatsapp IS NOT NULL
    ON CONFLICT (campanha_id, contato_id) DO NOTHING
    RETURNING 1`;
  return novas.length;
}

/** Quantos contatos com WhatsApp há nos segmentos: os da campanha, ou os escolhidos antes de ela existir. */
export async function contatosNosSegmentos(de: { campanhaId: string } | { segmentoIds: string[] }): Promise<number> {
  const [r] =
    "campanhaId" in de
      ? await sql`
          SELECT count(DISTINCT c.id)::int AS n FROM campanha_whatsapp_segmentos cws
            JOIN contato_segmentos cs ON cs.segmento_id = cws.segmento_id
            JOIN contatos c ON c.id = cs.contato_id
           WHERE cws.campanha_id = ${de.campanhaId}::uuid AND c.whatsapp IS NOT NULL`
      : await sql`
          SELECT count(DISTINCT c.id)::int AS n FROM contato_segmentos cs
            JOIN contatos c ON c.id = cs.contato_id
           WHERE cs.segmento_id = ANY(string_to_array(${listaUuid(de.segmentoIds.filter(ehUuid))}, ',')::uuid[])
             AND c.whatsapp IS NOT NULL`;
  return (r?.n as number) ?? 0;
}

// ── Eventos ─────────────────────────────────────────────────────────────────

type Detalhe = Record<string, unknown>;

async function evento(campanhaId: string, execucaoId: string | null, tipo: string, detalhe: Detalhe = {}) {
  await sql`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
            VALUES (${campanhaId}::uuid, ${execucaoId}::uuid, ${tipo}, ${sql.json(detalhe as never)})`;
}

/** Quem criou, ativou, pausou, retomou ou editou: o motor roda sem sessão, a autoria fica aqui. */
export async function registrarNaCampanha(
  campanhaId: string,
  tipo: "campanha_criada" | "campanha_ativada" | "campanha_pausada" | "campanha_retomada" | "campanha_editada",
  usuarioId: string,
  extra: Detalhe = {},
) {
  await evento(campanhaId, null, tipo, { usuario: usuarioId, ...extra });
}

// ── Rodada ──────────────────────────────────────────────────────────────────

type Execucao = {
  id: string;
  campanha_id: string;
  campanha_nome: string;
  contato_id: string;
  bloco_atual: string | null;
  contato_nome: string;
  whatsapp: string | null;
  email: string | null;
  cidade: string | null;
  telefone_id: string;
  telefone_exibicao: string;
  waba_id: string;
  template_nome: string;
  template_idioma: string;
  definicao: unknown;
};

/** Os templates de cada conta, lidos uma vez por rodada e só se algum bloco enviar. null = a Meta não respondeu. */
type Rodada = { templates: (waba: string) => Promise<Map<string, TemplateMeta> | null> };

function novaRodada(): Rodada {
  const lidos = new Map<string, Promise<Map<string, TemplateMeta> | null>>();
  return {
    templates(waba) {
      if (!lidos.has(waba)) {
        lidos.set(
          waba,
          templatesMeta(waba).then(
            (lista) => new Map(lista.map((t) => [`${t.name}|${t.language}`, t])),
            (e: unknown) => {
              console.error("[campanhas] não li os templates da WABA", waba, e);
              return null;
            },
          ),
        );
      }
      return lidos.get(waba)!;
    },
  };
}

/** O que a rodada fez que importa a quem chamou: o webhook só deixa a IA responder a mensagem consumida se o fluxo a ligou. */
type Efeitos = { ligouIa: boolean };

type Passo = { tipo: "segue"; destino: Destino } | { tipo: "parou" };
const segue = (destino: Destino): Passo => ({ tipo: "segue", destino });
const PAROU: Passo = { tipo: "parou" };

const RESERVA = "15 minutes";
const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const ehBloco = (f: FluxoCampanha, id: string) => Object.hasOwn(f.blocos, id);
const dadosDe = (e: Execucao): DadosDoContato =>
  dadosDoContato({ nome: e.contato_nome, whatsapp: e.whatsapp, email: e.email, cidade: e.cidade });

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
     ORDER BY COALESCE(e.prazo_resposta, e.data_criacao)
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

async function eventoBloco(e: Execucao, id: string, b: BlocoCampanha, r: { saida?: string; ok: boolean; erro?: string; wamid?: string | null }) {
  await evento(e.campanha_id, e.id, "bloco", { bloco: id, tipo: b.tipo, ...r });
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

/** 23505 no índice único de resposta_id: a mesma mensagem já andou outro fluxo (corrida com o webhook). */
const respostaRepetida = (e: unknown) => (e as { code?: string })?.code === "23505";

/** O bloco já rodou nesta execução (sem laço, só uma vez): é o que separa "chegou ao Esperar" de "a espera acabou". */
async function jaComecou(e: Execucao, id: string): Promise<boolean> {
  const [r] = await sql`
    SELECT 1 FROM campanha_whatsapp_eventos
     WHERE campanha_id = ${e.campanha_id}::uuid AND execucao_id = ${e.id}::uuid
       AND tipo = 'bloco' AND detalhe->>'bloco' = ${id}
     LIMIT 1`;
  return !!r;
}

/** Um envio deste bloco já foi tentado? 'resolvida' = tem o evento do bloco (deu certo ou foi registrado); 'sem_confirmacao' = começou e não voltou. */
async function tentativaAnterior(e: Execucao, id: string): Promise<"nenhuma" | "resolvida" | "sem_confirmacao"> {
  const [r] = await sql`
    SELECT bool_or(tipo = 'enviando') AS tentou, bool_or(tipo = 'bloco') AS resolveu
      FROM campanha_whatsapp_eventos
     WHERE campanha_id = ${e.campanha_id}::uuid AND execucao_id = ${e.id}::uuid
       AND tipo IN ('enviando', 'bloco') AND detalhe->>'bloco' = ${id}`;
  if (r?.resolveu) return "resolvida";
  return r?.tentou ? "sem_confirmacao" : "nenhuma";
}

const SEM_CONFIRMACAO = "O envio anterior deste bloco não voltou confirmado: não reenviado, para não mandar em dobro.";

async function concluir(e: Execucao) {
  await sql`
    UPDATE campanha_whatsapp_execucoes
       SET estado = 'concluida', bloco_atual = NULL, prazo_resposta = NULL, finalizado_em = now()
     WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
}

async function falhar(e: Execucao, onde: { id: string; b: BlocoCampanha } | null, erro: string) {
  await sql`
    UPDATE campanha_whatsapp_execucoes
       SET estado = 'falhou', erro = ${erro}, bloco_atual = COALESCE(${onde?.id ?? null}, bloco_atual),
           prazo_resposta = NULL, finalizado_em = now()
     WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
  if (onde) await eventoBloco(e, onde.id, onde.b, { ok: false, erro });
  else await evento(e.campanha_id, e.id, "falhou", { erro });
}

/** Para em `id` e volta a rodar em `minutos` (0 = na próxima rodada, se a campanha estiver ativa). */
async function estacionar(e: Execucao, id: string, minutos: number) {
  await sql`
    UPDATE campanha_whatsapp_execucoes
       SET estado = 'em_andamento', bloco_atual = ${id},
           prazo_resposta = now() + make_interval(mins => ${minutos}::int)
     WHERE id = ${e.id}::uuid AND estado = 'enviando'`;
}

// ── Envios ──────────────────────────────────────────────────────────────────

/** O payload dos botões de resposta rápida: diz de qual execução é o clique, sem expor nada. */
export const payloadDoBotao = (execucaoId: string, blocoId: string) => `cw:${execucaoId}:${blocoId}`;
const PAYLOAD = /^cw:([0-9a-f-]{36}):([a-z0-9_-]{1,40})$/;

const ADIAR_MINUTOS = 10;

async function enviarTemplate(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "enviar_template" }>, rodada: Rodada): Promise<Passo> {
  const recusar = async (erro: string) => {
    await falhar(e, { id, b }, erro);
    return PAROU;
  };
  const anterior = await tentativaAnterior(e, id);
  if (anterior === "resolvida") return segue(b.proximo);
  if (anterior === "sem_confirmacao") return recusar(SEM_CONFIRMACAO);

  const templates = await rodada.templates(e.waba_id);
  if (!templates) {
    // A Meta fora do ar não é motivo para perder o contato: tenta de novo daqui a pouco.
    await evento(e.campanha_id, e.id, "adiado", { bloco: id, motivo: "Os templates da Meta não responderam." });
    await estacionar(e, id, ADIAR_MINUTOS);
    return PAROU;
  }
  const t = templates.get(`${b.template_nome}|${b.template_idioma}`);
  if (!t || t.status !== "APPROVED") return recusar("O template não está aprovado na Meta.");
  const lido = lerTemplate(t);
  // De novo no disparo: a campanha inscreve gente do segmento por semanas, e o
  // template pode ter mudado na Meta desde a ativação.
  const problema = problemaNoEnvio(lido, b.variaveis);
  if (problema) return recusar(problema);
  if (!e.whatsapp) return recusar("Contato sem WhatsApp.");
  // As marcas ({{primeiro_nome}}…) viram os dados DESTE contato, saneados.
  // Faltando um, a execução falha aqui com o motivo, sem ir à Meta.
  const valores = valoresParaContato(ajustarValores(b.variaveis, variaveisDoTemplate(lido)), dadosDe(e));
  if ("falta" in valores) return recusar(`Contato sem ${valores.falta}.`);
  const botoes = {
    links: linksVariaveisDe(lido).map((l) => ({ indice: l.indice, valor: valores.botoes?.[l.indice] ?? "" })),
    // O índice é a posição entre TODOS os botões do template, como a Graph pede.
    respostas: lido.botoes.flatMap((x, indice) => (x.tipo === "QUICK_REPLY" ? [{ indice, payload: payloadDoBotao(e.id, id) }] : [])),
  };

  await evento(e.campanha_id, e.id, "enviando", { bloco: id });
  let wamid: string | null;
  try {
    const r = await enviarTemplateMeta(e.telefone_id, {
      to: e.whatsapp,
      name: b.template_nome,
      language: b.template_idioma,
      components: componentesDoEnvio(valores, botoes),
    });
    wamid = r.messages?.[0]?.id ?? null;
  } catch (erro) {
    return recusar(motivo(erro));
  }
  await sql`UPDATE campanha_whatsapp_execucoes SET mensagem_id_meta = ${wamid}, enviado_em = now() WHERE id = ${e.id}::uuid`;
  await eventoBloco(e, id, b, { saida: "proximo", ok: true, wamid });
  // A mensagem entra na conversa do contato no canal oficial — sem isto o
  // /chat mostraria só a resposta, sem o que a campanha mandou.
  await registrarEnvioOficial({
    contatoId: e.contato_id,
    numeroCanal: e.telefone_exibicao,
    texto: textoDoTemplate(t.components, valores) || `Template "${b.template_nome}"`,
    wamid,
    enviadaPor: "automacao",
  });
  return segue(b.proximo);
}

type Conversa = { id: string; responsavel_id: string | null; status: string };

/** A conversa do contato no número da campanha: é nela que o texto sai e é o link do aviso. */
async function conversaOficial(e: Execucao): Promise<Conversa | null> {
  const [a] = (await sql`
    SELECT id, responsavel_id, status FROM atendimentos
     WHERE contato_id = ${e.contato_id}::uuid AND canal = 'whatsapp_oficial'
       AND numero_instancia = ${soDigitos(e.telefone_exibicao)}
     LIMIT 1`) as Conversa[];
  return a ?? null;
}

/** Alguém da equipe assumiu a conversa: a campanha não fala por cima nem liga a IA. */
const temGente = (c: Conversa) => c.responsavel_id !== null && c.status !== "encerrado";

/** O texto com as marcas da campanha trocadas pelos dados do contato. Faltando um, nada sai. */
function textoParaContato(texto: string, dados: DadosDoContato): string | { falta: string } {
  let falta: string | null = null;
  const pronto = texto.replace(/\{\{([a-z_]+)\}\}/g, (bruto, chave: string) => {
    const dado = DADOS_NA_CAMPANHA.find((d) => d.chave === chave);
    if (!dado) {
      falta ??= `um dado para ${bruto}`;
      return bruto;
    }
    if (!dados[dado.chave]) falta ??= dado.rotulo.toLowerCase();
    return dados[dado.chave];
  });
  return falta ? { falta } : pronto.trim();
}

/**
 * Texto livre pela conversa (lib/conversa-envio.ts: janela de 24h real, linha
 * pendente antes, o canal da conversa). Não sair não para o fluxo: o bloco fica
 * registrado como não enviado e o contato segue.
 */
async function enviarTexto(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "enviar_texto" }>): Promise<Passo> {
  const pular = async (erro: string) => {
    await eventoBloco(e, id, b, { saida: "proximo", ok: false, erro });
    return segue(b.proximo);
  };
  const anterior = await tentativaAnterior(e, id);
  if (anterior === "resolvida") return segue(b.proximo);
  if (anterior === "sem_confirmacao") {
    await falhar(e, { id, b }, SEM_CONFIRMACAO);
    return PAROU;
  }
  const conversa = await conversaOficial(e);
  if (!conversa) return pular("Sem conversa no número da campanha.");
  if (temGente(conversa)) return pular("A conversa está com alguém da equipe: texto não enviado.");
  const texto = textoParaContato(b.texto, dadosDe(e));
  if (typeof texto !== "string") return pular(`Contato sem ${texto.falta}.`);

  await evento(e.campanha_id, e.id, "enviando", { bloco: id });
  const r = await enviarTextoNaConversa({ atendimentoId: conversa.id, texto, autorId: null, enviadaPor: "automacao" });
  if (r.erro) {
    await eventoBloco(e, id, b, { saida: "proximo", ok: false, erro: r.erro });
    return segue(b.proximo);
  }
  // O wamid vai no evento: quem responder citando este texto casa com a
  // execução (alvoDaResposta, citação). O envio guarda o id na linha da conversa.
  const [m] = r.mensagemId ? await sql`SELECT id_externo FROM mensagens WHERE id = ${r.mensagemId}::uuid` : [];
  await eventoBloco(e, id, b, { saida: "proximo", ok: true, wamid: (m?.id_externo as string | null) ?? null });
  return segue(b.proximo);
}

// ── Ações ───────────────────────────────────────────────────────────────────

type Acao = Extract<
  BlocoCampanha,
  { tipo: "mudar_tag" | "mudar_segmento" | "criar_oportunidade" | "mover_oportunidade" | "registrar_conversao" | "avisar_equipe" | "ligar_ia" }
>;
type Resultado = { ok: boolean; erro?: string };
const OK: Resultado = { ok: true };

async function executarAcao(e: Execucao, b: Acao, efeitos: Efeitos): Promise<Resultado> {
  switch (b.tipo) {
    case "mudar_tag": {
      if (b.acao === "adicionar") {
        const r = await sql`INSERT INTO contato_tags (contato_id, tag_id) VALUES (${e.contato_id}::uuid, ${b.tagId}::uuid)
                            ON CONFLICT DO NOTHING RETURNING tag_id`;
        if (r.length) await registrarTag(e.contato_id, b.tagId, "adicionada");
      } else {
        const r = await sql`DELETE FROM contato_tags WHERE contato_id = ${e.contato_id}::uuid AND tag_id = ${b.tagId}::uuid RETURNING tag_id`;
        if (r.length) await registrarTag(e.contato_id, b.tagId, "removida");
      }
      return OK;
    }
    case "mudar_segmento": {
      // Entrar num segmento pode inscrever o contato em OUTRA campanha ativa
      // dele (gatilho de migration-campanhas-whatsapp-segmentos-n8n.sql).
      if (b.acao === "adicionar") {
        const r = await sql`INSERT INTO contato_segmentos (contato_id, segmento_id) VALUES (${e.contato_id}::uuid, ${b.segmentoId}::uuid)
                            ON CONFLICT DO NOTHING RETURNING segmento_id`;
        if (r.length) await registrarSegmento([e.contato_id], b.segmentoId);
      } else {
        await sql`DELETE FROM contato_segmentos WHERE contato_id = ${e.contato_id}::uuid AND segmento_id = ${b.segmentoId}::uuid`;
      }
      return OK;
    }
    case "criar_oportunidade": {
      const nome = b.nome.replaceAll("{{nome}}", e.contato_nome);
      const [op] = await sql`INSERT INTO oportunidades (nome, contato_id, valor, status, funil_id, etapa_id)
                             VALUES (${nome}, ${e.contato_id}::uuid, 0, 'aberta', ${b.funilId}::uuid, ${b.etapaId}::uuid)
                             RETURNING id`;
      // Nasceu dentro da etapa: evento da Meta dela, se configurado.
      eventoAoEntrarNaEtapa(op.id, b.etapaId);
      return OK;
    }
    case "mover_oportunidade": {
      const [op] = await sql`
        SELECT id FROM oportunidades
         WHERE contato_id = ${e.contato_id}::uuid AND funil_id = ${b.funilId}::uuid AND status = 'aberta'
         ORDER BY data_criacao DESC LIMIT 1`;
      if (!op) return { ok: false, erro: "Sem oportunidade aberta neste funil." };
      await moverOportunidadeDeEtapa(op.id as string, b.etapaId, b.funilId, ` pela campanha "${e.campanha_nome}"`);
      return OK;
    }
    case "registrar_conversao":
      await sql`UPDATE campanha_whatsapp_execucoes SET conversao = true WHERE id = ${e.id}::uuid`;
      return OK;
    case "ligar_ia": {
      const conversa = await conversaOficial(e);
      if (conversa && temGente(conversa)) return { ok: false, erro: "A conversa está com alguém da equipe: IA não ligada." };
      // Quem desligou à mão, ou escolheu outra IA, decidiu: a campanha não passa
      // por cima. A condição vai no próprio UPDATE (lib/ia/contato-ia.ts).
      const r = await gravarIaDoContato(e.contato_id, true, b.iaId, null, `pela campanha "${e.campanha_nome}"`, { respeitarEscolhaManual: true });
      if (r.erro) return { ok: false, erro: r.erro };
      efeitos.ligouIa = true;
      return OK;
    }
    case "avisar_equipe": {
      // Só ENFILEIRA: a rodada do /processar junta os avisos de cada pessoa numa
      // mensagem (enviarAvisosPendentes). Um por contato, uma campanha grande
      // viraria centenas de mensagens no celular de alguém.
      const ids = new Set(b.usuarioIds);
      if (b.responsavelDoFunil) {
        const [op] = await sql`
          SELECT responsavel_id FROM oportunidades
           WHERE contato_id = ${e.contato_id}::uuid AND funil_id = ${b.responsavelDoFunil}::uuid
             AND status = 'aberta' AND responsavel_id IS NOT NULL
           ORDER BY data_criacao DESC LIMIT 1`;
        if (op) ids.add(op.responsavel_id as string);
      }
      if (!ids.size) return { ok: false, erro: "Ninguém para avisar: sem responsável no funil." };
      const conversa = await conversaOficial(e);
      await evento(e.campanha_id, e.id, "aviso_pendente", {
        instanciaId: b.instanciaId,
        usuarioIds: [...ids],
        texto: b.texto,
        atendimentoId: conversa?.id ?? null,
      });
      return OK;
    }
  }
}

// ── Resposta do contato ─────────────────────────────────────────────────────

/** O que a Meta manda e não é a pessoa respondendo: reação, aviso de sistema, mensagem que sumiu. */
const NAO_E_RESPOSTA = new Set(["reaction", "system", "ephemeral"]);

/**
 * Toda mensagem NOVA anda campanha, menos reação, aviso de sistema e
 * temporária (revisões de 2026-10-28): áudio, foto e documento também são
 * resposta. Sem texto que case com botão ou palavra, a mídia sai por "outra".
 * Reentrega da Meta (nova = false) nunca anda.
 */
export function alimentaCampanha(m: Pick<MensagemRecebida, "nova" | "tipo">): boolean {
  return m.nova && !NAO_E_RESPOSTA.has(m.tipo);
}

type Alvo = {
  id: string;
  campanha_id: string;
  estado: string;
  bloco_atual: string | null;
  enviado_em: Date | string | null;
  status: string;
  telefone_id: string;
  whatsapp: string | null;
  definicao: unknown;
  template_nome: string;
  template_idioma: string;
};

const mesmoContato = (a: Alvo, numero: string) => !!a.whatsapp && chaveTelefone(a.whatsapp) === chaveTelefone(numero);

/**
 * De qual execução é esta resposta, nesta ordem:
 *   (a) o payload `cw:<execução>:<bloco>` do botão — vale só se a execução é
 *       DESTE contato e DESTE número da Meta. O clique só conta como BOTÃO se o
 *       bloco do payload é o último template que a execução mandou; clique num
 *       template anterior vale como texto no Aguardar atual (`comoBotao` false);
 *   (b) a mensagem citada (context.id) é um envio da execução (template ou
 *       texto), no mesmo número;
 *   (c) sem citação: a aguardando mais recente do contato naquele número.
 * Citou uma mensagem que não é de campanha: não cai no (c) — a pessoa
 * respondeu a outra coisa.
 */
async function alvoDaResposta(m: MensagemRecebida): Promise<(Alvo & { comoBotao: boolean }) | null> {
  const doBotao = PAYLOAD.exec(m.botaoPayload ?? "");
  if (doBotao && ehUuid(doBotao[1])) {
    const [a] = (await sql`
      SELECT e.id, e.campanha_id, e.estado, e.bloco_atual, e.enviado_em, cw.status, cw.telefone_id,
             c.whatsapp, cw.definicao, cw.template_nome, cw.template_idioma,
             (SELECT ev.detalhe->>'bloco' FROM campanha_whatsapp_eventos ev
               WHERE ev.execucao_id = e.id AND ev.tipo = 'bloco' AND ev.detalhe->>'tipo' = 'enviar_template'
                 AND (ev.detalhe->>'ok')::boolean
               ORDER BY ev.id DESC LIMIT 1) AS ultimo_template
        FROM campanha_whatsapp_execucoes e
        JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
        JOIN contatos c ON c.id = e.contato_id
       WHERE e.id = ${doBotao[1]}::uuid`) as Array<Alvo & { ultimo_template: string | null }>;
    if (!a || !mesmoContato(a, m.numero) || a.telefone_id !== m.phoneNumberId) return null;
    return { ...a, comoBotao: a.ultimo_template === doBotao[2] };
  }
  const fim8 = soDigitos(m.numero).slice(-8);
  if (fim8.length < 8 || !m.phoneNumberId) return null;
  const contexto = m.contextoId || null;
  const candidatas = (await sql`
    SELECT e.id, e.campanha_id, e.estado, e.bloco_atual, e.enviado_em, cw.status, cw.telefone_id,
           c.whatsapp, cw.definicao, cw.template_nome, cw.template_idioma
      FROM campanha_whatsapp_execucoes e
      JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
      JOIN contatos c ON c.id = e.contato_id
     WHERE cw.telefone_id = ${m.phoneNumberId}
       AND regexp_replace(c.whatsapp, '\\D', '', 'g') LIKE ${"%" + fim8}
       AND (${contexto}::text IS NOT NULL OR e.estado = 'aguardando_resposta')
       AND (${contexto}::text IS NULL OR e.mensagem_id_meta = ${contexto} OR EXISTS (
             SELECT 1 FROM campanha_whatsapp_eventos ev
              WHERE ev.campanha_id = e.campanha_id AND ev.execucao_id = e.id
                AND ev.tipo = 'bloco' AND ev.detalhe->>'wamid' = ${contexto}))
     ORDER BY e.enviado_em DESC NULLS LAST`) as Alvo[];
  const alvo = candidatas.find((a) => mesmoContato(a, m.numero));
  return alvo ? { ...alvo, comoBotao: true } : null;
}

/** Folga para o relógio da Meta e o nosso: a resposta vale a partir do envio que o bloco aguarda. */
const FOLGA_RELOGIO_MS = 5_000;
function depoisDoEnvio(timestamp: number | null, enviadoEm: Date | string | null): boolean {
  if (!enviadoEm || !timestamp) return true;
  return timestamp * 1000 >= new Date(enviadoEm).getTime() - FOLGA_RELOGIO_MS;
}

type Aguardar = Extract<BlocoCampanha, { tipo: "aguardar_resposta" }>;
const aguardarDe = (f: FluxoCampanha, id: string): Aguardar | null => {
  if (!ehBloco(f, id)) return null;
  const b = f.blocos[id];
  return b.tipo === "aguardar_resposta" ? b : null;
};

/**
 * Tira a execução do "Aguardar" pela saída escolhida, numa instrução só: só
 * sai quem ainda está aguardando NESTE bloco, e uma mensagem (resposta_id)
 * nunca anda o fluxo duas vezes (o índice único da migration segura a corrida:
 * a segunda instrução falha com 23505, e aqui vira "não saiu"). Campanha
 * PAUSADA também sai: grava a saída e espera a retomada, porque a fila só anda
 * campanha ativa (revisões de 2026-10-28). Destino null = fim.
 */
async function sairDoAguardar(execucaoId: string, blocoId: string, saida: string, destino: Destino, respostaId: string | null): Promise<boolean> {
  try {
    const [r] = await sql`
      UPDATE campanha_whatsapp_execucoes e
         SET resposta_saida = ${saida},
             resposta_id = COALESCE(${respostaId}::text, e.resposta_id),
             respondeu_em = CASE WHEN ${respostaId}::text IS NULL THEN e.respondeu_em ELSE now() END,
             bloco_atual = ${destino}::text,
             estado = CASE WHEN ${destino}::text IS NULL THEN 'concluida' ELSE 'em_andamento' END,
             prazo_resposta = CASE WHEN ${destino}::text IS NULL THEN NULL ELSE now() END,
             finalizado_em = CASE WHEN ${destino}::text IS NULL THEN now() ELSE NULL END
       WHERE e.id = ${execucaoId}::uuid
         AND e.estado = 'aguardando_resposta'
         AND COALESCE(e.bloco_atual, ${ID_AGUARDAR_ANTIGO}) = ${blocoId}
         AND EXISTS (SELECT 1 FROM campanhas_whatsapp cw WHERE cw.id = e.campanha_id AND cw.status IN ('ativa', 'pausada'))
         AND (${respostaId}::text IS NULL OR NOT EXISTS (
               SELECT 1 FROM campanha_whatsapp_execucoes x WHERE x.resposta_id = ${respostaId}::text))
      RETURNING e.id`;
    return !!r;
  } catch (erro) {
    if (respostaRepetida(erro)) return false;
    throw erro;
  }
}

export type RespostaDaCampanha =
  | { consumida: false }
  | {
      consumida: true;
      execucaoId: string;
      /** Andar agora (avancarExecucao): só com destino e campanha ativa. Pausada anda na retomada. */
      continuar: boolean;
      /** A IA de atendimento fica calada nesta mensagem: o caminho que ela tomou manda mensagem antes da próxima espera. */
      calaIa: boolean;
    };

/**
 * Uma mensagem recebida no número oficial. Se ela é a resposta que uma
 * execução aguarda, escolhe a saída (botão, palavra, outra; "sair" encerra) e
 * deixa a execução pronta para continuar — quem chama continua depois de
 * responder à Meta (avancarExecucao), e o /processar retoma se isso morrer.
 *
 * A IA de atendimento só fica calada se a campanha está falando
 * (campanhaFalaAntesDeEsperar, lib/campanhas-fluxo-envios.ts); "Passar para a
 * IA" entrega de qualquer jeito (o webhook olha o que a rodada ligou).
 *
 * DESCADASTRO ("sair", "parar"…): além de sair do Aguardar, encerra TODA
 * execução não final do contato naquele número, em qualquer campanha
 * (encerrarPorDescadastro), consumida ou não.
 */
export async function registrarResposta(m: MensagemRecebida): Promise<RespostaDaCampanha> {
  const nao: RespostaDaCampanha = { consumida: false };
  if (!alimentaCampanha(m) || !m.id || !m.phoneNumberId) return nao;
  const descadastro = ehDescadastro(m.texto);
  const r = await responderAoAguardar(m, descadastro);
  if (descadastro) await encerrarPorDescadastro(m);
  return r ?? nao;
}

async function responderAoAguardar(m: MensagemRecebida, descadastro: boolean): Promise<RespostaDaCampanha | null> {
  const alvo = await alvoDaResposta(m);
  if (!alvo || alvo.estado !== "aguardando_resposta" || (alvo.status !== "ativa" && alvo.status !== "pausada")) return null;
  if (!depoisDoEnvio(m.timestamp, alvo.enviado_em)) return null;
  const fluxo = lerDefinicao(alvo.definicao, alvo);
  const blocoId = alvo.bloco_atual ?? ID_AGUARDAR_ANTIGO;
  const b = aguardarDe(fluxo, blocoId);
  if (!b) return null;
  const saida = descadastro
    ? { saidaId: "descadastro", destino: null }
    : saidaDaResposta(b, { texto: m.texto, botao: alvo.comoBotao ? m.botaoTexto : null });
  if (!(await sairDoAguardar(alvo.id, blocoId, saida.saidaId, saida.destino, m.id))) return null;
  await evento(alvo.campanha_id, alvo.id, "bloco", { bloco: blocoId, tipo: b.tipo, saida: saida.saidaId, ok: true });
  return {
    consumida: true,
    execucaoId: alvo.id,
    continuar: saida.destino !== null && alvo.status === "ativa",
    calaIa: campanhaFalaAntesDeEsperar(fluxo, saida.destino),
  };
}

/**
 * O descadastro vale para o NÚMERO, não só para a campanha que perguntou:
 * encerra toda execução não final do contato naquele telefone_id, em qualquer
 * campanha e estado (inclusive a que está enviando agora: a rodada vê e para,
 * podeSeguir), com evento. Descadastro que valha também para campanhas
 * futuras pede modelagem (ver docs/campanhas-whatsapp.md).
 */
async function encerrarPorDescadastro(m: MensagemRecebida): Promise<number> {
  const fim8 = soDigitos(m.numero).slice(-8);
  if (fim8.length < 8 || !m.phoneNumberId) return 0;
  const candidatas = (await sql`
    SELECT e.id, c.whatsapp FROM campanha_whatsapp_execucoes e
      JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
      JOIN contatos c ON c.id = e.contato_id
     WHERE cw.telefone_id = ${m.phoneNumberId}
       AND regexp_replace(c.whatsapp, '\\D', '', 'g') LIKE ${"%" + fim8}
       AND e.estado IN ('na_fila', 'enviando', 'aguardando_resposta', 'em_andamento')`) as unknown as Array<{
    id: string;
    whatsapp: string | null;
  }>;
  const ids = candidatas.filter((c) => !!c.whatsapp && chaveTelefone(c.whatsapp) === chaveTelefone(m.numero)).map((c) => c.id);
  if (!ids.length) return 0;
  const encerradas = await sql`
    WITH fim AS (
      UPDATE campanha_whatsapp_execucoes e
         SET estado = 'concluida', prazo_resposta = NULL, finalizado_em = now()
       WHERE e.id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
         AND e.estado IN ('na_fila', 'enviando', 'aguardando_resposta', 'em_andamento')
      RETURNING e.id, e.campanha_id, e.bloco_atual)
    INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
    SELECT fim.campanha_id, fim.id, 'descadastro', jsonb_build_object('bloco', fim.bloco_atual) FROM fim
    RETURNING id`;
  return encerradas.length;
}

// ── Prazos, presas e avisos (a rodada do /processar) ────────────────────────

/** O prazo do "Aguardar" venceu: sai por "sem resposta", com a mesma transição atômica da resposta. */
export async function processarExpirados(limite = 200, campanhaId?: string) {
  const linhas = (await sql`
    SELECT e.id, e.campanha_id, e.bloco_atual, cw.definicao, cw.template_nome, cw.template_idioma
      FROM campanha_whatsapp_execucoes e
      JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
     WHERE e.estado = 'aguardando_resposta' AND e.prazo_resposta <= now() AND cw.status = 'ativa'
       AND (${campanhaId ?? null}::uuid IS NULL OR cw.id = ${campanhaId ?? null}::uuid)
     ORDER BY e.prazo_resposta
     LIMIT ${limite}`) as Array<{ id: string; campanha_id: string; bloco_atual: string | null; definicao: unknown } & Coluna>;
  let expirados = 0;
  for (const l of linhas) {
    const blocoId = l.bloco_atual ?? ID_AGUARDAR_ANTIGO;
    const b = aguardarDe(lerDefinicao(l.definicao, l), blocoId);
    if (!b) {
      const erro = "Aguardando num bloco que não é mais Aguardar resposta.";
      const [f] = await sql`UPDATE campanha_whatsapp_execucoes SET estado = 'falhou', erro = ${erro}, finalizado_em = now()
                             WHERE id = ${l.id}::uuid AND estado = 'aguardando_resposta' RETURNING id`;
      if (f) await evento(l.campanha_id, l.id, "falhou", { bloco: blocoId, erro });
      continue;
    }
    if (await sairDoAguardar(l.id, blocoId, "sem_resposta", b.sem_resposta, null)) {
      await evento(l.campanha_id, l.id, "bloco", { bloco: blocoId, tipo: b.tipo, saida: "sem_resposta", ok: true });
      expirados++;
    }
  }
  await atualizarTotais();
  return { expirados };
}

const MOTIVO_PRESA = "A rodada parou no meio (mais de 15 minutos sem terminar): não reenviado, para não mandar em dobro.";

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

type AvisoReservado = {
  id: string;
  detalhe: { instanciaId?: unknown; usuarioIds?: unknown; texto?: unknown; atendimentoId?: unknown };
  nome: string | null;
};

/**
 * Os avisos enfileirados pelo bloco "Avisar a equipe", JUNTOS: uma chamada a
 * avisarEquipeNoWhatsApp por instância e pessoa, com todas as linhas dela. A
 * reserva troca o tipo do evento ('aviso_pendente' → 'aviso_enviando') numa
 * instrução, então duas rodadas nunca mandam o mesmo aviso; reservado há mais
 * de 15 min sem resultado vira 'aviso_falhou', sem reenvio. Só de campanha
 * ativa: pausada, o aviso espera a retomada.
 */
export async function enviarAvisosPendentes(limite = 200): Promise<{ avisos: number; mensagens: number; falhas: number }> {
  await sql`
    UPDATE campanha_whatsapp_eventos
       SET tipo = 'aviso_falhou', detalhe = detalhe || ${sql.json({ falhas: [MOTIVO_PRESA] } as never)}
     WHERE tipo = 'aviso_enviando' AND (detalhe->>'reservado_em')::timestamptz < now() - ${RESERVA}::interval`;
  const reservados = (await sql`
    UPDATE campanha_whatsapp_eventos ev
       SET tipo = 'aviso_enviando', detalhe = ev.detalhe || jsonb_build_object('reservado_em', now())
     WHERE ev.tipo = 'aviso_pendente'
       AND ev.id IN (SELECT p.id FROM campanha_whatsapp_eventos p
                       JOIN campanhas_whatsapp cw ON cw.id = p.campanha_id
                      WHERE p.tipo = 'aviso_pendente' AND cw.status = 'ativa'
                      ORDER BY p.id LIMIT ${limite})
    RETURNING ev.id::text AS id, ev.detalhe,
              (SELECT c.nome FROM campanha_whatsapp_execucoes x JOIN contatos c ON c.id = x.contato_id
                WHERE x.id = ev.execucao_id) AS nome`) as AvisoReservado[];
  if (!reservados.length) return { avisos: 0, mensagens: 0, falhas: 0 };

  // instância|pessoa → as linhas dela e os avisos de onde vieram.
  const grupos = new Map<string, { instanciaId: string; usuarioId: string; linhas: LinhaDoAviso[]; avisos: string[] }>();
  for (const a of reservados) {
    const instanciaId = typeof a.detalhe.instanciaId === "string" ? a.detalhe.instanciaId : "";
    const pessoas = Array.isArray(a.detalhe.usuarioIds) ? a.detalhe.usuarioIds.filter((u): u is string => typeof u === "string") : [];
    const linha: LinhaDoAviso = {
      texto: typeof a.detalhe.texto === "string" ? a.detalhe.texto : "",
      nome: a.nome,
      atendimentoId: typeof a.detalhe.atendimentoId === "string" ? a.detalhe.atendimentoId : null,
    };
    for (const usuarioId of pessoas) {
      const chave = `${instanciaId}|${usuarioId}`;
      const g = grupos.get(chave) ?? { instanciaId, usuarioId, linhas: [], avisos: [] };
      g.linhas.push(linha);
      g.avisos.push(a.id);
      grupos.set(chave, g);
    }
  }

  const resultado = new Map(reservados.map((a) => [a.id, { enviados: 0, falhas: [] as string[] }]));
  let mensagens = 0;
  for (const g of grupos.values()) {
    const r = await avisarEquipeNoWhatsApp({ instanciaId: g.instanciaId, usuarioIds: [g.usuarioId], linhas: g.linhas });
    mensagens += r.enviados;
    for (const id of g.avisos) {
      const x = resultado.get(id)!;
      x.enviados += r.enviados;
      x.falhas.push(...r.falhas);
    }
  }
  const linhas = [...resultado].map(([id, r]) => ({
    id,
    tipo: r.enviados > 0 ? "aviso_enviado" : "aviso_falhou",
    resultado: { enviados: r.enviados, falhas: [...new Set(r.falhas)].slice(0, 20) },
  }));
  await sql`
    UPDATE campanha_whatsapp_eventos ev SET tipo = x.tipo, detalhe = ev.detalhe || x.resultado
      FROM jsonb_to_recordset(${sql.json(linhas as never)}) AS x(id bigint, tipo text, resultado jsonb)
     WHERE ev.id = x.id AND ev.tipo = 'aviso_enviando'`;
  return { avisos: reservados.length, mensagens, falhas: linhas.filter((l) => l.tipo === "aviso_falhou").length };
}

async function atualizarTotais() {
  await sql`UPDATE campanhas_whatsapp c SET
    enviados=(SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.enviado_em IS NOT NULL),
    total=(SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id),
    status=c.status,
    data_conclusao=c.data_conclusao
    WHERE c.status IN ('ativa','processando')`;
}

// ── Pausar, editar, retomar ─────────────────────────────────────────────────

/** Pausa sem mexer no n8n: o agendador segue chamando, e o motor não anda campanha que não está ativa. */
export async function pausarCampanha(id: string, usuarioId: string): Promise<boolean> {
  const [c] = await sql`UPDATE campanhas_whatsapp SET status = 'pausada' WHERE id = ${id}::uuid AND status = 'ativa' RETURNING id`;
  if (c) await registrarNaCampanha(id, "campanha_pausada", usuarioId);
  return !!c;
}

/**
 * Quem está num bloco que o fluxo não tem mais (ou aguardando num bloco que
 * deixou de ser "Aguardar resposta") termina como 'concluida', com evento. As
 * execuções antigas ganham antes o bloco pelo estado, para a conta valer para
 * elas também. Rodando agora ('enviando') fica de fora: a rodada estaciona e
 * esta conferência pega na próxima vez.
 */
async function concluirForaDoFluxo(tx: typeof sql, campanhaId: string, f: FluxoCampanha): Promise<number> {
  const blocos = Object.keys(f.blocos);
  const aguardar = blocos.filter((id) => f.blocos[id].tipo === "aguardar_resposta");
  await tx`
    UPDATE campanha_whatsapp_execucoes SET bloco_atual = ${ID_AGUARDAR_ANTIGO}
     WHERE campanha_id = ${campanhaId}::uuid AND bloco_atual IS NULL AND estado = 'aguardando_resposta'`;
  const fora = await tx`
    WITH fora AS (
      UPDATE campanha_whatsapp_execucoes e
         SET estado = 'concluida', prazo_resposta = NULL, finalizado_em = now()
       WHERE e.campanha_id = ${campanhaId}::uuid
         AND e.estado IN ('aguardando_resposta', 'em_andamento') AND e.bloco_atual IS NOT NULL
         AND (NOT (e.bloco_atual = ANY(string_to_array(${blocos.join(",")}, ',')))
           OR (e.estado = 'aguardando_resposta' AND NOT (e.bloco_atual = ANY(string_to_array(${aguardar.join(",")}, ',')))))
      RETURNING e.id, e.bloco_atual)
    INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
    SELECT ${campanhaId}::uuid, fora.id, 'bloco_removido', jsonb_build_object('bloco', fora.bloco_atual) FROM fora
    RETURNING id`;
  return fora.length;
}

/**
 * Grava o fluxo editado de uma campanha PAUSADA ou RASCUNHO (null = não está
 * em nenhum dos dois). Tudo numa transação: a definição nova e quem saiu do
 * fluxo por estar num bloco apagado.
 *
 * TRAVA DE ID (revisões de 2026-10-28): bloco que já existe na definição
 * gravada não muda de tipo, e id que já rodou e foi apagado não volta
 * (travaDeIds, lib/campanhas-fluxo-entrada.ts); devolve os `problemas` e não
 * grava. Aqui, e não só na rota, porque a linha fica travada (FOR UPDATE) entre
 * a comparação e a gravação: a definição conferida é a que é substituída,
 * venha a edição da tela, da IA do construtor ou de um PUT à mão.
 */
export async function salvarEdicao(e: {
  campanhaId: string;
  nome: string | null;
  fluxo: FluxoCampanha;
  usuarioId: string;
}): Promise<{ concluidas: number } | { problemas: ProblemaDoFluxo[] } | null> {
  const tpl = templateDaCampanha(e.fluxo);
  return sql.begin(async (tx: typeof sql) => {
    const [atual] = (await tx`
      SELECT status, definicao, template_nome, template_idioma FROM campanhas_whatsapp
       WHERE id = ${e.campanhaId}::uuid AND status IN ('pausada', 'rascunho')
         FOR UPDATE`) as unknown as Array<Coluna & { status: string; definicao: unknown }>;
    if (!atual) return null;
    const problemas = await travaDeIds(tx, e.campanhaId, fluxoGravado(atual), e.fluxo);
    if (problemas.length) return { problemas };
    const [c] = await tx`
      UPDATE campanhas_whatsapp
         SET definicao = ${sql.json(e.fluxo as never)},
             nome = COALESCE(${e.nome}::text, nome),
             template_nome = COALESCE(nullif(${tpl.template_nome}, ''), template_nome),
             template_idioma = COALESCE(nullif(${tpl.template_idioma}, ''), template_idioma)
       WHERE id = ${e.campanhaId}::uuid AND status IN ('pausada', 'rascunho')
      RETURNING id`;
    if (!c) return null;
    const concluidas = await concluirForaDoFluxo(tx, e.campanhaId, e.fluxo);
    await tx`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
             VALUES (${e.campanhaId}::uuid, NULL, 'campanha_editada', ${sql.json({ usuario: e.usuarioId, concluidas } as never)})`;
    return { concluidas };
  });
}

/** JSON com as chaves em ordem: o jsonb reordena as chaves, e comparar definições não pode depender disso. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Volta a campanha pausada para 'ativa' (quem chama já revalidou `fluxo`).
 * Na mesma transação, com a linha travada: confere que a definição gravada é
 * a que foi conferida (outra aba pode ter salvo no meio: 'mudou', e quem chama
 * confere de novo), conclui quem ficou fora do fluxo e inscreve quem entrou nos
 * segmentos durante a pausa (o gatilho só inscreve em campanha ativa).
 */
export async function retomarCampanha(
  id: string,
  fluxo: FluxoCampanha,
  usuarioId: string,
): Promise<{ estado: "retomada"; inscritas: number } | { estado: "nao_pausada" } | { estado: "mudou" }> {
  return sql.begin(async (tx: typeof sql) => {
    const [atual] = (await tx`
      SELECT status, definicao, template_nome, template_idioma FROM campanhas_whatsapp
       WHERE id = ${id}::uuid AND status = 'pausada'
         FOR UPDATE`) as unknown as Array<Coluna & { status: string; definicao: unknown }>;
    if (!atual) return { estado: "nao_pausada" as const };
    if (canonico(lerDefinicao(atual.definicao, atual)) !== canonico(fluxo)) return { estado: "mudou" as const };
    await tx`UPDATE campanhas_whatsapp SET status = 'ativa' WHERE id = ${id}::uuid`;
    const concluidas = await concluirForaDoFluxo(tx, id, fluxo);
    const inscritas = await inscreverDosSegmentos(tx, id);
    await tx`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
             VALUES (${id}::uuid, NULL, 'campanha_retomada', ${sql.json({ usuario: usuarioId, concluidas, inscritas } as never)})`;
    return { estado: "retomada" as const, inscritas };
  });
}

// ── Métricas do canvas ──────────────────────────────────────────────────────

export type MetricasDoFluxo = {
  /** Por bloco: quantos estão nele agora e quantos já passaram por ele. */
  porBloco: Record<string, { agora: number; passaram: number }>;
  /** Por `${blocoId}|${saidaId}`: quantos saíram por ali. */
  porSaida: Record<string, number>;
};

/**
 * Pelos eventos 'bloco' e pelo bloco_atual. Campanha do formato antigo conta
 * também os eventos de antes (mensagem_enviada, resposta_recebida,
 * prazo_expirado) nos blocos da conversão: senão o canvas dela abriria zerado.
 */
export async function metricasDasCampanhas(campanhas: Array<{ id: string; definicao: FluxoCampanha }>): Promise<Map<string, MetricasDoFluxo>> {
  const saida = new Map<string, MetricasDoFluxo>();
  if (!campanhas.length) return saida;
  const ids = listaUuid(campanhas.map((c) => c.id));
  const [agora, passaram, saidas] = (await Promise.all([
    sql`SELECT campanha_id::text, estado, bloco_atual, count(*)::int AS n
          FROM campanha_whatsapp_execucoes
         WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[])
           AND estado IN ('na_fila', 'enviando', 'aguardando_resposta', 'em_andamento')
         GROUP BY 1, 2, 3`,
    sql`SELECT campanha_id::text, bloco, count(DISTINCT execucao_id)::int AS n FROM (
          SELECT campanha_id, execucao_id,
                 CASE tipo WHEN 'bloco' THEN detalhe->>'bloco' WHEN 'mensagem_enviada' THEN ${ID_ENVIO_ANTIGO} END AS bloco
            FROM campanha_whatsapp_eventos
           WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[]) AND tipo IN ('bloco', 'mensagem_enviada')
          UNION ALL
          SELECT campanha_id, execucao_id, ${ID_AGUARDAR_ANTIGO}
            FROM campanha_whatsapp_eventos
           WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[]) AND tipo = 'mensagem_enviada'
        ) x WHERE bloco IS NOT NULL GROUP BY 1, 2`,
    sql`SELECT campanha_id::text, bloco, saida, count(*)::int AS n FROM (
          SELECT campanha_id,
                 CASE tipo WHEN 'bloco' THEN detalhe->>'bloco' WHEN 'mensagem_enviada' THEN ${ID_ENVIO_ANTIGO} ELSE ${ID_AGUARDAR_ANTIGO} END AS bloco,
                 CASE tipo WHEN 'bloco' THEN detalhe->>'saida' WHEN 'mensagem_enviada' THEN 'proximo'
                           WHEN 'resposta_recebida' THEN 'outra' ELSE 'sem_resposta' END AS saida
            FROM campanha_whatsapp_eventos
           WHERE campanha_id = ANY(string_to_array(${ids}, ',')::uuid[])
             AND tipo IN ('bloco', 'mensagem_enviada', 'resposta_recebida', 'prazo_expirado')
        ) x WHERE bloco IS NOT NULL AND saida IS NOT NULL GROUP BY 1, 2, 3`,
  ])) as [
    Array<{ campanha_id: string; estado: string; bloco_atual: string | null; n: number }>,
    Array<{ campanha_id: string; bloco: string; n: number }>,
    Array<{ campanha_id: string; bloco: string; saida: string; n: number }>,
  ];
  for (const c of campanhas) {
    const porBloco = new Map<string, { agora: number; passaram: number }>();
    const no = (bloco: string) => porBloco.get(bloco) ?? porBloco.set(bloco, { agora: 0, passaram: 0 }).get(bloco)!;
    for (const l of agora.filter((x) => x.campanha_id === c.id)) {
      // Execução antiga sem bloco_atual conta pelo estado; a da fila, no primeiro bloco.
      const bloco =
        l.bloco_atual ??
        (l.estado === "aguardando_resposta" ? ID_AGUARDAR_ANTIGO : l.estado === "enviando" ? ID_ENVIO_ANTIGO : c.definicao.inicio);
      if (bloco) no(bloco).agora += l.n;
    }
    for (const l of passaram.filter((x) => x.campanha_id === c.id)) no(l.bloco).passaram += l.n;
    const porSaida = new Map<string, number>();
    for (const l of saidas.filter((x) => x.campanha_id === c.id)) {
      const chave = `${l.bloco}|${l.saida}`;
      porSaida.set(chave, (porSaida.get(chave) ?? 0) + l.n);
    }
    // fromEntries define a chave como própria, mesmo um id estranho vindo de evento antigo.
    saida.set(c.id, { porBloco: Object.fromEntries(porBloco), porSaida: Object.fromEntries(porSaida) });
  }
  return saida;
}
