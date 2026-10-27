// Mandar uma mensagem numa conversa do CRM — pelo canal que ELA tem.
//
// Existe porque duas vozes mandam texto na mesma conversa com o mesmo ciclo:
// a equipe pelo /chat (app/chat/actions.ts) e a IA que atende o contato
// (lib/ia/atendente.ts). O ciclo é um só e não pode divergir entre elas:
//
//   1. grava a linha 'pendente' ANTES de falar com o WhatsApp (a mensagem não
//      se perde se a rede cair);
//   2. dispara pela uazapi (WhatsApp Web), pela Meta (API oficial) ou pelo
//      direct do Instagram, conforme o canal da conversa, e pelo NÚMERO (ou
//      conta) dela;
//   3. casa o retorno: id_externo + 'enviado', ou 'erro' com o motivo.
//
// O CANAL É EXAUSTIVO (revisão de segurança, 2026-10-26): whatsapp,
// whatsapp_oficial ou instagram, e qualquer outro é recusa. Antes era "se não é
// a oficial, é uazapi", e uma conversa do Instagram sairia pela uazapi. No
// Instagram só vai texto: áudio é recusado antes de a voz ser gerada.
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
import { ehUuid } from "@/lib/validacao";
import { ehIdMeta, enviarDirect, perfilDaConta } from "@/lib/instagram";

export type ResultadoEnvio = {
  erro?: string;
  /** A mensagem chegou a ser gravada (e está na conversa, com o erro). */
  registrada?: boolean;
  mensagemId?: string;
};

const JANELA_MS = 24 * 60 * 60 * 1000;

export const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export type Destino = {
  id: string;
  canal: string;
  numero_instancia: string | null;
  whatsapp: string | null;
  /** IGSID do contato (contatos.campos.instagram_id): o destinatário no canal instagram. */
  instagram_id: string | null;
  /** Nome, e-mail e cidade: o que as variáveis de template do chat oferecem no menu. */
  nome: string | null;
  email: string | null;
  cidade: string | null;
  ultima_entrada: Date | null;
};

/** Para onde vai a mensagem desta conversa: canal, nosso número e o do contato. */
export async function destinoDa(atendimentoId: string): Promise<Destino | null> {
  if (!ehUuid(atendimentoId)) return null;
  const [d] = await sql`
    SELECT a.id, a.canal, a.numero_instancia, c.whatsapp, c.campos->>'instagram_id' AS instagram_id,
           c.nome, c.email, c.cidade,
           (SELECT max(m.data_criacao) FROM mensagens m
             WHERE m.atendimento_id = a.id AND m.origem = 'contato') AS ultima_entrada
    FROM atendimentos a
    JOIN contatos c ON c.id = a.contato_id
    WHERE a.id = ${atendimentoId}`;
  return (d as unknown as Destino) ?? null;
}

/** Os canais pelos quais o CRM manda. Qualquer outro valor de atendimentos.canal é recusa. */
export type CanalDeEnvio = "whatsapp" | "whatsapp_oficial" | "instagram";

export function canalDeEnvio(d: Destino): CanalDeEnvio | null {
  switch (d.canal) {
    case "whatsapp":
    case "whatsapp_oficial":
    case "instagram":
      return d.canal;
    default:
      return null;
  }
}

export const ehOficial = (d: Destino) => d.canal === "whatsapp_oficial";

/** Texto livre só até 24h depois da última mensagem do contato (API oficial e Instagram). */
export function janelaAberta(d: Destino) {
  return d.ultima_entrada !== null && Date.now() - new Date(d.ultima_entrada).getTime() < JANELA_MS;
}

/**
 * A janela de 24h POR CANAL, num lugar só (chat, IA e retomada): na API
 * oficial e no direct do Instagram, texto livre só até 24h depois da última
 * mensagem do contato. Devolve o motivo da recusa, ou null quando pode mandar.
 */
export function foraDaJanela(d: Destino): string | null {
  switch (canalDeEnvio(d)) {
    case "whatsapp_oficial":
      return janelaAberta(d) ? null : "A janela de 24h está fechada. Pela API oficial, só um template reabre a conversa.";
    case "instagram":
      return janelaAberta(d) ? null : "A janela de 24h está fechada. No Instagram, a conversa reabre quando a pessoa escrever de novo.";
    case "whatsapp":
    case null:
      return null;
  }
}

/**
 * Por que não dá para mandar nada nesta conversa: canal que o CRM não usa, ou
 * contato sem o destinatário daquele canal. null = tem para onde mandar.
 */
export function recusaDoDestino(d: Destino): string | null {
  switch (canalDeEnvio(d)) {
    case null:
      return "O CRM não envia mensagem pelo canal desta conversa.";
    case "whatsapp":
    case "whatsapp_oficial":
      return d.whatsapp ? null : "O contato não tem número de WhatsApp.";
    case "instagram":
      if (!perfilDaConta(d.numero_instancia)) return "A conta do Instagram desta conversa não é uma das contas do CRM.";
      return ehIdMeta(d.instagram_id) ? null : "O contato não tem conta do Instagram ligada.";
  }
}

/** O limite de tamanho do texto, por canal. */
function limiteDoTexto(canal: CanalDeEnvio): { max: number; erro: string } {
  return canal === "instagram"
    ? { max: 1000, erro: "A mensagem passa de 1.000 caracteres, o limite do direct do Instagram." }
    : { max: 4096, erro: "A mensagem passa de 4.096 caracteres, o limite do WhatsApp." };
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
  /**
   * Pausa antes de sair, como quem digita: a IA quebra a resposta em mensagens
   * curtas. Pela uazapi o cliente vê "Digitando..."; pela Meta é só a pausa.
   * A linha é gravada ANTES da pausa: mensagem do cliente que chegar durante
   * ela fica mais nova que esta, e a IA a vê como ainda sem resposta.
   */
  digitandoMs?: number;
}): Promise<ResultadoEnvio> {
  const corpo = e.texto.trim();
  if (!corpo) return { erro: "Mensagem vazia." };

  const d = await destinoDa(e.atendimentoId);
  if (!d) return { erro: "Conversa não encontrada." };
  const canal = canalDeEnvio(d);
  const recusa = recusaDoDestino(d);
  if (!canal || recusa) return { erro: recusa ?? "O CRM não envia mensagem pelo canal desta conversa." };
  const limite = limiteDoTexto(canal);
  if (corpo.length > limite.max) return { erro: limite.erro };
  // A regra da Meta conferida ANTES de gravar: fora da janela o envio seria
  // recusado (131047 no WhatsApp) com a linha já na conversa.
  const fechada = foraDaJanela(d);
  if (fechada) return { erro: fechada };

  const [msg] = await sql`
    INSERT INTO mensagens (atendimento_id, origem, autor_id, texto, status, enviada_por)
    VALUES (${e.atendimentoId}, 'agente', ${e.autorId}, ${corpo}, 'pendente', ${e.enviadaPor})
    RETURNING id`;
  const mensagemId = msg.id as string;

  try {
    const idExterno = await textoPeloCanal(canal, d, corpo, mensagemId, e.digitandoMs);
    await confirmarEnvio(mensagemId, idExterno);
    await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${e.atendimentoId}`;
    return { mensagemId };
  } catch (erro) {
    await marcarErro(mensagemId, erro);
    return { erro: motivo(erro), registrada: true, mensagemId };
  }
}

/** O texto pelo canal da conversa. Devolve o id da mensagem no serviço. */
async function textoPeloCanal(
  canal: CanalDeEnvio,
  d: Destino,
  corpo: string,
  mensagemId: string,
  digitandoMs?: number,
): Promise<string | null> {
  const pausa = async () => {
    if (digitandoMs) await new Promise((r) => setTimeout(r, digitandoMs));
  };
  switch (canal) {
    case "whatsapp_oficial": {
      await pausa();
      const r = await enviarTextoMeta(await telefoneOficial(d), soDigitos(d.whatsapp ?? ""), corpo);
      return r.messages?.[0]?.id ?? null;
    }
    case "instagram": {
      const perfil = perfilDaConta(d.numero_instancia);
      if (!perfil || !ehIdMeta(d.instagram_id)) throw new Error("Conversa do Instagram sem conta ou sem destinatário.");
      await pausa();
      return (await enviarDirect(perfil, d.instagram_id, corpo)).id;
    }
    case "whatsapp": {
      // Pelo número que RECEBEU a conversa: pela instância errada a resposta
      // chega de um número que o cliente não conhece.
      const instancia = await instanciaPorNumero(d.numero_instancia ?? null);
      return (await enviarTexto(soDigitos(d.whatsapp ?? ""), corpo, instancia, mensagemId, digitandoMs)).messageid;
    }
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
  const canal = canalDeEnvio(d);
  // Antes da voz: gerar áudio que o canal não leva é crédito gasto à toa.
  if (canal === "instagram") return { erro: "O direct do Instagram não recebe áudio pelo CRM." };
  const recusa = recusaDoDestino(d) ?? foraDaJanela(d);
  if (!canal || recusa) return { erro: recusa ?? "O CRM não envia mensagem pelo canal desta conversa." };
  const whatsapp = soDigitos(d.whatsapp ?? "");

  const mensagemId = randomUUID();
  let arquivo: { bytes: Uint8Array; mime: string };
  let caminho: string;
  try {
    // A trava do dev antes da voz: gerar áudio que não vai sair é crédito
    // gasto à toa. O envio confere de novo, como sempre.
    conferirDestino(whatsapp);
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
    switch (canal) {
      case "whatsapp_oficial": {
        // A Cloud API mostra MP3 como arquivo de áudio, não como mensagem de voz
        // (essa exige OGG/Opus, e converter pediria ffmpeg no servidor).
        const telefoneId = await telefoneOficial(d);
        const midiaId = await subirMidiaMeta(telefoneId, arquivo.bytes, arquivo.mime, "resposta.mp3");
        const r = await enviarMidiaMeta(telefoneId, whatsapp, "audio", midiaId);
        idExterno = r.messages?.[0]?.id ?? null;
        break;
      }
      case "whatsapp": {
        const instancia = await instanciaPorNumero(d.numero_instancia ?? null);
        const r = await enviarMidia(
          whatsapp,
          Buffer.from(arquivo.bytes).toString("base64"),
          { tipo: "voz", mime: arquivo.mime },
          instancia,
          mensagemId,
        );
        idExterno = r.messageid;
        break;
      }
    }
    await confirmarEnvio(mensagemId, idExterno);
    await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${e.atendimentoId}`;
    return { mensagemId };
  } catch (erro) {
    await marcarErro(mensagemId, erro);
    return { erro: motivo(erro), registrada: true, mensagemId };
  }
}
