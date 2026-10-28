// Os blocos do MOTOR que MANDAM mensagem ao contato (lib/campanhas-whatsapp.ts
// explica o motor inteiro): Enviar template, pela Meta, e Enviar texto e Enviar
// arquivo, pela conversa (lib/conversa-envio.ts). Dividido do motor em 2026-10-28.
//
// NUNCA EM DOBRO: o evento 'enviando' é gravado antes de falar com a Meta e o
// evento do bloco depois. Começou e não voltou (tentativaAnterior
// 'sem_confirmacao'), a execução falha em vez de reenviar no escuro.
import "server-only";
import { sql } from "@/lib/db";
import { enviarTemplateMeta, templatesMeta, type TemplateMeta } from "@/lib/meta";
import { prepararMidiaDoCabecalho, registrarEnvioOficial, textoDoTemplate } from "@/lib/whatsapp-oficial";
import { enviarDocumentoNaConversa, enviarTextoNaConversa } from "@/lib/conversa-envio";
import { comCaminho } from "@/lib/documentos";
import {
  ajustarValores,
  componentesDoEnvio,
  DADOS_NA_CAMPANHA,
  lerTemplate,
  linksVariaveisDe,
  midiaDoCabecalho,
  problemaNoEnvio,
  valoresParaContato,
  variaveisDoTemplate,
  type DadosDoContato,
} from "@/lib/templates-whatsapp";
import type { BlocoCampanha } from "@/lib/campanhas-fluxo";
import { problemaDoArquivoDaCampanha } from "@/lib/campanhas-fluxo-envios";
import {
  ADIAR_MINUTOS,
  conversaOficial,
  dadosDe,
  estacionar,
  evento,
  eventoBloco,
  falhar,
  motivo,
  PAROU,
  segue,
  temGente,
  type Execucao,
  type Passo,
} from "@/lib/campanhas-whatsapp-base";

/** Os templates de cada conta, lidos uma vez por rodada e só se algum bloco enviar. null = a Meta não respondeu. */
export type Rodada = { templates: (waba: string) => Promise<Map<string, TemplateMeta> | null> };

export function novaRodada(): Rodada {
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

/** O payload dos botões de resposta rápida: diz de qual execução é o clique, sem expor nada. */
export const payloadDoBotao = (execucaoId: string, blocoId: string) => `cw:${execucaoId}:${blocoId}`;
export const PAYLOAD = /^cw:([0-9a-f-]{36}):([a-z0-9_-]{1,40})$/;

export async function enviarTemplate(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "enviar_template" }>, rodada: Rodada): Promise<Passo> {
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
  // Cabeçalho de imagem, vídeo ou documento: o arquivo da biblioteca, conferido
  // e subido para a Meta uma vez por número e documento (lib/whatsapp-oficial.ts).
  const cabecalho = await prepararMidiaDoCabecalho({ telefoneId: e.telefone_id, para: e.whatsapp, pede: midiaDoCabecalho(lido), documentoId: valores.midia });
  if ("erro" in cabecalho) return recusar(cabecalho.erro);

  await evento(e.campanha_id, e.id, "enviando", { bloco: id });
  let wamid: string | null;
  try {
    const r = await enviarTemplateMeta(e.telefone_id, {
      to: e.whatsapp,
      name: b.template_nome,
      language: b.template_idioma,
      components: componentesDoEnvio(valores, botoes, cabecalho.midia),
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
    midia: cabecalho.midia,
  });
  return segue(b.proximo);
}

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
export async function enviarTexto(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "enviar_texto" }>): Promise<Passo> {
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

/**
 * Um arquivo da biblioteca pela conversa, pelo MESMO caminho do anexo do /chat
 * (enviarDocumentoNaConversa, lib/conversa-envio.ts: janela de 24h real, linha
 * pendente antes, o arquivo por id da mídia na Meta). Como o texto livre: não
 * sair não para o fluxo, fica registrado e o contato segue. O arquivo é
 * conferido de novo aqui: pode ter sido arquivado depois da ativação.
 */
export async function enviarArquivo(e: Execucao, id: string, b: Extract<BlocoCampanha, { tipo: "enviar_arquivo" }>): Promise<Passo> {
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
  if (temGente(conversa)) return pular("A conversa está com alguém da equipe: arquivo não enviado.");
  const doc = await comCaminho(b.documentoId);
  if (!doc || doc.arquivado) return pular("O arquivo não está mais disponível na biblioteca.");
  const fora = problemaDoArquivoDaCampanha(doc);
  if (fora) return pular(fora);
  const legenda = textoParaContato(b.legenda, dadosDe(e));
  if (typeof legenda !== "string") return pular(`Contato sem ${legenda.falta}.`);

  await evento(e.campanha_id, e.id, "enviando", { bloco: id });
  const r = await enviarDocumentoNaConversa({
    atendimentoId: conversa.id,
    documentoId: b.documentoId,
    legenda,
    autorId: null,
    enviadaPor: "automacao",
  });
  if (r.erro) {
    await eventoBloco(e, id, b, { saida: "proximo", ok: false, erro: r.erro });
    return segue(b.proximo);
  }
  const [m] = r.mensagemId ? await sql`SELECT id_externo FROM mensagens WHERE id = ${r.mensagemId}::uuid` : [];
  await eventoBloco(e, id, b, { saida: "proximo", ok: true, wamid: (m?.id_externo as string | null) ?? null });
  return segue(b.proximo);
}
