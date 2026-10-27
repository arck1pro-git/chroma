// As ferramentas do conector MCP: o Claude (claude.ai, app ou Claude Code)
// lendo os funis do CRM para ajudar a entender onde os leads param e o que
// melhorar. Quem fala o protocolo é app/api/mcp/[segredo]/route.ts; aqui ficam
// só as consultas e o formato do que sai.
//
// SÓ LEITURA, e é o ponto do arquivo: nenhuma ferramenta aqui grava. Mover
// lead, mandar mensagem ou editar contato continuam sendo coisa da tela, com
// login e permissão de módulo. Ferramenta que escreve não entra aqui.
//
// TELEFONE E E-MAIL SAEM MASCARADOS (pedido dele, 2026-10-14). Ficam o DDD e o
// domínio, que servem para análise (região; e-mail corporativo × pessoal) e não
// identificam ninguém. As conversas do WhatsApp também ficam de fora: sai só
// quantas mensagens houve e quando, nunca o texto. O nome do lead sai inteiro.
//
// HORÁRIOS EM BRASÍLIA, como texto ("2026-10-14 13:44"). O Claude lê ISO em UTC
// e erra o dia de quem chegou depois das 21h.
import { z } from "zod";
import { sql } from "@/lib/db";
import type { Ferramenta } from "@/lib/mcp/protocolo";

// ── Máscara ─────────────────────────────────────────────────────────────────

const EMAIL = /[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)/gi;
// Candidato a telefone, que ainda passa por ehTelefone. Não pode estar colado
// em letra ou hífen: é o que deixa de fora os pedaços de UUID.
const TELEFONE = /(?<![\w-])\+?\(?\d[\d\s().-]{8,}\d(?![\w-])/g;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}/;

/**
 * 10 ou 11 dígitos (DDD + número), ou 12–13 começando com 55. Fora disso não é
 * telefone: data com hora ("2026-10-05 12:30" dá 10 dígitos) e id de campanha
 * da Meta (18 dígitos) seguem como estão, porque escondê-los tira dado útil.
 */
function ehTelefone(trecho: string): boolean {
  if (DATA_ISO.test(trecho.trim())) return false;
  const d = trecho.replace(/\D/g, "");
  return d.length === 10 || d.length === 11 || ((d.length === 12 || d.length === 13) && d.startsWith("55"));
}
// Campo de formulário cujo valor some inteiro, seja qual for o formato.
// instagram (2026-10-26): o IGSID e o @ do contato que veio do direct.
const CHAVE_SENSIVEL = /fone|whats|celular|phone|e-?mail|cpf|cnpj|^rg$|_rg$|instagram/i;

/** "(47) •••••-••••": o DDD serve para ver de onde vêm os leads. */
export function mascararTelefone(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const d = bruto.replace(/\D/g, "");
  // "+1 415 555 0100" também tem 11 dígitos: com "+" e sem 55, não há DDD.
  if (bruto.trim().startsWith("+") && !d.startsWith("55")) return "(número internacional oculto)";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return `(${d.slice(2, 4)}) •••••-••••`;
  if (d.length === 10 || d.length === 11) return `(${d.slice(0, 2)}) •••••-••••`;
  return "(número internacional oculto)";
}

/** "•••@gmail.com": o domínio diz se é e-mail pessoal ou da empresa. */
export function mascararEmail(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const dominio = bruto.trim().split("@")[1];
  return dominio ? `•••@${dominio.toLowerCase()}` : "(oculto)";
}

/** Texto livre (histórico, anotação, resposta de formulário) sem telefone nem e-mail. */
export function mascararTexto(texto: string): string {
  return texto
    .replace(EMAIL, (_t, dominio: string) => `•••@${dominio.toLowerCase()}`)
    .replace(TELEFONE, (t) => (ehTelefone(t) ? (mascararTelefone(t) ?? "(oculto)") : t));
}

function mascararValor(valor: unknown): unknown {
  if (typeof valor === "string") return mascararTexto(valor);
  if (Array.isArray(valor)) return valor.map(mascararValor);
  if (valor && typeof valor === "object") return mascararCampos(valor as Record<string, unknown>);
  return valor;
}

/** Campos de formulário (jsonb) com os valores pessoais mascarados. */
export function mascararCampos(campos: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(campos ?? {})) {
    saida[chave] = CHAVE_SENSIVEL.test(chave) && valor !== null && valor !== "" ? "(oculto)" : mascararValor(valor);
  }
  return saida;
}

// ── Formato ─────────────────────────────────────────────────────────────────

const RELOGIO = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Instante em Brasília, "2026-10-14 13:44". */
function br(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return RELOGIO.format(new Date(d));
}

const DIA_MS = 86_400_000;
const dias = (ms: number) => Math.round((ms / DIA_MS) * 10) / 10;

// A origem do lead. Os webhooks gravam as UTMs no CONTATO (é onde o carimbo de
// campanha também escreve); a oportunidade, quando tem, ganha por cima.
const CHAVES_ORIGEM = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campaign_id",
  "adset_name",
  "ad_name",
] as const;

type Campos = Record<string, unknown> | null;

function origem(doContato: Campos, daOportunidade: Campos): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const fonte of [doContato, daOportunidade]) {
    for (const chave of CHAVES_ORIGEM) {
      const valor = fonte?.[chave];
      // Macro que a Meta não trocou ("{{campaign.name}}") não é origem.
      if (typeof valor === "string" && valor.trim() && !valor.includes("{{")) saida[chave] = valor.trim();
    }
  }
  return saida;
}

// Hora em que o lead entrou na etapa atual: a última mudança de etapa
// registrada no histórico (lib/historico.ts, moverEtapaRegistrando), ou a
// criação se ele nunca saiu da primeira. Função, e não constante: sql`` no
// topo do módulo abriria a conexão no import e quebraria o `next build`.
const entradaNaEtapa = () => sql`
  LEFT JOIN LATERAL (
    SELECT max(h.data_criacao) AS ultima
      FROM historico h
     WHERE h.oportunidade_id = o.id AND h.descricao LIKE 'Movida de %'
  ) mv ON true`;

// ── 1. Visão geral ──────────────────────────────────────────────────────────

async function visaoGeralFunis() {
  const [etapas, criadas] = await Promise.all([
    sql`
      SELECT f.id AS funil_id, f.nome AS funil, f.descricao,
             e.id AS etapa_id, e.nome AS etapa, e.ordem, ia.nome AS ia,
             count(o.id) FILTER (WHERE o.status = 'aberta')::int AS abertas,
             count(o.id) FILTER (WHERE o.status = 'ganha')::int AS ganhas,
             count(o.id) FILTER (WHERE o.status = 'perdida')::int AS perdidas,
             coalesce(sum(o.valor) FILTER (WHERE o.status = 'aberta'), 0)::float8 AS valor_aberto,
             (avg(EXTRACT(EPOCH FROM now() - coalesce(mv.ultima, o.data_criacao)))
                FILTER (WHERE o.status = 'aberta'))::float8 AS segundos_medios_na_etapa
        FROM funis f
        LEFT JOIN etapas e ON e.funil_id = f.id
        LEFT JOIN ias ia ON ia.id = e.ia_id
        LEFT JOIN oportunidades o ON o.etapa_id = e.id
        ${entradaNaEtapa()}
       GROUP BY f.id, e.id, ia.nome
       ORDER BY f.nome, e.ordem`,
    sql`
      SELECT funil_id,
             count(*) FILTER (WHERE data_criacao > now() - interval '7 days')::int AS d7,
             count(*) FILTER (WHERE data_criacao > now() - interval '30 days')::int AS d30
        FROM oportunidades GROUP BY funil_id`,
  ]);

  const porFunil = new Map<string, { d7: number; d30: number }>(
    criadas.map((c) => [c.funil_id as string, { d7: c.d7 as number, d30: c.d30 as number }]),
  );
  type Funil = {
    id: string;
    nome: string;
    descricao: string | null;
    criadas_ultimos_7_dias: number;
    criadas_ultimos_30_dias: number;
    totais: { abertas: number; ganhas: number; perdidas: number; valor_aberto: number };
    etapas: unknown[];
  };
  const funis = new Map<string, Funil>();
  for (const l of etapas) {
    let f = funis.get(l.funil_id);
    if (!f) {
      f = {
        id: l.funil_id,
        nome: l.funil,
        descricao: l.descricao || null,
        criadas_ultimos_7_dias: porFunil.get(l.funil_id)?.d7 ?? 0,
        criadas_ultimos_30_dias: porFunil.get(l.funil_id)?.d30 ?? 0,
        totais: { abertas: 0, ganhas: 0, perdidas: 0, valor_aberto: 0 },
        etapas: [],
      };
      funis.set(l.funil_id, f);
    }
    if (!l.etapa_id) continue;
    f.totais.abertas += l.abertas;
    f.totais.ganhas += l.ganhas;
    f.totais.perdidas += l.perdidas;
    f.totais.valor_aberto += l.valor_aberto;
    f.etapas.push({
      id: l.etapa_id,
      ordem: l.ordem,
      nome: l.etapa,
      ia_que_atende: l.ia ?? null,
      abertas: l.abertas,
      ganhas: l.ganhas,
      perdidas: l.perdidas,
      valor_aberto: l.valor_aberto,
      dias_medios_parados_na_etapa: l.segundos_medios_na_etapa == null ? null : dias(l.segundos_medios_na_etapa * 1000),
    });
  }
  return {
    gerado_em: br(new Date()),
    observacao:
      "Ganhas e perdidas ficam na etapa em que estavam quando foram marcadas. 'dias_medios_parados_na_etapa' conta só as abertas, desde a última mudança de etapa.",
    funis: [...funis.values()],
  };
}

// ── 2. Lista de leads ───────────────────────────────────────────────────────

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD");

const entradaListar = z.object({
  funil_id: z.uuid().optional().describe("Id do funil (sai de visao_geral_funis)."),
  etapa_id: z.uuid().optional().describe("Id da etapa (sai de visao_geral_funis)."),
  status: z.enum(["aberta", "ganha", "perdida", "todas"]).default("aberta"),
  responsavel: z.string().trim().min(1).optional().describe("Parte do nome do responsável."),
  busca: z.string().trim().min(1).optional().describe("Parte do nome do lead ou da oportunidade."),
  campanha: z.string().trim().min(1).optional().describe("Parte do utm_campaign."),
  criado_desde: DATA.optional().describe("Criadas a partir deste dia (Brasília), AAAA-MM-DD."),
  criado_ate: DATA.optional().describe("Criadas até este dia, inclusive, AAAA-MM-DD."),
  parado_ha_dias: z.number().int().min(0).optional().describe("Só quem está na etapa atual há pelo menos N dias."),
  ordenar: z.enum(["recentes", "mais_parados"]).default("recentes"),
  limite: z.number().int().min(1).max(200).default(50),
  pagina: z.number().int().min(1).default(1),
});

async function listarLeads(a: z.output<typeof entradaListar>) {
  const linhas = await sql`
    WITH base AS (
      SELECT o.id, o.nome AS oportunidade, o.status, o.valor::float8 AS valor, o.data_criacao,
             o.campos AS campos_op, c.id AS contato_id, c.nome AS contato, c.whatsapp, c.email,
             c.cidade, c.estado, c.campos AS campos_contato,
             f.nome AS funil, e.nome AS etapa, u.nome AS responsavel,
             coalesce(mv.ultima, o.data_criacao) AS na_etapa_desde
        FROM oportunidades o
        LEFT JOIN contatos c ON c.id = o.contato_id
        LEFT JOIN funis f ON f.id = o.funil_id
        LEFT JOIN etapas e ON e.id = o.etapa_id
        LEFT JOIN usuarios u ON u.id = o.responsavel_id
        ${entradaNaEtapa()}
       WHERE (${a.funil_id ?? null}::uuid IS NULL OR o.funil_id = ${a.funil_id ?? null}::uuid)
         AND (${a.etapa_id ?? null}::uuid IS NULL OR o.etapa_id = ${a.etapa_id ?? null}::uuid)
         AND (${a.status}::text = 'todas' OR o.status = ${a.status}::text)
         AND (${a.responsavel ?? null}::text IS NULL OR u.nome ILIKE '%' || ${a.responsavel ?? null}::text || '%')
         AND (${a.busca ?? null}::text IS NULL
              OR o.nome ILIKE '%' || ${a.busca ?? null}::text || '%'
              OR c.nome ILIKE '%' || ${a.busca ?? null}::text || '%')
         AND (${a.campanha ?? null}::text IS NULL
              OR concat_ws(' ', c.campos->>'utm_campaign', o.campos->>'utm_campaign')
                 ILIKE '%' || ${a.campanha ?? null}::text || '%')
         AND (${a.criado_desde ?? null}::date IS NULL
              OR o.data_criacao >= (${a.criado_desde ?? null}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND (${a.criado_ate ?? null}::date IS NULL
              OR o.data_criacao < (${a.criado_ate ?? null}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    )
    SELECT b.*, count(*) OVER ()::int AS total, tg.tags, msg.*
      FROM base b
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(t.nome ORDER BY t.nome) AS tags
          FROM contato_tags ct JOIN tags t ON t.id = ct.tag_id
         WHERE ct.contato_id = b.contato_id
      ) tg ON true
      LEFT JOIN LATERAL (
        SELECT max(m.data_criacao) FILTER (WHERE m.origem = 'contato') AS ultima_msg_cliente,
               max(m.data_criacao) FILTER (WHERE m.origem = 'agente') AS ultima_msg_nossa,
               count(*) FILTER (WHERE m.origem = 'contato')::int AS msgs_cliente,
               count(*) FILTER (WHERE m.origem = 'agente')::int AS msgs_nossas,
               count(*) FILTER (WHERE m.origem = 'agente' AND m.enviada_por = 'ia')::int AS msgs_da_ia
          FROM atendimentos at JOIN mensagens m ON m.atendimento_id = at.id
         WHERE at.contato_id = b.contato_id
      ) msg ON true
     WHERE (${a.parado_ha_dias ?? null}::int IS NULL
            OR b.na_etapa_desde <= now() - make_interval(days => ${a.parado_ha_dias ?? null}::int))
     ORDER BY CASE WHEN ${a.ordenar}::text = 'mais_parados' THEN b.na_etapa_desde END ASC NULLS LAST,
              b.data_criacao DESC
     LIMIT ${a.limite} OFFSET ${(a.pagina - 1) * a.limite}`;

  const agora = Date.now();
  return {
    total: linhas[0]?.total ?? 0,
    pagina: a.pagina,
    limite: a.limite,
    leads: linhas.map((l) => ({
      oportunidade_id: l.id,
      oportunidade: l.oportunidade,
      contato: l.contato,
      telefone: mascararTelefone(l.whatsapp),
      email: mascararEmail(l.email),
      cidade: l.cidade || null,
      estado: l.estado || null,
      funil: l.funil,
      etapa: l.etapa,
      status: l.status,
      valor: l.valor,
      responsavel: l.responsavel ?? null,
      criada_em: br(l.data_criacao),
      na_etapa_desde: br(l.na_etapa_desde),
      dias_na_etapa: dias(agora - new Date(l.na_etapa_desde).getTime()),
      origem: origem(l.campos_contato, l.campos_op),
      tags: l.tags ?? [],
      conversa: resumoConversa(l),
    })),
  };
}

/** Quantas mensagens e quando: o texto das conversas não sai do CRM. */
function resumoConversa(l: Record<string, unknown>) {
  const cliente = l.ultima_msg_cliente ? new Date(l.ultima_msg_cliente as string) : null;
  const nossa = l.ultima_msg_nossa ? new Date(l.ultima_msg_nossa as string) : null;
  return {
    msgs_do_cliente: l.msgs_cliente ?? 0,
    msgs_nossas: l.msgs_nossas ?? 0,
    das_nossas_pela_ia: l.msgs_da_ia ?? 0,
    ultima_do_cliente: br(cliente),
    ultima_nossa: br(nossa),
    cliente_esperando_resposta: !!cliente && (!nossa || cliente > nossa),
  };
}

// ── 3. Ficha do lead ────────────────────────────────────────────────────────

const entradaFicha = z.object({
  oportunidade_id: z.uuid().describe("Id da oportunidade (sai de listar_leads)."),
});

async function fichaLead({ oportunidade_id }: z.output<typeof entradaFicha>) {
  const [op] = await sql`
    SELECT o.id, o.nome, o.status, o.valor::float8 AS valor, o.data_criacao, o.campos AS campos_op,
           c.id AS contato_id, c.nome AS contato, c.whatsapp, c.email, c.cidade, c.estado, c.pais,
           c.data_criacao AS contato_criado, c.campos AS campos_contato, c.ia AS ia_do_contato,
           f.nome AS funil, e.nome AS etapa, u.nome AS responsavel, ia.nome AS ia_da_etapa,
           coalesce(mv.ultima, o.data_criacao) AS na_etapa_desde
      FROM oportunidades o
      LEFT JOIN contatos c ON c.id = o.contato_id
      LEFT JOIN funis f ON f.id = o.funil_id
      LEFT JOIN etapas e ON e.id = o.etapa_id
      LEFT JOIN ias ia ON ia.id = e.ia_id
      LEFT JOIN usuarios u ON u.id = o.responsavel_id
      ${entradaNaEtapa()}
     WHERE o.id = ${oportunidade_id}`;
  if (!op) return { erro: "Oportunidade não encontrada." };

  const [outras, tags, segmentos, historico, anotacoes, reunioes, [conversa]] = await Promise.all([
    sql`
      SELECT o.id, o.nome, o.status, o.data_criacao, f.nome AS funil, e.nome AS etapa
        FROM oportunidades o
        LEFT JOIN funis f ON f.id = o.funil_id
        LEFT JOIN etapas e ON e.id = o.etapa_id
       WHERE o.contato_id = ${op.contato_id} AND o.id <> ${op.id}
       ORDER BY o.data_criacao DESC`,
    sql`SELECT t.nome FROM contato_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contato_id = ${op.contato_id} ORDER BY t.nome`,
    sql`SELECT s.nome FROM contato_segmentos cs JOIN segmentos s ON s.id = cs.segmento_id WHERE cs.contato_id = ${op.contato_id} ORDER BY s.nome`,
    sql`
      SELECT h.data_criacao, h.descricao, h.oportunidade_id, u.nome AS autor
        FROM historico h LEFT JOIN usuarios u ON u.id = h.autor_id
       WHERE h.contato_id = ${op.contato_id}
       ORDER BY h.data_criacao DESC LIMIT 300`,
    sql`
      SELECT a.data_criacao, a.texto, u.nome AS autor
        FROM anotacoes a LEFT JOIN usuarios u ON u.id = a.autor_id
       WHERE a.contato_id = ${op.contato_id}
       ORDER BY a.data_criacao DESC LIMIT 100`,
    sql`SELECT inicio, fim, data_criacao FROM agenda_reunioes WHERE contato_id = ${op.contato_id} ORDER BY inicio DESC`,
    sql`
      SELECT max(m.data_criacao) FILTER (WHERE m.origem = 'contato') AS ultima_msg_cliente,
             max(m.data_criacao) FILTER (WHERE m.origem = 'agente') AS ultima_msg_nossa,
             min(m.data_criacao) FILTER (WHERE m.origem = 'agente') AS primeira_msg_nossa,
             min(m.data_criacao) FILTER (WHERE m.origem = 'contato') AS primeira_msg_cliente,
             count(*) FILTER (WHERE m.origem = 'contato')::int AS msgs_cliente,
             count(*) FILTER (WHERE m.origem = 'agente')::int AS msgs_nossas,
             count(*) FILTER (WHERE m.origem = 'agente' AND m.enviada_por = 'ia')::int AS msgs_da_ia
        FROM atendimentos at JOIN mensagens m ON m.atendimento_id = at.id
       WHERE at.contato_id = ${op.contato_id}`,
  ]);

  return {
    oportunidade: {
      id: op.id,
      nome: op.nome,
      funil: op.funil,
      etapa: op.etapa,
      status: op.status,
      valor: op.valor,
      responsavel: op.responsavel ?? null,
      criada_em: br(op.data_criacao),
      na_etapa_desde: br(op.na_etapa_desde),
      dias_na_etapa: dias(Date.now() - new Date(op.na_etapa_desde).getTime()),
      ia_da_etapa: op.ia_da_etapa ?? null,
    },
    contato: {
      nome: op.contato,
      telefone: mascararTelefone(op.whatsapp),
      email: mascararEmail(op.email),
      cidade: op.cidade || null,
      estado: op.estado || null,
      pais: op.pais || null,
      no_crm_desde: br(op.contato_criado),
      ia_no_contato: op.ia_do_contato === true ? "ligada à mão" : op.ia_do_contato === false ? "desligada à mão" : "segue a etapa",
      tags: tags.map((t) => t.nome),
      segmentos: segmentos.map((s) => s.nome),
    },
    origem: origem(op.campos_contato, op.campos_op),
    respostas_do_formulario: { ...mascararCampos(op.campos_contato), ...mascararCampos(op.campos_op) },
    conversa: {
      ...resumoConversa(conversa ?? {}),
      primeira_do_cliente: br(conversa?.primeira_msg_cliente),
      primeira_nossa: br(conversa?.primeira_msg_nossa),
    },
    reunioes: reunioes.map((r) => ({ inicio: br(r.inicio), fim: br(r.fim), marcada_em: br(r.data_criacao) })),
    outras_oportunidades_do_contato: outras.map((o) => ({
      id: o.id,
      nome: o.nome,
      funil: o.funil,
      etapa: o.etapa,
      status: o.status,
      criada_em: br(o.data_criacao),
    })),
    anotacoes_da_equipe: anotacoes.map((n) => ({
      quando: br(n.data_criacao),
      autor: n.autor ?? null,
      texto: mascararTexto(n.texto ?? ""),
    })),
    historico_mais_recente_primeiro: historico.map((h) => ({
      quando: br(h.data_criacao),
      autor: h.autor ?? "Sistema",
      ...(h.oportunidade_id && h.oportunidade_id !== op.id ? { de_outra_oportunidade: true } : {}),
      o_que: mascararTexto(h.descricao ?? ""),
    })),
  };
}

// ── 4. Movimentação do funil ────────────────────────────────────────────────

const entradaMovimentacao = z.object({
  funil_id: z.uuid().describe("Id do funil (sai de visao_geral_funis)."),
  desde: DATA.optional().describe("Primeiro dia do período (Brasília), AAAA-MM-DD. Padrão: 30 dias atrás."),
  ate: DATA.optional().describe("Último dia do período, inclusive, AAAA-MM-DD. Padrão: hoje."),
});

// "Movida de X para Y" + complemento opcional (" pela IA Z: motivo").
const MOVIDA = /^Movida de (.+?) para (.+?)(?= pela | — |$)/;
const CRIADA = /^Oportunidade ".*" criada em (.+)$/;

/** De onde e para onde, preferindo os nomes de etapa conhecidos (nome pode ter " para "). */
function lerMovida(texto: string, nomes: string[]): { de: string; para: string } | null {
  const resto = texto.slice("Movida de ".length);
  for (const de of nomes) {
    if (!resto.startsWith(`${de} para `)) continue;
    const depois = resto.slice(de.length + " para ".length);
    const para = nomes.find((n) => depois === n || depois.startsWith(`${n} `));
    if (para) return { de, para };
  }
  const m = MOVIDA.exec(texto);
  return m ? { de: m[1], para: m[2] } : null;
}

function mediana(valores: number[]): number {
  const v = [...valores].sort((x, y) => x - y);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/** Meia-noite de Brasília do dia "AAAA-MM-DD" (UTC−3, sem horário de verão). */
const inicioDoDia = (dia: string) => new Date(`${dia}T00:00:00-03:00`).getTime();

async function movimentacaoFunil(a: z.output<typeof entradaMovimentacao>) {
  const hoje = br(new Date())!.slice(0, 10);
  const ate = a.ate ?? hoje;
  const desde = a.desde ?? br(new Date(inicioDoDia(ate) - 29 * DIA_MS))!.slice(0, 10);
  const ini = inicioDoDia(desde);
  const fim = inicioDoDia(ate) + DIA_MS;
  const noPeriodo = (t: number) => t >= ini && t < fim;

  const [[funil], etapas, ops, eventos] = await Promise.all([
    sql`SELECT id, nome FROM funis WHERE id = ${a.funil_id}`,
    sql`SELECT nome, ordem FROM etapas WHERE funil_id = ${a.funil_id} ORDER BY ordem`,
    sql`
      SELECT o.id, o.status, o.data_criacao, c.campos AS campos_contato, o.campos AS campos_op
        FROM oportunidades o LEFT JOIN contatos c ON c.id = o.contato_id
       WHERE o.funil_id = ${a.funil_id}`,
    sql`
      SELECT h.oportunidade_id, h.data_criacao, h.descricao
        FROM historico h JOIN oportunidades o ON o.id = h.oportunidade_id
       WHERE o.funil_id = ${a.funil_id}
         AND (h.descricao LIKE 'Movida de %' OR h.descricao LIKE 'Oportunidade "%" criada em %'
              OR h.descricao LIKE 'Marcada como %' OR h.descricao = 'Oportunidade reaberta')
       ORDER BY h.oportunidade_id, h.data_criacao`,
  ]);
  if (!funil) return { erro: "Funil não encontrado." };

  // Mais longo primeiro: "novo contato - sem doc" antes de "novo contato".
  const nomes = etapas.map((e) => e.nome as string).sort((x, y) => y.length - x.length);
  const ordemDe = new Map<string, number>(etapas.map((e) => [e.nome as string, e.ordem as number]));

  type Op = { criada: number; status: string; campanha: string; entrada: string | null; maiorOrdem: number };
  const porOp = new Map<string, Op>();
  for (const o of ops) {
    porOp.set(o.id, {
      criada: new Date(o.data_criacao).getTime(),
      status: o.status,
      campanha: origem(o.campos_contato, o.campos_op).utm_campaign ?? "(sem campanha)",
      entrada: null,
      maiorOrdem: -1,
    });
  }

  const transicoes = new Map<string, { de: string; para: string; quantidade: number }>();
  const tempos = new Map<string, number[]>();
  const ganhasPorEtapa = new Map<string, number>();
  const perdidasPorEtapa = new Map<string, number>();
  let ganhas = 0;
  let perdidas = 0;
  const conta = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  let atual: string | null = null; // oportunidade da vez (eventos vêm ordenados por ela)
  let ultimoMarco = 0; // quando ela entrou na etapa em que está
  let etapaAtual: string | null = null;
  for (const ev of eventos) {
    const op = porOp.get(ev.oportunidade_id);
    if (!op) continue;
    if (ev.oportunidade_id !== atual) {
      atual = ev.oportunidade_id;
      ultimoMarco = op.criada;
      etapaAtual = null;
    }
    const t = new Date(ev.data_criacao).getTime();
    const texto = ev.descricao as string;

    const criada = CRIADA.exec(texto);
    if (criada) {
      op.entrada = criada[1];
      etapaAtual = criada[1];
      op.maiorOrdem = Math.max(op.maiorOrdem, ordemDe.get(criada[1]) ?? -1);
      continue;
    }
    if (texto.startsWith("Movida de ")) {
      const mov = lerMovida(texto, nomes);
      if (!mov) continue;
      op.entrada ??= mov.de;
      op.maiorOrdem = Math.max(op.maiorOrdem, ordemDe.get(mov.de) ?? -1, ordemDe.get(mov.para) ?? -1);
      if (noPeriodo(t)) {
        const chave = `${mov.de}\u0000${mov.para}`;
        const tr = transicoes.get(chave) ?? { de: mov.de, para: mov.para, quantidade: 0 };
        tr.quantidade += 1;
        transicoes.set(chave, tr);
        const lista = tempos.get(mov.de) ?? [];
        lista.push(t - ultimoMarco);
        tempos.set(mov.de, lista);
      }
      ultimoMarco = t;
      etapaAtual = mov.para;
      continue;
    }
    if (noPeriodo(t) && texto === "Marcada como ganha") {
      ganhas += 1;
      conta(ganhasPorEtapa, etapaAtual ?? "(etapa desconhecida)");
    } else if (noPeriodo(t) && texto === "Marcada como perdida") {
      perdidas += 1;
      conta(perdidasPorEtapa, etapaAtual ?? "(etapa desconhecida)");
    }
  }

  const criadas = [...porOp.values()].filter((o) => noPeriodo(o.criada));
  const porEntrada = new Map<string, number>();
  const porCampanha = new Map<string, { campanha: string; criadas: number; avancaram: number; ganhas: number; perdidas: number }>();
  for (const o of criadas) {
    conta(porEntrada, o.entrada ?? "(sem registro)");
    const c = porCampanha.get(o.campanha) ?? { campanha: o.campanha, criadas: 0, avancaram: 0, ganhas: 0, perdidas: 0 };
    c.criadas += 1;
    const ordemEntrada = o.entrada ? (ordemDe.get(o.entrada) ?? -1) : -1;
    if (o.status === "ganha" || (ordemEntrada >= 0 && o.maiorOrdem > ordemEntrada)) c.avancaram += 1;
    if (o.status === "ganha") c.ganhas += 1;
    if (o.status === "perdida") c.perdidas += 1;
    porCampanha.set(o.campanha, c);
  }

  const lista = (m: Map<string, number>) =>
    [...m].map(([etapa, quantidade]) => ({ etapa, quantidade })).sort((x, y) => y.quantidade - x.quantidade);

  return {
    funil: funil.nome,
    periodo: { desde, ate },
    criadas_no_periodo: criadas.length,
    criadas_por_etapa_de_entrada: lista(porEntrada),
    criadas_por_campanha: [...porCampanha.values()].sort((x, y) => y.criadas - x.criadas),
    transicoes: [...transicoes.values()].sort((x, y) => y.quantidade - x.quantidade),
    tempo_na_etapa_de_quem_saiu: [...tempos]
      .map(([etapa, ms]) => ({
        etapa,
        saidas: ms.length,
        dias_medios: dias(ms.reduce((s, v) => s + v, 0) / ms.length),
        dias_mediana: dias(mediana(ms)),
      }))
      .sort((x, y) => (ordemDe.get(x.etapa) ?? 99) - (ordemDe.get(y.etapa) ?? 99)),
    ganhas_no_periodo: ganhas,
    ganhas_por_etapa: lista(ganhasPorEtapa),
    perdidas_no_periodo: perdidas,
    perdidas_por_etapa: lista(perdidasPorEtapa),
    observacao:
      "Transições e tempos vêm do histórico de mudança de etapa. 'avancaram' = passou de uma etapa de ordem maior que a de entrada, ou foi ganha. " +
      "Quem continua parado não entra em 'tempo_na_etapa_de_quem_saiu': veja visao_geral_funis e listar_leads com ordenar=mais_parados.",
  };
}

// ── Catálogo ────────────────────────────────────────────────────────────────

export const FERRAMENTAS: Ferramenta[] = [
  {
    nome: "visao_geral_funis",
    titulo: "Visão geral dos funis",
    descricao:
      "Todos os funis com as etapas em ordem: quantos leads abertos, ganhos e perdidos em cada etapa, valor em aberto, há quantos dias em média os abertos estão parados, e qual IA atende a etapa. Comece por aqui: os ids de funil e etapa das outras ferramentas saem daqui.",
    entrada: z.object({}),
    executar: visaoGeralFunis,
  },
  {
    nome: "listar_leads",
    titulo: "Listar leads",
    descricao:
      "Leads (oportunidades) com filtros: funil, etapa, status, responsável, nome, campanha (utm_campaign), período de criação e tempo parado na etapa. Cada lead traz etapa, dias na etapa, origem/UTM, tags e o resumo da conversa no WhatsApp (contagem e datas, sem o texto). Telefone e e-mail vêm mascarados. Paginado.",
    entrada: entradaListar,
    executar: listarLeads,
  },
  {
    nome: "ficha_lead",
    titulo: "Ficha do lead",
    descricao:
      "Tudo de um lead: dados do contato (telefone/e-mail mascarados), origem, respostas do formulário, tags, segmentos, reuniões, outras oportunidades, anotações da equipe e o histórico completo (mudanças de etapa, IA, automações, objeções registradas).",
    entrada: entradaFicha,
    executar: fichaLead,
  },
  {
    nome: "movimentacao_funil",
    titulo: "Movimentação do funil",
    descricao:
      "Como os leads andaram num funil num período (padrão: últimos 30 dias): leads criados por etapa de entrada e por campanha (com quantos avançaram, ganharam e perderam), transições entre etapas, tempo médio e mediano em cada etapa, e em que etapa estavam os ganhos e os perdidos.",
    entrada: entradaMovimentacao,
    executar: movimentacaoFunil,
  },
];
