// Contato sob demanda: a gaveta da tela inicial, o seletor da nova oportunidade
// e o /contatos não carregam mais a base inteira. Pedido dele (2026-10-15):
// "o sistema apenas puxa quando pesquisar um nome ou número ou e-mail
// correspondente ou similar ... e não pesa". Com os ~27 mil leads do SprintHub,
// a lista inteira eram ~9 MB a cada abertura da tela inicial.
//
// Duas consultas, as duas pequenas: a BUSCA (no máximo LIMITE linhas) e os
// DADOS de um contato só, quando ele é aberto.
import { sql } from "@/lib/db";
import { LIMITE_BUSCA, prepararTermo } from "@/lib/contatos-termo";
import type { Anotacao, Contato, Historico, Oportunidade, Segmento, Tag } from "@/app/data";

// Sem acento dos dois lados, para "joao" achar "João". translate() e não a
// extensão unaccent: não depende de nada instalado no banco.
const COM_ACENTO = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucn";

// % e _ digitados são texto, não curinga do LIKE.
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type ContatoEncontrado = Contato & { tags: Tag[]; negocios: number };

/**
 * Nome (sem acento, em qualquer parte, ou PARECIDO pelo trigrama do pg_trgm),
 * e-mail ou telefone (só os dígitos, em qualquer parte do número). Quem começa
 * com o termo vem primeiro, depois o mais parecido.
 */
export async function buscarContatosNoBanco(termo: string): Promise<ContatoEncontrado[]> {
  const t = prepararTermo(termo);
  if (!t) return [];
  const parte = `%${literal(t.texto)}%`;
  const inicio = `${literal(t.texto)}%`;
  const linhas = await sql`
    WITH c AS (
      SELECT id, nome, whatsapp, email, cidade, estado, pais, ia, ia_id, data_criacao,
             translate(lower(nome), ${COM_ACENTO}, ${SEM_ACENTO}) AS nome_n
        FROM contatos
    ), achados AS (
      SELECT * FROM c
       WHERE c.nome_n LIKE ${parte}
          OR lower(c.email) LIKE ${parte}
          OR (${t.digitos} <> '' AND regexp_replace(c.whatsapp, '\\D', '', 'g') LIKE '%' || ${t.digitos} || '%')
          -- parecido: "joao silav" ainda acha "João Silva". Só a partir de 4
          -- letras, senão o trigrama casa com qualquer nome curto.
          OR (length(${t.texto}) >= 4 AND similarity(c.nome_n, ${t.texto}) > 0.35)
       ORDER BY (c.nome_n LIKE ${inicio}) DESC, similarity(c.nome_n, ${t.texto}) DESC, c.nome
       LIMIT ${LIMITE_BUSCA}
    )
    SELECT a.id, a.nome, a.whatsapp, a.email, a.cidade, a.estado, a.pais, a.ia, a.ia_id,
           to_char(a.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
           (SELECT count(*)::int FROM oportunidades o WHERE o.contato_id = a.id) AS negocios,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('id', tg.id, 'nome', tg.nome) ORDER BY tg.nome), '[]'::jsonb)
              FROM contato_tags ct JOIN tags tg ON tg.id = ct.tag_id
             WHERE ct.contato_id = a.id) AS tags
      FROM achados a`;
  return linhas as unknown as ContatoEncontrado[];
}

/** Quantos contatos a base tem: o número do botão, sem trazer nenhum. */
export async function totalDeContatos(): Promise<number> {
  const [r] = await sql`SELECT count(*)::int AS n FROM contatos`;
  return r.n as number;
}

export type DadosDoContato = {
  contato: Contato;
  segmentos: Segmento[];
  tags: Tag[];
  oportunidades: Oportunidade[];
  historico: Historico[];
  anotacoes: Anotacao[];
};

/**
 * Tudo o que a ficha de UM contato mostra. `soDoResponsavel` é o escopo
 * 'proprio' do Dashboard: as oportunidades dos colegas não saem do servidor,
 * igual ao quadro (app/funil/dados.ts).
 */
export async function dadosDoContatoNoBanco(
  id: string,
  soDoResponsavel: string | null,
): Promise<DadosDoContato | null> {
  const [[contato], segmentos, tags, oportunidades, historico, anotacoes] = await Promise.all([
    sql`
      SELECT id, nome, whatsapp, email, cidade, estado, pais, ia, ia_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
        FROM contatos WHERE id = ${id}`,
    sql`
      SELECT s.id, s.nome, to_char(s.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
        FROM contato_segmentos cs JOIN segmentos s ON s.id = cs.segmento_id
       WHERE cs.contato_id = ${id} ORDER BY s.nome`,
    sql`
      SELECT t.id, t.nome, to_char(t.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
        FROM contato_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.contato_id = ${id} ORDER BY t.nome`,
    sql`
      SELECT id, nome, contato_id, valor::float8 AS valor, responsavel_id, status, funil_id, etapa_id, campos,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
             (CURRENT_DATE - data_criacao::date) AS dias_na_etapa
        FROM oportunidades
       WHERE contato_id = ${id}
         AND (${soDoResponsavel}::uuid IS NULL OR responsavel_id = ${soDoResponsavel}::uuid)
       ORDER BY data_criacao DESC`,
    sql`
      SELECT id, contato_id, oportunidade_id, descricao, autor_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
        FROM historico WHERE contato_id = ${id}
       ORDER BY data_criacao DESC LIMIT 300`,
    sql`
      SELECT id, contato_id, texto, autor_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
             to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_atualizacao
        FROM anotacoes WHERE contato_id = ${id}
       ORDER BY data_criacao DESC`,
  ]);
  if (!contato) return null;
  return {
    contato: contato as Contato,
    segmentos: segmentos as unknown as Segmento[],
    tags: tags as unknown as Tag[],
    oportunidades: oportunidades as unknown as Oportunidade[],
    historico: historico as unknown as Historico[],
    anotacoes: anotacoes as unknown as Anotacao[],
  };
}
