// A API oficial (Cloud API da Meta) dentro das conversas do CRM.
//
// É o par do app/api/uazapi/webhook para o outro canal: o que chega ao número
// oficial vira contato + atendimento + mensagem, exatamente como o que chega a
// um WhatsApp Web — só que com `canal = 'whatsapp_oficial'` e o número da Meta
// em `numero_instancia`. É esse par (canal, número) que o /chat usa para
// separar "Comercial" de "Automações e IA".
//
// Três entradas:
//   · processarWebhookOficial → mensagens recebidas e status (enviado,
//                               entregue, lido, falhou) do webhook da Meta.
//                               Devolve cada mensagem (MensagemRecebida) para
//                               as campanhas: botão clicado, citação, número.
//   · registrarEnvioOficial   → o que NÓS mandamos por fora do /chat
//                               (campanhas). A Meta não ecoa o que sai pela
//                               API, então sem isto a conversa mostraria só a
//                               resposta do cliente, sem a mensagem que a puxou.
//   · prepararMidiaDoCabecalho → o documento da biblioteca que vai no
//                               cabeçalho de imagem, vídeo ou documento de um
//                               template (chat e campanha), já subido na Meta.
//
// Contrato do webhook (documentação da Cloud API, "messages"):
//   entry[].changes[].value = {
//     metadata: { display_phone_number, phone_number_id },
//     contacts: [{ wa_id, profile: { name } }],
//     messages: [{ from, id, timestamp, type, text|image|audio|… }],
//     statuses: [{ id, status, timestamp, recipient_id, errors? }],
//   }
import "server-only";
import { sql } from "@/lib/db";
import { chaveTelefone, soDigitos } from "@/lib/telefone";
import { subirMidiaMeta } from "@/lib/meta";
import { comCaminho, lerArquivo } from "@/lib/documentos";
import { conferirDestino } from "@/lib/destino-permitido";
import {
  problemaDaMidia,
  problemaDoArquivoDoCabecalho,
  type MidiaDoCabecalho,
  type MidiaNaMeta,
} from "@/lib/templates-whatsapp";
import type { TipoMensagem } from "@/lib/midia";

type MidiaMeta = { id?: string; mime_type?: string; caption?: string; filename?: string };

type MensagemMeta = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: MidiaMeta;
  video?: MidiaMeta;
  audio?: MidiaMeta;
  document?: MidiaMeta;
  sticker?: MidiaMeta;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  /** Clique em botão de resposta rápida de template: `payload` é o que mandamos no envio. */
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  /** A mensagem que a pessoa citou ao responder (inclusive o template do botão clicado). */
  context?: { id?: string; from?: string };
};

type StatusMeta = {
  id?: string;
  status?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
};

export type ValorWebhookMeta = {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: MensagemMeta[];
  statuses?: StatusMeta[];
};

type Conteudo = {
  texto: string;
  tipo: TipoMensagem;
  /** `meta:<id>` — lib/midia.ts sabe baixar por aí. */
  origem: string | null;
  mime: string | null;
  nome: string | null;
};

const TIPO_MIDIA: Record<string, TipoMensagem> = {
  image: "imagem",
  video: "video",
  audio: "audio",
  document: "documento",
  sticker: "sticker",
};

/**
 * O que a mensagem diz, no formato das nossas colunas. `null` = não é algo que
 * valha virar mensagem (reação, aviso de sistema).
 *
 * Localização e cartão de contato viram TEXTO, e é de propósito: a trava
 * `ck_mensagens_midia` exige arquivo para qualquer tipo que não seja texto, e
 * nenhum dos dois tem arquivo. Escritos por extenso, com o link do mapa, eles
 * aparecem na conversa em vez de sumir num erro de constraint.
 */
export function conteudoDaMensagem(m: MensagemMeta): Conteudo | null {
  const tipo = m.type ?? "";
  const vazio = { origem: null, mime: null, nome: null };

  if (tipo === "text") return { texto: m.text?.body ?? "", tipo: "texto", ...vazio };

  if (tipo in TIPO_MIDIA) {
    const midia = (m as unknown as Record<string, MidiaMeta | undefined>)[tipo];
    if (!midia?.id) return { texto: "[anexo sem arquivo]", tipo: "texto", ...vazio };
    return {
      texto: midia.caption ?? "",
      tipo: TIPO_MIDIA[tipo],
      origem: `meta:${midia.id}`,
      mime: midia.mime_type ?? null,
      nome: midia.filename ?? null,
    };
  }

  if (tipo === "location" && m.location) {
    const { latitude, longitude, name, address } = m.location;
    const lugar = [name, address].filter(Boolean).join(" — ");
    const mapa =
      latitude != null && longitude != null
        ? `https://maps.google.com/?q=${latitude},${longitude}`
        : "";
    return { texto: ["📍 Localização", lugar, mapa].filter(Boolean).join("\n"), tipo: "texto", ...vazio };
  }

  if (tipo === "contacts" && m.contacts?.length) {
    const linhas = m.contacts.map((c) =>
      [c.name?.formatted_name, c.phones?.map((p) => p.phone).filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" · "),
    );
    return { texto: ["👤 Contato compartilhado", ...linhas].join("\n"), tipo: "texto", ...vazio };
  }

  // Resposta a botão de template e a mensagem interativa: o que a pessoa
  // clicou é o que ela "disse".
  if (tipo === "button") return { texto: m.button?.text ?? "", tipo: "texto", ...vazio };
  if (tipo === "interactive") {
    const r = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
    return { texto: r, tipo: "texto", ...vazio };
  }

  if (tipo === "reaction" || tipo === "system" || tipo === "ephemeral") return null;

  // Pedido, enquete, etc.: não sabemos desenhar, mas a pessoa ESCREVEU algo.
  // Melhor um aviso na conversa do que um buraco.
  return { texto: "[mensagem não suportada pelo CRM — veja no WhatsApp]", tipo: "texto", ...vazio };
}

// ── Contato e conversa ──────────────────────────────────────────────────────

const soNumero = (s: string) => /^[\d\s+()-]+$/.test(s.trim());

/**
 * O contato daquele número — o que já existe (casado pelos últimos 8 dígitos,
 * como no resto do app) ou um novo. Contato que nasceu só com o número ganha o
 * nome do perfil assim que ele aparece.
 */
export async function contatoDoNumero(numero: string, nomePerfil: string | null): Promise<string> {
  const fim8 = chaveTelefone(numero).slice(-8);
  const [existente] = await sql`
    SELECT id, nome FROM contatos
    WHERE regexp_replace(whatsapp, '[^0-9]', '', 'g') LIKE ${"%" + fim8}
    ORDER BY data_criacao
    LIMIT 1`;

  if (existente) {
    if (nomePerfil && soNumero(existente.nome as string)) {
      await sql`UPDATE contatos SET nome = ${nomePerfil} WHERE id = ${existente.id}`;
    }
    return existente.id as string;
  }

  const [novo] = await sql`
    INSERT INTO contatos (nome, whatsapp)
    VALUES (${nomePerfil || numero}, ${numero})
    RETURNING id`;
  return novo.id as string;
}

// ── Webhook ─────────────────────────────────────────────────────────────────

// Status só avança: um "entregue" atrasado não pode desfazer um "lido".
const ANTERIORES: Record<string, string[]> = {
  enviado: ["pendente"],
  entregue: ["pendente", "enviado"],
  lido: ["pendente", "enviado", "entregue"],
  erro: ["pendente", "enviado", "entregue"],
};

const STATUS_META: Record<string, string> = {
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "erro",
};

function motivoDaFalha(s: StatusMeta): string {
  const e = s.errors?.[0];
  if (!e) return "A Meta recusou a entrega (sem motivo informado).";
  const detalhe = e.error_data?.details ?? e.message;
  return [`${e.title ?? "Falha na entrega"}${e.code ? ` (${e.code})` : ""}`, detalhe]
    .filter(Boolean)
    .join(": ")
    .slice(0, 500);
}

async function registrarStatus(s: StatusMeta) {
  const novo = STATUS_META[s.status ?? ""];
  if (!s.id || !novo) return;
  const erro = novo === "erro" ? motivoDaFalha(s) : null;
  await sql`
    UPDATE mensagens
       SET status = ${novo}, erro = COALESCE(${erro}, erro)
     WHERE id_externo = ${s.id}
       -- Lista como UMA string: array cru não passa nesta conexão (ver lib/db.ts).
       AND status = ANY(string_to_array(${ANTERIORES[novo].join(",")}, ','))`;

  // Campanha que a Meta aceitou e depois não entregou: sem isto a execução
  // ficava "aguardando resposta" de uma mensagem que nunca chegou.
  if (novo === "erro") {
    await sql`
      UPDATE campanha_whatsapp_execucoes
         SET estado = 'falhou', erro = ${erro}, finalizado_em = now()
       WHERE mensagem_id_meta = ${s.id} AND estado = 'aguardando_resposta'`;
  }
}

/**
 * Uma mensagem recebida. Devolve `true` quando gravou algo NOVO com anexo a
 * baixar — quem chama agenda o download depois de responder à Meta.
 */
async function registrarRecebida(
  m: MensagemMeta,
  numeroCanal: string,
  nomePerfil: string | null,
): Promise<{ nova: boolean; midia: boolean; atendimentoId?: string; mensagemId?: string }> {
  const conteudo = conteudoDaMensagem(m);
  const numero = soDigitos(m.from ?? "");
  if (!conteudo || !numero || !m.id) return { nova: false, midia: false };

  const contatoId = await contatoDoNumero(numero, nomePerfil);

  // Uma conversa por par (contato, número nosso) — a trava é do banco
  // (ux_atendimento_contato_numero). Voltar a escrever reabre: encerrada vai
  // para a fila, e a conversa aberta SEM dono (a que uma automação começou)
  // também, porque agora há alguém esperando resposta.
  const [at] = await sql`
    INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
    VALUES (${contatoId}, 'na_fila', 'whatsapp_oficial', ${numeroCanal})
    ON CONFLICT (contato_id, numero_instancia) DO UPDATE
      SET status = CASE
            WHEN atendimentos.status = 'encerrado'
              OR (atendimentos.status = 'aberto' AND atendimentos.responsavel_id IS NULL)
            THEN 'na_fila'
            ELSE atendimentos.status
          END,
          canal = 'whatsapp_oficial',
          data_atualizacao = now()
    RETURNING id`;

  // A data é a do WhatsApp, não a da chegada do webhook: é ela que abre a
  // janela de 24h, e a Meta pode reenviar um evento minutos depois.
  const quando = Number(m.timestamp);
  const inseridas = await sql`
    INSERT INTO mensagens (
      atendimento_id, origem, texto, status, id_externo,
      tipo, midia_url_origem, midia_mime, midia_nome, midia_estado, data_criacao)
    VALUES (
      ${at.id}, 'contato', ${conteudo.texto}, 'recebido', ${m.id},
      ${conteudo.tipo}, ${conteudo.origem}, ${conteudo.mime}, ${conteudo.nome},
      ${conteudo.origem ? "pendente" : "ausente"},
      ${Number.isFinite(quando) && quando > 0 ? new Date(quando * 1000) : new Date()})
    ON CONFLICT (id_externo) WHERE id_externo IS NOT NULL DO NOTHING
    RETURNING id`;

  return {
    nova: inseridas.length > 0,
    midia: inseridas.length > 0 && Boolean(conteudo.origem),
    atendimentoId: at.id as string,
    mensagemId: inseridas[0]?.id as string | undefined,
  };
}

/**
 * Uma mensagem recebida, como as campanhas a leem (lib/campanhas-whatsapp.ts,
 * registrarResposta). `nova` = gravada agora (reentrega da Meta vem false);
 * `tipo` é o da Meta (text, button, interactive, reaction…); `texto` é o que a
 * conversa mostra; `botaoPayload` e `contextoId` dizem a qual envio ela
 * responde; `timestamp` em segundos, do WhatsApp.
 */
export type MensagemRecebida = {
  numero: string;
  id: string;
  nova: boolean;
  tipo: string;
  texto: string;
  botaoTexto: string | null;
  botaoPayload: string | null;
  contextoId: string | null;
  phoneNumberId: string | null;
  timestamp: number | null;
};

function mensagemRecebida(m: MensagemMeta & { from: string; id: string }, nova: boolean, phoneNumberId: string | null): MensagemRecebida {
  const quando = Number(m.timestamp);
  return {
    numero: m.from,
    id: m.id,
    nova,
    tipo: m.type ?? "",
    texto: conteudoDaMensagem(m)?.texto ?? "",
    botaoTexto: m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null,
    botaoPayload: m.button?.payload ?? m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null,
    contextoId: m.context?.id ?? null,
    phoneNumberId,
    timestamp: Number.isFinite(quando) && quando > 0 ? quando : null,
  };
}

/**
 * Processa um `value` do webhook (campo "messages"). Cada item é isolado: uma
 * mensagem que falha não impede as outras nem os status do mesmo lote.
 */
export async function processarWebhookOficial(
  valor: ValorWebhookMeta,
): Promise<{
  recebidas: number;
  comMidia: number;
  /** Cada mensagem gravada (nova ou reentrega), para as campanhas. */
  mensagens: MensagemRecebida[];
  /** As mensagens que entraram AGORA — é a elas que a IA pode responder. `id` é o da Meta. */
  novas: Array<{ atendimentoId: string; mensagemId: string; id: string }>;
}> {
  const numeroCanal = soDigitos(valor.metadata?.display_phone_number ?? "");
  const phoneNumberId = valor.metadata?.phone_number_id ?? null;
  const nomes = new Map(
    (valor.contacts ?? []).map((c) => [soDigitos(c.wa_id ?? ""), c.profile?.name?.trim() || null]),
  );

  let recebidas = 0;
  let comMidia = 0;
  const mensagens: MensagemRecebida[] = [];
  const novas: Array<{ atendimentoId: string; mensagemId: string; id: string }> = [];

  if (numeroCanal) {
    for (const m of valor.messages ?? []) {
      try {
        const r = await registrarRecebida(m, numeroCanal, nomes.get(soDigitos(m.from ?? "")) ?? null);
        if (r.nova) recebidas++;
        if (r.midia) comMidia++;
        if (m.from && m.id) {
          if (r.nova && r.atendimentoId && r.mensagemId) novas.push({ atendimentoId: r.atendimentoId, mensagemId: r.mensagemId, id: m.id });
          mensagens.push(mensagemRecebida({ ...m, from: m.from, id: m.id }, r.nova, phoneNumberId));
        }
      } catch (e) {
        console.error("[whatsapp oficial] falhei ao gravar mensagem", m.id, e);
      }
    }
  }

  for (const s of valor.statuses ?? []) {
    try {
      await registrarStatus(s);
    } catch (e) {
      console.error("[whatsapp oficial] falhei ao gravar status", s.id, e);
    }
  }

  return { recebidas, comMidia, mensagens, novas };
}

// ── Envio feito fora do /chat ───────────────────────────────────────────────

/**
 * Registra na conversa uma mensagem que saiu pela API oficial por outro
 * caminho (campanha). Não lança: quem chama já enviou, e falhar aqui não pode
 * transformar um envio bem-sucedido em erro.
 *
 * Conversa nova nasce 'aberto' e SEM dono: é a automação falando, ninguém da
 * equipe assumiu. Quando o contato responder, o webhook a joga para a fila.
 *
 * `midia`: o template saiu com imagem, vídeo ou documento no cabeçalho. A linha
 * aponta para o documento da biblioteca (documento_id), como o anexo do chat
 * (lib/conversa-envio.ts), e o balão mostra o arquivo com o texto embaixo.
 */
export async function registrarEnvioOficial(e: {
  contatoId: string;
  numeroCanal: string;
  texto: string;
  wamid: string | null;
  enviadaPor: "automacao" | "crm";
  autorId?: string | null;
  midia?: MidiaDoCabecalhoPronta | null;
}): Promise<void> {
  const m = e.midia ?? null;
  try {
    const numeroCanal = soDigitos(e.numeroCanal);
    if (!numeroCanal) return;
    const [at] = await sql`
      INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
      VALUES (${e.contatoId}, 'aberto', 'whatsapp_oficial', ${numeroCanal})
      ON CONFLICT (contato_id, numero_instancia) DO UPDATE
        SET data_atualizacao = now()
      RETURNING id`;
    await sql`
      INSERT INTO mensagens
        (atendimento_id, origem, autor_id, texto, status, id_externo, enviada_por,
         tipo, documento_id, midia_estado, midia_mime, midia_nome, midia_tamanho)
      VALUES
        (${at.id}, 'agente', ${e.autorId ?? null}, ${e.texto}, 'enviado', ${e.wamid}, ${e.enviadaPor},
         ${m?.tipo ?? "texto"}, ${m?.documentoId ?? null}, ${m ? "salva" : "ausente"},
         ${m?.mime ?? null}, ${m?.arquivoNome ?? null}, ${m?.tamanho ?? null})
      ON CONFLICT (id_externo) WHERE id_externo IS NOT NULL DO NOTHING`;
  } catch (erro) {
    console.error("[whatsapp oficial] não registrei o envio na conversa:", erro);
  }
}

// ── Cabeçalho de mídia do template ──────────────────────────────────────────
//
// Template aprovado com imagem, vídeo ou documento no cabeçalho (desde
// 2026-10-28) leva um documento da BIBLIOTECA. Sai pelo mesmo caminho do anexo
// do chat (lib/conversa-envio.ts): os bytes sobem para /<PHONE_ID>/media
// (subirMidiaMeta) e o envio leva o id. Link assinado não: a Meta busca o link
// quando quer, e a biblioteca é acervo atrás de login.
//
// Numa campanha o mesmo arquivo vai para muitos contatos: o id fica guardado em
// memória por número e documento para não subir a cada envio. A Meta guarda a
// mídia por 30 dias; aqui ela vale 7, com folga. É memória do processo, não
// fila: outra instância da Vercel sobe de novo, uma vez. O documento não muda
// de bytes (renomear muda só o nome), então a chave não envelhece por isso.

/** A mídia pronta para componentesDoEnvio e para registrarEnvioOficial. */
export type MidiaDoCabecalhoPronta = MidiaNaMeta & { documentoId: string; mime: string; tamanho: number };

const VALIDADE_DO_ID_MS = 7 * 24 * 60 * 60 * 1000;
const MAXIMO_DE_IDS = 200;
const idsNaMeta = new Map<string, { id: Promise<string>; ate: number }>();

function idNaMeta(telefoneId: string, doc: { id: string; caminho: string; mime: string; arquivoNome: string }): Promise<string> {
  const chave = `${telefoneId}|${doc.id}`;
  const guardado = idsNaMeta.get(chave);
  if (guardado && guardado.ate > Date.now()) return guardado.id;
  // A promessa, e não o id: dois envios ao mesmo tempo esperam o mesmo upload.
  const id = lerArquivo(doc.caminho).then((bytes) => subirMidiaMeta(telefoneId, bytes, doc.mime, doc.arquivoNome));
  idsNaMeta.delete(chave);
  if (idsNaMeta.size >= MAXIMO_DE_IDS) idsNaMeta.delete(idsNaMeta.keys().next().value as string);
  idsNaMeta.set(chave, { id, ate: Date.now() + VALIDADE_DO_ID_MS });
  // Upload que falhou sai da memória: a próxima tentativa sobe de novo. Quem
  // espera `id` recebe o erro do mesmo jeito.
  id.catch(() => {
    if (idsNaMeta.get(chave)?.id === id) idsNaMeta.delete(chave);
  });
  return id;
}

/**
 * O cabeçalho de mídia deste envio, pronto: confere o documento (existe, não
 * está arquivado, é do tipo, do formato e do tamanho que a Cloud API aceita,
 * por problemaDoArquivoDoCabecalho) e sobe para a Meta, ou reaproveita o id
 * já subido. `pede` é midiaDoCabecalho do template; `{ midia: null }` quando
 * o template não tem cabeçalho de mídia. Recusa e falha do upload voltam como
 * `{ erro }`: o chat mostra, a campanha registra no contato.
 *
 * `para` é o WhatsApp do contato: a trava do dev (WHATSAPP_SO_PARA) vem antes
 * do upload, como antes da voz da IA. Sem ela o arquivo subiria para a Meta e
 * só o envio seria barrado.
 */
export async function prepararMidiaDoCabecalho(e: {
  telefoneId: string;
  para: string;
  pede: MidiaDoCabecalho | null;
  documentoId: unknown;
}): Promise<{ midia: MidiaDoCabecalhoPronta | null } | { erro: string }> {
  const recusa = problemaDaMidia(e.pede, e.documentoId);
  if (recusa) return { erro: recusa };
  if (!e.pede || typeof e.documentoId !== "string") return { midia: null };
  const doc = await comCaminho(e.documentoId.trim());
  if (!doc) return { erro: "O arquivo do cabeçalho não está mais na biblioteca." };
  const problema = problemaDoArquivoDoCabecalho(e.pede, doc);
  if (problema) return { erro: problema };
  try {
    conferirDestino(e.para);
  } catch (bloqueio) {
    return { erro: bloqueio instanceof Error ? bloqueio.message : String(bloqueio) };
  }
  try {
    const id = await idNaMeta(e.telefoneId, doc);
    return { midia: { tipo: e.pede, id, arquivoNome: doc.arquivoNome, documentoId: doc.id, mime: doc.mime, tamanho: doc.tamanho } };
  } catch (falha) {
    console.error("[whatsapp oficial] não subi o arquivo do cabeçalho", doc.id, falha);
    return { erro: `O arquivo do cabeçalho não subiu para a Meta: ${(falha instanceof Error ? falha.message : String(falha)).slice(0, 300)}` };
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

type ComponenteTemplate = { type?: string; format?: string; text?: string };

/** "Olá {{1}}" + ["Ana"] → "Olá Ana". Variável sem valor fica como estava. */
export function preencher(texto: string, valores: string[]): string {
  return texto.replace(/\{\{(\d+)\}\}/g, (bruto, n) => valores[Number(n) - 1] ?? bruto);
}

/**
 * O texto que o contato lê — cabeçalho, corpo e rodapé — para guardar na
 * conversa. Botões ficam de fora: são ação, não conteúdo.
 */
export function textoDoTemplate(
  componentes: Array<Record<string, unknown>> | ComponenteTemplate[],
  valores: { cabecalho?: string[]; corpo?: string[] } = {},
): string {
  const lista = componentes as ComponenteTemplate[];
  const achar = (t: string) => lista.find((c) => String(c.type ?? "").toUpperCase() === t);
  const cab = achar("HEADER");
  const corpo = achar("BODY");
  const rodape = achar("FOOTER");
  return [
    cab?.format?.toUpperCase() === "TEXT" && cab.text ? `*${preencher(cab.text, valores.cabecalho ?? [])}*` : "",
    corpo?.text ? preencher(corpo.text, valores.corpo ?? []) : "",
    rodape?.text ? `_${rodape.text}_` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
