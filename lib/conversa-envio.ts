// Mandar uma mensagem numa conversa do CRM — pelo canal que ELA tem.
//
// Existe porque várias vozes mandam na mesma conversa com o mesmo ciclo: a
// equipe pelo /chat (app/chat/actions.ts), a IA que atende o contato
// (lib/ia/atendente.ts) e as campanhas em blocos (texto livre e arquivo da
// biblioteca). O ciclo é um só e não pode divergir entre elas:
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
//
// A PRINCIPAL CAIU (2026-10-30, ver saidaDaConversa): no WhatsApp Web, com o
// número da conversa vermelho e a secundária dele verde, a mensagem sai pela
// secundária e fica na conversa da secundária com o lead (decisão dele). O
// resultado diz para onde ela foi (`movida`).
import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { enviarMidia, enviarTexto, instanciaPorNumero, type Instancia } from "@/lib/uazapi";
import { instanciaQueEnvia } from "@/lib/uazapi-reserva";
import { abrirConversaDoContato } from "@/lib/automacoes/conversa-da-cadencia";
import { enviarMidiaMeta, enviarTextoMeta, subirMidiaMeta, type TipoMidiaMeta } from "@/lib/meta";
import { canalOficial } from "@/lib/canais";
import { comCaminho, lerArquivo } from "@/lib/documentos";
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
  /** A principal caiu e a secundária assumiu: a conversa onde a mensagem ficou. */
  movida?: Movida;
};

export type Movida = {
  atendimentoId: string;
  /** Os dígitos do número da secundária: a chave do canal no /chat. */
  canal: string;
  principal: string;
  secundaria: string;
};

const JANELA_MS = 24 * 60 * 60 * 1000;

export const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export type Destino = {
  id: string;
  canal: string;
  /** null na conversa de grupo. */
  contato_id: string | null;
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

/**
 * Para onde vai a mensagem desta conversa: canal, nosso número e o do contato.
 * Na conversa de GRUPO (2026-10-29), `whatsapp` é o jid do grupo ("…@g.us"),
 * que a uazapi aceita como destino; nome é o do grupo, sem e-mail nem cidade.
 */
export async function destinoDa(atendimentoId: string): Promise<Destino | null> {
  if (!ehUuid(atendimentoId)) return null;
  const [d] = await sql`
    SELECT a.id, a.canal, a.contato_id, a.numero_instancia, coalesce(c.whatsapp, g.jid) AS whatsapp,
           c.campos->>'instagram_id' AS instagram_id,
           coalesce(c.nome, g.nome) AS nome, c.email, c.cidade,
           (SELECT max(m.data_criacao) FROM mensagens m
             WHERE m.atendimento_id = a.id AND m.origem = 'contato') AS ultima_entrada
    FROM atendimentos a
    LEFT JOIN contatos c ON c.id = a.contato_id
    LEFT JOIN grupos_whatsapp g ON g.id = a.grupo_id
    WHERE a.id = ${atendimentoId}`;
  return (d as unknown as Destino) ?? null;
}

/**
 * O destinatário como a uazapi quer: o grupo vai com o jid inteiro ("…@g.us");
 * o contato, só com os dígitos. Sem isto o soDigitos do grupo viraria um
 * "telefone" que não existe.
 */
export function numeroDoDestino(d: Destino): string {
  return /@g\.us$/i.test(d.whatsapp ?? "") ? (d.whatsapp as string) : soDigitos(d.whatsapp ?? "");
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

/** Onde a mensagem fica e por qual instância do WhatsApp Web ela sai. */
type Saida = {
  atendimentoId: string;
  d: Destino;
  /** null fora do WhatsApp Web, ou quando a instância só se resolve no envio (e o erro fica na linha). */
  instancia: Instancia | null;
  movida?: Movida;
};

/**
 * Normalmente a própria conversa, pelo número dela. Com esse número vermelho e
 * a secundária dele verde (lib/uazapi-reserva.ts), a mensagem sai pela
 * secundária e fica na conversa da secundária com o lead: a resposta dele cai
 * nela, e o fio segue inteiro lá. A conversa nova herda o dono da antiga, para
 * não voltar à fila. Grupo não troca: a secundária não está no grupo.
 */
async function saidaDaConversa(atendimentoId: string, d: Destino): Promise<Saida> {
  const fica: Saida = { atendimentoId, d, instancia: null };
  if (canalDeEnvio(d) !== "whatsapp") return fica;
  // Sem casar o número, instanciaPorNumero pode recusar: o erro aparece no
  // envio, com a linha já gravada, como sempre foi.
  const pedida = await instanciaPorNumero(d.numero_instancia ?? null).catch(() => null);
  if (!pedida) return fica;
  if (!d.contato_id) return { ...fica, instancia: pedida };
  const { instancia, principal } = await instanciaQueEnvia(pedida);
  if (!principal || !instancia.numero) return { ...fica, instancia: pedida };

  const numero = soDigitos(instancia.numero);
  const outraId = await abrirConversaDoContato(d.contato_id, numero);
  const outra = outraId ? await destinoDa(outraId) : null;
  if (!outraId || !outra) return { ...fica, instancia: pedida };
  await sql`
    UPDATE atendimentos
       SET responsavel_id = (SELECT responsavel_id FROM atendimentos WHERE id = ${atendimentoId})
     WHERE id = ${outraId} AND responsavel_id IS NULL`;
  return {
    atendimentoId: outraId,
    d: outra,
    instancia,
    movida: { atendimentoId: outraId, canal: numero, principal: principal.nome, secundaria: instancia.nome },
  };
}

/**
 * Manda um texto nesta conversa, pelo canal dela. Não mexe em dono nem status
 * da conversa — isso é de quem chama (responder pelo chat assume; a IA não).
 */
export async function enviarTextoNaConversa(e: {
  atendimentoId: string;
  texto: string;
  autorId: string | null;
  /** "automacao": o texto livre da campanha em blocos, a mesma marca das cadências. */
  enviadaPor: "crm" | "ia" | "automacao";
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

  const s = await saidaDaConversa(e.atendimentoId, d);
  const [msg] = await sql`
    INSERT INTO mensagens (atendimento_id, origem, autor_id, texto, status, enviada_por)
    VALUES (${s.atendimentoId}, 'agente', ${e.autorId}, ${corpo}, 'pendente', ${e.enviadaPor})
    RETURNING id`;
  const mensagemId = msg.id as string;

  try {
    const idExterno = await textoPeloCanal(canal, s, corpo, mensagemId, e.digitandoMs);
    await confirmarEnvio(mensagemId, idExterno);
    await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${s.atendimentoId}`;
    return { mensagemId, movida: s.movida };
  } catch (erro) {
    await marcarErro(mensagemId, erro);
    return { erro: motivo(erro), registrada: true, mensagemId, movida: s.movida };
  }
}

/** O texto pelo canal da conversa. Devolve o id da mensagem no serviço. */
async function textoPeloCanal(
  canal: CanalDeEnvio,
  { d, instancia: escolhida }: Saida,
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
      const r = await enviarTextoMeta(await telefoneOficial(d), numeroDoDestino(d), corpo);
      return r.messages?.[0]?.id ?? null;
    }
    case "instagram": {
      const perfil = perfilDaConta(d.numero_instancia);
      if (!perfil || !ehIdMeta(d.instagram_id)) throw new Error("Conversa do Instagram sem conta ou sem destinatário.");
      await pausa();
      return (await enviarDirect(perfil, d.instagram_id, corpo)).id;
    }
    case "whatsapp": {
      // Pelo número que RECEBEU a conversa (ou a secundária que assumiu, com a
      // conversa já trocada em saidaDaConversa): pela instância errada a
      // resposta chega de um número que o cliente não conhece.
      const instancia = escolhida ?? (await instanciaPorNumero(d.numero_instancia ?? null));
      return (await enviarTexto(numeroDoDestino(d), corpo, instancia, mensagemId, digitandoMs)).messageid;
    }
  }
}

// O que a Cloud API aceita como imagem é só JPEG e PNG; o resto vai como
// documento em vez de ser recusado.
function tipoParaMeta(tipo: string, mime: string): TipoMidiaMeta {
  if (tipo === "imagem") return /^image\/(jpe?g|png)$/i.test(mime) ? "image" : "document";
  if (tipo === "video") return /^video\/(mp4|3gpp)$/i.test(mime) ? "video" : "document";
  if (tipo === "audio") return "audio";
  return "document";
}

/**
 * Manda um documento da BIBLIOTECA (lib/documentos.ts) nesta conversa, pelo
 * mesmo ciclo do texto: o anexo do /chat (app/chat/actions.ts) e o bloco
 * "Enviar arquivo" das campanhas (lib/campanhas-whatsapp-envios.ts). Era do
 * chat até 2026-10-28; veio para cá para a campanha sair pelo MESMO caminho.
 *
 * O ARQUIVO NÃO É COPIADO para a conversa: a mensagem aponta para a linha em
 * `documentos` (documento_id), e o balão pede o arquivo por /api/midia/<id da
 * mensagem>. Mandar a mesma tabela de preços para 300 contatos guarda um
 * arquivo, não 300. No direct do Instagram só vai texto; na API oficial, só com
 * a janela de 24h aberta. Não mexe em dono nem status da conversa.
 */
export async function enviarDocumentoNaConversa(e: {
  atendimentoId: string;
  documentoId: string;
  legenda: string;
  autorId: string | null;
  enviadaPor: "crm" | "automacao";
}): Promise<ResultadoEnvio> {
  const doc = ehUuid(e.documentoId) ? await comCaminho(e.documentoId) : null;
  if (!doc) return { erro: "Documento não encontrado na biblioteca." };
  const texto = e.legenda.trim().slice(0, 1024);

  const d = await destinoDa(e.atendimentoId);
  if (!d) return { erro: "Conversa não encontrada." };
  // Canal exaustivo: no direct do Instagram o CRM manda só texto, e canal
  // desconhecido é recusa (nunca "senão é uazapi").
  const canal = canalDeEnvio(d);
  if (canal === "instagram") return { erro: "No direct do Instagram o CRM manda só texto." };
  const recusa = recusaDoDestino(d);
  if (!canal || recusa) return { erro: recusa ?? "O CRM não envia mensagem pelo canal desta conversa." };
  if (ehOficial(d) && !janelaAberta(d)) {
    return { erro: "A janela de 24h está fechada. Envie um template antes do anexo." };
  }
  const whatsapp = numeroDoDestino(d);
  const s = await saidaDaConversa(e.atendimentoId, d);

  const [msg] = await sql`
    INSERT INTO mensagens
      (atendimento_id, origem, autor_id, texto, status, enviada_por,
       tipo, documento_id, midia_estado, midia_mime, midia_nome, midia_tamanho)
    VALUES
      (${s.atendimentoId}, 'agente', ${e.autorId}, ${texto}, 'pendente', ${e.enviadaPor},
       ${doc.tipo}, ${doc.id}, 'salva', ${doc.mime}, ${doc.arquivoNome}, ${doc.tamanho})
    RETURNING id`;
  const mensagemId = msg.id as string;

  try {
    const bytes = await lerArquivo(doc.caminho);
    let idExterno: string | null;
    switch (canal) {
      case "whatsapp_oficial": {
        const telefoneId = await telefoneOficial(d);
        const midiaId = await subirMidiaMeta(telefoneId, bytes, doc.mime, doc.arquivoNome);
        const r = await enviarMidiaMeta(telefoneId, whatsapp, tipoParaMeta(doc.tipo, doc.mime), midiaId, {
          legenda: texto,
          arquivoNome: doc.arquivoNome,
        });
        idExterno = r.messages?.[0]?.id ?? null;
        break;
      }
      case "whatsapp": {
        const instancia = s.instancia ?? (await instanciaPorNumero(d.numero_instancia ?? null));
        // Base64 e não URL: ver `paraEnvio` em lib/documentos.ts.
        const r = await enviarMidia(
          whatsapp,
          bytes.toString("base64"),
          { tipo: doc.tipo, texto, arquivoNome: doc.arquivoNome, mime: doc.mime },
          instancia,
          mensagemId,
        );
        idExterno = r.messageid;
        break;
      }
    }
    await confirmarEnvio(mensagemId, idExterno);
    await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${s.atendimentoId}`;
    return { mensagemId, movida: s.movida };
  } catch (erro) {
    await marcarErro(mensagemId, erro);
    return { erro: motivo(erro), registrada: true, mensagemId, movida: s.movida };
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
  const whatsapp = numeroDoDestino(d);

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

  const s = await saidaDaConversa(e.atendimentoId, d);
  await sql`
    INSERT INTO mensagens
      (id, atendimento_id, origem, autor_id, texto, status, enviada_por,
       tipo, midia_caminho, midia_mime, midia_tamanho, midia_estado)
    VALUES
      (${mensagemId}, ${s.atendimentoId}, 'agente', NULL, ${corpo}, 'pendente', ${e.enviadaPor},
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
        const instancia = s.instancia ?? (await instanciaPorNumero(d.numero_instancia ?? null));
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
    await sql`UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${s.atendimentoId}`;
    return { mensagemId, movida: s.movida };
  } catch (erro) {
    await marcarErro(mensagemId, erro);
    return { erro: motivo(erro), registrada: true, mensagemId, movida: s.movida };
  }
}
