"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; esta linha acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
import { exigirModulo } from "@/lib/auth/dal";

// Mutações do módulo Webhooks. Roda no servidor — trate a entrada como não
// confiável, mesmo vindo da nossa própria tela.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import type { DestinoCampo, TipoCampo } from "@/lib/webhooks";

function revalidar() {
  revalidatePath("/webhooks");
}

function ehDuplicado(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

// ── Slug e segredo ──────────────────────────────────────────────────────────
// O slug nasce do nome para ser reconhecível num log do outro lado ("de qual
// formulário veio essa chamada?"), e ganha sufixo aleatório porque duas
// captações podem se chamar "Site" — e um slug adivinhável é meia porta aberta,
// já que ele aparece na URL junto do segredo.
function slugDe(nome: string) {
  const base = nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${base || "captacao"}-${randomBytes(3).toString("hex")}`;
}

const novoSegredo = () => randomBytes(32).toString("hex");

/**
 * Cria a webhook JÁ COM a ação "criar lead".
 *
 * Ela é obrigatória (ux_webhook_criar_lead) e as outras três dependem dela —
 * uma webhook recém-criada sem ela responderia 200 sem fazer nada, que é o
 * pior estado possível para depurar.
 */
export async function criarWebhook(nome: string): Promise<string> {
  await exigirModulo("webhooks");
  const n = nome.trim();
  if (!n) throw new Error("Nome é obrigatório");

  const [w] = await sql`
    INSERT INTO webhooks (nome, slug, segredo)
    VALUES (${n}, ${slugDe(n)}, ${novoSegredo()})
    RETURNING id`;

  await sql`
    INSERT INTO webhook_acoes (webhook_id, tipo, ordem)
    VALUES (${w.id}, 'criar_lead', 0)`;

  revalidar();
  return w.id;
}

export async function editarWebhook(
  id: string,
  nome: string,
  descricao: string,
): Promise<void> {
  await exigirModulo("webhooks");
  const n = nome.trim();
  if (!n) throw new Error("Nome é obrigatório");
  await sql`
    UPDATE webhooks
    SET nome = ${n}, descricao = ${descricao.trim() || null},
        data_atualizacao = now()
    WHERE id = ${id}`;
  revalidar();
}

export async function alternarAtivo(id: string, ativo: boolean): Promise<void> {
  await exigirModulo("webhooks");
  await sql`
    UPDATE webhooks SET ativo = ${ativo}, data_atualizacao = now()
    WHERE id = ${id}`;
  revalidar();
}

/**
 * Troca o segredo mantendo a URL. Quebra QUEM JÁ ESTÁ ENVIANDO até o outro
 * lado ser atualizado — é o ponto: é o botão de "vazou".
 */
export async function girarSegredo(id: string): Promise<void> {
  await exigirModulo("webhooks");
  await sql`
    UPDATE webhooks SET segredo = ${novoSegredo()}, data_atualizacao = now()
    WHERE id = ${id}`;
  revalidar();
}

// CASCADE leva campos, ações e recebimentos junto. O contato já criado fica: o
// lead é dele, não da webhook.
export async function excluirWebhook(id: string): Promise<void> {
  await exigirModulo("webhooks");
  await sql`DELETE FROM webhooks WHERE id = ${id}`;
  revalidar();
}

// ── Campos ──────────────────────────────────────────────────────────────────
// A `chave` é o contrato com o outro lado: renomear depois de implementado
// quebra o envio em silêncio (campo não declarado é descartado). Por isso a
// tela avisa, mas deixa — quem implementou pode ter errado a grafia.
export async function criarCampo(
  webhookId: string,
  chave: string,
  rotulo: string,
  tipo: TipoCampo,
  obrigatorio: boolean,
  destino: DestinoCampo,
  destinoChave: string,
): Promise<void> {
  await exigirModulo("webhooks");
  const k = chave.trim();
  if (!k) throw new Error("A chave do campo é obrigatória");
  if (!/^[A-Za-z0-9_.-]+$/.test(k)) {
    throw new Error("A chave só aceita letras, números, ponto, hífen e _");
  }

  const precisaChave = destino.endsWith(".campo");
  const dc = destinoChave.trim();
  if (precisaChave && !dc) {
    throw new Error("Escolha em qual campo personalizado o valor vai ser gravado");
  }

  try {
    await sql`
      INSERT INTO webhook_campos
        (webhook_id, chave, rotulo, tipo, obrigatorio, destino, destino_chave, ordem)
      VALUES (
        ${webhookId}, ${k}, ${rotulo.trim() || k}, ${tipo}, ${obrigatorio},
        ${destino}, ${precisaChave ? dc : null},
        (SELECT COALESCE(MAX(ordem), 0) + 1 FROM webhook_campos WHERE webhook_id = ${webhookId}))`;
    revalidar();
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Já existe um campo com essa chave nesta webhook");
    throw e;
  }
}

export async function editarCampo(
  id: string,
  rotulo: string,
  tipo: TipoCampo,
  obrigatorio: boolean,
  destino: DestinoCampo,
  destinoChave: string,
): Promise<void> {
  await exigirModulo("webhooks");
  const precisaChave = destino.endsWith(".campo");
  const dc = destinoChave.trim();
  if (precisaChave && !dc) {
    throw new Error("Escolha em qual campo personalizado o valor vai ser gravado");
  }
  await sql`
    UPDATE webhook_campos
    SET rotulo = ${rotulo.trim()}, tipo = ${tipo}, obrigatorio = ${obrigatorio},
        destino = ${destino}, destino_chave = ${precisaChave ? dc : null}
    WHERE id = ${id}`;
  revalidar();
}

export async function excluirCampo(id: string): Promise<void> {
  await exigirModulo("webhooks");
  await sql`DELETE FROM webhook_campos WHERE id = ${id}`;
  revalidar();
}

// ── Ações ───────────────────────────────────────────────────────────────────
/**
 * Liga/desliga a criação de oportunidade e diz onde ela nasce.
 *
 * Sem funil e etapa a linha nem entra (o CHECK da tabela recusa), então a
 * validação aqui é só para o erro sair em português em vez de 500 cru.
 */
export async function configurarCriarLead(
  webhookId: string,
  criarOportunidade: boolean,
  funilId: string,
  etapaId: string,
): Promise<void> {
  await exigirModulo("webhooks");
  if (criarOportunidade && (!funilId || !etapaId)) {
    throw new Error("Escolha o funil e a etapa onde o card vai nascer");
  }
  await sql`
    UPDATE webhook_acoes
    SET criar_oportunidade = ${criarOportunidade},
        funil_id = ${criarOportunidade ? funilId : null},
        etapa_id = ${criarOportunidade ? etapaId : null}
    WHERE webhook_id = ${webhookId} AND tipo = 'criar_lead'`;
  revalidar();
}

export async function adicionarAcao(
  webhookId: string,
  tipo: "inscrever_fluxo" | "adicionar_segmento" | "adicionar_tag",
  alvoId: string,
): Promise<void> {
  await exigirModulo("webhooks");
  if (!alvoId) throw new Error("Escolha o alvo da ação");

  try {
    await sql`
      INSERT INTO webhook_acoes (webhook_id, tipo, ordem, fluxo_id, segmento_id, tag_id)
      VALUES (
        ${webhookId}, ${tipo},
        (SELECT COALESCE(MAX(ordem), 0) + 1 FROM webhook_acoes WHERE webhook_id = ${webhookId}),
        ${tipo === "inscrever_fluxo" ? alvoId : null},
        ${tipo === "adicionar_segmento" ? alvoId : null},
        ${tipo === "adicionar_tag" ? alvoId : null})`;
    revalidar();
  } catch (e) {
    if (ehDuplicado(e)) throw new Error("Essa ação já está nesta webhook");
    throw e;
  }
}

// 'criar_lead' não sai: é ela que resolve o contato de quem as outras dependem.
export async function excluirAcao(id: string): Promise<void> {
  await exigirModulo("webhooks");
  await sql`DELETE FROM webhook_acoes WHERE id = ${id} AND tipo <> 'criar_lead'`;
  revalidar();
}
