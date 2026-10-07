// Os dados do módulo Contatos (app/contatos): a lista da esquerda e a ficha
// completa de um contato.
//
// A FICHA JUNTA O QUE ESTÁ ESPALHADO. Onze tabelas apontam para um contato
// (oportunidades, atendimentos, reuniões, vídeos, automações, captações…), e
// cada tela do CRM mostra a sua fatia. Aqui elas se encontram, numa leitura só
// — tudo em paralelo, uma consulta por assunto.
//
// ORIGEM: o lead traz a origem nos `campos` (UTMs e ids da Meta, gravados pela
// captação e pelo carimbo de campanha — lib/campanha-do-lead.ts) e no próprio
// rastro: por qual captação entrou, ou se chegou mandando mensagem. Os campos
// personalizados moram no MESMO jsonb; o que não é campo personalizado
// declarado é tratado como parâmetro de origem.
import "server-only";
import { sql } from "@/lib/db";
import { tomDaEtapa } from "@/lib/cores-funil";
import { unirTrechos } from "@/lib/videos";

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Etapa com nome, funil e o tom da posição dela (a mesma regra do quadro). */
export type EtapaComTom = { id: string; nome: string; funil: string; funilId: string; cor: string; ordem: number };

export async function etapasComTom(): Promise<Map<string, EtapaComTom>> {
  const [funis, etapas] = await Promise.all([
    sql`SELECT id, nome, cor FROM funis`,
    sql`SELECT id, nome, funil_id, ordem FROM etapas ORDER BY funil_id, ordem`,
  ]);
  const funilPorId = new Map(funis.map((f) => [f.id as string, f]));
  const mapa = new Map<string, EtapaComTom>();
  for (const f of funis) {
    const doFunil = etapas.filter((e) => e.funil_id === f.id);
    doFunil.forEach((e, i) =>
      mapa.set(e.id as string, {
        id: e.id as string,
        nome: e.nome as string,
        funil: (funilPorId.get(e.funil_id)?.nome as string) ?? "",
        funilId: e.funil_id as string,
        cor: tomDaEtapa(f.cor as string, i, doFunil.length),
        ordem: Number(e.ordem),
      }),
    );
  }
  return mapa;
}

// ── A lista ─────────────────────────────────────────────────────────────────

export type ContatoNaLista = {
  id: string;
  nome: string;
  whatsapp: string;
  email: string;
  cidade: string;
  estado: string;
  dataCriacao: string;
  /** A conversa, o histórico ou a criação — o que for mais recente. */
  ultimaAtividade: string;
  /** A oportunidade aberta mais nova: é a etapa que a lista mostra. */
  etapaId: string | null;
  abertas: number;
  valorAberto: number;
  conversou: boolean;
  viuVideo: boolean;
  /** Rótulo curto de onde veio: campanha, captação ou nada. */
  origem: string | null;
  tagIds: string[];
};

export async function listarContatos(): Promise<ContatoNaLista[]> {
  const linhas = await sql`
    SELECT c.id, c.nome, c.whatsapp, c.email, c.cidade, c.estado, c.data_criacao,
           op.etapa_id, coalesce(op.abertas, 0) AS abertas, coalesce(op.valor_aberto, 0) AS valor_aberto,
           at.ultima AS ultima_conversa,
           (SELECT max(h.data_criacao) FROM historico h WHERE h.contato_id = c.id) AS ultimo_historico,
           EXISTS (SELECT 1 FROM video_visualizacoes vv WHERE vv.contato_id = c.id) AS viu_video,
           coalesce(nullif(c.campos ->> 'utm_campaign', ''), nullif(c.campos ->> 'campaign_name', ''),
                    (SELECT w.nome FROM webhook_recebimentos r JOIN webhooks w ON w.id = r.webhook_id
                      WHERE r.contato_id = c.id ORDER BY r.data_criacao LIMIT 1)) AS origem,
           (SELECT coalesce(array_agg(ct.tag_id::text), '{}') FROM contato_tags ct WHERE ct.contato_id = c.id) AS tag_ids
      FROM contatos c
      LEFT JOIN LATERAL (
        SELECT (array_agg(o.etapa_id ORDER BY o.data_criacao DESC))[1] AS etapa_id,
               count(*)::int AS abertas, sum(o.valor)::float8 AS valor_aberto
          FROM oportunidades o WHERE o.contato_id = c.id AND o.status = 'aberta'
      ) op ON true
      LEFT JOIN LATERAL (
        SELECT max(coalesce(a.data_atualizacao, a.data_criacao)) AS ultima
          FROM atendimentos a WHERE a.contato_id = c.id
      ) at ON true
     ORDER BY c.data_criacao DESC`;

  return linhas.map((l) => {
    const datas = [l.data_criacao, l.ultima_conversa, l.ultimo_historico].filter(Boolean).map((d) => new Date(d as string).getTime());
    return {
      id: l.id as string,
      nome: (l.nome as string) ?? "",
      whatsapp: (l.whatsapp as string) ?? "",
      email: (l.email as string) ?? "",
      cidade: (l.cidade as string) ?? "",
      estado: (l.estado as string) ?? "",
      dataCriacao: iso(l.data_criacao)!,
      ultimaAtividade: new Date(Math.max(...datas)).toISOString(),
      etapaId: (l.etapa_id as string | null) ?? null,
      abertas: num(l.abertas),
      valorAberto: num(l.valor_aberto),
      conversou: Boolean(l.ultima_conversa),
      viuVideo: Boolean(l.viu_video),
      origem: (l.origem as string | null) ?? null,
      tagIds: (l.tag_ids as string[]) ?? [],
    };
  });
}

// ── A ficha ─────────────────────────────────────────────────────────────────

/** Rótulos das chaves de origem conhecidas — o resto aparece com a chave crua. */
export const ROTULO_ORIGEM: Record<string, string> = {
  utm_source: "Fonte (utm_source)",
  utm_medium: "Meio (utm_medium)",
  utm_campaign: "Campanha (utm_campaign)",
  utm_content: "Conteúdo (utm_content)",
  utm_term: "Termo (utm_term)",
  utm_id: "Id da campanha (utm_id)",
  campaign_id: "Id da campanha na Meta",
  campanha_id: "Id da campanha",
  campaign_name: "Campanha",
  adset_id: "Id do conjunto",
  conjunto_id: "Id do conjunto",
  adset_name: "Conjunto",
  ad_id: "Id do anúncio",
  anuncio_id: "Id do anúncio",
  ad_name: "Anúncio",
  fbclid: "fbclid (clique da Meta)",
  gclid: "gclid (clique do Google)",
  pixel_id: "Pixel",
  site_source_name: "Plataforma",
  placement: "Posicionamento",
};

export type Origem = {
  /** Como o contato chegou ao CRM, numa frase. */
  comoChegou: string;
  campanha: string | null;
  campanhaId: string | null;
  conjunto: string | null;
  anuncio: string | null;
  fonte: string | null;
  meio: string | null;
  /** Tudo o que veio de origem (contato e oportunidades), sem os campos personalizados. */
  parametros: { chave: string; rotulo: string; valor: string; de: string }[];
  captacoes: { id: string; webhook: string; webhookId: string; estado: string; resumo: string | null; erro: string | null; quando: string }[];
};

export type OportunidadeDaFicha = {
  id: string;
  nome: string;
  valor: number;
  status: string;
  etapaId: string;
  responsavel: string | null;
  dataCriacao: string;
  eventosMeta: { evento: string; status: string; erro: string | null; quando: string }[];
};

export type ConversaDaFicha = {
  id: string;
  canal: string;
  status: string;
  instancia: string | null;
  responsavel: string | null;
  mensagens: number;
  recebidas: number;
  pelaIa: number;
  pelaEquipe: number;
  ultima: { texto: string; tipo: string; deQuem: "contato" | "agente"; quando: string } | null;
  primeiraEm: string | null;
  dataCriacao: string;
};

export type VideoDaFicha = {
  id: string;
  nome: string;
  duracao: number | null;
  aberturas: number;
  /** Segundos diferentes vistos, somando as aberturas (como na tela de Vídeos). */
  cobertura: number;
  naPagina: number;
  primeira: string;
  ultima: string;
};

/** Uma mensagem como o trecho de chat da ficha a desenha. */
export type MensagemDaFicha = {
  id: string;
  deQuem: "contato" | "agente";
  /** Quem do nosso lado: 'ia', 'automacao', 'crm' (alguém pela tela), 'aparelho' (pelo celular). */
  por: string | null;
  autor: string | null;
  texto: string;
  tipo: string;
  status: string;
  quando: string;
};

function paraMensagem(m: Record<string, unknown>): MensagemDaFicha {
  return {
    id: m.id as string,
    deQuem: m.origem === "contato" ? "contato" : "agente",
    por: (m.enviada_por as string | null) ?? null,
    autor: (m.autor as string | null) ?? null,
    texto: (m.texto as string) ?? "",
    tipo: (m.tipo as string) ?? "texto",
    status: (m.status as string) ?? "",
    quando: new Date(m.data_criacao as string).toISOString(),
  };
}

export type FichaContato = {
  contato: {
    id: string;
    nome: string;
    whatsapp: string;
    email: string;
    cidade: string;
    estado: string;
    pais: string;
    ia: boolean | null;
    iaId: string | null;
    dataCriacao: string;
  };
  origem: Origem;
  oportunidades: OportunidadeDaFicha[];
  conversas: ConversaDaFicha[];
  reunioes: { id: string; inicio: string; fim: string; pelaIa: boolean; autor: string | null; oportunidade: string | null; marcadaEm: string }[];
  videos: VideoDaFicha[];
  automacoes: { id: string; fluxo: string; fluxoId: string; etapa: string | null; estado: string; origem: string; sobre: string; iniciadoEm: string; finalizadoEm: string | null; erro: string | null }[];
  campanhas: { campanha: string; estado: string; enviadoEm: string | null; respondeuEm: string | null; conversao: boolean | null; erro: string | null; quando: string }[];
  tags: { id: string; nome: string }[];
  segmentos: { id: string; nome: string }[];
  historico: { id: string; descricao: string; autor: string | null; oportunidadeId: string | null; quando: string }[];
  /**
   * As mensagens resumidas por conversa e por DIA — é o que o feed da ficha
   * mostra. Uma linha por mensagem afogaria o resto do que aconteceu; por dia,
   * a conversa vira um acontecimento ("trocou 12 mensagens") com a última
   * coisa que ELE disse, que é o que quem atende quer ler.
   */
  dias: {
    atendimentoId: string;
    canal: string;
    dia: string;
    total: number;
    dele: number;
    ia: number;
    equipe: number;
    ultimaEm: string;
    ultimoDele: string | null;
    ultimoNosso: string | null;
    /**
     * Todas as mensagens do dia, em ordem — o feed mostra o dia inteiro como
     * chat, de uma vez (pedido de 2026-10-06). O teto de 2000 por contato
     * (as mais recentes) só existe para uma conversa de anos não travar a
     * ficha; se cortar um dia, o feed avisa e aponta o Chat.
     */
    mensagens: MensagemDaFicha[];
  }[];
  anotacoes: { id: string; contato_id: string; texto: string; autor_id: string; data_criacao: string; data_atualizacao: string | null }[];
};

const textoDe = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).trim();
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A ficha inteira de um contato, ou null se ele não existe. */
export async function fichaDoContato(id: string, chavesPersonalizadas: Set<string>): Promise<FichaContato | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const [
    [contato],
    oportunidades,
    eventos,
    conversas,
    reunioes,
    aberturas,
    automacoes,
    campanhas,
    captacoes,
    tags,
    segmentos,
    historico,
    anotacoes,
    dias,
    trechos,
  ] = await Promise.all([
    sql`SELECT id, nome, whatsapp, email, cidade, estado, pais, ia, ia_id, campos, data_criacao
          FROM contatos WHERE id = ${id}`,
    sql`SELECT o.id, o.nome, o.valor::float8 AS valor, o.status, o.etapa_id, o.campos, o.data_criacao, u.nome AS responsavel
          FROM oportunidades o LEFT JOIN usuarios u ON u.id = o.responsavel_id
         WHERE o.contato_id = ${id}
         ORDER BY (o.status = 'aberta') DESC, o.data_criacao DESC`,
    sql`SELECT me.oportunidade_id, me.evento, me.status, me.erro, me.data_criacao
          FROM meta_eventos me JOIN oportunidades o ON o.id = me.oportunidade_id
         WHERE o.contato_id = ${id} ORDER BY me.data_criacao DESC LIMIT 100`,
    sql`SELECT a.id, a.canal, a.status, a.numero_instancia, a.data_criacao, u.nome AS responsavel,
               coalesce(a.data_atualizacao, a.data_criacao) AS atualizado,
               count(m.id)::int AS mensagens,
               count(m.id) FILTER (WHERE m.origem = 'contato')::int AS recebidas,
               count(m.id) FILTER (WHERE m.enviada_por = 'ia')::int AS pela_ia,
               count(m.id) FILTER (WHERE m.origem = 'agente' AND coalesce(m.enviada_por, '') <> 'ia')::int AS pela_equipe,
               (array_agg(m.texto ORDER BY m.data_criacao DESC))[1] AS ultimo_texto,
               (array_agg(m.tipo ORDER BY m.data_criacao DESC))[1] AS ultimo_tipo,
               (array_agg(m.origem ORDER BY m.data_criacao DESC))[1] AS ultima_origem,
               max(m.data_criacao) AS ultima_em, min(m.data_criacao) AS primeira_em
          FROM atendimentos a
          LEFT JOIN usuarios u ON u.id = a.responsavel_id
          LEFT JOIN mensagens m ON m.atendimento_id = a.id
         WHERE a.contato_id = ${id}
         GROUP BY a.id, u.nome
         ORDER BY atualizado DESC`,
    sql`SELECT r.id, r.inicio, r.fim, r.autor_id, r.data_criacao, u.nome AS autor, o.nome AS oportunidade
          FROM agenda_reunioes r
          LEFT JOIN usuarios u ON u.id = r.autor_id
          LEFT JOIN oportunidades o ON o.id = r.oportunidade_id
         WHERE r.contato_id = ${id} ORDER BY r.inicio DESC`,
    sql`SELECT v.id, v.nome, v.duracao, vv.trechos, vv.segundos_na_pagina, vv.data_criacao, vv.data_atualizacao
          FROM video_visualizacoes vv JOIN videos v ON v.id = vv.video_id
         WHERE vv.contato_id = ${id} ORDER BY vv.data_criacao DESC`,
    sql`SELECT e.id, e.estado, e.origem, e.entidade_tipo, e.iniciado_em, e.finalizado_em, e.erro_msg,
               f.id AS fluxo_id, f.nome AS fluxo, et.nome AS etapa
          FROM fluxo_execucoes e
          JOIN fluxos f ON f.id = e.fluxo_id
          LEFT JOIN etapas et ON et.id = f.etapa_id
         WHERE (e.entidade_tipo = 'contato' AND e.entidade_id = ${id})
            OR (e.entidade_tipo = 'oportunidade'
                AND e.entidade_id IN (SELECT o.id FROM oportunidades o WHERE o.contato_id = ${id}))
         ORDER BY e.iniciado_em DESC LIMIT 50`,
    sql`SELECT c.nome AS campanha, x.estado, x.enviado_em, x.respondeu_em, x.conversao, x.erro, x.data_criacao
          FROM campanha_whatsapp_execucoes x JOIN campanhas_whatsapp c ON c.id = x.campanha_id
         WHERE x.contato_id = ${id} ORDER BY x.data_criacao DESC`,
    sql`SELECT r.id, r.estado, r.resumo, r.erro, r.payload, r.data_criacao, w.id AS webhook_id, w.nome AS webhook
          FROM webhook_recebimentos r JOIN webhooks w ON w.id = r.webhook_id
         WHERE r.contato_id = ${id} ORDER BY r.data_criacao LIMIT 20`,
    sql`SELECT t.id, t.nome FROM contato_tags ct JOIN tags t ON t.id = ct.tag_id
         WHERE ct.contato_id = ${id} ORDER BY t.nome`,
    sql`SELECT s.id, s.nome FROM contato_segmentos cs JOIN segmentos s ON s.id = cs.segmento_id
         WHERE cs.contato_id = ${id} ORDER BY s.nome`,
    sql`SELECT h.id, h.descricao, h.oportunidade_id, h.data_criacao, u.nome AS autor
          FROM historico h LEFT JOIN usuarios u ON u.id = h.autor_id
         WHERE h.contato_id = ${id} ORDER BY h.data_criacao DESC LIMIT 200`,
    sql`SELECT id, contato_id, texto, autor_id, data_criacao, data_atualizacao
          FROM anotacoes WHERE contato_id = ${id} ORDER BY data_criacao DESC`,
    sql`SELECT m.atendimento_id, a.canal,
               to_char((m.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia,
               count(*)::int AS total,
               count(*) FILTER (WHERE m.origem = 'contato')::int AS dele,
               count(*) FILTER (WHERE m.enviada_por = 'ia')::int AS ia,
               count(*) FILTER (WHERE m.origem = 'agente' AND coalesce(m.enviada_por, '') <> 'ia')::int AS equipe,
               max(m.data_criacao) AS ultima_em,
               (array_agg(m.texto ORDER BY m.data_criacao DESC)
                  FILTER (WHERE m.origem = 'contato' AND m.texto <> ''))[1] AS ultimo_dele,
               (array_agg(m.texto ORDER BY m.data_criacao DESC)
                  FILTER (WHERE m.origem = 'agente' AND m.texto <> ''))[1] AS ultimo_nosso
          FROM mensagens m JOIN atendimentos a ON a.id = m.atendimento_id
         WHERE a.contato_id = ${id}
         GROUP BY 1, 2, 3
         ORDER BY ultima_em DESC
         LIMIT 120`,
    sql`SELECT * FROM (
          SELECT m.id, m.atendimento_id, m.origem, m.enviada_por, m.texto, m.tipo, m.status, m.data_criacao,
                 u.nome AS autor,
                 to_char((m.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia
            FROM mensagens m
            JOIN atendimentos a ON a.id = m.atendimento_id
            LEFT JOIN usuarios u ON u.id = m.autor_id
           WHERE a.contato_id = ${id}
           ORDER BY m.data_criacao DESC
           LIMIT 2000
        ) x ORDER BY data_criacao`,
  ]);
  if (!contato) return null;

  // ── Origem ──
  const parametros: Origem["parametros"] = [];
  const juntar = (campos: unknown, de: string) => {
    for (const [chave, bruto] of Object.entries(objeto(campos))) {
      if (chavesPersonalizadas.has(chave)) continue;
      const valor = textoDe(bruto);
      if (!valor || parametros.some((p) => p.chave === chave && p.valor === valor)) continue;
      parametros.push({ chave, rotulo: ROTULO_ORIGEM[chave] ?? chave, valor, de });
    }
  };
  juntar(contato.campos, "contato");
  for (const o of oportunidades) juntar(o.campos, `oportunidade "${o.nome}"`);
  const valor = (...chaves: string[]) => {
    for (const c of chaves) {
      const p = parametros.find((x) => x.chave === c);
      if (p) return p.valor;
    }
    return null;
  };

  const primeiraCaptacao = captacoes[0];
  const primeiraConversa = conversas
    .map((c) => c.primeira_em)
    .filter(Boolean)
    .map((d) => new Date(d as string).getTime())
    .sort((a, b) => a - b)[0];
  const criado = new Date(contato.data_criacao as string).getTime();
  const perto = (t: number) => Math.abs(t - criado) < 10 * 60_000;
  const comoChegou =
    primeiraCaptacao && perto(new Date(primeiraCaptacao.data_criacao as string).getTime())
      ? `Entrou pela captação "${primeiraCaptacao.webhook}"`
      : primeiraConversa && perto(primeiraConversa)
        ? "Chegou mandando mensagem no WhatsApp"
        : primeiraCaptacao
          ? `Cadastrado no CRM; depois passou pela captação "${primeiraCaptacao.webhook}"`
          : "Cadastrado no CRM";

  // ── Vídeos: uma linha por vídeo, juntando as aberturas ──
  const porVideo = new Map<string, VideoDaFicha & { _trechos: [number, number][] }>();
  for (const a of aberturas) {
    const atual =
      porVideo.get(a.id as string) ??
      {
        id: a.id as string,
        nome: a.nome as string,
        duracao: a.duracao === null ? null : Number(a.duracao),
        aberturas: 0,
        cobertura: 0,
        naPagina: 0,
        primeira: iso(a.data_criacao)!,
        ultima: iso(a.data_atualizacao)!,
        _trechos: [],
      };
    atual.aberturas += 1;
    atual.naPagina += num(a.segundos_na_pagina);
    const abriu = iso(a.data_criacao)!;
    const viu = iso(a.data_atualizacao)!;
    if (abriu < atual.primeira) atual.primeira = abriu;
    if (viu > atual.ultima) atual.ultima = viu;
    atual._trechos.push(...((a.trechos as [number, number][] | null) ?? []));
    porVideo.set(atual.id, atual);
  }
  const videos = [...porVideo.values()].map(({ _trechos, ...v }) => ({
    ...v,
    cobertura: unirTrechos(_trechos).reduce((s, [a, b]) => s + (b - a), 0),
  }));

  const eventosPorOportunidade = new Map<string, OportunidadeDaFicha["eventosMeta"]>();
  for (const e of eventos) {
    const lista = eventosPorOportunidade.get(e.oportunidade_id as string) ?? [];
    lista.push({ evento: e.evento as string, status: e.status as string, erro: (e.erro as string | null) ?? null, quando: iso(e.data_criacao)! });
    eventosPorOportunidade.set(e.oportunidade_id as string, lista);
  }

  return {
    contato: {
      id: contato.id as string,
      nome: (contato.nome as string) ?? "",
      whatsapp: (contato.whatsapp as string) ?? "",
      email: (contato.email as string) ?? "",
      cidade: (contato.cidade as string) ?? "",
      estado: (contato.estado as string) ?? "",
      pais: (contato.pais as string) ?? "",
      ia: (contato.ia as boolean | null) ?? null,
      iaId: (contato.ia_id as string | null) ?? null,
      dataCriacao: iso(contato.data_criacao)!,
    },
    origem: {
      comoChegou,
      campanha: valor("campaign_name", "utm_campaign"),
      campanhaId: valor("campaign_id", "campanha_id", "utm_id"),
      conjunto: valor("adset_name", "utm_term"),
      anuncio: valor("ad_name", "utm_content"),
      fonte: valor("utm_source", "site_source_name"),
      meio: valor("utm_medium"),
      parametros,
      captacoes: captacoes.map((r) => ({
        id: r.id as string,
        webhook: r.webhook as string,
        webhookId: r.webhook_id as string,
        estado: r.estado as string,
        resumo: (r.resumo as string | null) ?? null,
        erro: (r.erro as string | null) ?? null,
        quando: iso(r.data_criacao)!,
      })),
    },
    oportunidades: oportunidades.map((o) => ({
      id: o.id as string,
      nome: o.nome as string,
      valor: num(o.valor),
      status: o.status as string,
      etapaId: o.etapa_id as string,
      responsavel: (o.responsavel as string | null) ?? null,
      dataCriacao: iso(o.data_criacao)!,
      eventosMeta: eventosPorOportunidade.get(o.id as string) ?? [],
    })),
    conversas: conversas.map((c) => ({
      id: c.id as string,
      canal: c.canal as string,
      status: c.status as string,
      instancia: (c.numero_instancia as string | null) ?? null,
      responsavel: (c.responsavel as string | null) ?? null,
      mensagens: num(c.mensagens),
      recebidas: num(c.recebidas),
      pelaIa: num(c.pela_ia),
      pelaEquipe: num(c.pela_equipe),
      ultima: c.ultima_em
        ? {
            texto: (c.ultimo_texto as string) ?? "",
            tipo: (c.ultimo_tipo as string) ?? "texto",
            deQuem: c.ultima_origem === "contato" ? "contato" : "agente",
            quando: iso(c.ultima_em)!,
          }
        : null,
      primeiraEm: iso(c.primeira_em),
      dataCriacao: iso(c.data_criacao)!,
    })),
    reunioes: reunioes.map((r) => ({
      id: r.id as string,
      inicio: iso(r.inicio)!,
      fim: iso(r.fim)!,
      pelaIa: r.autor_id === null,
      autor: (r.autor as string | null) ?? null,
      oportunidade: (r.oportunidade as string | null) ?? null,
      marcadaEm: iso(r.data_criacao)!,
    })),
    videos,
    automacoes: automacoes.map((a) => ({
      id: a.id as string,
      fluxo: a.fluxo as string,
      fluxoId: a.fluxo_id as string,
      etapa: (a.etapa as string | null) ?? null,
      estado: a.estado as string,
      origem: a.origem as string,
      sobre: a.entidade_tipo === "contato" ? "contato" : "oportunidade",
      iniciadoEm: iso(a.iniciado_em)!,
      finalizadoEm: iso(a.finalizado_em),
      erro: (a.erro_msg as string | null) ?? null,
    })),
    campanhas: campanhas.map((c) => ({
      campanha: c.campanha as string,
      estado: c.estado as string,
      enviadoEm: iso(c.enviado_em),
      respondeuEm: iso(c.respondeu_em),
      conversao: (c.conversao as boolean | null) ?? null,
      erro: (c.erro as string | null) ?? null,
      quando: iso(c.data_criacao)!,
    })),
    tags: tags.map((t) => ({ id: t.id as string, nome: t.nome as string })),
    segmentos: segmentos.map((s) => ({ id: s.id as string, nome: s.nome as string })),
    historico: historico.map((h) => ({
      id: h.id as string,
      descricao: h.descricao as string,
      autor: (h.autor as string | null) ?? null,
      oportunidadeId: (h.oportunidade_id as string | null) ?? null,
      quando: iso(h.data_criacao)!,
    })),
    dias: dias.map((d) => ({
      mensagens: trechos
        .filter((m) => m.atendimento_id === d.atendimento_id && m.dia === d.dia)
        .map(paraMensagem),
      atendimentoId: d.atendimento_id as string,
      canal: d.canal as string,
      dia: d.dia as string,
      total: num(d.total),
      dele: num(d.dele),
      ia: num(d.ia),
      equipe: num(d.equipe),
      ultimaEm: iso(d.ultima_em)!,
      ultimoDele: (d.ultimo_dele as string | null) ?? null,
      ultimoNosso: (d.ultimo_nosso as string | null) ?? null,
    })),
    anotacoes: anotacoes.map((a) => ({
      id: a.id as string,
      contato_id: a.contato_id as string,
      texto: a.texto as string,
      autor_id: a.autor_id as string,
      data_criacao: iso(a.data_criacao)!,
      data_atualizacao: iso(a.data_atualizacao),
    })),
  };
}
