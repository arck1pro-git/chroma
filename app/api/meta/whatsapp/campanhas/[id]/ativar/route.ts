// Ativa um RASCUNHO (o que a IA de campanhas ou a tela montou): confere o
// fluxo inteiro contra a permissão de quem ativa, a Meta e o banco, inscreve
// TODOS os contatos dos segmentos e liga o agendador da campanha no n8n.
//
// DUPLO CLIQUE (revisões de 2026-10-28): numa transação, a campanha passa a
// 'ativa' só se ainda é 'rascunho' (UPDATE … AND status = 'rascunho'); o
// segundo clique espera a trava da linha, não acha rascunho e não publica um
// segundo workflow. Se a publicação no n8n falhar, a transação desfaz a ativação
// e as inscrições.
import { exigirModuloApi } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { respostaErroMeta } from "@/lib/meta";
import { contatosNosSegmentos, inscreverDosSegmentos, numeroDaConta, processarFila, registrarNaCampanha, templateDaCampanha } from "@/lib/campanhas-whatsapp";
import { conferirFluxo, definicaoDoRascunho, recusaDoFluxo } from "@/lib/campanhas-fluxo-entrada";
import { enderecoDoCrm } from "@/lib/endereco";
import { publicarWorkflowCampanha } from "@/lib/campanhas-workflow";
import { ehUuid } from "@/lib/validacao";

const JA_ATIVADO = "Rascunho não encontrado ou já ativado.";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const acesso=await exigirModuloApi("campanhas", "editar");if(acesso instanceof Response)return acesso;
  const {id}=await params;
  if(!ehUuid(id))return Response.json({erro:JA_ATIVADO},{status:404});
  try{
    const [c]=await sql`SELECT * FROM campanhas_whatsapp WHERE id=${id}::uuid AND status='rascunho'`;
    if(!c)return Response.json({erro:JA_ATIVADO},{status:404});
    // Rascunho nunca rodou: o que foi montado vale, mesmo gravado como string
    // JSON antes da correção — e é regravado como objeto (fluxo v2) abaixo.
    const fluxo=definicaoDoRascunho(c.definicao,{template_nome:c.template_nome,template_idioma:c.template_idioma});
    const problemas=await conferirFluxo({fluxo,wabaId:c.waba_id,usuario:acesso.usuario});
    if(problemas.length)return recusaDoFluxo(problemas);
    if(!(await numeroDaConta(c.waba_id,c.telefone_id)))return Response.json({erro:"O número deste rascunho não pertence à conta do WhatsApp."},{status:400});
    if(!(await contatosNosSegmentos({campanhaId:id})))return Response.json({erro:"O segmento não possui contatos com WhatsApp."},{status:400});
    const endereco=enderecoDoCrm(req.headers);if(!endereco.publico)return Response.json({erro:`O n8n não alcança ${endereco.host}. Abra o CRM pelo domínio público.`},{status:400});
    const tpl=templateDaCampanha(fluxo);
    const ativada=await sql.begin(async(tx:typeof sql)=>{
      const [mudou]=await tx`UPDATE campanhas_whatsapp SET status='ativa',ativada_em=now(),definicao=${sql.json(fluxo as never)},template_nome=${tpl.template_nome},template_idioma=${tpl.template_idioma} WHERE id=${id}::uuid AND status='rascunho' RETURNING id`;
      if(!mudou)return null;
      const total=await inscreverDosSegmentos(tx,id);
      const workflowId=await publicarWorkflowCampanha({campanhaId:id,nome:c.nome,crmBaseUrl:endereco.url});
      await tx`UPDATE campanhas_whatsapp SET total=${total},motor_workflow_id=${workflowId} WHERE id=${id}::uuid`;
      return {total};
    });
    if(!ativada)return Response.json({erro:JA_ATIVADO},{status:409});
    await registrarNaCampanha(id,"campanha_ativada",acesso.usuario.id);
    const processamento=await processarFila(5,id);
    return Response.json({ok:true,total:ativada.total,processamento});
  }catch(e){return respostaErroMeta(e)}
}
