import "server-only";
import type { WorkflowMotor } from "@/lib/automacoes/motores/n8n/adaptador";
import { ativarWorkflow, criarCredencial, criarWorkflow } from "@/lib/automacoes/motores/n8n/adaptador";
import { credencialDoMotor } from "@/lib/automacoes/repositorio";
import { sql } from "@/lib/db";

const CHAVE_CREDENCIAL = "crm_callback";

export function montarWorkflowCampanha({ campanhaId, nome, crmBaseUrl, credencialId }: { campanhaId:string; nome:string; crmBaseUrl:string; credencialId:string }): WorkflowMotor {
  const agenda = "Verificar fila";
  const executar = "Executar campanha";
  return {
    name: `[Chroma] Campanha · ${nome.slice(0, 80)} · ${campanhaId.slice(0, 8)}`,
    nodes: [
      { id:"agenda", name:agenda, type:"n8n-nodes-base.scheduleTrigger", typeVersion:1.2, position:[0,0], parameters:{ rule:{ interval:[{ field:"minutes", minutesInterval:1 }] } } },
      { id:"executar", name:executar, type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[260,0], parameters:{ url:`${crmBaseUrl}/api/meta/whatsapp/processar`, method:"POST", sendBody:true, contentType:"raw", rawContentType:"application/json", body:JSON.stringify({campanhaId}), options:{} }, credentials:{ httpHeaderAuth:{ id:credencialId, name:"Chroma · CRM (token de serviço)" } } },
    ],
    connections:{ [agenda]:{ main:[[{node:executar,type:"main",index:0}]] } },
    settings:{ executionOrder:"v1" },
  };
}

/**
 * A credencial do n8n com o token de serviço do CRM (Header Auth), criada na
 * primeira vez. Os agendadores que chamam o CRM de volta usam esta mesma: as
 * campanhas e as retomadas da IA (lib/ia/retomada.ts).
 */
export async function garantirCredencialDoCrm(): Promise<{ id: string }> {
  const token=process.env.CRM_SERVICE_TOKEN;
  if(!token)throw new Error("CRM_SERVICE_TOKEN não definido: sem ele o n8n não consegue chamar o CRM.");
  const credencial=await credencialDoMotor("n8n",CHAVE_CREDENCIAL);
  if(credencial)return credencial;
  const id=await criarCredencial("Chroma · CRM (token de serviço)","httpHeaderAuth",{name:"Authorization",value:`Bearer ${token}`});
  await sql`INSERT INTO motor_credenciais(chave,motor,motor_cred_id,motor_cred_tipo,descricao) VALUES(${CHAVE_CREDENCIAL},'n8n',${id},'httpHeaderAuth','Campanhas oficiais de WhatsApp') ON CONFLICT(motor,chave) DO NOTHING`;
  return {id};
}

export async function publicarWorkflowCampanha(dados:{campanhaId:string;nome:string;crmBaseUrl:string}){
  const credencial=await garantirCredencialDoCrm();
  const id=await criarWorkflow(montarWorkflowCampanha({...dados,credencialId:credencial.id}));
  await ativarWorkflow(id);
  return id;
}
