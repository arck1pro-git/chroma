// Campanhas de WhatsApp oficial em blocos: listar (com o fluxo normalizado e as
// métricas do canvas) e criar já ativa. Criar exige criar E editar no módulo,
// como o botão Ativar do rascunho. O fluxo é lido e conferido em
// lib/campanhas-fluxo-entrada.ts, inclusive contra a permissão de quem cria: o
// motor roda sem sessão (lib/campanhas-whatsapp.ts). Criar inscreve TODOS os
// contatos com WhatsApp dos segmentos (inscreverDosSegmentos; até 2026-10-28
// eram os 250 primeiros por nome). O GET diz qual migration falta.
import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { sql } from "@/lib/db";
import { respostaErroMeta } from "@/lib/meta";
import {
  contatosNosSegmentos,
  inscreverDosSegmentos,
  metricasDasCampanhas,
  numeroDaConta,
  processarFila,
  registrarNaCampanha,
  templateDaCampanha,
} from "@/lib/campanhas-whatsapp";
import { conferirFluxo, fluxoGravado, lerFluxoDaEntrada, recusaDoFluxo } from "@/lib/campanhas-fluxo-entrada";
import { enderecoDoCrm } from "@/lib/endereco";
import { publicarWorkflowCampanha } from "@/lib/campanhas-workflow";
import { ehUuid } from "@/lib/validacao";

export const dynamic = "force-dynamic";

export async function GET() {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  try {
    // "responderam" e "expiraram" contam os dois formatos: o antigo terminava
    // em 'respondeu'/'expirou'; o de blocos marca respondeu_em e a saída.
    const campanhas = await sql`
      SELECT id, nome, segmento_id,
             COALESCE((SELECT string_agg(s.nome, ', ' ORDER BY s.nome) FROM campanha_whatsapp_segmentos cs JOIN segmentos s ON s.id=cs.segmento_id WHERE cs.campanha_id=c.id), segmento_nome) AS segmento_nome,
             template_nome, definicao, motor_workflow_id,
             template_idioma, telefone_exibicao, status, total, enviados,
             falhas, data_criacao, data_conclusao,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.estado='aguardando_resposta') AS aguardando,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.respondeu_em IS NOT NULL) AS responderam,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND (e.estado='expirou' OR e.resposta_saida='sem_resposta')) AS expiraram,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.estado='falhou') AS falharam,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.conversao) AS conversoes
        FROM campanhas_whatsapp c
       ORDER BY data_criacao DESC
       LIMIT 100` as unknown as Array<Record<string, unknown> & { id: string; status: string; definicao: unknown; template_nome: string; template_idioma: string }>;
    // O fluxo do jeito que vai rodar: a campanha antiga no ar roda com os
    // padrões; o rascunho é lido de verdade, como na ativação.
    const lidas = campanhas.map((c) => ({ ...c, definicao: fluxoGravado(c) }));
    const metricas = await metricasDasCampanhas(lidas);
    return Response.json({
      campanhas: lidas.map((c) => ({ ...c, metricas: metricas.get(c.id) ?? { porBloco: {}, porSaida: {} } })),
    });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    const codigo = (e as { code?: string })?.code;
    // As colunas dos blocos (bloco_atual, resposta_saida, resposta_id) são de
    // migration-campanhas-whatsapp-blocos.sql, que vai ANTES do deploy.
    if (codigo === "42703" || /bloco_atual|resposta_saida|resposta_id/.test(mensagem)) {
      return Response.json({ erro: "Falta rodar migration-campanhas-whatsapp-blocos.sql." }, { status: 500 });
    }
    if (codigo === "42P01" || /campanhas_whatsapp/i.test(mensagem)) {
      return Response.json({ erro: "Falta rodar migration-campanhas-whatsapp.sql." }, { status: 500 });
    }
    return Response.json({ erro: mensagem }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const acesso = await exigirModuloApi("campanhas", "criar");
  if (acesso instanceof Response) return acesso;
  if (!podeOperar(acesso.usuario, "campanhas", "editar")) {
    return Response.json({ erro: "Sem permissão para ativar campanhas neste módulo." }, { status: 403 });
  }
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || b.confirmar !== true) return Response.json({ erro: "Confirme a ativação antes de iniciar." }, { status: 400 });
    const waba = typeof b.waba === "string" ? b.waba : "";
    const telefoneId = typeof b.telefoneId === "string" ? b.telefoneId : "";
    const segmentoIds = Array.isArray(b.segmentoIds) ? [...new Set(b.segmentoIds.filter((id):id is string=>typeof id==="string"&&ehUuid(id)))].slice(0, 50) : [];
    if(!segmentoIds.length)return Response.json({erro:"Escolha pelo menos um segmento."},{status:400});
    const lido = lerFluxoDaEntrada(b.definicao);
    if (!lido.ok) return recusaDoFluxo(lido.problemas);
    const fluxo = lido.fluxo;
    const problemas = await conferirFluxo({ fluxo, wabaId: waba, usuario: acesso.usuario });
    if (problemas.length) return recusaDoFluxo(problemas);
    const { template_nome: templateNome, template_idioma: idioma } = templateDaCampanha(fluxo);
    const nome = (typeof b.nome === "string" ? b.nome : "").trim().slice(0, 160) || templateNome;
    const telefone = await numeroDaConta(waba, telefoneId);
    if (!telefone) return Response.json({ erro: "Este número não pertence à conta do WhatsApp." }, { status: 400 });
    if (!(await contatosNosSegmentos({ segmentoIds }))) return Response.json({ erro: "O segmento não possui contatos com WhatsApp." }, { status: 400 });
    const nomesSegmentos = await sql`SELECT id,nome FROM segmentos WHERE id=ANY(string_to_array(${segmentoIds.join(",")}, ',')::uuid[]) ORDER BY nome` as unknown as Array<{ id:string;nome:string }>;
    if(nomesSegmentos.length!==segmentoIds.length)return Response.json({erro:"Um dos segmentos não existe."},{status:400});
    const telefoneExibicao = telefone.display_phone_number;
    const [campanha] = await sql`
      INSERT INTO campanhas_whatsapp (
        nome, segmento_id, segmento_nome, template_nome, template_idioma,
        waba_id, telefone_id, telefone_exibicao, total, criado_por, definicao,
        status, ativada_em
      ) VALUES (
        ${nome}, ${segmentoIds[0]}::uuid, ${nomesSegmentos.map(s=>s.nome).join(", ")},
        ${templateNome}, ${idioma}, ${waba}, ${telefoneId}, ${telefoneExibicao},
        0, ${acesso.usuario.id}::uuid, ${sql.json(fluxo as never)},
        'ativa', now()
      ) RETURNING id` as unknown as Array<{ id: string }>;
    for(const segmentoId of segmentoIds)await sql`INSERT INTO campanha_whatsapp_segmentos(campanha_id,segmento_id) VALUES(${campanha.id}::uuid,${segmentoId}::uuid) ON CONFLICT DO NOTHING`;
    // Todos os contatos dos segmentos, numa instrução (sem o teto de 250 de antes).
    const total = await inscreverDosSegmentos(sql, campanha.id);
    await sql`UPDATE campanhas_whatsapp SET total = ${total} WHERE id = ${campanha.id}::uuid`;
    const endereco=enderecoDoCrm(req.headers);
    if(!endereco.publico){await sql`DELETE FROM campanhas_whatsapp WHERE id=${campanha.id}::uuid`;return Response.json({erro:`O n8n não alcança ${endereco.host}. Abra o CRM pelo domínio público para ativar a campanha.`},{status:400})}
    let workflowId:string;
    try{workflowId=await publicarWorkflowCampanha({campanhaId:campanha.id,nome,crmBaseUrl:endereco.url})}catch(erroWorkflow){await sql`DELETE FROM campanhas_whatsapp WHERE id=${campanha.id}::uuid`;throw erroWorkflow}
    await sql`UPDATE campanhas_whatsapp SET motor_workflow_id=${workflowId} WHERE id=${campanha.id}::uuid`;
    await registrarNaCampanha(campanha.id, "campanha_criada", acesso.usuario.id);
    // Primeira leva pequena para o botão responder rápido. O restante é
    // drenado pela rota de serviço /processar; request web não é fila durável.
    const processamento = await processarFila(5, campanha.id);
    return Response.json({ ok: true, id: campanha.id, total, processamento });
  } catch (e) { return respostaErroMeta(e); }
}
