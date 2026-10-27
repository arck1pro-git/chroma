"use server";

// Mutações de funil e etapa (Configurações › Funis e etapas).
//
// Toda ação aqui é ponto de entrada de rede: o navegador posta direto nela, sem
// passar pela tela. Por isso cada uma começa pela guarda. Erro esperado volta
// como `ResultadoAcao` (lib/resultado-acao.ts), nunca como exceção: em produção
// a mensagem de um erro lançado não chega à tela.
//
// Era um trecho de ./actions.ts, que passou de 1.200 linhas e foi dividido por
// assunto em 2026-10-21 (o mesmo desenho de ./acoes-acessos.ts). O "layout" no
// revalidatePath("/configuracoes") vale para todas: cada seção é uma rota.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { corValida } from "@/lib/cores-funil";
import { sql } from "@/lib/db";
import { removerEtapaNoBanco, type ResultadoRemocao } from "@/lib/etapas";
import { NOME_EVENTO_META } from "@/lib/meta-eventos-nomes";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";

export async function criarFunil(
  nome: string,
  descricao: string,
  cor: string,
): Promise<ResultadoAcao<{ id: string }>> {
  await exigirModulo("configuracoes", "criar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome do funil é obrigatório" };

  const [f] = await sql`
    INSERT INTO funis (nome, descricao, cor)
    VALUES (${n}, ${descricao.trim()}, ${corValida(cor)})
    RETURNING id`;

  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  return { ok: true, id: f.id as string };
}

/**
 * Renomeia o funil e troca a descrição.
 *
 * O nome do funil aparece no quadro da raiz, no seletor de etapa das
 * automações e em toda ação de webhook que abre oportunidade — todas leem
 * `funis.nome` na hora, então não há nada a propagar aqui. É por isso que
 * renomear é só um UPDATE: nenhuma cópia do nome foi gravada noutro lugar.
 *
 * A descrição vem junto porque ela nasce no mesmo formulário de criação, e
 * separar as duas obrigaria a tela a ter dois modos de edição para um cartão só.
 */
export async function editarFunil(
  id: string,
  nome: string,
  descricao: string,
): Promise<ResultadoAcao> {
  await exigirModulo("configuracoes", "editar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome do funil é obrigatório" };

  await sql`
    UPDATE funis SET nome = ${n}, descricao = ${descricao.trim()}
    WHERE id = ${id}`;

  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Troca o tom do funil — e, com ele, o de TODAS as etapas dele: os tons são
 * derivados na leitura (lib/cores-funil.ts), não gravados por etapa.
 *
 * corValida peneira antes do banco. O CHECK da coluna recusaria um valor solto
 * de qualquer jeito, mas com um 500 cru em vez de silenciosamente cair no
 * padrão, que é o comportamento útil aqui.
 */
export async function editarCorDoFunil(id: string, cor: string): Promise<void> {
  await exigirModulo("configuracoes", "editar");
  await sql`UPDATE funis SET cor = ${corValida(cor)} WHERE id = ${id}`;
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

// A etapa NÃO recebe mais cor: ela herda um tom do funil conforme a posição
// (migration-cor-no-funil.sql). `etapas.cor` continua na tabela com o DEFAULT
// antigo preenchendo — e ninguém lê.
export async function criarEtapa(
  funilId: string,
  nome: string,
): Promise<ResultadoAcao<{ id: string }>> {
  await exigirModulo("configuracoes", "criar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome da etapa é obrigatório" };

  // ordem = próxima na sequência do funil (a coluna nasce no fim do quadro).
  // Nascer no fim significa nascer com o tom MAIS ESCURO, e empurrar a etapa
  // que era a última um degrau para cima — o gradiente se refaz sozinho.
  const [e] = await sql`
    INSERT INTO etapas (nome, funil_id, ordem)
    VALUES (
      ${n}, ${funilId},
      (SELECT COALESCE(MAX(ordem), 0) + 1 FROM etapas WHERE funil_id = ${funilId})
    )
    RETURNING id`;

  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  return { ok: true, id: e.id as string };
}

export async function editarEtapa(id: string, nome: string): Promise<ResultadoAcao> {
  await exigirModulo("configuracoes", "editar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome da etapa é obrigatório" };
  await sql`UPDATE etapas SET nome = ${n} WHERE id = ${id}`;
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Qual evento da Meta a etapa envia quando uma oportunidade entra nela.
 * `null` desliga. O envio em si mora em lib/meta-eventos.ts.
 *
 * Mudar o evento não reenvia nada para quem já está na etapa: o gatilho é a
 * ENTRADA, e quem já entrou entrou antes de a etapa mandar alguma coisa.
 */
export async function definirEventoMetaDaEtapa(
  id: string,
  evento: string | null,
): Promise<ResultadoAcao> {
  await exigirModulo("configuracoes", "editar");
  const e = evento?.trim() || null;
  if (e && !NOME_EVENTO_META.test(e)) {
    return {
      ok: false,
      erro: "Nome de evento inválido: comece com letra e use só letras, números e _ (até 50).",
    };
  }
  await sql`UPDATE etapas SET meta_evento = ${e} WHERE id = ${id}`;
  revalidatePath("/configuracoes", "layout");
  return { ok: true };
}

// Recebe os ids na ordem final (é o que o drag-and-drop já resolveu na tela)
// e regrava 1..N. Em transação: uma reordenação pela metade deixaria duas
// etapas com o mesmo `ordem` e o quadro empilharia colunas.
export async function reordenarEtapas(etapaIds: string[]): Promise<void> {
  await exigirModulo("configuracoes", "editar");
  await sql.begin(async (tx: typeof sql) => {
    for (let i = 0; i < etapaIds.length; i++) {
      await tx`UPDATE etapas SET ordem = ${i + 1} WHERE id = ${etapaIds[i]}`;
    }
  });
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

/**
 * Remove a etapa; as oportunidades dela (e as webhooks que criam lead nela)
 * vão para `destinoId`. A regra inteira está em lib/etapas.ts.
 *
 * Devolve o erro em vez de lançar: em produção o Next troca a mensagem de um
 * erro lançado numa action por uma genérica, e aqui o motivo ("a etapa tem a
 * cadência X") é justamente o que a pessoa precisa ler.
 */
export async function removerEtapa(
  etapaId: string,
  destinoId: string | null,
): Promise<ResultadoRemocao> {
  await exigirModulo("configuracoes", "excluir");
  if (!ehUuid(etapaId) || (destinoId !== null && !ehUuid(destinoId))) {
    return { erro: "Etapa inválida." };
  }
  const r = await removerEtapaNoBanco(etapaId, destinoId);
  if (!r.erro) {
    revalidatePath("/configuracoes", "layout");
    revalidatePath("/");
  }
  return r;
}
