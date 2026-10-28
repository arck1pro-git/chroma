// A IA que monta RASCUNHOS de campanha oficial de WhatsApp (e o modo completo
// do TI, lib/ia/completa.ts, pelas mesmas ferramentas).
//
// Ela escreve no formato SIMPLES de antes (template → prazo → respondeu / não
// respondeu → ações), que vira fluxo em blocos por fluxoDoFormatoAntigo e é
// conferido INTEIRO como o da tela (lib/campanhas-fluxo-entrada.ts: forma,
// permissão de quem pediu, Meta e banco). Por construção a ferramenta que GRAVA
// rascunho nunca gera ligar IA, avisar a equipe, texto livre nem mover
// oportunidade: esses blocos só com uma pessoa olhando o canvas (revisão de
// segurança do desenho, 2026-10-27). Desde 2026-10-28 essa decisão vale só para
// esta ferramenta: a IA do CONSTRUTOR (lib/ia/campanhas-construtor.ts) usa todos
// os blocos porque não grava nada — desenha no canvas aberto, e a pessoa revisa
// antes de Salvar ou Ativar.
import { exigirModulo } from "@/lib/auth/dal";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sql } from "@/lib/db";
import { numeroDaConta, templateDaCampanha } from "@/lib/campanhas-whatsapp";
import { conferirFluxo, definicaoAntiga, fluxoGravado, lerFluxoDaEntrada } from "@/lib/campanhas-fluxo-entrada";
import { fluxoDoFormatoAntigo } from "@/lib/campanhas-fluxo";
import { telefonesMeta, templatesMeta, wabasMeta } from "@/lib/meta";
import { DADOS_NA_CAMPANHA, LIMITE, lerTemplate, variaveisDoTemplate } from "@/lib/templates-whatsapp";
import { ehUuid } from "@/lib/validacao";
import { blocoParaIa } from "./campanhas-construtor-formato";
import { comoDado } from "./sanitizar";

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
      const templates=(await Promise.all(wabas.map(w=>templatesMeta(w.id)))).flat().filter(t=>t.status==="APPROVED").map(lerTemplate);
      // O texto e quantas variáveis cada template pede: sem isso a IA não sabe o que pôr em {{1}}, {{2}}.
      return JSON.stringify({segmentos,tags,funis,etapas,wabas,telefones,templates:templates.map(t=>({id:t.id,nome:t.nome,idioma:t.idioma,categoria:t.categoria,cabecalho:t.cabecalho?.texto??null,corpo:t.corpo,variaveis:variaveisDoTemplate(t)}))});
    },
  });
  // Nunca a definicao crua (revisão de segurança M3, 2026-10-28): nome e
  // segmentos embrulhados, e os blocos no formato da IA, com o texto livre
  // embrulhado — numa campanha de colega ele não é ordem para o modelo.
  const listar = betaZodTool({name:"listar_campanhas",description:"Lista campanhas e rascunhos existentes: nome, situação, segmentos, template e os blocos do fluxo.",inputSchema:z.object({}),run:async()=>{
    const linhas=await sql`SELECT c.id,c.nome,c.status,c.template_nome,c.template_idioma,c.definicao,
      COALESCE((SELECT jsonb_agg(s.nome ORDER BY s.nome) FROM campanha_whatsapp_segmentos cs JOIN segmentos s ON s.id=cs.segmento_id WHERE cs.campanha_id=c.id),jsonb_build_array(c.segmento_nome)) AS segmentos
      FROM campanhas_whatsapp c ORDER BY c.data_criacao DESC LIMIT 50` as unknown as Array<{id:string;nome:string;status:string;template_nome:string|null;template_idioma:string|null;definicao:unknown;segmentos:Array<string|null>}>;
    return JSON.stringify(linhas.map(c=>{const f=fluxoGravado(c);return{id:c.id,nome:comoDado(c.nome),status:c.status,segmentos:c.segmentos.filter(Boolean).map(comoDado),template:c.template_nome,inicio:f.inicio,blocos:Object.entries(f.blocos).map(([id,b])=>blocoParaIa(id,b))}}));
  }});
  const escrever = betaZodTool({
    name:"criar_rascunho_campanha",
    description:"Cria um rascunho completo. Não ativa nem envia. Use ids reais de listar_alvos_campanha.",
    inputSchema:z.object({nome:z.string(),segmento_ids:z.array(z.string()).min(1),waba_id:z.string(),telefone_id:z.string(),telefone_exibicao:z.string(),template_nome:z.string(),template_idioma:z.string(),espera_minutos:z.number().min(5).max(43200),
      variaveis:z.object({cabecalho:z.array(z.string()).max(1),corpo:z.array(z.string()).max(20)}).optional().describe("Valor de cada {{n}} do template, na ordem: texto fixo ou marca de dado do contato."),
      ao_responder:z.array(acao),ao_expirar:z.array(acao)}),
    run:async entrada=>{
      const {usuario}=await exigirModulo("campanhas", "criar");
      const ids=[...new Set(entrada.segmento_ids)];
      if(!ids.every(ehUuid))return "RECUSADO: um dos segmentos não existe.";
      const segmentos=await sql`SELECT id,nome FROM segmentos WHERE id=ANY(string_to_array(${ids.join(",")}, ',')::uuid[]) ORDER BY nome`;
      if(segmentos.length!==ids.length)return "RECUSADO: um dos segmentos não existe.";
      // O formato simples vira fluxo e passa pela MESMA conferência da tela.
      const lido=lerFluxoDaEntrada(fluxoDoFormatoAntigo(definicaoAntiga(entrada)));
      if(!lido.ok)return `RECUSADO: ${lido.problemas.map(p=>p.mensagem).join(" ")} Use ids de listar_alvos_campanha.`;
      const problemas=await conferirFluxo({fluxo:lido.fluxo,wabaId:entrada.waba_id,usuario});
      if(problemas.length)return `RECUSADO: ${problemas.map(p=>p.mensagem).join(" ")}`;
      // O número vem do modelo: só vale um da conta, e o nome exibido sai da Meta.
      const telefone=await numeroDaConta(entrada.waba_id,entrada.telefone_id);
      if(!telefone)return "RECUSADO: esse número não pertence à conta do WhatsApp. Use um de listar_alvos_campanha.";
      const tpl=templateDaCampanha(lido.fluxo);
      const [nova]=await sql`INSERT INTO campanhas_whatsapp (nome,segmento_id,segmento_nome,template_nome,template_idioma,waba_id,telefone_id,telefone_exibicao,status,definicao,criado_por) VALUES (${entrada.nome.slice(0,160)},${ids[0]}::uuid,${segmentos.map(s=>s.nome).join(", ")},${tpl.template_nome},${tpl.template_idioma},${entrada.waba_id},${telefone.id},${telefone.display_phone_number},'rascunho',${sql.json(lido.fluxo as never)},${usuarioId}::uuid) RETURNING id`;
      for(const segmentoId of ids)await sql`INSERT INTO campanha_whatsapp_segmentos(campanha_id,segmento_id) VALUES(${nova.id}::uuid,${segmentoId}::uuid) ON CONFLICT DO NOTHING`;
      gravou=true;return `Fluxo criado com id ${nova.id}. Ele não aparece em Automações; ao clicar em Ativar, ganha um workflow executor próprio no n8n e passa a inscrever também contatos novos dos segmentos.`;
    },
  });
  return {ferramentas:[listarAlvos,listar,escrever],gravou:()=>gravou};
}

// As regras de montar campanha, sem a frase de abertura: o modo completo
// (lib/ia/completa.ts) monta campanha também e usa este mesmo texto.
export const REGRAS_DE_CAMPANHA = `A campanha sempre é: um ou mais segmentos → bloco de template aprovado com prazo de resposta → ramo respondeu / ramo não respondeu → ações.
Antes de criar, chame listar_alvos_campanha. Use somente ids retornados. Faça o rascunho inteiro na mesma resposta.

Ações: registrar_lead; adicionar_tag; adicionar_segmento; criar_oportunidade (funil, etapa e nome; {{nome}} pode entrar no nome).
Prazo entre 5 minutos e 30 dias. Se o usuário não disser, use 1 dia (1440).
Variáveis: preencha exatamente as {{n}} que o template pede (a quantidade está em "variaveis" de listar_alvos_campanha), na ordem, cada uma com um dado do contato — ${DADOS_NA_CAMPANHA.map((d) => `{{${d.chave}}} (${d.rotulo.toLowerCase()})`).join(", ")} — ou com um texto fixo curto (até ${LIMITE.valorFixo} caracteres, sem link). Não existe outra marca: e-mail e telefone do contato não vão em campanha. Se não souber o que vai numa variável, pergunte antes de criar. Contato sem o dado escolhido fica de fora do disparo, com a falha registrada.
A mensagem em si é um template aprovado: fora das variáveis, não escreva texto. Se não houver template adequado, explique que ele deve ser criado no módulo Templates.
Saídas por botão, texto livre, espera, aviso à equipe, passar para a IA e mover oportunidade não são com você: diga que a pessoa acrescenta esses blocos no canvas da campanha, depois do rascunho.
Você nunca dispara sem confirmação humana. A ferramenta cria o fluxo de campanha fora do módulo Automações. No fim resuma o fluxo e diga para revisar e clicar em Ativar; esse clique cria e liga o workflow executor próprio no n8n.`;

export const SISTEMA_CAMPANHAS = `Você monta RASCUNHOS de campanhas oficiais de WhatsApp no AmaanOffice. Responda em português do Brasil.

${REGRAS_DE_CAMPANHA}`;
