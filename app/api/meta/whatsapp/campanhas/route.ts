import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { respostaErroMeta, templatesMeta } from "@/lib/meta";
import { lerDefinicao, processarFila } from "@/lib/campanhas-whatsapp";
import { enderecoDoCrm } from "@/lib/endereco";
import { publicarWorkflowCampanha } from "@/lib/campanhas-workflow";

export const dynamic = "force-dynamic";

export async function GET() {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  try {
    const campanhas = await sql`
      SELECT id, nome, segmento_id,
             COALESCE((SELECT string_agg(s.nome, ', ' ORDER BY s.nome) FROM campanha_whatsapp_segmentos cs JOIN segmentos s ON s.id=cs.segmento_id WHERE cs.campanha_id=c.id), segmento_nome) AS segmento_nome,
             template_nome, definicao, motor_workflow_id,
             template_idioma, telefone_exibicao, status, total, enviados,
             falhas, data_criacao, data_conclusao,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.estado='aguardando_resposta') AS aguardando,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.estado='respondeu') AS responderam,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.estado='expirou') AS expiraram,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.estado='falhou') AS falharam,
             (SELECT count(*)::int FROM campanha_whatsapp_execucoes e WHERE e.campanha_id=c.id AND e.conversao) AS conversoes
        FROM campanhas_whatsapp c
       ORDER BY data_criacao DESC
       LIMIT 100`;
    return Response.json({ campanhas });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    if (/campanhas_whatsapp|42P01/i.test(mensagem)) {
      return Response.json({ erro: "Falta rodar migration-campanhas-whatsapp.sql." }, { status: 500 });
    }
    return Response.json({ erro: mensagem }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  try {
    const b = await req.json() as Record<string, unknown>;
    if (b.confirmar !== true) return Response.json({ erro: "Confirme a ativação antes de iniciar." }, { status: 400 });
    const waba = String(b.waba ?? "");
    const telefoneId = String(b.telefoneId ?? "");
    const segmentoIds = Array.isArray(b.segmentoIds) ? [...new Set(b.segmentoIds.filter((id):id is string=>typeof id==="string"&&/^[0-9a-f-]{36}$/i.test(id)))] : [];
    const definicao = lerDefinicao(b.definicao);
    const templateNome = definicao.template_nome;
    const idioma = definicao.template_idioma;
    const nome = String(b.nome ?? templateNome).trim().slice(0, 160) || templateNome;
    if(!segmentoIds.length)return Response.json({erro:"Escolha pelo menos um segmento."},{status:400});
    const aprovado = (await templatesMeta(waba)).some((t) => t.name === templateNome && t.language === idioma && t.status === "APPROVED");
    if (!aprovado) return Response.json({ erro: "Escolha um template aprovado pela Meta." }, { status: 400 });
    const contatos = await sql`
      SELECT c.id, c.nome, c.whatsapp FROM contatos c
      JOIN contato_segmentos cs ON cs.contato_id = c.id
      WHERE cs.segmento_id = ANY(string_to_array(${segmentoIds.join(",")}, ',')::uuid[]) AND c.whatsapp IS NOT NULL
      GROUP BY c.id, c.nome, c.whatsapp
      ORDER BY c.nome LIMIT 250` as unknown as Array<{ id: string; nome: string; whatsapp: string }>;
    if (!contatos.length) return Response.json({ erro: "O segmento não possui contatos com WhatsApp." }, { status: 400 });
    const nomesSegmentos = await sql`SELECT id,nome FROM segmentos WHERE id=ANY(string_to_array(${segmentoIds.join(",")}, ',')::uuid[]) ORDER BY nome` as unknown as Array<{ id:string;nome:string }>;
    if(nomesSegmentos.length!==segmentoIds.length)return Response.json({erro:"Um dos segmentos não existe."},{status:400});
    const telefoneExibicao = String(b.telefoneExibicao ?? telefoneId).slice(0, 80);
    const [campanha] = await sql`
      INSERT INTO campanhas_whatsapp (
        nome, segmento_id, segmento_nome, template_nome, template_idioma,
        waba_id, telefone_id, telefone_exibicao, total, criado_por, definicao,
        status, ativada_em
      ) VALUES (
        ${nome}, ${segmentoIds[0]}::uuid, ${nomesSegmentos.map(s=>s.nome).join(", ")},
        ${templateNome}, ${idioma}, ${waba}, ${telefoneId}, ${telefoneExibicao},
        ${contatos.length}, ${acesso.usuario.id}::uuid, ${JSON.stringify(definicao)}::jsonb,
        'ativa', now()
      ) RETURNING id` as unknown as Array<{ id: string }>;
    for(const segmentoId of segmentoIds)await sql`INSERT INTO campanha_whatsapp_segmentos(campanha_id,segmento_id) VALUES(${campanha.id}::uuid,${segmentoId}::uuid) ON CONFLICT DO NOTHING`;
    for (const contato of contatos) {
      await sql`INSERT INTO campanha_whatsapp_execucoes (campanha_id, contato_id)
                VALUES (${campanha.id}::uuid, ${contato.id}::uuid) ON CONFLICT DO NOTHING`;
    }
    const endereco=enderecoDoCrm(req.headers);
    if(!endereco.publico){await sql`DELETE FROM campanhas_whatsapp WHERE id=${campanha.id}::uuid`;return Response.json({erro:`O n8n não alcança ${endereco.host}. Abra o CRM pelo domínio público para ativar a campanha.`},{status:400})}
    let workflowId:string;
    try{workflowId=await publicarWorkflowCampanha({campanhaId:campanha.id,nome,crmBaseUrl:endereco.url})}catch(erroWorkflow){await sql`DELETE FROM campanhas_whatsapp WHERE id=${campanha.id}::uuid`;throw erroWorkflow}
    await sql`UPDATE campanhas_whatsapp SET motor_workflow_id=${workflowId} WHERE id=${campanha.id}::uuid`;
    // Primeira leva pequena para o botão responder rápido. O restante é
    // drenado pela rota de serviço /processar; request web não é fila durável.
    const processamento = await processarFila(5);
    return Response.json({ ok: true, id: campanha.id, total: contatos.length, processamento });
  } catch (e) { return respostaErroMeta(e); }
}
