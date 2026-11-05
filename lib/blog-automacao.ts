// A automação dos artigos no n8n: ver como está, ligar (criando ou atualizando
// o workflow) e pausar.
//
// UM WORKFLOW SÓ PARA O CRM INTEIRO, "[Chroma] Blog · artigos por RSS": ele
// pede a pauta de todos os blogs com a automação ligada e gera um artigo por
// vez. Quem decide se um blog entra é o interruptor do blog (blog.rss_ativo),
// não o workflow.
//
// SÓ A PRODUÇÃO LIGA E PAUSA (a rota confere VERCEL_ENV). A instância do n8n é
// a mesma para DEV e produção — e é compartilhada com o SprintHub —, e o
// workflow é achado pelo nome: ligar a partir do DEV, de um túnel ou de um
// deploy de prévia apontaria o único workflow para um endereço que não é o do
// CRM no ar. Pelo mesmo motivo o endereço que vai nos nós é sempre o domínio de
// produção (ENDERECO_DO_CRM), nunca o do request.
//
// LIGAR É IDEMPOTENTE: cria se não existe; se existe, pausa, reescreve com a
// forma atual (agenda, fuso, endereço, credencial) e liga de novo. É assim que
// uma mudança na agenda chega ao n8n — religando pela tela.
import "server-only";
import { sql } from "@/lib/db";
import {
  acharWorkflowPorNome,
  ativarWorkflow,
  atualizarWorkflow,
  criarCredencial,
  criarWorkflow,
  desativarWorkflow,
  lerWorkflow,
  listarExecucoes,
  type ExecucaoMotor,
} from "@/lib/automacoes/motores/n8n/adaptador";
import { credencialDoMotor } from "@/lib/automacoes/repositorio";
import { ENDERECO_DO_CRM } from "@/lib/link-do-crm";
import {
  AGENDA_AUTOMACAO,
  proximaRodada,
  type EstadoAutomacao,
  type ExecucaoAutomacao,
} from "@/lib/blog-automacao-tipos";
import { NOME_WORKFLOW, NO_PAUTA, montarWorkflowRss } from "@/lib/blog-rss-workflow";

/** Apelido em motor_credenciais — o mesmo das cadências que chamam o CRM de volta. */
const CHAVE_CRED = "crm_callback";
const NOME_CRED = "Chroma · CRM (token de serviço)";

/** Recusa que a rota devolve como 400, com a frase para a tela. */
export class FalhaAutomacao extends Error {}

function temMotor(): boolean {
  return Boolean(process.env.N8N_BASE_URL?.trim() && process.env.N8N_API_KEY?.trim());
}

/** Só a produção mexe no workflow — ver o cabeçalho. */
export function podeLigarDaqui(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function situacao(e: ExecucaoMotor): ExecucaoAutomacao["situacao"] {
  switch (e.status) {
    case "success":
      return "sucesso";
    case "error":
    case "crashed":
      return "erro";
    case "running":
    case "waiting":
    case "new":
      return "rodando";
    case undefined:
      return e.finished ? "sucesso" : e.stoppedAt ? "erro" : "rodando";
    default:
      return "outro";
  }
}

type NoLido = { name?: string; type?: string; parameters?: Record<string, unknown> };

/**
 * O workflow do n8n é de outra versão? Agenda, fuso ou endereço diferentes do
 * que montarWorkflowRss produziria hoje. A tela oferece "Atualizar" quando é.
 */
function desatualizado(lido: unknown): boolean {
  const wf = (lido ?? {}) as { nodes?: NoLido[]; settings?: { timezone?: string } };
  const nos = wf.nodes ?? [];
  const gatilho = nos.find((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  const regra = gatilho?.parameters?.rule as { interval?: { expression?: string }[] } | undefined;
  const pauta = nos.find((n) => n.name === NO_PAUTA);
  return (
    regra?.interval?.[0]?.expression !== AGENDA_AUTOMACAO.cron ||
    wf.settings?.timezone !== AGENDA_AUTOMACAO.fuso ||
    pauta?.parameters?.url !== `${ENDERECO_DO_CRM}/api/blogs/rss/pauta`
  );
}

export async function estadoDaAutomacao(): Promise<EstadoAutomacao> {
  if (!temMotor()) return { estado: "sem-motor" };
  const daqui = podeLigarDaqui();
  try {
    const wf = await acharWorkflowPorNome(NOME_WORKFLOW);
    if (!wf) return { estado: "nao-criada", podeLigarDaqui: daqui };

    const [lido, execucoes] = await Promise.all([lerWorkflow(wf.id), listarExecucoes(wf.id, 8)]);
    return {
      estado: wf.active ? "ligada" : "pausada",
      workflowId: wf.id,
      desatualizada: desatualizado(lido),
      proxima: wf.active ? proximaRodada() : null,
      execucoes: execucoes.map((e) => ({
        id: String(e.id),
        inicio: e.startedAt,
        fim: e.stoppedAt ?? null,
        situacao: situacao(e),
      })),
      podeLigarDaqui: daqui,
    };
  } catch (e) {
    console.error("[blog-automacao] n8n não respondeu:", e);
    return { estado: "erro", mensagem: "O n8n não respondeu agora. Tente de novo em instantes." };
  }
}

/** A credencial Header Auth com o token de serviço, criada uma vez e lembrada. */
async function credencial(): Promise<string> {
  const guardada = await credencialDoMotor("n8n", CHAVE_CRED);
  if (guardada) return guardada.id;

  const token = process.env.CRM_SERVICE_TOKEN;
  if (!token) {
    throw new FalhaAutomacao("CRM_SERVICE_TOKEN não definido: sem ele o n8n não consegue chamar o CRM.");
  }
  // A API pública do n8n não lista credenciais: quem lembra o id é o CRM
  // (motor_credenciais é um mapa apelido → id lá dentro, não um cofre).
  const id = await criarCredencial(NOME_CRED, "httpHeaderAuth", {
    name: "Authorization",
    value: `Bearer ${token}`,
  });
  await sql`
    INSERT INTO motor_credenciais (chave, motor, motor_cred_id, motor_cred_tipo, descricao)
    VALUES (${CHAVE_CRED}, 'n8n', ${id}, 'httpHeaderAuth',
            'Header Auth com o CRM_SERVICE_TOKEN, usada pelos workflows que chamam o CRM de volta')
    ON CONFLICT (motor, chave) DO NOTHING`;
  // Duas pessoas ligando ao mesmo tempo: quem perdeu o ON CONFLICT usa a que ficou.
  return (await credencialDoMotor("n8n", CHAVE_CRED))?.id ?? id;
}

export async function ligarAutomacao(): Promise<{ workflowId: string; criada: boolean }> {
  if (!temMotor()) throw new FalhaAutomacao("O n8n não está configurado neste servidor.");

  const wf = montarWorkflowRss({
    crmBaseUrl: ENDERECO_DO_CRM,
    credencialId: await credencial(),
    credencialNome: NOME_CRED,
  });

  const existente = await acharWorkflowPorNome(NOME_WORKFLOW);
  if (existente) {
    // Workflow publicado não aceita ser reescrito com segurança em todas as
    // versões do n8n: pausa, reescreve, liga.
    if (existente.active) await desativarWorkflow(existente.id);
    await atualizarWorkflow(existente.id, wf);
    await ativarWorkflow(existente.id);
    return { workflowId: existente.id, criada: false };
  }

  const id = await criarWorkflow(wf);
  await ativarWorkflow(id);
  return { workflowId: id, criada: true };
}

export async function pausarAutomacao(): Promise<void> {
  if (!temMotor()) throw new FalhaAutomacao("O n8n não está configurado neste servidor.");
  const existente = await acharWorkflowPorNome(NOME_WORKFLOW);
  if (existente?.active) await desativarWorkflow(existente.id);
}
