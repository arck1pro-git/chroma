"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; esta linha acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
import { exigirModulo } from "@/lib/auth/dal";

// Mutações do Funil. Roda no servidor — entrada é não confiável.
import { revalidatePath } from "next/cache";
import { listaUuid, sql } from "@/lib/db";
import {
  automacoesDaEntidade,
  dadosDeDisparo,
  inscreverNaCadenciaDaEtapa,
  inscreverOportunidades,
  pausarExecucao,
  retomarExecucao,
  type AutomacaoDaEntidade,
} from "@/lib/automacoes/repositorio";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import {
  abertaNoFunil,
  ehDuplicadaNoFunil,
  jaTemAberta,
} from "@/lib/oportunidades";
import {
  moverEtapaRegistrando,
  registrarOportunidadeCriada,
  registrarResponsavel,
  registrarSegmento,
  registrarStatus,
} from "@/lib/historico";
import { STATUS_OPORTUNIDADE, type StatusOportunidade } from "./status";

// Mover card entre etapas persiste etapa_id + funil_id juntos. A FK composta
// (etapa_id, funil_id) do schema garante que a etapa é do mesmo funil — um
// destino inconsistente é recusado pelo banco, não corrompe o quadro.
//
// O UPDATE e a linha de histórico saem na MESMA consulta (lib/historico.ts):
// "movida de X para Y" precisa do nome da etapa de origem, que deixa de existir
// no instante em que o UPDATE roda.
export async function moverOportunidade(
  id: string,
  etapaId: string,
  funilId: string,
) {
  await exigirModulo("inicio");
  await moverEtapaRegistrando(id, etapaId, funilId);
  // Entrar na etapa é entrar na cadência dela, se houver uma rodando. É o que
  // faz a cadência valer para "as próximas que entrarem" sem ninguém clicar em
  // nada — ver inscreverNaCadenciaDaEtapa.
  await entrarNaCadencia(id, etapaId);
  revalidatePath("/");
}

/**
 * Põe a oportunidade na cadência da etapa e manda o motor começar.
 *
 * NÃO DERRUBA QUEM CHAMOU: mover o card é a ação; a cadência é consequência.
 * Se o n8n estiver fora do ar, o card fica na etapa nova do mesmo jeito e a
 * inscrição já está gravada — o próximo Publicar a leva ao motor.
 */
async function entrarNaCadencia(oportunidadeId: string, etapaId: string) {
  try {
    const r = await inscreverNaCadenciaDaEtapa(oportunidadeId, etapaId);
    if (r) await dispararInscritos(r.fluxo, "oportunidade", r.inscritos);
  } catch (e) {
    console.error("[cadencia] falhou ao inscrever na entrada da etapa:", e);
  }
}

// ── Status da oportunidade ──────────────────────────────────────────────────
//
// A lista de valores está em ./status.ts, não aqui: "use server" só deixa este
// arquivo exportar função async, e exportar a constante daqui derruba a página.

/**
 * Marca a oportunidade como ganha, perdida — ou reabre.
 *
 * Fechar NÃO apaga nem esconde: o card continua na etapa em que estava, com o
 * selo mudado. É de propósito — "ganhamos na proposta" é a informação que a
 * etapa carrega, e mover o card para uma coluna "Ganhos" perderia isso.
 *
 * O efeito colateral que importa: `inscreverEtapa` só pega oportunidade com
 * status 'aberta' (lib/automacoes/repositorio.ts), então fechar tira o card das
 * próximas cadências de etapa automaticamente. As inscrições que JÁ estão
 * rodando seguem — fechar é um fato comercial, não um pedido de parar mensagem;
 * quem quer parar tira da automação pela ficha.
 */
export async function mudarStatusOportunidade(
  id: string,
  status: StatusOportunidade,
): Promise<{ ok: boolean; mensagem: string }> {
  await exigirModulo("inicio");
  if (!STATUS_OPORTUNIDADE.includes(status)) {
    return { ok: false, mensagem: "Status inválido." };
  }

  // REABRIR é uma criação disfarçada: a oportunidade volta a ocupar a vaga do
  // contato naquele funil. Se outra já tomou o lugar enquanto esta estava
  // fechada, o índice recusa — e sem esta checagem o usuário veria o 23505.
  if (status === "aberta") {
    const [atual] = await sql`
      SELECT contato_id, funil_id FROM oportunidades WHERE id = ${id}`;
    if (!atual) return { ok: false, mensagem: "Oportunidade não encontrada." };

    const ja = await abertaNoFunil(
      atual.contato_id as string,
      atual.funil_id as string,
      id,
    );
    if (ja) return { ok: false, mensagem: jaTemAberta(ja.contato) };
  }

  let linhas;
  try {
    linhas = await sql`
      UPDATE oportunidades SET status = ${status} WHERE id = ${id}
      RETURNING nome`;
  } catch (e) {
    if (!ehDuplicadaNoFunil(e)) throw e;
    return { ok: false, mensagem: jaTemAberta("Este contato") };
  }

  if (linhas.length === 0) {
    return { ok: false, mensagem: "Oportunidade não encontrada." };
  }

  await registrarStatus(id, status);
  revalidatePath("/");
  return {
    ok: true,
    mensagem:
      status === "aberta"
        ? "Oportunidade reaberta."
        : `Marcada como ${status}.`,
  };
}

/**
 * Exclui a oportunidade — e SÓ ela.
 *
 * O CONTATO NUNCA É TOCADO. É o ponto inteiro desta função: a oportunidade é um
 * negócio que não vingou; a pessoa continua na base, com o histórico dela, as
 * anotações (que são do contato, não daqui) e as outras oportunidades.
 *
 * A ordem abaixo não é arbitrária — sem os dois primeiros passos o DELETE ou
 * falha ou deixa lixo perigoso:
 *
 *  1. CANCELAR as inscrições vivas em automação. `fluxo_execucoes.entidade_id`
 *     é polimórfico e NÃO tem FK (schema-automacoes.sql), então o banco deixaria
 *     a execução apontando para um uuid que não existe mais — e o motor
 *     continuaria acordando para mandar mensagem de um negócio apagado. Cancelar
 *     faz a guarda do workflow barrar o envio no próximo passo.
 *  2. DESANEXAR os atendimentos. `atendimentos.oportunidade_id` tem FK SEM
 *     ON DELETE (migration-atendimento-oportunidade.sql), o que faz o Postgres
 *     RECUSAR o DELETE enquanto houver conversa ligada. A conversa é do contato
 *     e fica; só o vínculo com este negócio se desfaz.
 *  3. O DELETE. `historico` cai por CASCADE (o histórico é deste negócio) e
 *     `webhook_recebimentos.oportunidade_id` vira NULL — a prova de que o lead
 *     chegou pela captação não pode sumir junto.
 */
export async function excluirOportunidade(
  id: string,
): Promise<{ ok: boolean; mensagem: string }> {
  await exigirModulo("inicio");
  const [op] = await sql`SELECT nome FROM oportunidades WHERE id = ${id}`;
  if (!op) return { ok: false, mensagem: "Oportunidade não encontrada." };

  // 1. As esperas primeiro, com a execução ainda viva: é o predicado dela que
  //    seleciona quais cancelar. Mesma ordem de `desinscrever`.
  await sql`
    UPDATE fluxo_esperas es SET estado = 'cancelada'
    FROM fluxo_execucoes e
    WHERE es.execucao_id = e.id
      AND es.estado IN ('ativa','pausada')
      AND e.entidade_tipo = 'oportunidade'
      AND e.entidade_id = ${id}
      AND e.estado IN ('pendente','rodando','esperando','pausada')`;

  const canceladas = await sql`
    UPDATE fluxo_execucoes SET
      estado = 'cancelada',
      erro_msg = 'Oportunidade excluída',
      finalizado_em = now()
    WHERE entidade_tipo = 'oportunidade'
      AND entidade_id = ${id}
      AND estado IN ('pendente','rodando','esperando','pausada')
    RETURNING id`;

  // 2. O vínculo com as conversas. A conversa continua existindo, do contato.
  const soltas = await sql`
    UPDATE atendimentos SET oportunidade_id = NULL
    WHERE oportunidade_id = ${id}
    RETURNING id`;

  // 3. Só a linha da oportunidade.
  await sql`DELETE FROM oportunidades WHERE id = ${id}`;

  revalidatePath("/");

  const extras = [
    canceladas.length
      ? `${canceladas.length} ${canceladas.length === 1 ? "automação cancelada" : "automações canceladas"}`
      : null,
    soltas.length
      ? `${soltas.length} ${soltas.length === 1 ? "conversa desvinculada" : "conversas desvinculadas"}`
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    mensagem: `"${op.nome}" excluída. O contato continua na base${
      extras.length ? ` · ${extras.join(" · ")}` : ""
    }.`,
  };
}

/**
 * Exclui as oportunidades SELECIONADAS — a mesma operação de `excluirOportunidade`,
 * em lote.
 *
 * É uma função separada e não um laço sobre a de cima porque os três passos
 * viram três consultas para o lote inteiro, e não três por cartão: apagar
 * quarenta cartões seriam 120 idas ao banco, cada uma com a sua latência.
 *
 * OS CONTATOS NUNCA SÃO TOCADOS, como lá: o que se apaga é o negócio; a pessoa
 * continua na base, com o histórico, as anotações e as outras oportunidades
 * dela. E a ordem é a mesma, pelas mesmas razões — cancelar as automações antes
 * (o motor continuaria acordando para mandar mensagem de um negócio apagado) e
 * soltar as conversas depois (a FK sem ON DELETE recusaria o DELETE).
 */
export async function excluirOportunidades(
  oportunidadeIds: string[],
): Promise<ResultadoLote> {
  await exigirModulo("inicio");
  const ids = idsValidos(oportunidadeIds);
  if (ids.length === 0) return { ok: false, mensagem: "Nada selecionado." };
  const lista = listaUuid(ids);

  // 1. As esperas primeiro, com a execução ainda viva: é o predicado dela que
  //    seleciona quais cancelar.
  await sql`
    UPDATE fluxo_esperas es SET estado = 'cancelada'
    FROM fluxo_execucoes e
    WHERE es.execucao_id = e.id
      AND es.estado IN ('ativa','pausada')
      AND e.entidade_tipo = 'oportunidade'
      AND e.entidade_id = ANY(string_to_array(${lista}, ',')::uuid[])
      AND e.estado IN ('pendente','rodando','esperando','pausada')`;

  const canceladas = await sql`
    UPDATE fluxo_execucoes SET
      estado = 'cancelada',
      erro_msg = 'Oportunidade excluída',
      finalizado_em = now()
    WHERE entidade_tipo = 'oportunidade'
      AND entidade_id = ANY(string_to_array(${lista}, ',')::uuid[])
      AND estado IN ('pendente','rodando','esperando','pausada')
    RETURNING id`;

  // 2. O vínculo com as conversas. A conversa continua existindo, do contato.
  const soltas = await sql`
    UPDATE atendimentos SET oportunidade_id = NULL
    WHERE oportunidade_id = ANY(string_to_array(${lista}, ',')::uuid[])
    RETURNING id`;

  // 3. Só as linhas das oportunidades. O histórico delas cai por CASCADE — é o
  //    histórico daquele negócio, e ele deixou de existir. Por isso também não
  //    se registra "saiu da automação" aqui: não sobra ficha onde ler.
  const apagadas = await sql`
    DELETE FROM oportunidades
    WHERE id = ANY(string_to_array(${lista}, ',')::uuid[])
    RETURNING id`;

  revalidatePath("/");

  if (apagadas.length === 0) {
    return { ok: false, mensagem: "Nenhuma das oportunidades ainda existe." };
  }

  const extras = [
    canceladas.length
      ? `${canceladas.length} ${canceladas.length === 1 ? "automação cancelada" : "automações canceladas"}`
      : null,
    soltas.length
      ? `${soltas.length} ${soltas.length === 1 ? "conversa desvinculada" : "conversas desvinculadas"}`
      : null,
  ].filter(Boolean);

  const n = apagadas.length;
  return {
    ok: true,
    mensagem: `${n} ${n === 1 ? "oportunidade excluída" : "oportunidades excluídas"}. Os contatos continuam na base${
      extras.length ? ` · ${extras.join(" · ")}` : ""
    }.`,
  };
}

// Anexa o atendimento à oportunidade em vista; chamar de novo com a mesma
// oportunidade desanexa (toggle) — é o que o botão da ficha faz. Anexar
// enquanto já preso a OUTRA oportunidade reatribui, sem confirmação: curadoria
// leve, não um fluxo protegido.
export async function anexarAtendimento(
  atendimentoId: string,
  oportunidadeId: string,
) {
  await exigirModulo("inicio");
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
  await exigirModulo("inicio");
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
  await exigirModulo("inicio");
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Nome é obrigatório");
  // contato_id é NOT NULL no schema (oportunidade é sempre de um contato).
  if (!dados.contato_id) throw new Error("Selecione um contato");

  // Uma aberta por contato em cada funil (migration-oportunidade-unica.sql).
  // A consulta aqui é pela MENSAGEM — quem garante a regra é o índice, e é por
  // isso que o INSERT abaixo também trata a violação: entre esta linha e ele
  // cabe um segundo clique.
  const ja = await abertaNoFunil(dados.contato_id, funilId);
  if (ja) throw new Error(jaTemAberta(ja.contato));

  let nova;
  try {
    [nova] = await sql`
      INSERT INTO oportunidades
        (nome, contato_id, valor, responsavel_id, status, funil_id, etapa_id)
      VALUES
        (${nome}, ${dados.contato_id}, ${dados.valor},
         ${dados.responsavel_id || null}, 'aberta', ${funilId}, ${etapaId})
      RETURNING id`;
  } catch (e) {
    if (!ehDuplicadaNoFunil(e)) throw e;
    throw new Error(jaTemAberta("Este contato"));
  }

  await registrarOportunidadeCriada(nova.id);
  // Card criado JÁ DENTRO da etapa também é "entrou na etapa".
  await entrarNaCadencia(nova.id, etapaId);
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
  await exigirModulo("inicio");
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
  await exigirModulo("inicio");
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
  await exigirModulo("inicio");
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
  await exigirModulo("inicio");
  const ids = idsValidos(oportunidadeIds);
  if (ids.length === 0) return { ok: false, mensagem: "Nada selecionado." };

  // usuarioId null = tirar o responsável (volta a "sem dono"), que é uma
  // operação legítima e não um erro de entrada.
  const alvo = usuarioId && /^[0-9a-f-]{36}$/i.test(usuarioId) ? usuarioId : null;

  const linhas = await sql`
    UPDATE oportunidades SET responsavel_id = ${alvo}
    WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
    RETURNING id`;

  await registrarResponsavel(
    linhas.map((l) => l.id as string),
    alvo,
  );
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
  await exigirModulo("inicio");
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

  await registrarSegmento(
    linhas.map((l) => l.contato_id as string),
    segmentoId,
  );
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
  await exigirModulo("inicio");
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
  await exigirModulo("inicio");
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
