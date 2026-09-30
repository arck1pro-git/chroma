"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; `exigirModulo` acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
//
// QUEM ENVIA é a sessão, nunca um parâmetro. Antes o autor vinha do navegador
// (`autorId`), e qualquer um podia assinar mensagem em nome de outra pessoa.
//
// ERROS VOLTAM COMO VALOR ({ erro }), não como exceção: em produção o Next
// troca a mensagem de exceção de server action por um texto genérico, e a tela
// precisa dizer o motivo ("janela fechada", "contato sem WhatsApp").
//
// Envio real, nos dois canais, com o mesmo ciclo:
//   1. grava a linha 'pendente' (não perde a mensagem se a rede cair)
//   2. dispara — uazapi (WhatsApp Web) ou Meta (API oficial), conforme o canal
//      da conversa
//   3. casa o retorno: id_externo + 'enviado', ou 'erro' com o motivo
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { exigirModulo } from "@/lib/auth/dal";
import { enviarMidia, instanciaPorNumero } from "@/lib/uazapi";
import { comCaminho, lerArquivo } from "@/lib/documentos";
import { soDigitos } from "@/lib/telefone";
import { eventoAoEntrarNaEtapa } from "@/lib/meta-eventos";
import { canalOficial, fim8, listarCanais } from "@/lib/canais";
import {
  enviarMidiaMeta,
  enviarTemplateMeta,
  subirMidiaMeta,
  templatesMeta,
  type TipoMidiaMeta,
} from "@/lib/meta";
import { textoDoTemplate, variaveisDe } from "@/lib/whatsapp-oficial";
import {
  confirmarEnvio,
  destinoDa,
  ehOficial,
  enviarTextoNaConversa,
  janelaAberta,
  marcarErro,
  motivo,
  telefoneOficial,
} from "@/lib/conversa-envio";
import { gravarIaDoContato } from "@/lib/ia/contato-ia";
import type { TemplateChat } from "./tipos";

/** `registrada`: a mensagem chegou a ser gravada (e está na conversa com o erro). */
export type Resultado = { erro?: string; registrada?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Responder é assumir: a conversa da fila (ou a que uma automação começou,
 * aberta sem dono) passa a ser de quem respondeu. Encerrada não muda — o
 * compositor nem aparece nela.
 */
async function assumirAoResponder(atendimentoId: string, usuarioId: string) {
  await sql`
    UPDATE atendimentos
       SET responsavel_id = COALESCE(responsavel_id, ${usuarioId}),
           status = CASE WHEN status = 'na_fila' THEN 'aberto' ELSE status END,
           lido_em = now(),
           data_atualizacao = now()
     WHERE id = ${atendimentoId}`;
}

// ── Texto ───────────────────────────────────────────────────────────────────

export async function enviarMensagem(atendimentoId: string, texto: string): Promise<Resultado> {
  const { usuario } = await exigirModulo("chat");
  // `crm` é gente digitando aqui — é o que cala a cadência para este contato
  // (migration-cadencia-controles.sql). O ciclo pendente → envio → retorno é o
  // mesmo da IA, e mora em lib/conversa-envio.ts.
  const r = await enviarTextoNaConversa({ atendimentoId, texto, autorId: usuario.id, enviadaPor: "crm" });
  if (!r.erro) await assumirAoResponder(atendimentoId, usuario.id);
  if (r.erro && !r.registrada) return { erro: r.erro };
  revalidatePath("/chat");
  return r.erro ? { erro: r.erro, registrada: true } : {};
}

// ── Documento da biblioteca ─────────────────────────────────────────────────

// O que a Cloud API aceita como imagem é só JPEG e PNG; o resto vai como
// documento em vez de ser recusado.
function tipoParaMeta(tipo: string, mime: string): TipoMidiaMeta {
  if (tipo === "imagem") return /^image\/(jpe?g|png)$/i.test(mime) ? "image" : "document";
  if (tipo === "video") return /^video\/(mp4|3gpp)$/i.test(mime) ? "video" : "document";
  if (tipo === "audio") return "audio";
  return "document";
}

/**
 * Manda um documento da biblioteca. Mesmo ciclo do texto.
 *
 * O ARQUIVO NÃO É COPIADO para a conversa: a mensagem aponta para a linha em
 * `documentos` (documento_id), e o balão pede o arquivo por /api/midia/<id da
 * mensagem>. Mandar a mesma tabela de preços para 300 contatos guarda um
 * arquivo, não 300.
 */
export async function enviarDocumento(
  atendimentoId: string,
  documentoId: string,
  legenda: string,
): Promise<Resultado> {
  const { usuario } = await exigirModulo("chat");

  const doc = UUID.test(documentoId) ? await comCaminho(documentoId) : null;
  if (!doc) return { erro: "Documento não encontrado na biblioteca." };
  const texto = legenda.trim().slice(0, 1024);

  const d = await destinoDa(atendimentoId);
  if (!d) return { erro: "Conversa não encontrada." };
  if (!d.whatsapp) return { erro: "O contato não tem número de WhatsApp." };
  if (ehOficial(d) && !janelaAberta(d)) {
    return { erro: "A janela de 24h está fechada. Envie um template antes do anexo." };
  }

  const [msg] = await sql`
    INSERT INTO mensagens
      (atendimento_id, origem, autor_id, texto, status, enviada_por,
       tipo, documento_id, midia_estado, midia_mime, midia_nome, midia_tamanho)
    VALUES
      (${atendimentoId}, 'agente', ${usuario.id}, ${texto}, 'pendente', 'crm',
       ${doc.tipo}, ${doc.id}, 'salva', ${doc.mime}, ${doc.arquivoNome}, ${doc.tamanho})
    RETURNING id`;

  try {
    const bytes = await lerArquivo(doc.caminho);
    let idExterno: string | null;
    if (ehOficial(d)) {
      const telefoneId = await telefoneOficial(d);
      const midiaId = await subirMidiaMeta(telefoneId, bytes, doc.mime, doc.arquivoNome);
      const r = await enviarMidiaMeta(telefoneId, soDigitos(d.whatsapp), tipoParaMeta(doc.tipo, doc.mime), midiaId, {
        legenda: texto,
        arquivoNome: doc.arquivoNome,
      });
      idExterno = r.messages?.[0]?.id ?? null;
    } else {
      const instancia = await instanciaPorNumero(d.numero_instancia ?? null);
      // Base64 e não URL: ver `paraEnvio` em lib/documentos.ts.
      const r = await enviarMidia(
        soDigitos(d.whatsapp),
        bytes.toString("base64"),
        { tipo: doc.tipo, texto, arquivoNome: doc.arquivoNome, mime: doc.mime },
        instancia,
        msg.id,
      );
      idExterno = r.messageid;
    }
    await confirmarEnvio(msg.id, idExterno);
    await assumirAoResponder(atendimentoId, usuario.id);
  } catch (e) {
    await marcarErro(msg.id, e);
    revalidatePath("/chat");
    return { erro: motivo(e), registrada: true };
  }

  revalidatePath("/chat");
  return {};
}

// ── Templates (API oficial) ─────────────────────────────────────────────────

type Componente = {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string }>;
};

function paraTemplateChat(t: { name: string; language: string; category: string; components: Array<Record<string, unknown>> }): TemplateChat {
  const comps = t.components as Componente[];
  const achar = (tipo: string) => comps.find((c) => String(c.type ?? "").toUpperCase() === tipo);
  const cab = achar("HEADER");
  const corpo = achar("BODY");
  const rodape = achar("FOOTER");
  const botoes = achar("BUTTONS")?.buttons ?? [];
  const cabTexto = cab && String(cab.format ?? "").toUpperCase() === "TEXT" ? (cab.text ?? "") : null;

  let bloqueio: string | null = null;
  if (cab && cabTexto === null) {
    bloqueio = "Tem cabeçalho de imagem, vídeo ou documento — envie pela tela de Campanhas.";
  } else if (botoes.some((b) => /\{\{\d+\}\}/.test(b.url ?? ""))) {
    bloqueio = "Tem botão com link variável — envie pela tela de Campanhas.";
  }

  return {
    nome: t.name,
    idioma: t.language,
    categoria: t.category,
    cabecalho: cabTexto,
    corpo: corpo?.text ?? "",
    rodape: rodape?.text ?? null,
    botoes: botoes.map((b) => b.text ?? "").filter(Boolean),
    variaveisCabecalho: variaveisDe(cabTexto ?? ""),
    variaveisCorpo: variaveisDe(corpo?.text),
    bloqueio,
  };
}

async function templatesDoCanal(numeroCanal: string | null): Promise<TemplateChat[]> {
  const canal = await canalOficial(numeroCanal);
  if (!canal?.wabaId) throw new Error("O número desta conversa não aparece na conta da Meta.");
  const lista = await templatesMeta(canal.wabaId);
  return lista
    .filter((t) => t.status === "APPROVED")
    .map(paraTemplateChat)
    .sort((a, b) => Number(a.bloqueio !== null) - Number(b.bloqueio !== null) || a.nome.localeCompare(b.nome));
}

/** Os templates aprovados do número desta conversa, para o seletor. */
export async function listarTemplates(
  atendimentoId: string,
): Promise<{ templates?: TemplateChat[]; erro?: string }> {
  await exigirModulo("chat");
  const d = await destinoDa(atendimentoId);
  if (!d || !ehOficial(d)) return { erro: "Templates são só da API oficial." };
  try {
    return { templates: await templatesDoCanal(d.numero_instancia) };
  } catch (e) {
    return { erro: motivo(e) };
  }
}

/**
 * Manda um template — o único jeito de falar pela API oficial fora da janela
 * de 24h. O template é conferido AQUI de novo (aprovado, variáveis
 * preenchidas): o que a tela manda é só o nome e os valores.
 */
export async function enviarTemplate(
  atendimentoId: string,
  nome: string,
  idioma: string,
  valores: { cabecalho: string[]; corpo: string[] },
): Promise<Resultado> {
  const { usuario } = await exigirModulo("chat");
  const d = await destinoDa(atendimentoId);
  if (!d || !ehOficial(d)) return { erro: "Templates são só da API oficial." };
  if (!d.whatsapp) return { erro: "O contato não tem número de WhatsApp." };

  let template: TemplateChat | undefined;
  try {
    template = (await templatesDoCanal(d.numero_instancia)).find((t) => t.nome === nome && t.idioma === idioma);
  } catch (e) {
    return { erro: motivo(e) };
  }
  if (!template) return { erro: "Template não encontrado ou não aprovado." };
  if (template.bloqueio) return { erro: template.bloqueio };

  const cabecalho = (valores.cabecalho ?? []).slice(0, template.variaveisCabecalho).map((v) => v.trim());
  const corpo = (valores.corpo ?? []).slice(0, template.variaveisCorpo).map((v) => v.trim());
  if (cabecalho.length < template.variaveisCabecalho || corpo.length < template.variaveisCorpo || [...cabecalho, ...corpo].some((v) => !v)) {
    return { erro: "Preencha todas as variáveis do template." };
  }

  const componentes: Array<Record<string, unknown>> = [];
  if (cabecalho.length) componentes.push({ type: "header", parameters: cabecalho.map((text) => ({ type: "text", text })) });
  if (corpo.length) componentes.push({ type: "body", parameters: corpo.map((text) => ({ type: "text", text })) });

  const texto = textoDoTemplate(
    [
      ...(template.cabecalho !== null ? [{ type: "HEADER", format: "TEXT", text: template.cabecalho }] : []),
      { type: "BODY", text: template.corpo },
      ...(template.rodape ? [{ type: "FOOTER", text: template.rodape }] : []),
    ],
    { cabecalho, corpo },
  );

  const [msg] = await sql`
    INSERT INTO mensagens (atendimento_id, origem, autor_id, texto, status, enviada_por)
    VALUES (${atendimentoId}, 'agente', ${usuario.id}, ${texto}, 'pendente', 'crm')
    RETURNING id`;

  try {
    const r = await enviarTemplateMeta(await telefoneOficial(d), {
      to: d.whatsapp,
      name: template.nome,
      language: template.idioma,
      components: componentes,
    });
    await confirmarEnvio(msg.id, r.messages?.[0]?.id ?? null);
    await assumirAoResponder(atendimentoId, usuario.id);
  } catch (e) {
    await marcarErro(msg.id, e);
    revalidatePath("/chat");
    return { erro: motivo(e), registrada: true };
  }

  revalidatePath("/chat");
  return {};
}

// ── Nova conversa ───────────────────────────────────────────────────────────

export type ContatoBusca = { id: string; nome: string; whatsapp: string | null; email: string | null };

/** Busca de contato para "Nova conversa": nome, e-mail ou pedaço do telefone. */
export async function buscarContatos(termo: string): Promise<ContatoBusca[]> {
  await exigirModulo("chat");
  const t = termo.trim().slice(0, 80).toLowerCase();
  const digitos = soDigitos(t);
  const linhas = await sql`
    SELECT id, nome, whatsapp, email FROM contatos
    WHERE ${t} = ''
       OR position(${t} in lower(nome)) > 0
       OR position(${t} in lower(coalesce(email, ''))) > 0
       OR (${digitos.length >= 3} AND position(${digitos} in regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) > 0)
    ORDER BY nome
    LIMIT 30`;
  return linhas as unknown as ContatoBusca[];
}

/**
 * Abre a conversa do contato NO CANAL escolhido — uma por par de números
 * (ux_atendimento_contato_numero). Reusa a que existir; a encerrada volta
 * aberta com quem iniciou.
 *
 * O canal é obrigatório. Antes a conversa nascia sem número quando havia mais
 * de uma instância, e o primeiro envio dela não sabia por onde sair.
 */
export async function iniciarConversa(
  contatoId: string,
  canalChave: string,
): Promise<{ id?: string; erro?: string }> {
  const { usuario } = await exigirModulo("chat");
  if (!UUID.test(contatoId)) return { erro: "Contato inválido." };

  const canal = (await listarCanais()).find((c) => fim8(c.chave) === fim8(canalChave));
  if (!canal) return { erro: "Escolha por qual número a conversa vai sair." };

  const [contato] = await sql`SELECT whatsapp FROM contatos WHERE id = ${contatoId}`;
  if (!contato) return { erro: "Contato não encontrado." };
  if (!soDigitos((contato.whatsapp as string | null) ?? "")) {
    return { erro: "Este contato não tem número de WhatsApp. Cadastre o número antes." };
  }

  const tipoCanal = canal.tipo === "api" ? "whatsapp_oficial" : "whatsapp";
  const alvo = fim8(canal.chave);

  const [existente] = await sql`
    SELECT id, status FROM atendimentos
    WHERE contato_id = ${contatoId}
      AND right(regexp_replace(coalesce(numero_instancia, ''), '[^0-9]', '', 'g'), 8) = ${alvo}
    LIMIT 1`;
  if (existente) {
    if (existente.status === "encerrado") {
      await sql`
        UPDATE atendimentos
           SET status = 'aberto', responsavel_id = ${usuario.id}, data_atualizacao = now()
         WHERE id = ${existente.id}`;
    }
    revalidatePath("/chat");
    return { id: existente.id as string };
  }

  // Conversa antiga deste contato que ficou SEM número (a tela criava assim):
  // adota em vez de abrir uma segunda ao lado.
  const [semNumero] = await sql`
    UPDATE atendimentos
       SET numero_instancia = ${canal.chave}, canal = ${tipoCanal},
           status = 'aberto', responsavel_id = COALESCE(responsavel_id, ${usuario.id}),
           data_atualizacao = now()
     WHERE id = (SELECT id FROM atendimentos
                  WHERE contato_id = ${contatoId} AND numero_instancia IS NULL
                  LIMIT 1)
    RETURNING id`;
  if (semNumero) {
    revalidatePath("/chat");
    return { id: semNumero.id as string };
  }

  const [novo] = await sql`
    INSERT INTO atendimentos (contato_id, responsavel_id, status, canal, numero_instancia)
    VALUES (${contatoId}, ${usuario.id}, 'aberto', ${tipoCanal}, ${canal.chave})
    RETURNING id`;
  revalidatePath("/chat");
  return { id: novo.id as string };
}

// ── Ciclo do atendimento ────────────────────────────────────────────────────

/** Assumir: vira de quem clicou e abre. lido_em = agora zera as não lidas. */
export async function assumirAtendimento(id: string): Promise<void> {
  const { usuario } = await exigirModulo("chat");
  if (!UUID.test(id)) return;
  await sql`
    UPDATE atendimentos
       SET responsavel_id = ${usuario.id}, status = 'aberto', lido_em = now()
     WHERE id = ${id}`;
  revalidatePath("/chat");
}

export async function encerrarAtendimento(id: string): Promise<void> {
  await exigirModulo("chat");
  if (!UUID.test(id)) return;
  await sql`UPDATE atendimentos SET status = 'encerrado', lido_em = now() WHERE id = ${id}`;
  revalidatePath("/chat");
}

export async function reabrirAtendimento(id: string): Promise<void> {
  const { usuario } = await exigirModulo("chat");
  if (!UUID.test(id)) return;
  await sql`
    UPDATE atendimentos
       SET status = 'aberto', responsavel_id = ${usuario.id}
     WHERE id = ${id}`;
  revalidatePath("/chat");
}

/**
 * O interruptor de IA do contato, direto da conversa. `null` volta a seguir a
 * etapa; `true` pede qual IA (`iaId`). Mesma gravação da gaveta do dashboard
 * (lib/ia/contato-ia.ts).
 */
export async function definirIaDoContatoNoChat(
  contatoId: string,
  valor: boolean | null,
  iaId: string | null,
): Promise<Resultado> {
  const { usuario } = await exigirModulo("chat");
  if (!UUID.test(contatoId)) return { erro: "Contato inválido." };
  if (iaId !== null && !UUID.test(iaId)) return { erro: "IA inválida." };
  const r = await gravarIaDoContato(contatoId, valor, iaId, usuario.id);
  if (r.erro) return r;
  revalidatePath("/chat");
  revalidatePath("/");
  return {};
}

/** Abriu = leu. É o que zera as não lidas na lista e no canal. */
export async function marcarLido(id: string): Promise<void> {
  await exigirModulo("chat");
  if (!UUID.test(id)) return;
  await sql`UPDATE atendimentos SET lido_em = now() WHERE id = ${id}`;
  revalidatePath("/chat");
}

// Cria oportunidade a partir da conversa (o contato é o dela). A FK composta
// (etapa_id, funil_id) garante que a etapa é do funil escolhido.
export async function criarOportunidade(
  contatoId: string,
  funilId: string,
  etapaId: string,
  nome: string,
  valor: number,
  responsavelId: string | null,
): Promise<Resultado> {
  await exigirModulo("chat");
  const n = nome.trim();
  if (!n) return { erro: "Dê um nome à oportunidade." };
  if (!UUID.test(contatoId)) return { erro: "Sem contato." };
  if (!UUID.test(funilId) || !UUID.test(etapaId)) return { erro: "Escolha o funil e a etapa." };

  try {
    const [op] = await sql`
      INSERT INTO oportunidades
        (nome, contato_id, valor, responsavel_id, status, funil_id, etapa_id)
      VALUES
        (${n}, ${contatoId}, ${Number.isFinite(valor) ? valor : 0}, ${responsavelId || null}, 'aberta', ${funilId}, ${etapaId})
      RETURNING id`;
    // Nasceu dentro da etapa: conta como entrada (evento da Meta, se configurado).
    eventoAoEntrarNaEtapa(op.id, etapaId);
  } catch (e) {
    return { erro: motivo(e) };
  }
  revalidatePath("/chat");
  revalidatePath("/");
  return {};
}
