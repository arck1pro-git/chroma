"use server";

// Mutações do Funil. Roda no servidor — entrada é não confiável.
import { revalidatePath } from "next/cache";
import { listaUuid, sql } from "@/lib/db";
import {
  automacoesDaEntidade,
  dadosDeDisparo,
  inscreverOportunidades,
  pausarExecucao,
  retomarExecucao,
  type AutomacaoDaEntidade,
} from "@/lib/automacoes/repositorio";
import { dispararInscritos } from "@/lib/automacoes/disparo";

// Mover card entre etapas persiste etapa_id + funil_id juntos. A FK composta
// (etapa_id, funil_id) do schema garante que a etapa é do mesmo funil — um
// destino inconsistente é recusado pelo banco, não corrompe o quadro.
export async function moverOportunidade(
  id: string,
  etapaId: string,
  funilId: string,
) {
  await sql`
    UPDATE oportunidades
    SET etapa_id = ${etapaId}, funil_id = ${funilId}
    WHERE id = ${id}`;
  revalidatePath("/");
}

// Anexa o atendimento à oportunidade em vista; chamar de novo com a mesma
// oportunidade desanexa (toggle) — é o que o botão da ficha faz. Anexar
// enquanto já preso a OUTRA oportunidade reatribui, sem confirmação: curadoria
// leve, não um fluxo protegido.
export async function anexarAtendimento(
  atendimentoId: string,
  oportunidadeId: string,
) {
  // Cast explícito nos dois lados: dentro de um CASE o postgres.js não tem
  // como inferir que o parâmetro é uuid (funciona sozinho num "SET col = $1"
  // simples, porque aí o driver usa o tipo da coluna; aqui ele manda text e o
  // Postgres recusa a atribuição).
  await sql`
    UPDATE atendimentos
    SET oportunidade_id = CASE
      WHEN oportunidade_id = ${oportunidadeId}::uuid THEN NULL
      ELSE ${oportunidadeId}::uuid
    END
    WHERE id = ${atendimentoId}`;
  revalidatePath("/");
}

// Os campos personalizados do contato NÃO viajam com a lista de contatos: são
// 17,8 mil linhas numa tela que já carrega tudo. A ficha pede os de UM contato
// quando abre — é leitura, mas mora aqui pra ser chamável do cliente.
export async function camposDoContato(
  contatoId: string,
): Promise<Record<string, string>> {
  const [c] = await sql`SELECT campos FROM contatos WHERE id = ${contatoId}`;
  return (c?.campos ?? {}) as Record<string, string>;
}

export type NovaOportunidade = {
  nome: string;
  contato_id: string;
  valor: number;
  responsavel_id: string;
};

export async function criarOportunidade(
  dados: NovaOportunidade,
  funilId: string,
  etapaId: string,
): Promise<string> {
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Nome é obrigatório");
  // contato_id é NOT NULL no schema (oportunidade é sempre de um contato).
  if (!dados.contato_id) throw new Error("Selecione um contato");

  const [nova] = await sql`
    INSERT INTO oportunidades
      (nome, contato_id, valor, responsavel_id, status, funil_id, etapa_id)
    VALUES
      (${nome}, ${dados.contato_id}, ${dados.valor},
       ${dados.responsavel_id || null}, 'aberta', ${funilId}, ${etapaId})
    RETURNING id`;

  revalidatePath("/");
  return nova.id;
}

// ── Automações do lead, na ficha ────────────────────────────────────────────
//
// Não viajam com carregarFunil: são uma consulta por oportunidade ABERTA na
// tela, e a raiz já carrega a base inteira. Mesma decisão de camposDoContato —
// é leitura, mas mora aqui para ser chamável do cliente.

export async function automacoesDaOportunidade(
  oportunidadeId: string,
): Promise<AutomacaoDaEntidade[]> {
  return automacoesDaEntidade("oportunidade", oportunidadeId);
}

export type ResultadoAutomacao = { ok: boolean; mensagem: string };

/**
 * Pausa a participação DESTA oportunidade na automação — não o fluxo inteiro.
 *
 * Não fala com o motor: lá a execução continua parada num Wait e um dia acorda.
 * Quem barra é o executor, que recusa bloco de execução que não esteja viva
 * (lib/automacoes/executor.ts). As duas pontas juntas é que fazem "pausei"
 * durar mais que o próximo despertar do n8n.
 */
export async function pausarAutomacao(
  execucaoId: string,
): Promise<ResultadoAutomacao> {
  try {
    const n = await pausarExecucao(execucaoId, "Pausada na ficha da oportunidade");
    revalidatePath("/");
    return n > 0
      ? { ok: true, mensagem: "Automação pausada para este lead." }
      : // Zero é o clique repetido, ou a execução ter terminado no meio do
        // caminho. Nenhum dos dois é erro que mereça alarme.
        { ok: false, mensagem: "Esta inscrição já não estava ativa." };
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) };
  }
}

export async function retomarAutomacao(
  execucaoId: string,
): Promise<ResultadoAutomacao> {
  try {
    const n = await retomarExecucao(execucaoId);
    revalidatePath("/");
    return n > 0
      ? { ok: true, mensagem: "Automação retomada." }
      : { ok: false, mensagem: "Esta inscrição não estava pausada." };
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : String(e) };
  }
}


// ── Ações em lote sobre a seleção do kanban ─────────────────────────────────
//
// Todas recebem uma LISTA de ids. Entrada não confiável como qualquer server
// action: `idsValidos` peneira antes de qualquer coisa tocar o banco — um id
// torto viraria erro de sintaxe de uuid do Postgres, e um array gigante viraria
// uma consulta que ninguém pediu.
//
// TETO de 500: é seleção de tela, não importação em massa. Acima disso o
// caminho certo é o disparo por segmento, que não passa a lista pelo navegador.
const TETO_LOTE = 500;

function idsValidos(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const limpos = ids.filter(
    (id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id),
  );
  // Set: o mesmo id repetido faria a mesma linha ser contada duas vezes no
  // "N movidas" que a tela mostra.
  return [...new Set(limpos)].slice(0, TETO_LOTE);
}

export type ResultadoLote = { ok: boolean; mensagem: string };

/** Passa as oportunidades selecionadas para outro responsável. */
export async function moverParaResponsavel(
  oportunidadeIds: string[],
  usuarioId: string | null,
): Promise<ResultadoLote> {
  const ids = idsValidos(oportunidadeIds);
  if (ids.length === 0) return { ok: false, mensagem: "Nada selecionado." };

  // usuarioId null = tirar o responsável (volta a "sem dono"), que é uma
  // operação legítima e não um erro de entrada.
  const alvo = usuarioId && /^[0-9a-f-]{36}$/i.test(usuarioId) ? usuarioId : null;

  const linhas = await sql`
    UPDATE oportunidades SET responsavel_id = ${alvo}
    WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
    RETURNING id`;

  revalidatePath("/");
  return {
    ok: true,
    mensagem: `${linhas.length} ${linhas.length === 1 ? "oportunidade movida" : "oportunidades movidas"}.`,
  };
}

/**
 * Põe os CONTATOS das oportunidades selecionadas num segmento.
 *
 * Segmento é do contato, não da oportunidade — por isso o INSERT sai de
 * `oportunidades`, resolvendo contato_id. Duas oportunidades do mesmo contato
 * são um contato só no segmento, e é o ON CONFLICT que garante isso.
 */
export async function adicionarASegmento(
  oportunidadeIds: string[],
  segmentoId: string,
): Promise<ResultadoLote> {
  const ids = idsValidos(oportunidadeIds);
  if (ids.length === 0) return { ok: false, mensagem: "Nada selecionado." };
  if (!/^[0-9a-f-]{36}$/i.test(segmentoId)) {
    return { ok: false, mensagem: "Segmento inválido." };
  }

  const linhas = await sql`
    INSERT INTO contato_segmentos (contato_id, segmento_id)
    SELECT DISTINCT o.contato_id, ${segmentoId}::uuid
    FROM oportunidades o
    WHERE o.id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
    ON CONFLICT (contato_id, segmento_id) DO NOTHING
    RETURNING contato_id`;

  revalidatePath("/");
  return {
    ok: true,
    mensagem: linhas.length
      ? `${linhas.length} ${linhas.length === 1 ? "contato adicionado" : "contatos adicionados"} ao segmento.`
      : "Todos os contatos selecionados já estavam neste segmento.",
  };
}

/** Inscreve as oportunidades selecionadas num fluxo publicado. */
export async function inscreverEmFluxo(
  oportunidadeIds: string[],
  fluxoId: string,
): Promise<ResultadoLote> {
  const ids = idsValidos(oportunidadeIds);
  if (ids.length === 0) return { ok: false, mensagem: "Nada selecionado." };

  const fluxo = await dadosDeDisparo(fluxoId);
  if (!fluxo) return { ok: false, mensagem: "Automação não encontrada." };
  if (fluxo.entidade_alvo !== "oportunidade") {
    return { ok: false, mensagem: "Esta automação é de contato, não de oportunidade." };
  }
  if (!fluxo.versao_publicada_id || !fluxo.motor_webhook_caminho) {
    return { ok: false, mensagem: "Publique a automação antes de inscrever alguém." };
  }
  if (fluxo.estado === "pausado") {
    return { ok: false, mensagem: "Automação pausada — ligue-a antes de inscrever." };
  }

  const inscritos = await inscreverOportunidades(
    fluxoId,
    fluxo.versao_publicada_id,
    ids,
  );
  if (inscritos.length === 0) {
    return {
      ok: false,
      mensagem: "Ninguém novo: as oportunidades selecionadas já estão nesta automação.",
    };
  }

  const { entraram, perdidas } = await dispararInscritos(fluxo, "oportunidade", inscritos);
  revalidatePath("/");

  if (entraram === 0) {
    return {
      ok: false,
      mensagem: "Nenhuma execução chegou ao motor. Confira se o workflow está ativo.",
    };
  }
  const falhou = perdidas
    ? ` ${perdidas} não chegaram ao motor e voltam no próximo disparo.`
    : "";
  return {
    ok: true,
    mensagem: `${entraram} ${entraram === 1 ? "oportunidade entrou" : "oportunidades entraram"} na automação.${falhou}`,
  };
}

// Aspas duplas viram duas, e o campo inteiro vai entre aspas. É o escape de CSV
// (RFC 4180) — sem ele, um nome com vírgula ("Silva, João") desloca todas as
// colunas seguintes da linha.
function csv(valor: unknown): string {
  const t = valor === null || valor === undefined ? "" : String(valor);
  return `"${t.replace(/"/g, '""')}"`;
}

/**
 * Exporta a seleção em CSV. Devolve o texto; quem faz o download é a tela — o
 * arquivo não chega a existir no servidor.
 *
 * BOM no início: sem ele o Excel em português abre UTF-8 como Latin-1 e todo
 * acento vira caractere quebrado. É o detalhe que decide se o arquivo é
 * utilizável por quem pediu a exportação.
 */
export async function exportarOportunidades(
  oportunidadeIds: string[],
): Promise<{ ok: boolean; conteudo?: string; mensagem?: string }> {
  const ids = idsValidos(oportunidadeIds);
  if (ids.length === 0) return { ok: false, mensagem: "Nada selecionado." };

  const linhas = await sql`
    SELECT o.nome, o.valor, o.status,
           f.nome AS funil, e.nome AS etapa,
           c.nome AS contato, c.whatsapp, c.email, c.cidade, c.estado,
           u.nome AS responsavel,
           to_char(o.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS criada_em
    FROM oportunidades o
    JOIN funis  f ON f.id = o.funil_id
    JOIN etapas e ON e.id = o.etapa_id
    JOIN contatos c ON c.id = o.contato_id
    LEFT JOIN usuarios u ON u.id = o.responsavel_id
    WHERE o.id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
    ORDER BY f.nome, e.ordem, o.nome`;

  const colunas = [
    "nome", "valor", "status", "funil", "etapa",
    "contato", "whatsapp", "email", "cidade", "estado",
    "responsavel", "criada_em",
  ] as const;

  // CRLF entre as linhas: é o que a RFC 4180 manda e o que o Excel no
  // Windows espera.
  const corpo = [
    colunas.join(";"),
    ...linhas.map((l) => colunas.map((c) => csv(l[c])).join(";")),
  ].join("\r\n");

  // Separador ';' e não ',': é o que o Excel em pt-BR espera, pelo mesmo motivo
  // do BOM. Com ',' a planilha abre tudo numa coluna só.
  return { ok: true, conteudo: "\uFEFF" + corpo };
}
