// Leitura de Contatos direto do Neon. Só é importado por page.tsx (server).
// Espelha os índices/mapas que o data.ts montava na memória — aqui viram SELECTs
// + agrupamento. Timestamps em ISO "…Z" (dataCurta fatia, dataHora faz new Date).
import { sql } from "@/lib/db";
import type {
  Anotacao,
  Contato,
  Historico,
  Oportunidade,
  Segmento,
  Tag,
  Usuario,
  Etapa,
  Funil,
} from "../data";

export type DadosContatos = {
  contatos: Contato[];
  segmentos: Segmento[]; // todos, para o menu de filtro
  tags: Tag[]; // todas, para o menu de filtro
  segmentosDoContato: Map<string, Segmento[]>;
  tagsDoContato: Map<string, Tag[]>;
  oportunidadesDoContato: Map<string, Oportunidade[]>;
  historicoDoContato: Map<string, Historico[]>;
  anotacoesDoContato: Map<string, Anotacao[]>;
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
};

// Agrupa linhas por contato_id preservando a ordem que a query já trouxe.
function agrupar<T extends { contato_id: string }>(linhas: T[]) {
  const mapa = new Map<string, T[]>();
  for (const l of linhas) {
    const atual = mapa.get(l.contato_id) ?? [];
    atual.push(l);
    mapa.set(l.contato_id, atual);
  }
  return mapa;
}

export async function carregarContatos(): Promise<DadosContatos> {
  const [
    contatos,
    segmentos,
    tags,
    segContato,
    tagContato,
    oportunidades,
    historico,
    anotacoes,
    etapas,
    funis,
    usuarios,
  ] = await Promise.all([
    sql`
      SELECT id, nome, whatsapp, email, cidade, estado, pais,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM contatos ORDER BY nome`,
    sql`SELECT id, nome FROM segmentos ORDER BY nome`,
    sql`SELECT id, nome FROM tags ORDER BY nome`,
    sql`
      SELECT cs.contato_id, s.id, s.nome
      FROM contato_segmentos cs JOIN segmentos s ON s.id = cs.segmento_id`,
    sql`
      SELECT ct.contato_id, t.id, t.nome
      FROM contato_tags ct JOIN tags t ON t.id = ct.tag_id`,
    sql`
      SELECT id, nome, contato_id, valor::float8 AS valor, responsavel_id, status, funil_id, etapa_id
      FROM oportunidades ORDER BY data_criacao DESC`,
    sql`
      SELECT id, contato_id, oportunidade_id, descricao, autor_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM historico ORDER BY data_criacao DESC`,
    sql`
      SELECT id, contato_id, texto, autor_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
             to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_atualizacao
      FROM anotacoes ORDER BY data_criacao DESC`,
    sql`SELECT id, nome, cor FROM etapas`,
    sql`SELECT id, nome FROM funis`,
    sql`SELECT id, nome, iniciais FROM usuarios`,
  ]);

  return {
    contatos: contatos as Contato[],
    segmentos: segmentos as Segmento[],
    tags: tags as Tag[],
    segmentosDoContato: agrupar(
      segContato as unknown as (Segmento & { contato_id: string })[],
    ),
    tagsDoContato: agrupar(
      tagContato as unknown as (Tag & { contato_id: string })[],
    ),
    oportunidadesDoContato: agrupar(oportunidades as unknown as Oportunidade[]),
    historicoDoContato: agrupar(historico as unknown as Historico[]),
    anotacoesDoContato: agrupar(anotacoes as unknown as Anotacao[]),
    etapaPorId: new Map((etapas as Etapa[]).map((e) => [e.id, e])),
    funilPorId: new Map((funis as Funil[]).map((f) => [f.id, f])),
    usuarioPorId: new Map((usuarios as Usuario[]).map((u) => [u.id, u])),
  };
}
