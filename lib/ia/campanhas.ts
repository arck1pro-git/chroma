import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sql } from "@/lib/db";
import { lerDefinicao } from "@/lib/campanhas-whatsapp";
import { telefonesMeta, templatesMeta, wabasMeta } from "@/lib/meta";

const acao = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("registrar_lead") }),
  z.object({ tipo: z.literal("adicionar_tag"), tagId: z.string() }),
  z.object({ tipo: z.literal("adicionar_segmento"), segmentoId: z.string() }),
  z.object({ tipo: z.literal("criar_oportunidade"), funilId: z.string(), etapaId: z.string(), nome: z.string() }),
]);

export function ferramentasDeCampanhas(usuarioId: string) {
  let gravou = false;
  const listarAlvos = betaZodTool({
    name: "listar_alvos_campanha",
    description: "Lista segmentos, tags, funis, etapas, números oficiais e templates aprovados. Chame antes de criar o rascunho; nunca invente ids.",
    inputSchema: z.object({}),
    run: async () => {
      const [segmentos,tags,funis,etapas,wabas] = await Promise.all([
        sql`SELECT s.id,s.nome,count(c.whatsapp)::int AS contatos FROM segmentos s LEFT JOIN contato_segmentos cs ON cs.segmento_id=s.id LEFT JOIN contatos c ON c.id=cs.contato_id AND c.whatsapp IS NOT NULL GROUP BY s.id,s.nome ORDER BY s.nome`,
        sql`SELECT id,nome FROM tags ORDER BY nome`, sql`SELECT id,nome FROM funis ORDER BY nome`,
        sql`SELECT id,nome,funil_id FROM etapas ORDER BY nome`, wabasMeta(),
      ]);
      const telefones=(await Promise.all(wabas.map(w=>telefonesMeta(w.id)))).flat();
      const templates=(await Promise.all(wabas.map(w=>templatesMeta(w.id)))).flat().filter(t=>t.status==="APPROVED");
      return JSON.stringify({segmentos,tags,funis,etapas,wabas,telefones,templates:templates.map(t=>({id:t.id,nome:t.name,idioma:t.language,categoria:t.category}))});
    },
  });
  const listar = betaZodTool({name:"listar_campanhas",description:"Lista campanhas e rascunhos existentes.",inputSchema:z.object({}),run:async()=>JSON.stringify(await sql`SELECT id,nome,status,segmento_nome,template_nome,definicao FROM campanhas_whatsapp ORDER BY data_criacao DESC LIMIT 50`)});
  const escrever = betaZodTool({
    name:"criar_rascunho_campanha",
    description:"Cria um rascunho completo. Não ativa nem envia. Use ids reais de listar_alvos_campanha.",
    inputSchema:z.object({nome:z.string(),segmento_ids:z.array(z.string()).min(1),waba_id:z.string(),telefone_id:z.string(),telefone_exibicao:z.string(),template_nome:z.string(),template_idioma:z.string(),espera_minutos:z.number().min(5).max(43200),ao_responder:z.array(acao),ao_expirar:z.array(acao)}),
    run:async entrada=>{
      const ids=[...new Set(entrada.segmento_ids)];
      const segmentos=await sql`SELECT id,nome FROM segmentos WHERE id=ANY(string_to_array(${ids.join(",")}, ',')::uuid[]) ORDER BY nome`;
      if(segmentos.length!==ids.length)return "RECUSADO: um dos segmentos não existe.";
      const templates=await templatesMeta(entrada.waba_id);
      if(!templates.some(t=>t.name===entrada.template_nome&&t.language===entrada.template_idioma&&t.status==="APPROVED"))return "RECUSADO: template não está aprovado ou não existe nessa WABA.";
      const definicao=lerDefinicao({...entrada,template_nome:entrada.template_nome,template_idioma:entrada.template_idioma});
      const [nova]=await sql`INSERT INTO campanhas_whatsapp (nome,segmento_id,segmento_nome,template_nome,template_idioma,waba_id,telefone_id,telefone_exibicao,status,definicao,criado_por) VALUES (${entrada.nome.slice(0,160)},${ids[0]}::uuid,${segmentos.map(s=>s.nome).join(", ")},${entrada.template_nome},${entrada.template_idioma},${entrada.waba_id},${entrada.telefone_id},${entrada.telefone_exibicao},'rascunho',${JSON.stringify(definicao)}::jsonb,${usuarioId}::uuid) RETURNING id`;
      for(const segmentoId of ids)await sql`INSERT INTO campanha_whatsapp_segmentos(campanha_id,segmento_id) VALUES(${nova.id}::uuid,${segmentoId}::uuid) ON CONFLICT DO NOTHING`;
      gravou=true;return `Fluxo criado com id ${nova.id}. Ele não aparece em Automações; ao clicar em Ativar, ganha um workflow executor próprio no n8n e passa a inscrever também contatos novos dos segmentos.`;
    },
  });
  return {ferramentas:[listarAlvos,listar,escrever],gravou:()=>gravou};
}

export const SISTEMA_CAMPANHAS=`Você monta RASCUNHOS de campanhas oficiais de WhatsApp no Chroma. Responda em português do Brasil.

A campanha sempre é: um ou mais segmentos → bloco de template aprovado com prazo de resposta → ramo respondeu / ramo não respondeu → ações.
Antes de criar, chame listar_alvos_campanha. Use somente ids retornados. Faça o rascunho inteiro na mesma resposta.

Ações: registrar_lead; adicionar_tag; adicionar_segmento; criar_oportunidade (funil, etapa e nome; {{nome}} pode entrar no nome).
Prazo entre 5 minutos e 30 dias. Se o usuário não disser, use 1 dia (1440).
Não crie texto livre: a mensagem é um template aprovado. Se não houver template adequado, explique que ele deve ser criado no módulo Templates.
Você nunca dispara sem confirmação humana. A ferramenta cria o fluxo de campanha fora do módulo Automações. No fim resuma o fluxo e diga para revisar e clicar em Ativar; esse clique cria e liga o workflow executor próprio no n8n.`;
