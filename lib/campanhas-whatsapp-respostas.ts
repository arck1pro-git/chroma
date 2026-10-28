// As RESPOSTAS do contato no motor das campanhas em blocos
// (lib/campanhas-whatsapp.ts explica o motor inteiro): de qual execução é a
// mensagem que chegou no número oficial, a saída que ela toma no "Aguardar
// resposta", o descadastro e o prazo vencido sem resposta. Quem chama é o
// webhook da Meta (registrarResposta) e a rodada do /processar
// (processarExpirados). Dividido do motor em 2026-10-28.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import type { MensagemRecebida } from "@/lib/whatsapp-oficial";
import { chaveTelefone, soDigitos } from "@/lib/telefone";
import { ehUuid } from "@/lib/validacao";
import { ehDescadastro, ID_AGUARDAR_ANTIGO, saidaDaResposta, type BlocoCampanha, type Destino, type FluxoCampanha } from "@/lib/campanhas-fluxo";
import { lerDefinicao, type Coluna } from "@/lib/campanhas-fluxo-entrada";
import { campanhaFalaAntesDeEsperar } from "@/lib/campanhas-fluxo-envios";
import { ehBloco, evento, FOLGA_RELOGIO_MS, respostaRepetida } from "@/lib/campanhas-whatsapp-base";
import { PAYLOAD } from "@/lib/campanhas-whatsapp-envios";
import { atualizarTotais } from "@/lib/campanhas-whatsapp-totais";

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
