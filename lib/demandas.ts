// Demandas: o que cada pessoa tem para fazer, com o check de feito, e os
// chamados abertos para o TI. Tabela em migration-demandas.sql.
//
// QUEM VÊ O QUÊ — decidido aqui, na consulta, e não na tela:
//   · todo mundo com o módulo vê as demandas que são DELA, as do departamento
//     dela (é assim que o TI recebe os chamados) e as que ELA criou (é assim
//     que quem abriu um chamado acompanha);
//   · Admin e TI veem as de todos.
//
// QUEM CRIA PARA ONDE (podeCriarPara): todo mundo cria para si mesmo ou abre um
// chamado para o TI; Admin e TI criam também para qualquer pessoa ou para todos.
//
// "Admin e TI" é o DEPARTAMENTO, pelo slug, e não o escopo do módulo nem
// `usuarios.papel` — decisão dele de 2026-10-07 ("fixo"). Mudar quem administra
// demandas é mudar ADMINISTRAM abaixo e publicar.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import type { UsuarioLogado } from "@/lib/auth/dal";
import { PARA_O_TI, type Demanda, type Prioridade } from "@/lib/demandas-tipos";

const ADMINISTRAM = new Set(["admin", "ti"]);

/** O departamento que recebe os chamados do botão "Abrir chamado". */
const SLUG_DO_TI = "ti";

/** As feitas somem da tela depois disso; a linha continua no banco. */
const DIAS_DE_FEITAS = 90;

export function administraDemandas(usuario: UsuarioLogado): boolean {
  return ADMINISTRAM.has(usuario.departamento?.slug ?? "");
}

/**
 * Para onde esta pessoa pode mandar uma demanda nova (pedido dele de
 * 2026-10-07): para si mesma e para o TI, qualquer um; para outra pessoa ou
 * para todos, só Admin e TI.
 *
 * É a regra de verdade, conferida no servidor: a tela só oferece as opções que
 * esta função aceitaria, mas quem posta direto na ação passa por aqui do mesmo
 * jeito.
 */
export function podeCriarPara(usuario: UsuarioLogado, para: string): boolean {
  if (para === PARA_O_TI || para === usuario.id) return true;
  return administraDemandas(usuario);
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
    feitaEm: iso(l.feita_em),
    feitaPor: (l.feita_por as string | null) ?? null,
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
           d.data_criacao, d.feita_em,
           f.nome                     AS feita_por
      FROM demandas d
      LEFT JOIN usuarios r        ON r.id = d.responsavel_id
      LEFT JOIN departamentos dep ON dep.id = d.departamento_id
      LEFT JOIN usuarios a        ON a.id = d.criado_por
      LEFT JOIN usuarios f        ON f.id = d.feita_por
     WHERE (d.feita_em IS NULL
            OR d.feita_em > now() - make_interval(days => ${DIAS_DE_FEITAS}))
       AND (${todas}::boolean
            OR d.responsavel_id  = ${usuario.id}
            OR d.departamento_id = ${departamento}
            OR d.criado_por      = ${usuario.id})
     ORDER BY d.data_criacao DESC`;
  return linhas.map(paraDemanda);
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
 * Devolve quantas nasceram — zero quer dizer que a pessoa escolhida não pode
 * recebê-la (ver pessoasParaDemanda, que é o mesmo filtro).
 */
export async function inserirDemandas(
  campos: Campos,
  para: string,
  criadoPor: string,
): Promise<number> {
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
  return linhas.length;
}

/** O chamado: uma demanda do departamento TI. false = o TI não existe no banco. */
export async function inserirChamado(campos: Campos, criadoPor: string): Promise<boolean> {
  const linhas = await sql`
    INSERT INTO demandas (titulo, descricao, prazo, prioridade, departamento_id, criado_por)
    SELECT ${campos.titulo}, ${campos.descricao}, ${campos.prazo}::date,
           ${campos.prioridade}, d.id, ${criadoPor}
      FROM departamentos d
     WHERE d.slug = ${SLUG_DO_TI}
    RETURNING id`;
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
 * Quem pode mexer numa demanda (editar ou excluir): Admin e TI em qualquer uma;
 * quem criou, na sua, enquanto ninguém deu o check (é o "desisti do chamado").
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
  admin: boolean,
): Promise<number> {
  const linhas = await sql`
    UPDATE demandas
       SET titulo = ${campos.titulo}, descricao = ${campos.descricao},
           prazo = ${campos.prazo}::date, prioridade = ${campos.prioridade}
     WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
       AND (${admin}::boolean OR (criado_por = ${usuario.id} AND feita_em IS NULL))
    RETURNING id`;
  return linhas.length;
}

export async function apagarDemandas(
  ids: string[],
  usuario: UsuarioLogado,
  admin: boolean,
): Promise<number> {
  const linhas = await sql`
    DELETE FROM demandas
     WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
       AND (${admin}::boolean OR (criado_por = ${usuario.id} AND feita_em IS NULL))
    RETURNING id`;
  return linhas.length;
}
