// Módulo Infra: as integrações que rodam por trás.
//   · n8n: executa as cadências e os agendadores. A instância é dividida com o
//     SprintHub, então só conta o que é do CRM: os workflows com o prefixo
//     [Chroma] (lib/automacoes/motores/n8n/adaptador.ts) e as falhas deles nas
//     últimas 24 h. Só leitura pela API do n8n.
//   · Google: a agenda conectada por OAuth (as reuniões e os horários da IA). A
//     conferência pede um token de acesso, como o CRM faz a cada leitura da
//     agenda: refresh token revogado aparece aqui antes de a IA errar horário.
import "server-only";
import { acessoGoogle, conexaoGoogle, GoogleDesconectado } from "@/lib/google-oauth";
import { horaCurta } from "@/lib/formato";
import { piorEstado, type CartaoInfra, type EstadoInfra, type MedidaInfra } from "@/lib/infra-tipos";

const PREFIXO_DO_CRM = "[Chroma]";

type Workflow = { id: string; name: string; active: boolean };
type Execucao = { workflowId: string; startedAt: string; status?: string };

async function n8n<T>(caminho: string): Promise<T> {
  const base = (process.env.N8N_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const chave = (process.env.N8N_API_KEY ?? "").trim();
  if (!base || !chave) throw new Error("n8n não configurado");
  const r = await fetch(`${base}/api/v1/${caminho}`, {
    headers: { "X-N8N-API-KEY": chave, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`n8n respondeu ${r.status}`);
  return (await r.json()) as T;
}

/** Todos os workflows, seguindo as páginas da API (250 por vez). */
async function workflows(): Promise<Workflow[]> {
  const todos: Workflow[] = [];
  let cursor = "";
  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await n8n<{ data: Workflow[]; nextCursor?: string | null }>(`workflows?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    todos.push(...r.data);
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return todos;
}

export async function cartaoN8n(): Promise<CartaoInfra> {
  const lidoEm = new Date().toISOString();
  const base = { chave: "n8n", titulo: "Automações", subtitulo: "n8n · cadências e agendadores", lidoEm };
  let lista: Workflow[];
  let falhas: Execucao[];
  try {
    [lista, falhas] = await Promise.all([
      workflows(),
      n8n<{ data: Execucao[] }>("executions?status=error&limit=250").then((r) => r.data),
    ]);
  } catch (e) {
    return {
      ...base,
      estado: "critico",
      medidas: [],
      avisos: [`O n8n não respondeu (${e instanceof Error ? e.message : "erro"}): cadências e agendadores podem estar parados.`],
    };
  }
  const doCrm = lista.filter((w) => w.name.startsWith(PREFIXO_DO_CRM));
  const ids = new Map(doCrm.map((w) => [w.id, w.name]));
  const desde = Date.now() - 86_400_000;
  const recentes = falhas
    .filter((f) => ids.has(f.workflowId) && Date.parse(f.startedAt) > desde)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const estadoFalhas: EstadoInfra = recentes.length === 0 ? "ok" : recentes.length >= 10 ? "critico" : "atencao";

  const medidas: MedidaInfra[] = [
    { rotulo: "Workflows do CRM ativos", valor: String(doCrm.filter((w) => w.active).length), limite: `de ${doCrm.length}` },
    {
      rotulo: "Falhas em 24 h",
      valor: String(recentes.length),
      limite: recentes.length ? `a última às ${horaCurta(recentes[0].startedAt)}` : undefined,
      estado: estadoFalhas,
    },
  ];
  const avisos: string[] = [];
  if (recentes.length) {
    const afetados = [...new Set(recentes.map((f) => (ids.get(f.workflowId) ?? "").replace(PREFIXO_DO_CRM, "").trim()))].slice(0, 3);
    avisos.push(`${recentes.length} execuções do CRM falharam no n8n em 24 h (${afetados.join(", ")}). Veja o motivo em Automações ou no n8n.`);
  }
  return { ...base, estado: piorEstado(...medidas.map((m) => m.estado)), medidas, avisos };
}

export async function cartaoGoogle(): Promise<CartaoInfra> {
  const lidoEm = new Date().toISOString();
  const base = { chave: "google", titulo: "Google", subtitulo: "Agenda das reuniões e gravações do Meet", lidoEm };
  const medidas: MedidaInfra[] = [];
  const avisos: string[] = [];

  const conexao = await conexaoGoogle();
  if (!conexao) {
    medidas.push({ rotulo: "Agenda", valor: "Não conectada", estado: "critico" });
    avisos.push("Nenhuma agenda do Google conectada: a IA não marca reunião e a Agenda fica vazia. Conecte em Agenda.");
  } else {
    try {
      await acessoGoogle();
      medidas.push({ rotulo: "Agenda", valor: "Conectada", estado: "ok" });
    } catch (e) {
      if (!(e instanceof GoogleDesconectado)) throw e;
      medidas.push({ rotulo: "Agenda", valor: "Acesso recusado", estado: "critico" });
      avisos.push("O Google recusou o acesso à agenda: a IA não marca reunião até conectar de novo em Agenda.");
    }
  }
  const contaDeServico = Boolean(process.env.GOOGLE_SA_EMAIL?.trim() && process.env.GOOGLE_SA_PRIVATE_KEY?.trim());
  medidas.push({
    rotulo: "Conta de serviço",
    valor: contaDeServico ? "Configurada" : "Não configurada",
    limite: "Drive e gravações do Meet",
    estado: contaDeServico ? "ok" : "atencao",
  });
  return { ...base, estado: piorEstado(...medidas.map((m) => m.estado)), medidas, avisos };
}
