// Demandas: o que cada pessoa tem para fazer, com o check de feito, e os
// chamados abertos para o TI. Tabela em migration-demandas.sql.
//
// QUEM VÊ O QUÊ — decidido aqui, na consulta, e não na tela:
//   · todo mundo com o módulo vê as demandas que são DELA, as do departamento
//     dela (é assim que o TI recebe os chamados) e as que ELA criou (é assim
//     que quem abriu um chamado acompanha);
//   · Admin e TI veem as de todos.
//
// QUEM CRIA PARA ONDE (podeCriarPara): desde 2026-10-08 ("todo mundo poder
// gerar demanda pra todo mundo") qualquer um cria para si, para qualquer pessoa
// da equipe ou abre um chamado para o TI; "para todos" (uma por pessoa, de uma
// vez) continua só de Admin e TI.
//
// "Admin e TI" é o DEPARTAMENTO, pelo slug, e não o escopo do módulo nem
// `usuarios.papel` — decisão dele de 2026-10-07 ("fixo"). Mudar quem administra
// demandas é mudar ADMINISTRAM abaixo e publicar.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import type { UsuarioLogado } from "@/lib/auth/dal";
import {
  PARA_TODOS,
  type ContagemDemandas,
  type Demanda,
  type ItemDemanda,
  type Prioridade,
} from "@/lib/demandas-tipos";

const ADMINISTRAM = new Set(["admin", "ti"]);

/** O departamento que recebe os chamados do botão "Abrir chamado". */
const SLUG_DO_TI = "ti";

/** As feitas somem da tela depois disso; a linha continua no banco. */
const DIAS_DE_FEITAS = 90;

export function administraDemandas(usuario: UsuarioLogado): boolean {
  return ADMINISTRAM.has(usuario.departamento?.slug ?? "");
}

/**
 * Para onde esta pessoa pode mandar uma demanda nova. Desde 2026-10-08 (pedido
 * dele: "todo mundo poder gerar demanda pra todo mundo"): para si, para o TI ou
 * para qualquer pessoa da equipe, qualquer um; "para todos" de uma vez, só
 * Admin e TI — é a única que vira dez demandas num clique.
 *
 * Quem PODE RECEBER (ativo, com login e com o módulo) não é decidido aqui: é o
 * próprio INSERT de inserirDemandas que filtra, e ninguém recebendo vira erro na
 * ação.
 *
 * É a regra de verdade, conferida no servidor: a tela só oferece as opções que
 * esta função aceitaria, mas quem posta direto na ação passa por aqui do mesmo
 * jeito.
 */
export function podeCriarPara(usuario: UsuarioLogado, para: string): boolean {
  if (para === PARA_TODOS) return administraDemandas(usuario);
  return true;
}

function paraDemanda(l: Record<string, unknown>): Demanda {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: l.id as string,
    titulo: l.titulo as string,
    descricao: (l.descricao as string | null) ?? null,
    prazo: (l.prazo as string | null) ?? null,
    prioridade: l.prioridade as Prioridade,
    responsavelId: (l.responsavel_id as string | null) ?? null,
    responsavel: (l.responsavel as string | null) ?? null,
    responsavelIniciais: (l.responsavel_iniciais as string | null) ?? null,
    departamentoId: (l.departamento_id as string | null) ?? null,
    departamento: (l.departamento as string | null) ?? null,
    criadoPor: (l.criado_por as string | null) ?? null,
    autor: (l.autor as string | null) ?? null,
    dataCriacao: iso(l.data_criacao)!,
    iniciadaEm: iso(l.iniciada_em),
    iniciadaPor: (l.iniciada_por as string | null) ?? null,
    feitaEm: iso(l.feita_em),
    feitaPor: (l.feita_por as string | null) ?? null,
    itens: [],
  };
}

/**
 * As demandas que esta pessoa enxerga: todas as pendentes e as feitas dos
 * últimos 90 dias.
 *
 * `prazo` sai como texto: o driver devolveria `date` como Date à meia-noite
 * UTC, e em Brasília isso é o dia anterior.
 */
export async function listarDemandas(
  usuario: UsuarioLogado,
  todas: boolean,
): Promise<Demanda[]> {
  const departamento = usuario.departamento?.id ?? null;
  const linhas = await sql`
    SELECT d.id, d.titulo, d.descricao,
           to_char(d.prazo, 'YYYY-MM-DD') AS prazo,
           d.prioridade,
           d.responsavel_id, r.nome   AS responsavel,
           r.iniciais                 AS responsavel_iniciais,
           d.departamento_id, dep.nome AS departamento,
           d.criado_por, a.nome       AS autor,
           d.data_criacao, d.iniciada_em,
           i.nome                     AS iniciada_por,
           d.feita_em,
           f.nome                     AS feita_por
      FROM demandas d
      LEFT JOIN usuarios r        ON r.id = d.responsavel_id
      LEFT JOIN departamentos dep ON dep.id = d.departamento_id
      LEFT JOIN usuarios a        ON a.id = d.criado_por
      LEFT JOIN usuarios i        ON i.id = d.iniciada_por
      LEFT JOIN usuarios f        ON f.id = d.feita_por
     WHERE (d.feita_em IS NULL
            OR d.feita_em > now() - make_interval(days => ${DIAS_DE_FEITAS}))
       AND (${todas}::boolean
            OR d.responsavel_id  = ${usuario.id}
            OR d.departamento_id = ${departamento}
            OR d.criado_por      = ${usuario.id})
     ORDER BY d.data_criacao DESC`;
  const demandas = linhas.map(paraDemanda);
  if (!demandas.length) return demandas;

  // O checklist numa segunda consulta, de uma vez para a lista inteira. Sem a
  // tabela (migration-demanda-itens.sql não rodou), a tela segue sem checklist.
  const itens = await sql`
    SELECT i.id, i.demanda_id, i.texto, i.ordem, i.feito_em, u.nome AS feito_por
      FROM demanda_itens i
      LEFT JOIN usuarios u ON u.id = i.feito_por
     WHERE i.demanda_id = ANY(string_to_array(${listaUuid(demandas.map((d) => d.id))}, ',')::uuid[])
     ORDER BY i.demanda_id, i.ordem`.catch((e: { code?: string }) => {
    if (e?.code === "42P01") return [];
    throw e;
  });
  const porDemanda = new Map(demandas.map((d) => [d.id, d.itens]));
  for (const i of itens) {
    porDemanda.get(i.demanda_id as string)?.push({
      id: i.id as string,
      texto: i.texto as string,
      ordem: Number(i.ordem),
      feitoEm: i.feito_em ? new Date(i.feito_em as string).toISOString() : null,
      feitoPor: (i.feito_por as string | null) ?? null,
    } satisfies ItemDemanda);
  }
  return demandas;
}

/**
 * O número da barra lateral: as demandas A FAZER para a pessoa — as dela e as
 * do departamento dela (os chamados chegam ao TI assim), a mesma regra do
 * recorte "Para mim" — e quantas delas passaram do prazo. Sem a tabela
 * (migration não rodou), zero: a barra não pode derrubar o layout.
 */
export async function contarPendentes(usuario: UsuarioLogado): Promise<ContagemDemandas> {
  try {
    const [c] = await sql`
      SELECT count(*)::int AS pendentes,
             count(*) FILTER (WHERE prazo < (now() AT TIME ZONE 'America/Sao_Paulo')::date)::int AS atrasadas
        FROM demandas
       WHERE feita_em IS NULL
         AND (responsavel_id = ${usuario.id} OR departamento_id = ${usuario.departamento?.id ?? null})`;
    return { pendentes: Number(c?.pendentes ?? 0), atrasadas: Number(c?.atrasadas ?? 0) };
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return { pendentes: 0, atrasadas: 0 };
    throw e;
  }
}

/**
 * Quem pode receber demanda: ativo, com login e com o módulo Demandas. Quem não
 * tem o módulo não veria a demanda, e ela ficaria pendente para sempre na tela
 * de quem criou.
 */
export async function pessoasParaDemanda(): Promise<{ id: string; nome: string }[]> {
  const linhas = await sql`
    SELECT u.id, u.nome
      FROM usuarios u
      JOIN departamento_modulos dm
        ON dm.departamento_id = u.departamento_id AND dm.modulo = 'demandas'
     WHERE u.ativo = true AND u.email IS NOT NULL
     ORDER BY u.nome`;
  return linhas.map((l) => ({ id: l.id as string, nome: l.nome as string }));
}

type Campos = {
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  prioridade: Prioridade;
};

/**
 * Cria a demanda para uma pessoa, ou uma POR PESSOA quando `para` é "todos".
 * Devolve os ids das que nasceram — nenhum quer dizer que a pessoa escolhida
 * não pode recebê-la (ver pessoasParaDemanda, que é o mesmo filtro).
 */
export async function inserirDemandas(
  campos: Campos,
  para: string,
  criadoPor: string,
): Promise<string[]> {
  const todos = para === "todos";
  const linhas = await sql`
    INSERT INTO demandas (titulo, descricao, prazo, prioridade, responsavel_id, criado_por)
    SELECT ${campos.titulo}, ${campos.descricao}, ${campos.prazo}::date,
           ${campos.prioridade}, u.id, ${criadoPor}
      FROM usuarios u
      JOIN departamento_modulos dm
        ON dm.departamento_id = u.departamento_id AND dm.modulo = 'demandas'
     WHERE u.ativo = true AND u.email IS NOT NULL
       AND (${todos}::boolean OR u.id::text = ${para})
    RETURNING id`;
  return linhas.map((l) => l.id as string);
}

/** O chamado: uma demanda do departamento TI. null = o TI não existe no banco. */
export async function inserirChamado(campos: Campos, criadoPor: string): Promise<string | null> {
  const linhas = await sql`
    INSERT INTO demandas (titulo, descricao, prazo, prioridade, departamento_id, criado_por)
    SELECT ${campos.titulo}, ${campos.descricao}, ${campos.prazo}::date,
           ${campos.prioridade}, d.id, ${criadoPor}
      FROM departamentos d
     WHERE d.slug = ${SLUG_DO_TI}
    RETURNING id`;
  return (linhas[0]?.id as string | undefined) ?? null;
}

// ── Checklist ───────────────────────────────────────────────────────────────
//
// Regras dele (2026-10-07): quem CRIOU a demanda monta o checklist; quem
// RECEBE marca os itens. Na demanda "para todos", cada pessoa tem a sua cópia
// dos itens — e o que quem criou muda vale para todas as cópias. O "mesmo item"
// em duas cópias é o da mesma posição (`ordem`): como só quem criou mexe, e
// sempre em todas de uma vez, as posições andam juntas.

/** Os passos de uma demanda nova, em cada uma das cópias, numa inserção só. */
export async function inserirItens(demandaIds: string[], textos: string[]) {
  if (!demandaIds.length || !textos.length) return;
  const passos = sql.json(textos.map((texto, i) => ({ texto, ordem: i + 1 })) as never);
  await sql`
    INSERT INTO demanda_itens (demanda_id, texto, ordem)
    SELECT d, p.texto, p.ordem
      FROM unnest(string_to_array(${listaUuid(demandaIds)}, ',')::uuid[]) AS d
     CROSS JOIN jsonb_to_recordset(${passos}::jsonb) AS p(texto text, ordem int)`;
}

/**
 * A demanda e as irmãs dela — as cópias da mesma demanda "para todos", que
 * nasceram no mesmo INSERT (mesmo autor, mesmo título, mesmo instante, até o
 * microssegundo). Chamado e demanda avulsa voltam sozinhos.
 */
async function copiasDe(demandaId: string): Promise<{ ids: string[]; criadoPor: string | null } | null> {
  const linhas = await sql`
    SELECT s.id, d.criado_por
      FROM demandas d
      JOIN demandas s
        ON s.id = d.id
        OR (d.responsavel_id IS NOT NULL AND s.responsavel_id IS NOT NULL
            AND s.criado_por IS NOT DISTINCT FROM d.criado_por
            AND s.data_criacao = d.data_criacao AND s.titulo = d.titulo)
     WHERE d.id = ${demandaId}`;
  if (!linhas.length) return null;
  return { ids: [...new Set(linhas.map((l) => l.id as string))], criadoPor: (linhas[0].criado_por as string | null) ?? null };
}

/** O item, a demanda dele e as cópias — o que montar o checklist precisa saber. */
async function itemComCopias(itemId: string) {
  const [i] = await sql`SELECT demanda_id, ordem FROM demanda_itens WHERE id = ${itemId}`;
  if (!i) return null;
  const copias = await copiasDe(i.demanda_id as string);
  return copias ? { ...copias, ordem: Number(i.ordem) } : null;
}

/** Acrescenta um passo no fim do checklist (de cada cópia). Só quem criou a demanda. */
export async function adicionarItem(demandaId: string, texto: string, usuario: UsuarioLogado): Promise<boolean> {
  const copias = await copiasDe(demandaId);
  if (!copias || copias.criadoPor !== usuario.id) return false;
  const ids = listaUuid(copias.ids);
  // A mesma posição em todas as cópias: o máximo entre elas, mais um.
  await sql`
    INSERT INTO demanda_itens (demanda_id, texto, ordem)
    SELECT d, ${texto},
           (SELECT coalesce(max(ordem), 0) + 1 FROM demanda_itens
             WHERE demanda_id = ANY(string_to_array(${ids}, ',')::uuid[]))
      FROM unnest(string_to_array(${ids}, ',')::uuid[]) AS d`;
  return true;
}

/** Troca o texto de um passo (em cada cópia). Só quem criou a demanda. */
export async function renomearItem(itemId: string, texto: string, usuario: UsuarioLogado): Promise<boolean> {
  const alvo = await itemComCopias(itemId);
  if (!alvo || alvo.criadoPor !== usuario.id) return false;
  await sql`
    UPDATE demanda_itens SET texto = ${texto}
     WHERE ordem = ${alvo.ordem}
       AND demanda_id = ANY(string_to_array(${listaUuid(alvo.ids)}, ',')::uuid[])`;
  return true;
}

/** Tira um passo (de cada cópia). Só quem criou a demanda. */
export async function removerItem(itemId: string, usuario: UsuarioLogado): Promise<boolean> {
  const alvo = await itemComCopias(itemId);
  if (!alvo || alvo.criadoPor !== usuario.id) return false;
  await sql`
    DELETE FROM demanda_itens
     WHERE ordem = ${alvo.ordem}
       AND demanda_id = ANY(string_to_array(${listaUuid(alvo.ids)}, ',')::uuid[])`;
  return true;
}

/**
 * O check de um passo. Marca quem marca a demanda: a pessoa dela, ou alguém do
 * departamento do chamado. Como no check da demanda, marcar de novo o que já
 * estava feito não troca a hora nem o autor (o SET lê o valor antigo).
 *
 * Marcar um passo também põe a demanda "Em andamento" (decisão dele,
 * 2026-10-09), se ela ainda não estava. Desmarcar NÃO a tira de lá: começou é
 * começou — quem quiser devolvê-la arrasta para a coluna do prazo.
 */
export async function marcarItem(itemId: string, feito: boolean, usuario: UsuarioLogado): Promise<boolean> {
  const departamento = usuario.departamento?.id ?? null;
  const linhas = await sql`
    WITH marcado AS (
      UPDATE demanda_itens i
         SET feito_em  = CASE WHEN ${feito}::boolean THEN coalesce(i.feito_em, now()) ELSE NULL END,
             feito_por = CASE WHEN NOT ${feito}::boolean THEN NULL
                              WHEN i.feito_em IS NULL THEN ${usuario.id}::uuid
                              ELSE i.feito_por END
        FROM demandas d
       WHERE i.id = ${itemId}
         AND d.id = i.demanda_id
         AND (d.responsavel_id = ${usuario.id} OR d.departamento_id = ${departamento})
      RETURNING i.id, i.demanda_id
    ), iniciada AS (
      UPDATE demandas
         SET iniciada_em = now(), iniciada_por = ${usuario.id}
       WHERE ${feito}::boolean
         AND iniciada_em IS NULL
         AND id IN (SELECT demanda_id FROM marcado)
    )
    SELECT id FROM marcado`;
  return linhas.length > 0;
}

/**
 * O check. Só marca quem é o destino: a pessoa da demanda, ou alguém do
 * departamento do chamado. Admin vê as dos outros, mas não marca por eles.
 *
 * No SET as duas colunas leem o valor ANTIGO da linha: marcar de novo o que já
 * estava feito não troca a hora nem o autor do check.
 */
export async function marcarFeita(
  id: string,
  feita: boolean,
  usuario: UsuarioLogado,
): Promise<boolean> {
  const departamento = usuario.departamento?.id ?? null;
  const linhas = feita
    ? await sql`
        UPDATE demandas
           SET feita_em  = coalesce(feita_em, now()),
               feita_por = CASE WHEN feita_em IS NULL THEN ${usuario.id}::uuid ELSE feita_por END
         WHERE id = ${id}
           AND (responsavel_id = ${usuario.id} OR departamento_id = ${departamento})
        RETURNING id`
    : await sql`
        UPDATE demandas
           SET feita_em = NULL, feita_por = NULL
         WHERE id = ${id}
           AND (responsavel_id = ${usuario.id} OR departamento_id = ${departamento})
        RETURNING id`;
  return linhas.length > 0;
}

/**
 * O arraste para "Em andamento" (`sim`) ou de volta para a coluna do prazo
 * (`não`) — pedido dele de 2026-10-09. Nos dois casos a demanda fica a fazer:
 * vir de "Feitas" para uma dessas colunas tira o check. Marca quem marca a
 * demanda, como marcarFeita.
 *
 * Arrastar para "Em andamento" o que já estava lá não troca a hora nem quem
 * pôs (o SET lê o valor antigo).
 */
export async function marcarEmAndamento(
  id: string,
  sim: boolean,
  usuario: UsuarioLogado,
): Promise<boolean> {
  const departamento = usuario.departamento?.id ?? null;
  const linhas = await sql`
    UPDATE demandas
       SET feita_em = NULL, feita_por = NULL,
           iniciada_em  = CASE WHEN ${sim}::boolean THEN coalesce(iniciada_em, now()) ELSE NULL END,
           iniciada_por = CASE WHEN NOT ${sim}::boolean THEN NULL
                               WHEN iniciada_em IS NULL THEN ${usuario.id}::uuid
                               ELSE iniciada_por END
     WHERE id = ${id}
       AND (responsavel_id = ${usuario.id} OR departamento_id = ${departamento})
    RETURNING id`;
  return linhas.length > 0;
}

/**
 * Quem pode mexer numa demanda (editar ou excluir): SÓ QUEM CRIOU — regra dele
 * de 2026-10-07 ("a única pessoa que pode editar uma demanda é quem a criou").
 * Nem Admin nem TI mexem na demanda de outra pessoa: o chamado que alguém abriu
 * para o TI é de quem abriu, e o TI só dá o check. Vale a qualquer momento,
 * feita ou não — a demanda é de quem a criou.
 *
 * Recebem VÁRIOS ids porque a demanda "para todos" aparece num cartão só na
 * tela, e editar ou excluir ali vale para a de cada pessoa. A regra é conferida
 * linha a linha no WHERE: id que a pessoa não pode tocar fica de fora em
 * silêncio, e o número devolvido diz quantas mudaram.
 */
export async function atualizarDemandas(
  ids: string[],
  campos: Campos,
  usuario: UsuarioLogado,
): Promise<number> {
  const linhas = await sql`
    UPDATE demandas
       SET titulo = ${campos.titulo}, descricao = ${campos.descricao},
           prazo = ${campos.prazo}::date, prioridade = ${campos.prioridade}
     WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
       AND criado_por = ${usuario.id}
    RETURNING id`;
  return linhas.length;
}

/**
 * Muda SÓ o prazo — o arraste no calendário de Demandas (2026-10-08). Só quem
 * criou, como editar; e vale para as cópias da demanda "para todos" (a mesma
 * regra de `copiasDe`): no calendário de quem recebeu só a própria cópia está
 * à vista, e o prazo de um lote não pode ficar diferente para cada pessoa.
 */
export async function mudarPrazo(
  ids: string[],
  prazo: string | null,
  usuario: UsuarioLogado,
): Promise<number> {
  const linhas = await sql`
    UPDATE demandas s
       SET prazo = ${prazo}::date
      FROM demandas d
     WHERE d.id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
       AND d.criado_por = ${usuario.id}
       AND (s.id = d.id
            OR (d.responsavel_id IS NOT NULL AND s.responsavel_id IS NOT NULL
                AND s.criado_por IS NOT DISTINCT FROM d.criado_por
                AND s.data_criacao = d.data_criacao AND s.titulo = d.titulo))
    RETURNING s.id`;
  return linhas.length;
}

export async function apagarDemandas(
  ids: string[],
  usuario: UsuarioLogado,
): Promise<number> {
  const linhas = await sql`
    DELETE FROM demandas
     WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
       AND criado_por = ${usuario.id}
    RETURNING id`;
  return linhas.length;
}
