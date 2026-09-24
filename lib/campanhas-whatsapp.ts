import "server-only";
import { sql } from "@/lib/db";
import { enviarTemplateMeta } from "@/lib/meta";

export type AcaoCampanha =
  | { tipo: "adicionar_tag"; tagId: string }
  | { tipo: "adicionar_segmento"; segmentoId: string }
  | { tipo: "criar_oportunidade"; funilId: string; etapaId: string; nome: string }
  | { tipo: "registrar_lead" };

export type DefinicaoCampanha = {
  template_nome: string;
  template_idioma: string;
  espera_minutos: number;
  ao_responder: AcaoCampanha[];
  ao_expirar: AcaoCampanha[];
};

export function lerDefinicao(valor: unknown): DefinicaoCampanha {
  const bruto = valor && typeof valor === "object" ? valor as Record<string, unknown> : {};
  const espera = Math.min(43_200, Math.max(5, Number(bruto.espera_minutos) || 1440));
  return {
    template_nome: typeof bruto.template_nome === "string" ? bruto.template_nome.trim().slice(0, 512) : "",
    template_idioma: typeof bruto.template_idioma === "string" ? bruto.template_idioma.trim().slice(0, 20) : "pt_BR",
    espera_minutos: espera,
    ao_responder: lerAcoes(bruto.ao_responder),
    ao_expirar: lerAcoes(bruto.ao_expirar),
  };
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

async function evento(campanhaId: string, execucaoId: string | null, tipo: string, detalhe: unknown = {}) {
  await sql`INSERT INTO campanha_whatsapp_eventos (campanha_id, execucao_id, tipo, detalhe)
            VALUES (${campanhaId}::uuid, ${execucaoId}::uuid, ${tipo}, ${JSON.stringify(detalhe)}::jsonb)`;
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
        await sql`INSERT INTO oportunidades (nome, contato_id, valor, status, funil_id, etapa_id)
                  VALUES (${nome}, ${execucao.contato_id}::uuid, 0, 'aberta', ${acao.funilId}::uuid, ${acao.etapaId}::uuid)`;
      } else if (acao.tipo === "registrar_lead") {
        await sql`UPDATE campanha_whatsapp_execucoes SET conversao = true WHERE id = ${execucao.id}::uuid`;
      }
      await evento(execucao.campanha_id, execucao.id, `acao_${acao.tipo}`, { ramo, ok: true });
    } catch (e) {
      await evento(execucao.campanha_id, execucao.id, `acao_${acao.tipo}`, { ramo, ok: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
}

export async function processarFila(limite = 50, campanhaId?: string) {
  const linhas = await sql`
    SELECT e.id, e.campanha_id, e.contato_id, c.nome AS contato_nome, c.whatsapp,
           cw.telefone_id, cw.template_nome, cw.template_idioma, cw.definicao
      FROM campanha_whatsapp_execucoes e
      JOIN campanhas_whatsapp cw ON cw.id = e.campanha_id
      JOIN contatos c ON c.id = e.contato_id
     WHERE e.estado = 'na_fila' AND cw.status = 'ativa'
       AND (${campanhaId ?? null}::uuid IS NULL OR cw.id = ${campanhaId ?? null}::uuid)
     ORDER BY e.data_criacao
     LIMIT ${limite}` as unknown as Array<Execucao & { telefone_id:string; template_nome:string; template_idioma:string }>;
  let enviados = 0;
  for (const e of linhas) {
    await sql`UPDATE campanha_whatsapp_execucoes SET estado='enviando' WHERE id=${e.id}::uuid AND estado='na_fila'`;
    try {
      const definicao = lerDefinicao(e.definicao);
      const r = await enviarTemplateMeta(e.telefone_id, { to: e.whatsapp, name: definicao.template_nome || e.template_nome, language: definicao.template_idioma || e.template_idioma });
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
        WHERE e2.estado='aguardando_resposta' AND regexp_replace(c.whatsapp,'\D','','g') LIKE ${"%"+fim})
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
