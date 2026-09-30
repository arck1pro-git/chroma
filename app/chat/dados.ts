// Leitura do chat direto do Neon. Só é importado por page.tsx (server
// component), que passa o resultado como props para o Chat.
//
// O QUE MUDOU: antes isto trazia TODAS as mensagens de TODAS as conversas a
// cada visita — a lista inteira do CRM viajando para o navegador para mostrar
// uma conversa só. Agora a tela é guiada pela URL (?canal=&atendimento=):
//   · a LISTA vem resumida (contato, última mensagem, não lidas, janela), só do
//     canal escolhido;
//   · as MENSAGENS vêm só da conversa aberta.
//
// Timestamps saem já em ISO "…Z" (to_char em UTC): o formato do Postgres
// ("2026-07-15 09:40:00+00", com espaço) nem sempre parseia no navegador.
import { sql } from "@/lib/db";
import { documentosEscolhiveis } from "@/lib/documentos";
import { fim8, listarCanais } from "@/lib/canais";
import { tomDaEtapa } from "@/lib/cores-funil";
import type { Contato, Etapa, Funil, Oportunidade, Usuario } from "../data";
import type {
  CanalChat,
  ConversaAberta,
  ConversaResumo,
  DadosChat,
  MensagemChat,
} from "./tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Quantas conversas a lista traz. A busca da tela filtra em cima disto; canal
// com mais conversas que isso mostra as mais recentes.
const LIMITE_LISTA = 500;
// Quantas mensagens da conversa aberta — as mais recentes.
const LIMITE_MENSAGENS = 400;

type LinhaConversa = Omit<ConversaResumo, "ultima"> & {
  u_texto: string | null;
  u_tipo: string | null;
  u_origem: "contato" | "agente" | null;
  u_status: string | null;
  u_enviada_por: string | null;
  u_data: string | null;
};

// `filtro` é um fragmento SQL: canal (últimos 8 dígitos do número) ou uma
// conversa específica pelo id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function consultarConversas(filtro: any, limite: number): Promise<ConversaResumo[]> {
  const linhas = (await sql`
    SELECT a.id, a.contato_id, a.responsavel_id, a.status, a.canal, a.numero_instancia,
           to_char(a.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
           c.nome AS contato_nome, c.whatsapp AS contato_whatsapp,
           u.texto AS u_texto, u.tipo AS u_tipo, u.origem AS u_origem, u.status AS u_status,
           u.enviada_por AS u_enviada_por,
           to_char(u.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS u_data,
           -- não lidas é derivado: mensagens do contato mais novas que lido_em.
           (SELECT count(*)::int FROM mensagens m
             WHERE m.atendimento_id = a.id AND m.origem = 'contato'
               AND (a.lido_em IS NULL OR m.data_criacao > a.lido_em)) AS nao_lidas,
           -- Janela de 24h da API oficial: a última mensagem DO CONTATO + 24h.
           to_char(((SELECT max(m.data_criacao) FROM mensagens m
                      WHERE m.atendimento_id = a.id AND m.origem = 'contato')
                    + interval '24 hours') AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS janela_ate
    FROM atendimentos a
    JOIN contatos c ON c.id = a.contato_id
    LEFT JOIN LATERAL (
      SELECT texto, tipo, origem, status, enviada_por, data_criacao
      FROM mensagens m
      WHERE m.atendimento_id = a.id
      ORDER BY m.data_criacao DESC
      LIMIT 1
    ) u ON true
    WHERE ${filtro}
    ORDER BY coalesce(u.data_criacao, a.data_atualizacao, a.data_criacao) DESC
    LIMIT ${limite}`) as unknown as LinhaConversa[];

  return linhas.map(({ u_texto, u_tipo, u_origem, u_status, u_enviada_por, u_data, ...a }) => ({
    ...a,
    ultima: u_data
      ? {
          texto: u_texto ?? "",
          tipo: (u_tipo ?? "texto") as MensagemChat["tipo"],
          origem: u_origem ?? "contato",
          status: (u_status ?? "recebido") as MensagemChat["status"],
          enviada_por: (u_enviada_por ?? null) as MensagemChat["enviada_por"],
          data: u_data,
        }
      : null,
  }));
}

async function carregarAberta(id: string): Promise<ConversaAberta | null> {
  const [resumo] = await consultarConversas(sql`a.id = ${id}`, 1);
  if (!resumo) return null;

  const [contatos, mensagens, oportunidades, outras] = await Promise.all([
    sql`
      SELECT id, nome, whatsapp, email, cidade, estado, pais,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
             ia AS ia_valor, ia_id AS ia_ia_id,
             (SELECT string_agg(DISTINCT e.nome, ', ')
                FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id
               WHERE o.contato_id = contatos.id AND o.status = 'aberta' AND e.ia_id IS NOT NULL) AS ia_etapas,
             -- A IA dessas etapas: a da oportunidade mais nova, mesma preferência
             -- de lib/ia/atendente.ts (sem o desempate pela anexada à conversa).
             (SELECT i.nome
                FROM oportunidades o JOIN etapas e ON e.id = o.etapa_id JOIN ias i ON i.id = e.ia_id
               WHERE o.contato_id = contatos.id AND o.status = 'aberta'
               ORDER BY o.data_criacao DESC LIMIT 1) AS ia_da_etapa
      FROM contatos WHERE id = ${resumo.contato_id}`,
    sql`
      SELECT id, atendimento_id, origem, autor_id, texto, status, erro, enviada_por, id_externo,
             tipo, midia_estado, midia_mime, midia_nome, midia_tamanho::float8 AS midia_tamanho,
             midia_duracao, midia_erro, documento_id,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM mensagens
      WHERE atendimento_id = ${id}
      ORDER BY data_criacao DESC
      LIMIT ${LIMITE_MENSAGENS}`,
    sql`
      SELECT id, nome, contato_id, valor::float8 AS valor, responsavel_id, status, funil_id, etapa_id
      FROM oportunidades
      WHERE contato_id = ${resumo.contato_id}
      ORDER BY data_criacao DESC`,
    sql`
      SELECT id, numero_instancia, canal, status FROM atendimentos
      WHERE contato_id = ${resumo.contato_id} AND id <> ${id}`,
  ]);

  return {
    id,
    resumo,
    contato: contatos[0] as unknown as Contato,
    ia: {
      valor: (contatos[0]?.ia_valor as boolean | null) ?? null,
      iaId: (contatos[0]?.ia_ia_id as string | null) ?? null,
      etapas: (contatos[0]?.ia_etapas as string | null) ?? null,
      iaDaEtapa: (contatos[0]?.ia_da_etapa as string | null) ?? null,
    },
    // Vieram do mais novo para o mais antigo (para o LIMIT pegar as recentes);
    // a conversa se lê de cima para baixo.
    mensagens: (mensagens as unknown as MensagemChat[]).reverse(),
    oportunidades: oportunidades as unknown as Oportunidade[],
    outras: outras as unknown as ConversaAberta["outras"],
  };
}

export async function carregarChat({
  canal,
  atendimentoId,
}: {
  /** Dígitos do número do canal; "" = todos. */
  canal: string;
  atendimentoId: string | null;
}): Promise<DadosChat> {
  const alvo = canal ? fim8(canal) : null;
  const idAberta = atendimentoId && UUID.test(atendimentoId) ? atendimentoId : null;

  const [canais, contagens, conversas, aberta, usuarios, funis, etapas, documentos, ias] =
    await Promise.all([
      listarCanais(),
      // Por canal: quantas conversas na fila e quantas com algo não lido.
      sql`
        SELECT right(regexp_replace(coalesce(a.numero_instancia, ''), '[^0-9]', '', 'g'), 8) AS fim8,
               count(*) FILTER (WHERE a.status = 'na_fila')::int AS fila,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM mensagens m
                  WHERE m.atendimento_id = a.id AND m.origem = 'contato'
                    AND (a.lido_em IS NULL OR m.data_criacao > a.lido_em)))::int AS nao_lidas
        FROM atendimentos a
        WHERE a.status <> 'encerrado'
        GROUP BY 1`,
      consultarConversas(
        alvo
          ? sql`right(regexp_replace(coalesce(a.numero_instancia, ''), '[^0-9]', '', 'g'), 8) = ${alvo}`
          : sql`true`,
        LIMITE_LISTA,
      ),
      idAberta ? carregarAberta(idAberta) : Promise.resolve(null),
      sql`SELECT id, nome, iniciais FROM usuarios ORDER BY nome`,
      sql`SELECT id, nome, cor FROM funis ORDER BY data_criacao`,
      sql`SELECT id, nome, funil_id, ordem FROM etapas ORDER BY funil_id, ordem`,
      // A biblioteca pode não existir ainda (migration-documentos.sql): sem ela
      // o botão de anexar some e nada mais muda.
      documentosEscolhiveis().catch(() => []),
      sql`SELECT id, nome FROM ias ORDER BY data_criacao`,
    ]);

  const porCanal = new Map(
    (contagens as unknown as Array<{ fim8: string; fila: number; nao_lidas: number }>).map((c) => [
      c.fim8,
      c,
    ]),
  );

  // A cor da etapa é derivada da cor do funil e da posição (lib/cores-funil.ts),
  // igual ao quadro — `etapas.cor` não é mais lida.
  const corDoFunil = new Map((funis as unknown as Funil[]).map((f) => [f.id, f.cor]));
  const etapasT = etapas as unknown as Etapa[];
  const totalPorFunil = new Map<string, number>();
  for (const e of etapasT) totalPorFunil.set(e.funil_id, (totalPorFunil.get(e.funil_id) ?? 0) + 1);
  const indice = new Map<string, number>();
  const etapasComCor = etapasT.map((e) => {
    const i = indice.get(e.funil_id) ?? 0;
    indice.set(e.funil_id, i + 1);
    return { ...e, cor: tomDaEtapa(corDoFunil.get(e.funil_id) ?? "", i, totalPorFunil.get(e.funil_id) ?? 1) };
  });

  return {
    canais: canais.map(
      (c): CanalChat => ({
        chave: c.chave,
        tipo: c.tipo,
        nome: c.nome,
        perfil: c.perfil,
        numero: c.numero,
        foto: c.foto,
        estado: c.estado,
        naoLidas: porCanal.get(fim8(c.chave))?.nao_lidas ?? 0,
        naFila: porCanal.get(fim8(c.chave))?.fila ?? 0,
      }),
    ),
    canal: canal ?? "",
    conversas,
    aberta,
    usuarios: usuarios as unknown as Usuario[],
    funis: funis as unknown as Funil[],
    etapas: etapasComCor,
    documentos,
    ias: ias as unknown as DadosChat["ias"],
    demo: false,
  };
}
