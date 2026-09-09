// Leitura do Funil direto do Neon. Só é importado por page.tsx (server).
// Como a ficha da oportunidade também mostra os dados do cliente, aqui carrega
// praticamente tudo — funis/etapas/oportunidades + os agregados por contato.
import { sql } from "@/lib/db";
import { tomDaEtapa } from "@/lib/cores-funil";
import type {
  Anotacao,
  Atendimento,
  CampoPersonalizado,
  Contato,
  Etapa,
  Funil,
  Historico,
  Oportunidade,
  Segmento,
  Tag,
  Usuario,
} from "../data";

export type DadosFunil = {
  funis: Funil[];
  etapas: Etapa[]; // já ordenadas por (funil_id, ordem)
  oportunidades: Oportunidade[];
  contatos: Contato[];
  usuarios: Usuario[];
  segmentos: Segmento[];
  tags: Tag[];
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  segmentosDoContato: Map<string, Segmento[]>;
  tagsDoContato: Map<string, Tag[]>;
  oportunidadesDoContato: Map<string, Oportunidade[]>;
  historicoDoContato: Map<string, Historico[]>;
  anotacoesDoContato: Map<string, Anotacao[]>;
  // Pra ficha da oportunidade listar canal/número e o botão "anexar" — ver
  // migration-atendimento-oportunidade.sql.
  atendimentosDoContato: Map<string, Atendimento[]>;
  // DEFINIÇÕES dos campos personalizados. Os valores da oportunidade vêm
  // junto (são 173 linhas); os do contato NÃO — com 17,8 mil contatos isso
  // engordaria demais uma tela que já carrega tudo. A ficha busca sob demanda
  // (camposDoContato, em ./actions.ts).
  camposContato: CampoPersonalizado[];
  camposOportunidade: CampoPersonalizado[];
};

function agrupar<T extends { contato_id: string }>(linhas: T[]) {
  const mapa = new Map<string, T[]>();
  for (const l of linhas) {
    const atual = mapa.get(l.contato_id) ?? [];
    atual.push(l);
    mapa.set(l.contato_id, atual);
  }
  return mapa;
}

export async function carregarFunil(): Promise<DadosFunil> {
  const [
    funis,
    etapas,
    oportunidades,
    contatos,
    usuarios,
    segmentos,
    tags,
    segContato,
    tagContato,
    historico,
    anotacoes,
    atendimentos,
    definicoesCampos,
  ] = await Promise.all([
    sql`SELECT id, nome, descricao, cor FROM funis ORDER BY data_criacao`,
    // Sem `cor`: ela é derivada abaixo, a partir da cor do FUNIL e da posição
    // da etapa. Ver lib/cores-funil.ts.
    sql`SELECT id, nome, funil_id, ordem FROM etapas ORDER BY funil_id, ordem`,
    // dias_na_etapa é aproximado por now()-data_criacao (não há registro de quando
    // entrou na etapa). Ver comentário no migration-front.sql.
    sql`
      SELECT id, nome, contato_id, valor::float8 AS valor, responsavel_id, status, funil_id, etapa_id, campos,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
             (CURRENT_DATE - data_criacao::date) AS dias_na_etapa
      FROM oportunidades ORDER BY data_criacao DESC`,
    sql`
      SELECT id, nome, whatsapp, email, cidade, estado, pais,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM contatos ORDER BY nome`,
    sql`SELECT id, nome, iniciais FROM usuarios`,
    sql`SELECT id, nome FROM segmentos ORDER BY nome`,
    sql`SELECT id, nome FROM tags ORDER BY nome`,
    sql`SELECT cs.contato_id, s.id, s.nome FROM contato_segmentos cs JOIN segmentos s ON s.id = cs.segmento_id`,
    sql`SELECT ct.contato_id, t.id, t.nome FROM contato_tags ct JOIN tags t ON t.id = ct.tag_id`,
    sql`
      SELECT id, contato_id, oportunidade_id, descricao, autor_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM historico ORDER BY data_criacao DESC`,
    sql`
      SELECT id, contato_id, texto, autor_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
             to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_atualizacao
      FROM anotacoes ORDER BY data_criacao DESC`,
    // Pra ficha da oportunidade listar canal/número; nao_lidas não entra aqui
    // (é o /chat que precisa dela, ver app/chat/dados.ts).
    sql`
      SELECT id, contato_id, responsavel_id, status, canal, numero_instancia, oportunidade_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM atendimentos ORDER BY data_criacao DESC`,
    sql`
      SELECT id, entidade, chave, rotulo, tipo, ordem,
             COALESCE(to_jsonb(opcoes), '[]'::jsonb) AS opcoes
      FROM campos_personalizados ORDER BY entidade, ordem, rotulo`,
  ]);

  const defs = definicoesCampos as unknown as CampoPersonalizado[];

  const contatosT = contatos as Contato[];
  const oportunidadesT = oportunidades as unknown as Oportunidade[];

  // ── A cor de cada etapa ───────────────────────────────────────────────────
  // Derivada aqui, uma vez, e não em cada componente: o cálculo precisa do
  // TOTAL de etapas do funil (é ele que define onde cai o tom mais escuro), e
  // esse total só existe depois de agrupar. Fazer isso na tela obrigaria toda
  // tela que desenha uma etapa a refazer o agrupamento.
  const funisT = funis as Funil[];
  const corPorFunil = new Map(funisT.map((f) => [f.id, f.cor]));
  const totalPorFunil = new Map<string, number>();
  for (const e of etapas) {
    totalPorFunil.set(e.funil_id, (totalPorFunil.get(e.funil_id) ?? 0) + 1);
  }
  // As etapas já vêm ORDER BY funil_id, ordem — o índice dentro do funil é a
  // posição, e é isso que tomDaEtapa espera.
  const posicao = new Map<string, number>();
  const etapasT = (etapas as Etapa[]).map((e) => {
    const i = posicao.get(e.funil_id) ?? 0;
    posicao.set(e.funil_id, i + 1);
    return {
      ...e,
      cor: tomDaEtapa(
        corPorFunil.get(e.funil_id) ?? "",
        i,
        totalPorFunil.get(e.funil_id) ?? 1,
      ),
    };
  });

  return {
    funis: funisT,
    etapas: etapasT,
    oportunidades: oportunidadesT,
    contatos: contatosT,
    usuarios: usuarios as Usuario[],
    segmentos: segmentos as Segmento[],
    tags: tags as Tag[],
    contatoPorId: new Map(contatosT.map((c) => [c.id, c])),
    usuarioPorId: new Map((usuarios as Usuario[]).map((u) => [u.id, u])),
    etapaPorId: new Map(etapasT.map((e) => [e.id, e])),
    funilPorId: new Map((funis as Funil[]).map((f) => [f.id, f])),
    segmentosDoContato: agrupar(
      segContato as unknown as (Segmento & { contato_id: string })[],
    ),
    tagsDoContato: agrupar(
      tagContato as unknown as (Tag & { contato_id: string })[],
    ),
    oportunidadesDoContato: agrupar(oportunidadesT),
    historicoDoContato: agrupar(historico as unknown as Historico[]),
    anotacoesDoContato: agrupar(anotacoes as unknown as Anotacao[]),
    atendimentosDoContato: agrupar(atendimentos as unknown as Atendimento[]),
    camposContato: defs.filter((d) => d.entidade === "contato"),
    camposOportunidade: defs.filter((d) => d.entidade === "oportunidade"),
  };
}
