import "server-only";
import { z } from "zod";
import { contaAutorizada } from "./meta-ads-relatorio";
import { ErroMeta, listarMeta, permissoesMeta, requisicao } from "./meta";
import type { RecursosAds, RecursoMeta } from "./meta-ads-tipos";

const id = z.string().regex(/^\d+$/);
const base = { conta: z.string().regex(/^act_\d+$/), confirmar: z.literal(true) };
export const acaoAds = z.discriminatedUnion("acao", [
  z.object({ ...base, acao: z.literal("editar"), id, nivel: z.enum(["campaign", "adset", "ad"]), nome: z.string().trim().min(1).max(200).optional(), status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    orcamento: z.number().int().positive().max(100000000).optional(), tipoOrcamento: z.enum(["daily_budget", "lifetime_budget"]).optional(),
  }).strict(),
  z.object({ ...base, acao: z.literal("duplicar"), id, nivel: z.enum(["campaign", "adset", "ad"]) }).strict(),
  z.object({ ...base, acao: z.literal("criar_campanha"), nome: z.string().trim().min(1).max(200), objetivo: z.enum(["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_APP_PROMOTION"]), categorias: z.array(z.enum(["CREDIT", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS"])).max(4) }).strict(),
]);
export type AcaoAds = z.infer<typeof acaoAds>;

export async function executarAcaoAds(entrada: AcaoAds) {
  const conta = await contaAutorizada(entrada.conta);
  if (!(await permissoesMeta()).includes("ads_management")) throw new ErroMeta("A integração não possui ads_management.", undefined, 403);
  if (entrada.acao === "criar_campanha") return requisicao<{id:string}>(`${entrada.conta}/campaigns`, { method: "POST", body: {
    name: entrada.nome, objective: entrada.objetivo, status: "PAUSED", special_ad_categories: entrada.categorias, is_adset_budget_sharing_enabled: false,
  } });
  // A conta e a hierarquia são verificadas no servidor antes de qualquer escrita.
  const fields = entrada.nivel === "campaign" ? "id,account_id,daily_budget,lifetime_budget" : entrada.nivel === "adset" ? "id,account_id,campaign_id,daily_budget,lifetime_budget" : "id,account_id,adset_id,campaign_id";
  const objeto = await requisicao<{account_id:string;campaign_id?:string;adset_id?:string;daily_budget?:string;lifetime_budget?:string}>(entrada.id, { params: { fields } });
  if (`act_${objeto.account_id}` !== entrada.conta || (entrada.nivel === "adset" && !objeto.campaign_id) || (entrada.nivel === "ad" && !objeto.adset_id)) throw new ErroMeta("Objeto não pertence à conta ou ao nível informado.", undefined, 403);
  if (entrada.acao === "duplicar") return requisicao<Record<string, unknown>>(`${entrada.id}/copies`, { method: "POST", body: { status_option: "PAUSED", ...(entrada.nivel !== "ad" ? { deep_copy: true } : {}) } });
  const body: Record<string, string | number> = {};
  if (entrada.nome) body.name = entrada.nome;
  if (entrada.status) body.status = entrada.status;
  if (entrada.orcamento !== undefined) {
    if (conta.currency !== "BRL") throw new ErroMeta("A edição de orçamento está disponível para contas em BRL.", undefined, 400);
    if (entrada.nivel === "ad" || !entrada.tipoOrcamento) throw new ErroMeta("Defina o orçamento na campanha ou no conjunto.", undefined, 400);
    if (entrada.nivel === "adset") {
      const campanha = await requisicao<{daily_budget?:string;lifetime_budget?:string}>(objeto.campaign_id!, { params: { fields: "daily_budget,lifetime_budget" } });
      if (Number(campanha.daily_budget) > 0 || Number(campanha.lifetime_budget) > 0) throw new ErroMeta("Esta campanha controla o orçamento. Edite o valor na campanha.", undefined, 400);
    }
    const tipoAtual = Number(objeto.daily_budget) > 0 ? "daily_budget" : Number(objeto.lifetime_budget) > 0 ? "lifetime_budget" : null;
    if (tipoAtual !== entrada.tipoOrcamento) throw new ErroMeta("Edite o tipo de orçamento já configurado na Meta.", undefined, 400);
    body[entrada.tipoOrcamento] = entrada.orcamento;
  }
  if (!Object.keys(body).length) throw new ErroMeta("Nenhuma alteração informada.", undefined, 400);
  return requisicao<{success:boolean}>(entrada.id, { method: "POST", body });
}

export async function recursosAds(conta: string): Promise<RecursosAds> {
  await contaAutorizada(conta);
  const avisos: string[] = [];
  async function consultar(caminho: string, fields: string, nome: string, accessToken?: string) {
    try { return await listarMeta<RecursoMeta>(caminho, { fields, limit: "100" }, accessToken); }
    catch (e) { avisos.push(`${nome}: ${e instanceof Error ? e.message : "indisponível"}`); return []; }
  }
  const [publicos, pixels, paginas] = await Promise.all([
    consultar(`${conta}/customaudiences`, "id,name,subtype,approximate_count_lower_bound", "Públicos"),
    consultar(`${conta}/adspixels`, "id,name", "Pixels"),
    consultar("me/accounts", "id,name", "Páginas"),
  ]);
  const formularios = (await Promise.all(paginas.map(async p => {
    try {
      const credencial = await requisicao<{access_token?:string}>(p.id, {params:{fields:"access_token"}});
      if (!credencial.access_token) throw new Error("Token da página indisponível.");
      return await consultar(`${p.id}/leadgen_forms`, "id,name,status", `Formulários de ${p.name}`, credencial.access_token);
    } catch (e) { avisos.push(`Formulários de ${p.name}: ${e instanceof Error ? e.message : "indisponível"}`); return []; }
  }))).flat();
  return { publicos, pixels, paginas, formularios, avisos };
}
