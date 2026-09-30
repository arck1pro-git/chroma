// Mandar uma mensagem numa conversa do CRM — pelo canal que ELA tem.
//
// Existe porque duas vozes mandam texto na mesma conversa com o mesmo ciclo:
// a equipe pelo /chat (app/chat/actions.ts) e a IA que atende o contato
// (lib/ia/atendente.ts). O ciclo é um só e não pode divergir entre elas:
//
//   1. grava a linha 'pendente' ANTES de falar com o WhatsApp (a mensagem não
//      se perde se a rede cair);
//   2. dispara pela uazapi (WhatsApp Web) ou pela Meta (API oficial), conforme
//      o canal da conversa, e pelo NÚMERO dela;
//   3. casa o retorno: id_externo + 'enviado', ou 'erro' com o motivo.
//
// Erros voltam como valor ({ erro, registrada }), não como exceção: quem chama
// decide se mostra na tela (chat) ou só registra (IA).
import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { enviarMidia, enviarTexto, instanciaPorNumero } from "@/lib/uazapi";
import { enviarMidiaMeta, enviarTextoMeta, subirMidiaMeta } from "@/lib/meta";
import { canalOficial } from "@/lib/canais";
import { soDigitos } from "@/lib/telefone";
import { conferirDestino } from "@/lib/destino-permitido";
import { guardarMidia } from "@/lib/midia";
import { sintetizarVoz } from "@/lib/voz";

export type ResultadoEnvio = {
  erro?: string;
  /** A mensagem chegou a ser gravada (e está na conversa, com o erro). */
  registrada?: boolean;
  mensagemId?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JANELA_MS = 24 * 60 * 60 * 1000;

export const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export type Destino = {
  id: string;
  canal: string;
  numero_instancia: string | null;
  whatsapp: string | null;
  ultima_entrada: Date | null;
};

/** Para onde vai a mensagem desta conversa: canal, nosso número e o do contato. */
export async function destinoDa(atendimentoId: string): Promise<Destino | null> {
  if (!UUID.test(atendimentoId)) return null;
  const [d] = await sql`
    SELECT a.id, a.canal, a.numero_instancia, c.whatsapp,
           (SELECT max(m.data_criacao) FROM mensagens m
             WHERE m.atendimento_id = a.id AND m.origem = 'contato') AS ultima_entrada
    FROM atendimentos a
    JOIN contatos c ON c.id = a.contato_id
    WHERE a.id = ${atendimentoId}`;
  return (d as unknown as Destino) ?? null;
}

export const ehOficial = (d: Destino) => d.canal === "whatsapp_oficial";

/** API oficial: texto livre só até 24h depois da última mensagem do contato. */
export function janelaAberta(d: Destino) {
  return d.ultima_entrada !== null && Date.now() - new Date(d.ultima_entrada).getTime() < JANELA_MS;
}

export async function telefoneOficial(d: Destino): Promise<string> {
  const canal = await canalOficial(d.numero_instancia);
  if (!canal?.telefoneId) {
    throw new Error("O número desta conversa não aparece mais na conta da Meta.");
  }
  return canal.telefoneId;
}

export async function marcarErro(mensagemId: string, e: unknown) {
  await sql`UPDATE mensagens SET status = 'erro', erro = ${motivo(e)} WHERE id = ${mensagemId}`;
}

/**
 * Casa o retorno do envio com a linha. O eco do webhook da uazapi pode chegar
 * ANTES desta atualização: com o track_id ele já adota a própria linha (e aqui
 * é só confirmar); sem ele — instância antiga, eco sem rastreio — o eco vira
 * uma segunda linha com o mesmo id_externo, que é apagada aqui antes de a
 * nossa receber o id (a trava ux_mensagens_externo não deixaria as duas).
 */
export async function confirmarEnvio(mensagemId: string, idExterno: string | null) {
  if (idExterno) {
    await sql`
      DELETE FROM mensagens
       WHERE id_externo = ${idExterno} AND id <> ${mensagemId} AND origem = 'agente'`;
  }
  await sql`
    UPDATE mensagens
       SET id_externo = COALESCE(${idExterno}, id_externo),
           status = CASE WHEN status = 'pendente' THEN 'enviado' ELSE status END
     WHERE id = ${mensagemId}`;
}

/**
 * Manda um texto nesta conversa, pelo canal dela. Não mexe em dono nem status
 * da conversa — isso é de quem chama (responder pelo chat assume; a IA não).
 */
export async function enviarTextoNaConversa(e: {
  atendimentoId: string;
  texto: string;
  autorId: string | null;
  enviadaPor: "crm" | "ia";
}): Promise<ResultadoEnvio> {
  const corpo = e.texto.trim();
  if (!corpo) return { erro: "Mensagem vazia." };
  if (corpo.length > 4096) return { erro: "A mensagem passa de 4.096 caracteres, o limite do WhatsApp." };

  const d = await destinoDa(e.atendimentoId);
  if (!d) return { erro: "Conversa não encontrada." };
  if (!d.whatsapp) return { erro: "O contato não tem número de WhatsApp." };
  // A regra da Meta conferida ANTES de gravar: fora da janela o envio seria
  // recusado (131047) com a linha já na conversa.
  if (ehOficial(d) && !janelaAberta(d)) {
    return { erro: "A janela de 24h está fechada. Pela API oficial, só um template reabre a conversa." };
  }

  const [msg] = await sql`
    INSERT INTO mensagens (atendimento_id, origem, autor_id, texto, status, enviada_por)
    VALUES (${e.atendimentoId}, 'agente', ${e.autorId}, ${corpo}, 'pendente', ${e.enviadaPor})
    RETURNING id`;
  const mensagemId = msg.id as string;

  try {
    let idExterno: string | null;
    if (ehOficial(d)) {
      const r = await enviarTextoMeta(await telefoneOficial(d), soDigitos(d.whatsapp), corpo);
      idExterno = r.messages?.[0]?.id ?? null;
    } else {
      // Pelo número que RECEBEU a conversa: pela instância errada a resposta
      // chega de um número que o cliente não conhece.
      const instancia = await instanciaPorNumero(d.numero_instancia ?? null);
      idExterno = (await enviarTexto(soDigitos(d.whatsapp), corpo, instancia, mensagemId)).messageid;
    }
    await confirmarEnvio(mensagemId, idExterno);
    await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${e.atendimentoId}`;
    return { mensagemId };
  } catch (erro) {
    await marcarErro(mensagemId, erro);
    return { erro: motivo(erro), registrada: true, mensagemId };
  }
}

/**
 * Manda um ÁUDIO nesta conversa: a resposta falada da IA (lib/voz.ts). Mesmo
 * ciclo do texto, com uma diferença de ordem: o arquivo é gerado e guardado
 * ANTES de a linha existir, porque áudio sem arquivo não passa na trava do
 * banco (ck_mensagens_midia). `texto` é o que foi falado e fica na linha — é a
 * "Transcrição" do balão e o que a IA lê no histórico.
 *
 * Se a voz não sair, nada é gravado e volta { erro } sem `registrada`: quem
 * chama pode mandar o mesmo texto por escrito.
 */
export async function enviarAudioNaConversa(e: {
  atendimentoId: string;
  texto: string;
  enviadaPor: "ia";
}): Promise<ResultadoEnvio> {
  const corpo = e.texto.trim();
  if (!corpo) return { erro: "Mensagem vazia." };

  const d = await destinoDa(e.atendimentoId);
  if (!d) return { erro: "Conversa não encontrada." };
  if (!d.whatsapp) return { erro: "O contato não tem número de WhatsApp." };
  if (ehOficial(d) && !janelaAberta(d)) {
    return { erro: "A janela de 24h está fechada. Pela API oficial, só um template reabre a conversa." };
  }

  const mensagemId = randomUUID();
  let arquivo: { bytes: Uint8Array; mime: string };
  let caminho: string;
  try {
    // A trava do dev antes da voz: gerar áudio que não vai sair é crédito
    // gasto à toa. O envio confere de novo, como sempre.
    conferirDestino(soDigitos(d.whatsapp));
    arquivo = await sintetizarVoz(corpo);
    caminho = await guardarMidia(mensagemId, arquivo.bytes, arquivo.mime, null);
  } catch (erro) {
    return { erro: motivo(erro) };
  }

  await sql`
    INSERT INTO mensagens
      (id, atendimento_id, origem, autor_id, texto, status, enviada_por,
       tipo, midia_caminho, midia_mime, midia_tamanho, midia_estado)
    VALUES
      (${mensagemId}, ${e.atendimentoId}, 'agente', NULL, ${corpo}, 'pendente', ${e.enviadaPor},
       'audio', ${caminho}, ${arquivo.mime}, ${arquivo.bytes.byteLength}, 'salva')`;

  try {
    let idExterno: string | null;
    if (ehOficial(d)) {
      // A Cloud API mostra MP3 como arquivo de áudio, não como mensagem de voz
      // (essa exige OGG/Opus, e converter pediria ffmpeg no servidor).
      const telefoneId = await telefoneOficial(d);
      const midiaId = await subirMidiaMeta(telefoneId, arquivo.bytes, arquivo.mime, "resposta.mp3");
      const r = await enviarMidiaMeta(telefoneId, soDigitos(d.whatsapp), "audio", midiaId);
      idExterno = r.messages?.[0]?.id ?? null;
    } else {
      const instancia = await instanciaPorNumero(d.numero_instancia ?? null);
      const r = await enviarMidia(
        soDigitos(d.whatsapp),
        Buffer.from(arquivo.bytes).toString("base64"),
        { tipo: "voz", mime: arquivo.mime },
        instancia,
        mensagemId,
      );
      idExterno = r.messageid;
    }
    await confirmarEnvio(mensagemId, idExterno);
    await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${e.atendimentoId}`;
    return { mensagemId };
  } catch (erro) {
    await marcarErro(mensagemId, erro);
    return { erro: motivo(erro), registrada: true, mensagemId };
  }
}
