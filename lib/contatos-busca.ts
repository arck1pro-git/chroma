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
import type { Anotacao, Contato, Historico, Oportunidade, Segmento, Tag } from "@/lib/entidades";

// % e _ digitados são texto, não curinga do LIKE.
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type ContatoEncontrado = Contato & { tags: Tag[]; negocios: number };

/**
 * Nome (sem acento, em qualquer parte, ou PARECIDO pelo trigrama do pg_trgm),
 * e-mail ou telefone (só os dígitos, em qualquer parte do número). Quem começa
 * com o termo vem primeiro, depois o mais parecido.
 *
 * CADA RAMO TEM ÍNDICE (migration-indice-contato-busca.sql e
 * migration-indice-contato-whatsapp.sql), e é por isso que a consulta tem esta
 * forma:
 *  · o nome sem acento é escrito POR EXTENSO, com o texto fixo no SQL — o
 *    Postgres só usa índice de expressão quando a consulta repete a expressão
 *    igual, e um ${parâmetro} no translate() viraria $1 e não casaria;
 *  · o "parecido" usa o operador % (limiar padrão 0,3), que o índice atende;
 *    a função similarity() sozinha obrigava a varrer a tabela;
 *  · telefone e parecido só entram quando o termo pede — um ramo que sempre
 *    está lá e às vezes é falso ainda faz o plano desistir do índice.
 */
export async function buscarContatosNoBanco(termo: string): Promise<ContatoEncontrado[]> {
  const t = prepararTermo(termo);
  if (!t) return [];
  const parte = `%${literal(t.texto)}%`;
  const inicio = `${literal(t.texto)}%`;
  const linhas = await sql`
    WITH achados AS (
      SELECT id, nome, whatsapp, email, cidade, estado, pais, ia, ia_id, data_criacao,
             translate(lower(nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') AS nome_n
        FROM contatos
       WHERE translate(lower(nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') LIKE ${parte}
          OR lower(email) LIKE ${parte}
          ${t.digitos ? sql`OR regexp_replace(whatsapp, '\\D', '', 'g') LIKE ${`%${t.digitos}%`}` : sql``}
          ${
            // parecido: "jose menesal" ainda acha "José Menescal". Só a partir
            // de 4 letras, senão o trigrama casa com qualquer nome curto.
            t.texto.length >= 4
              ? sql`OR translate(lower(nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') % ${t.texto}`
              : sql``
          }
       ORDER BY (translate(lower(nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') LIKE ${inicio}) DESC,
                similarity(translate(lower(nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), ${t.texto}) DESC,
                nome
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
 * igual ao quadro (lib/funil.ts).
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
