import "server-only";
import { sql } from "@/lib/db";
import { enviarTemplateMeta, telefonesMeta, templatesMeta, type TemplateMeta } from "@/lib/meta";
import { registrarEnvioOficial, textoDoTemplate } from "@/lib/whatsapp-oficial";
import { eventoAoEntrarNaEtapa } from "@/lib/meta-eventos";
import {
  ajustarValores,
  componentesDoEnvio,
  dadosDoContato,
  lerTemplate,
  problemaNoEnvio,
  valoresParaContato,
  variaveisDoTemplate,
  type ValoresDoEnvio,
} from "@/lib/templates-whatsapp";

// GRAVAR a definição com sql.json: até 2026-10-27 ela ia como
// `${JSON.stringify(definicao)}::jsonb`, que grava uma STRING JSON — e
// lerDefinicao, que só lê objeto, devolvia os padrões (sem ações, prazo de 1
// dia). As campanhas já ativadas continuam assim de propósito: passar a ler a
// string faria campanhas no ar começarem a executar ações que nunca rodaram. O
// RASCUNHO, que nunca rodou, é lido de verdade na ativação (definicaoDoRascunho).

export type AcaoCampanha =
  | { tipo: "adicionar_tag"; tagId: string }
  | { tipo: "adicionar_segmento"; segmentoId: string }
  | { tipo: "criar_oportunidade"; funilId: string; etapaId: string; nome: string }
  | { tipo: "registrar_lead" };

export type DefinicaoCampanha = {
  template_nome: string;
  template_idioma: string;
  espera_minutos: number;
  /** O valor de cada {{n}}: texto fixo ou marca de dado do contato ({{primeiro_nome}}). */
  variaveis: ValoresDoEnvio;
  ao_responder: AcaoCampanha[];
  ao_expirar: AcaoCampanha[];
};

/**
 * A definição normalizada. `coluna` é o template guardado nas colunas da
 * campanha: vale quando a definição não traz o seu — inclusive o IDIOMA, que
 * antes caía em pt_BR e recusava campanha antiga de template em outra língua.
 */
export function lerDefinicao(valor: unknown, coluna?: { template_nome?: string; template_idioma?: string }): DefinicaoCampanha {
  const bruto = valor && typeof valor === "object" ? valor as Record<string, unknown> : {};
  const espera = Math.min(43_200, Math.max(5, Number(bruto.espera_minutos) || 1440));
  const texto = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : "");
  return {
    template_nome: texto(bruto.template_nome, 512) || coluna?.template_nome || "",
    template_idioma: texto(bruto.template_idioma, 20) || coluna?.template_idioma || "pt_BR",
    espera_minutos: espera,
    variaveis: lerVariaveis(bruto.variaveis),
    ao_responder: lerAcoes(bruto.ao_responder),
    ao_expirar: lerAcoes(bruto.ao_expirar),
  };
}

function lerVariaveis(valor: unknown): ValoresDoEnvio {
  const v = valor && typeof valor === "object" ? valor as Record<string, unknown> : {};
  const lista = (x: unknown, maximo: number) =>
    Array.isArray(x) ? x.slice(0, maximo).map((i) => (typeof i === "string" ? i.slice(0, 500) : "")) : [];
  return { cabecalho: lista(v.cabecalho, 1), corpo: lista(v.corpo, 100) };
}

/**
 * Confere na Meta o template da campanha: aprovado e com toda variável
 * preenchida com texto ou dado do contato. Devolve o motivo da recusa, ou null.
 * Criação, ativação e a IA de campanhas passam por aqui.
 */
export async function recusaDoTemplate(wabaId: string, definicao: DefinicaoCampanha): Promise<string | null> {
  const template = (await templatesMeta(wabaId)).find(
    (t) => t.name === definicao.template_nome && t.language === definicao.template_idioma && t.status === "APPROVED",
  );
  if (!template) return "Escolha um template aprovado pela Meta.";
  return problemaNoEnvio(lerTemplate(template), definicao.variaveis);
}

/**
 * O número que envia, conferido na conta: o id vem do navegador ou da IA e
 * entra no caminho da Graph. O nome exibido sai da Meta, não de quem pediu —
 * senão a tela mostraria um número e a campanha sairia por outro.
 */
export async function numeroDaConta(wabaId: string, telefoneId: string) {
  return (await telefonesMeta(wabaId)).find((t) => t.id === telefoneId) ?? null;
}

/**
 * A definição de um RASCUNHO na ativação. Rascunho gravado antes da correção é
 * string JSON; como nunca rodou, ler o que foi montado (ações, prazo,
 * variáveis) é o certo — ao contrário da campanha que já está no ar.
 */
export function definicaoDoRascunho(valor: unknown, coluna: { template_nome: string; template_idioma: string }): DefinicaoCampanha {
  let bruto = valor;
  if (typeof valor === "string") {
    try {
      bruto = JSON.parse(valor);
    } catch {
      bruto = {};
    }
  }
  return lerDefinicao(bruto, coluna);
}

function lerAcoes(valor: unknown): AcaoCampanha[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((v): AcaoCampanha[] => {
    if (!v || typeof v !== "object") return [];
    const a = v as Record<string, unknown>;
    if (a.tipo === "registrar_lead") return [{ tipo: "registrar_lead" }];
    if (a.tipo === "adicionar_tag" && typeof a.tagId === "string") return [{ tipo: a.tipo, tagId: a.tagId }];
    if (a.tipo === "adicionar_segmento" && typeof a.segmentoId === "string") return [{ tipo: a.tipo, segmentoId: a.segmentoId }];
    if (a.tipo === "criar_oportunidade" && typeof a.funilId === "string" && typeof a.etapaId === "string") {
      return [{ tipo: a.tipo, funilId: a.funilId, etapaId: a.etapaId, nome: typeof a.nome === "string" ? a.nome.slice(0, 160) : "Oportunidade da campanha" }];
    }
    return [];
  }).slice(0, 20);
}

type Execucao = { id: string; campanha_id: string; contato_id: string; contato_nome: string; whatsapp: string; definicao: unknown };

async function evento(campanhaId: string, execucaoId: string | null, tipo: string, detalhe: Record<string, unknown> = {}) {
  await sql`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
            VALUES (${campanhaId}::uuid, ${execucaoId}::uuid, ${tipo}, ${sql.json(detalhe as never)})`;
}

export async function executarAcoes(execucao: Execucao, ramo: "respondeu" | "expirou") {
  const definicao = lerDefinicao(execucao.definicao);
  const acoes = ramo === "respondeu" ? definicao.ao_responder : definicao.ao_expirar;
  for (const acao of acoes) {
    try {
      if (acao.tipo === "adicionar_tag") {
        await sql`INSERT INTO contato_tags (contato_id, tag_id) VALUES (${execucao.contato_id}::uuid, ${acao.tagId}::uuid) ON CONFLICT DO NOTHING`;
      } else if (acao.tipo === "adicionar_segmento") {
        await sql`INSERT INTO contato_segmentos (contato_id, segmento_id) VALUES (${execucao.contato_id}::uuid, ${acao.segmentoId}::uuid) ON CONFLICT DO NOTHING`;
      } else if (acao.tipo === "criar_oportunidade") {
        const nome = acao.nome.replaceAll("{{nome}}", execucao.contato_nome);
        const [op] = await sql`INSERT INTO oportunidades (nome, contato_id, valor, status, funil_id, etapa_id)
                  VALUES (${nome}, ${execucao.contato_id}::uuid, 0, 'aberta', ${acao.funilId}::uuid, ${acao.etapaId}::uuid)
                  RETURNING id`;
        // Nasceu dentro da etapa: evento da Meta dela, se configurado.
        eventoAoEntrarNaEtapa(op.id, acao.etapaId);
      } else if (acao.tipo === "registrar_lead") {
        await sql`UPDATE campanha_whatsapp_execucoes SET conversao = true WHERE id = ${execucao.id}::uuid`;
      }
      await evento(execucao.campanha_id, execucao.id, `acao_${acao.tipo}`, { ramo, ok: true });
    } catch (e) {
      await evento(execucao.campanha_id, execucao.id, `acao_${acao.tipo}`, { ramo, ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
}

// Os templates das contas do lote, lidos uma vez: para conferir de novo as
// variáveis no disparo e para a mensagem aparecer na conversa do /chat como o
// contato a leu. Um GET por WABA por lote; falhou, a conferência fica com a da
// ativação e a conversa mostra o nome do template.
async function templatesDoLote(wabaIds: string[]) {
  const mapa = new Map<string, TemplateMeta>();
  for (const waba of new Set(wabaIds)) {
    try {
      for (const t of await templatesMeta(waba)) mapa.set(`${waba}|${t.name}|${t.language}`, t);
    } catch (e) {
      console.error("[campanhas] não li os templates da WABA", waba, e);
    }
  }
  return mapa;
}

export async function processarFila(limite = 50, campanhaId?: string) {
  const linhas = await sql`
    SELECT e.id, e.campanha_id, e.contato_id, c.nome AS contato_nome, c.whatsapp, c.email, c.cidade,
           cw.telefone_id, cw.telefone_exibicao, cw.waba_id,
           cw.template_nome, cw.template_idioma, cw.definicao
      FROM campanha_whatsapp_execucoes e
      JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
      JOIN contatos c ON c.id = e.contato_id
     WHERE e.estado = 'na_fila' AND cw.status = 'ativa'
       AND (${campanhaId ?? null}::uuid IS NULL OR cw.id = ${campanhaId ?? null}::uuid)
     ORDER BY e.data_criacao
     LIMIT ${limite}` as unknown as Array<Execucao & { email:string|null; cidade:string|null; telefone_id:string; telefone_exibicao:string; waba_id:string; template_nome:string; template_idioma:string }>;
  const templates = linhas.length ? await templatesDoLote(linhas.map((l) => l.waba_id)) : new Map<string, TemplateMeta>();
  let enviados = 0;
  for (const e of linhas) {
    // Reserva a linha. Outra execução da fila (o n8n chama a cada minuto, e a
    // criação e a ativação chamam também) pode ter pegado a mesma: sem a
    // reserva, as duas mandavam — mensagem oficial em dobro para o cliente.
    const [reservada] = await sql`UPDATE campanha_whatsapp_execucoes SET estado='enviando'
                                    WHERE id=${e.id}::uuid AND estado='na_fila' RETURNING id`;
    if (!reservada) continue;
    try {
      const definicao = lerDefinicao(e.definicao, e);
      const nome = definicao.template_nome;
      const idioma = definicao.template_idioma;
      const template = templates.get(`${e.waba_id}|${nome}|${idioma}`);
      const lido = template ? lerTemplate(template) : null;
      // De novo no disparo: a campanha inscreve gente do segmento por semanas,
      // e o template pode ter mudado na Meta desde a ativação.
      const problema = lido ? problemaNoEnvio(lido, definicao.variaveis) : null;
      if (problema) throw new Error(problema);
      const variaveis = lido ? ajustarValores(definicao.variaveis, variaveisDoTemplate(lido)) : definicao.variaveis;
      // As marcas ({{primeiro_nome}}…) viram os dados DESTE contato, saneados.
      // Faltando um, a execução falha aqui com o motivo, sem ir à Meta.
      const valores = valoresParaContato(variaveis, dadosDoContato({ nome: e.contato_nome, whatsapp: e.whatsapp, email: e.email, cidade: e.cidade }));
      if ("falta" in valores) throw new Error(`Contato sem ${valores.falta}.`);
      const r = await enviarTemplateMeta(e.telefone_id, { to: e.whatsapp, name: nome, language: idioma, components: componentesDoEnvio(valores) });
      // A mensagem entra na conversa do contato no canal oficial — sem isto o
      // /chat mostraria só a resposta, sem o que a campanha mandou.
      await registrarEnvioOficial({
        contatoId: e.contato_id,
        numeroCanal: e.telefone_exibicao,
        texto: (template && textoDoTemplate(template.components, valores)) || `Template "${nome}"`,
        wamid: r.messages?.[0]?.id ?? null,
        enviadaPor: "automacao",
      });
      const espera = definicao.espera_minutos;
      await sql`UPDATE campanha_whatsapp_execucoes
                   SET estado='aguardando_resposta', mensagem_id_meta=${r.messages?.[0]?.id ?? null},
                       enviado_em=now(), prazo_resposta=now()+(${espera} || ' minutes')::interval
                 WHERE id=${e.id}::uuid`;
      await evento(e.campanha_id, e.id, "mensagem_enviada", { mensagem_id: r.messages?.[0]?.id });
      enviados++;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await sql`UPDATE campanha_whatsapp_execucoes SET estado='falhou', erro=${mensagem}, finalizado_em=now() WHERE id=${e.id}::uuid`;
      await evento(e.campanha_id, e.id, "envio_falhou", { erro: mensagem });
    }
  }
  await atualizarTotais();
  return { encontrados: linhas.length, enviados };
}

export async function processarExpirados(limite = 200, campanhaId?: string) {
  const linhas = await sql`
    UPDATE campanha_whatsapp_execucoes e SET estado='expirou', finalizado_em=now()
     WHERE e.id IN (SELECT e2.id FROM campanha_whatsapp_execucoes e2 WHERE e2.estado='aguardando_resposta' AND e2.prazo_resposta<=now() AND (${campanhaId ?? null}::uuid IS NULL OR e2.campanha_id=${campanhaId ?? null}::uuid) ORDER BY e2.prazo_resposta LIMIT ${limite})
     RETURNING e.id, e.campanha_id, e.contato_id` as unknown as Array<{id:string;campanha_id:string;contato_id:string}>;
  for (const linha of linhas) {
    const [e] = await sql`SELECT e.id,e.campanha_id,e.contato_id,c.nome AS contato_nome,c.whatsapp,cw.definicao FROM campanha_whatsapp_execucoes e JOIN contatos c ON c.id=e.contato_id JOIN campanhas_whatsapp cw ON cw.id=e.campanha_id WHERE e.id=${linha.id}::uuid` as unknown as Execucao[];
    await evento(e.campanha_id, e.id, "prazo_expirado"); await executarAcoes(e, "expirou");
  }
  await atualizarTotais();
  return { expirados: linhas.length };
}

export async function registrarResposta(numero: string, mensagemId?: string) {
  const fim = numero.replace(/\D/g, "").slice(-8); if (!fim) return { encontradas: 0 };
  const linhas = await sql`
    UPDATE campanha_whatsapp_execucoes e SET estado='respondeu', respondeu_em=now(), finalizado_em=now()
     WHERE e.id IN (
       SELECT e2.id FROM campanha_whatsapp_execucoes e2 JOIN contatos c ON c.id=e2.contato_id
        WHERE e2.estado='aguardando_resposta' AND regexp_replace(c.whatsapp,'\\D','','g') LIKE ${"%"+fim})
     RETURNING e.id,e.campanha_id,e.contato_id` as unknown as Array<{id:string;campanha_id:string;contato_id:string}>;
  for (const linha of linhas) {
    const [e] = await sql`SELECT e.id,e.campanha_id,e.contato_id,c.nome AS contato_nome,c.whatsapp,cw.definicao FROM campanha_whatsapp_execucoes e JOIN contatos c ON c.id=e.contato_id JOIN campanhas_whatsapp cw ON cw.id=e.campanha_id WHERE e.id=${linha.id}::uuid` as unknown as Execucao[];
    await evento(e.campanha_id,e.id,"resposta_recebida",{mensagem_id:mensagemId}); await executarAcoes(e,"respondeu");
  }
  await atualizarTotais(); return { encontradas: linhas.length };
}

async function atualizarTotais() {
  await sql`UPDATE campanhas_whatsapp c SET
    enviados=(SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.enviado_em IS NOT NULL),
    total=(SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id),
    status=c.status,
    data_conclusao=c.data_conclusao
    WHERE c.status IN ('ativa','processando')`;
}
