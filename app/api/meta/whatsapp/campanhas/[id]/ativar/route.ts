import { exigirModuloApi } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { processarFila } from "@/lib/campanhas-whatsapp";
import { templatesMeta } from "@/lib/meta";
import { lerDefinicao } from "@/lib/campanhas-whatsapp";
import { enderecoDoCrm } from "@/lib/endereco";
import { publicarWorkflowCampanha } from "@/lib/campanhas-workflow";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const acesso=await exigirModuloApi("campanhas");if(acesso instanceof Response)return acesso;
  const {id}=await params;
  const [c]=await sql`SELECT * FROM campanhas_whatsapp WHERE id=${id}::uuid AND status='rascunho'`;
  if(!c)return Response.json({erro:"Rascunho não encontrado ou já ativado."},{status:404});
  const definicao=lerDefinicao(c.definicao);const templateNome=definicao.template_nome||c.template_nome;const idioma=definicao.template_idioma||c.template_idioma;
  const aprovado=(await templatesMeta(c.waba_id)).some(t=>t.name===templateNome&&t.language===idioma&&t.status==="APPROVED");
  if(!aprovado)return Response.json({erro:"O template deixou de estar aprovado."},{status:400});
  const contatos=await sql`SELECT c.id FROM contatos c JOIN contato_segmentos cs ON cs.contato_id=c.id JOIN campanha_whatsapp_segmentos cws ON cws.segmento_id=cs.segmento_id WHERE cws.campanha_id=${id}::uuid AND c.whatsapp IS NOT NULL GROUP BY c.id,c.nome ORDER BY c.nome LIMIT 250`;
  if(!contatos.length)return Response.json({erro:"O segmento não possui contatos com WhatsApp."},{status:400});
  for(const contato of contatos)await sql`INSERT INTO campanha_whatsapp_execucoes(campanha_id,contato_id) VALUES(${id}::uuid,${contato.id}::uuid) ON CONFLICT DO NOTHING`;
  const endereco=enderecoDoCrm(req.headers);if(!endereco.publico)return Response.json({erro:`O n8n não alcança ${endereco.host}. Abra o CRM pelo domínio público.`},{status:400});
  const workflowId=await publicarWorkflowCampanha({campanhaId:id,nome:c.nome,crmBaseUrl:endereco.url});
  await sql`UPDATE campanhas_whatsapp SET status='ativa',ativada_em=now(),total=${contatos.length},motor_workflow_id=${workflowId} WHERE id=${id}::uuid`;
  const processamento=await processarFila(5);
  return Response.json({ok:true,total:contatos.length,processamento});
}
