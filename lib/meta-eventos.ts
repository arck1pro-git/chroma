import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { sql } from "./db";
import { contasDeAnuncios, listarMeta, requisicao } from "./meta";

// Evento da Meta (Conversions API) quando a oportunidade ENTRA numa etapa.
//
// A etapa diz QUAL evento (etapas.meta_evento; NULL = não envia). O LEAD diz
// PARA QUAL PIXEL: cada landing page e cada campanha pode ter o seu, então o
// pixel sai do próprio lead — ver resolverPixel. Sem pixel identificado, nada
// é enviado.
//
// O envio sai UMA vez por oportunidade + evento: meta_eventos tem UNIQUE nessas
// duas colunas, e o card que sai da etapa e volta não manda de novo.
//
// DESLIGADO SEM META_EVENTOS_ATIVOS=1. É o estado do dev: a tela configura, o
// banco guarda, e nada vai para pixel nenhum. Não dá para usar "sem pixel
// configurado = desligado" como antes, porque agora o pixel vem do lead — um
// lead de teste com pixel_id no dev dispararia. Com META_TEST_EVENT_CODE, a Meta
// desvia tudo para a aba "Testar eventos" e nada conta para campanha.
//
// action_source "system_generated": o evento nasce no CRM, não numa página.
// "website" exigiria a URL e o user agent do visitante no momento do evento,
// que não existem quando alguém arrasta um card.

type Campos = Record<string, unknown> | null;

export type DadosDoLead = {
  contatoId: string;
  nome: string;
  email: string | null;
  whatsapp: string | null;
  cidade: string | null;
  estado: string | null;
  pais: string | null;
  // Oportunidade primeiro, contato depois — a mesma precedência de
  // origemDaOportunidade (lib/meta-ads-calculos.ts): o lead mais novo manda.
  camposOportunidade: Campos;
  camposContato: Campos;
  valor: number;
  // Instante do clique aproximado pelo da criação do lead, para montar o fbc
  // quando só o fbclid chegou.
  criadoEm: Date;
};

// ── Normalização e hash, no formato que a Meta pede ─────────────────────────
// Cada campo pessoal vai como SHA-256 do valor normalizado. Normalizar errado
// não dá erro: dá um hash que não casa com ninguém, e o evento chega "sem
// correspondência" sem aviso nenhum.

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");

function hashSe(valor: string | null | undefined): string | undefined {
  const v = valor?.trim();
  return v ? sha256(v) : undefined;
}

// Telefone: só dígitos, com código do país. O CRM grava o WhatsApp como veio,
// então 10 ou 11 dígitos são número brasileiro sem o 55.
export function telefoneMeta(whatsapp: string | null): string | null {
  const d = (whatsapp ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

// País em ISO de duas letras. O CRM guarda "Brasil" por extenso.
function paisMeta(pais: string | null): string | null {
  const p = semAcento(pais ?? "").trim().toLowerCase();
  if (!p || p === "brasil" || p === "brazil" || p === "br") return "br";
  return p.length === 2 ? p : null;
}

function texto(campos: Campos, chaves: string[]): string | null {
  for (const chave of chaves) {
    const v = campos?.[chave];
    if (typeof v === "string" && v.trim()) return v.trim();
    // id numérico que chegou como número no JSON do formulário
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function doLead(lead: DadosDoLead, chaves: string[]) {
  return texto(lead.camposOportunidade, chaves) ?? texto(lead.camposContato, chaves);
}

const UTMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "campaign_id", "adset_id", "ad_id"];

// ── De qual pixel é este lead ───────────────────────────────────────────────

export type PixelResolvido =
  | { pixelId: string; origem: "lead" | "conjunto" }
  | { pixelId: null; motivo: string };

export type DependenciasMeta = {
  // Pixels que esta integração enxerga. Pixel fora daqui não recebe evento.
  pixelsPermitidos: () => Promise<Set<string>>;
  // Para qual pixel o conjunto otimiza (promoted_object.pixel_id), ou null.
  pixelDoConjunto: (adsetId: string) => Promise<string | null>;
};

const ID_META = /^\d{6,20}$/;

/**
 * O pixel do lead, nesta ordem:
 *
 *   1. `pixel_id` nos campos do lead — o que a landing page mandou no
 *      formulário. É o pixel que de fato disparou na página onde ele converteu.
 *   2. `adset_id` nos campos do lead (UTM {{adset.id}}) → o pixel para o qual
 *      aquele conjunto otimiza. Segue a campanha sozinho, sem nada na LP.
 *   3. Nenhum dos dois → sem pixel, e nada é enviado.
 *
 * SÓ PIXEL DAS CONTAS DA INTEGRAÇÃO: o pixel_id vem de um formulário público.
 * Sem esta trava, um POST forjado escolheria para onde o CRM manda dado de
 * cliente. Pixel do lead fora da lista não para tudo — ainda tenta o conjunto.
 */
export async function resolverPixel(lead: DadosDoLead, deps: DependenciasMeta): Promise<PixelResolvido> {
  const permitidos = await deps.pixelsPermitidos();
  const motivos: string[] = [];

  const doFormulario = doLead(lead, ["pixel_id", "pixel"]);
  if (doFormulario) {
    if (!ID_META.test(doFormulario)) motivos.push(`pixel_id do lead inválido ("${doFormulario}")`);
    else if (permitidos.has(doFormulario)) return { pixelId: doFormulario, origem: "lead" };
    else motivos.push(`pixel ${doFormulario} do lead não pertence às contas da integração`);
  }

  const adset = doLead(lead, ["adset_id", "conjunto_id"]);
  if (adset && ID_META.test(adset)) {
    try {
      const doConjunto = await deps.pixelDoConjunto(adset);
      if (doConjunto && permitidos.has(doConjunto)) return { pixelId: doConjunto, origem: "conjunto" };
      motivos.push(doConjunto
        ? `pixel ${doConjunto} do conjunto ${adset} não pertence às contas da integração`
        : `conjunto ${adset} não otimiza para pixel`);
    } catch (e) {
      motivos.push(`conjunto ${adset}: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (adset) {
    motivos.push(`adset_id do lead inválido ("${adset}")`);
  }

  if (!doFormulario && !adset) motivos.push("lead sem pixel_id e sem adset_id");
  return { pixelId: null, motivo: motivos.join("; ") };
}

// Consultas reais, com cache curto por instância: um lote de leads do mesmo
// conjunto não vira uma chamada à Meta por lead.
const DEZ_MINUTOS = 10 * 60_000;
let cachePixels: { ate: number; ids: Set<string> } | null = null;
const cacheConjuntos = new Map<string, { ate: number; pixel: string | null }>();

export const dependenciasMeta: DependenciasMeta = {
  async pixelsPermitidos() {
    if (cachePixels && cachePixels.ate > Date.now()) return cachePixels.ids;
    const contas = await contasDeAnuncios();
    const negocios = [...new Set(contas.map((c) => c.business?.id).filter((id): id is string => Boolean(id)))];
    const listas = await Promise.all([
      ...contas.map((c) => listarMeta<{ id: string }>(`${c.id}/adspixels`, { fields: "id", limit: "100" })),
      // pixel do portfólio que não foi compartilhado com a conta de anúncios
      ...negocios.map((n) => listarMeta<{ id: string }>(`${n}/adspixels`, { fields: "id", limit: "100" }).catch(() => [])),
    ]);
    const ids = new Set(listas.flat().map((p) => p.id));
    cachePixels = { ate: Date.now() + DEZ_MINUTOS, ids };
    return ids;
  },
  async pixelDoConjunto(adsetId) {
    const guardado = cacheConjuntos.get(adsetId);
    if (guardado && guardado.ate > Date.now()) return guardado.pixel;
    const r = await requisicao<{ promoted_object?: { pixel_id?: string } }>(adsetId, { params: { fields: "promoted_object" } });
    const pixel = r.promoted_object?.pixel_id ?? null;
    cacheConjuntos.set(adsetId, { ate: Date.now() + DEZ_MINUTOS, pixel });
    return pixel;
  },
};

/**
 * Monta o evento, sem rede e sem banco — é a parte que o teste confere.
 *
 * Identificadores do pixel: `fbp`/`fbc` gravados pelo webhook (aceita com e sem
 * o "_" do nome do cookie). Sem fbc mas com fbclid, o fbc é montado no formato
 * que o próprio pixel usa: fb.1.<milissegundos>.<fbclid>.
 *
 * UTMs vão em custom_data. Elas NÃO fazem a Meta ligar o evento ao anúncio —
 * quem faz isso é fbc/fbp, email e telefone —, mas ficam no evento para
 * relatório e segmentação.
 */
export function montarEventoMeta(opcoes: {
  evento: string;
  eventId: string;
  funil: string;
  etapa: string;
  lead: DadosDoLead;
  agora?: Date;
}) {
  const { lead } = opcoes;
  const partesNome = lead.nome.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const fbclid = doLead(lead, ["fbclid"]);
  const fbc = doLead(lead, ["fbc", "_fbc"]) ?? (fbclid ? `fb.1.${lead.criadoEm.getTime()}.${fbclid}` : null);
  const fbp = doLead(lead, ["fbp", "_fbp"]);
  const telefone = telefoneMeta(lead.whatsapp);
  const estado = (lead.estado ?? "").trim().toLowerCase();

  const user_data: Record<string, string> = {};
  const por = (chave: string, valor: string | undefined | null) => { if (valor) user_data[chave] = valor; };
  por("em", hashSe(lead.email?.toLowerCase()));
  por("ph", telefone ? sha256(telefone) : undefined);
  por("fn", partesNome.length ? sha256(partesNome[0]) : undefined);
  por("ln", partesNome.length > 1 ? sha256(partesNome[partesNome.length - 1]) : undefined);
  por("ct", hashSe(semAcento(lead.cidade ?? "").toLowerCase().replace(/[^a-z]/g, "")));
  por("st", estado.length === 2 ? sha256(estado) : undefined);
  const pais = paisMeta(lead.pais);
  por("country", pais ? sha256(pais) : undefined);
  // id do contato, com hash: casa o mesmo lead entre eventos diferentes.
  por("external_id", sha256(lead.contatoId));
  por("fbc", fbc);
  por("fbp", fbp);

  const custom_data: Record<string, string | number> = {
    // Os dois que a integração de CRM da Meta usa para reconhecer a origem.
    event_source: "crm",
    lead_event_source: "Chroma",
    funil: opcoes.funil,
    etapa: opcoes.etapa,
    // Valor sempre em BRL: é a moeda do CRM. Purchase exige os dois campos.
    currency: "BRL",
    value: lead.valor,
  };
  for (const utm of UTMS) {
    const v = doLead(lead, [utm]);
    if (v) custom_data[utm] = v;
  }

  return {
    event_name: opcoes.evento,
    event_time: Math.floor((opcoes.agora ?? new Date()).getTime() / 1000),
    event_id: opcoes.eventId,
    action_source: "system_generated",
    user_data,
    custom_data,
  };
}

export type ResultadoEvento =
  | { estado: "sem_evento" }       // a etapa não envia nada
  | { estado: "desligado" }        // META_EVENTOS_ATIVOS != 1 (dev)
  | { estado: "ja_enviado" }       // esta oportunidade já mandou este evento
  | { estado: "sem_pixel"; motivo: string }
  | { estado: "enviado"; evento: string; pixelId: string }
  | { estado: "erro"; evento: string; erro: string };

type Consulta = (strings: TemplateStringsArray, ...valores: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * RESERVA ANTES DE ENVIAR: o INSERT com status 'pendente' é o que garante que
 * dois caminhos ao mesmo tempo (arraste duplo, reenvio do webhook) não mandem o
 * evento duas vezes. Retoma 'erro' e 'sem_pixel' — o pixel pode ter aparecido
 * no lead desde a última entrada — e um 'pendente' com mais de 10 minutos, que é
 * o que sobra quando a função morre no meio do envio. 'enviado' nunca volta.
 *
 * Recebe a conexão para o teste rodar dentro de uma transação desfeita no fim.
 * Devolve null quando não há o que enviar.
 */
export async function reservarEvento(db: Consulta, oportunidadeId: string, etapaId: string, evento: string) {
  const [reserva] = await db`
    INSERT INTO meta_eventos (oportunidade_id, etapa_id, evento)
    VALUES (${oportunidadeId}, ${etapaId}, ${evento})
    ON CONFLICT (oportunidade_id, evento) DO UPDATE
       SET status = 'pendente', erro = NULL, resposta = NULL, pixel_id = NULL, pixel_origem = NULL,
           etapa_id = EXCLUDED.etapa_id, data_criacao = now()
     WHERE meta_eventos.status IN ('erro', 'sem_pixel')
        OR (meta_eventos.status = 'pendente' AND meta_eventos.data_criacao < now() - interval '10 minutes')
    RETURNING id, event_id`;
  return reserva ? { id: reserva.id as string, eventId: reserva.event_id as string } : null;
}

/** Envia o evento da etapa para esta oportunidade, no pixel do lead, se houver. */
export async function dispararEventoDaEtapa(
  oportunidadeId: string,
  etapaId: string,
  deps: DependenciasMeta = dependenciasMeta,
): Promise<ResultadoEvento> {
  const [etapa] = await sql`
    SELECT e.meta_evento, e.nome, f.nome AS funil
      FROM etapas e JOIN funis f ON f.id = e.funil_id
     WHERE e.id = ${etapaId}`;
  const evento = (etapa?.meta_evento as string | null) ?? null;
  if (!evento) return { estado: "sem_evento" };
  if (process.env.META_EVENTOS_ATIVOS?.trim() !== "1") return { estado: "desligado" };

  const reserva = await reservarEvento(sql, oportunidadeId, etapaId, evento);
  if (!reserva) return { estado: "ja_enviado" };

  let pixelId: string | null = null;
  try {
    const [linha] = await sql`
      SELECT o.valor::float8 AS valor, o.campos AS campos_op, o.data_criacao,
             c.id AS contato_id, c.nome, c.email, c.whatsapp, c.cidade, c.estado, c.pais,
             c.campos AS campos_contato
        FROM oportunidades o JOIN contatos c ON c.id = o.contato_id
       WHERE o.id = ${oportunidadeId}`;
    if (!linha) throw new Error("oportunidade não encontrada");

    const lead: DadosDoLead = {
      contatoId: linha.contato_id,
      nome: linha.nome,
      email: linha.email,
      whatsapp: linha.whatsapp,
      cidade: linha.cidade,
      estado: linha.estado,
      pais: linha.pais,
      camposOportunidade: linha.campos_op,
      camposContato: linha.campos_contato,
      valor: Number(linha.valor) || 0,
      criadoEm: new Date(linha.data_criacao),
    };

    const pixel = await resolverPixel(lead, deps);
    if (pixel.pixelId === null) {
      await sql`UPDATE meta_eventos SET status = 'sem_pixel', erro = ${pixel.motivo} WHERE id = ${reserva.id}`;
      return { estado: "sem_pixel", motivo: pixel.motivo };
    }
    pixelId = pixel.pixelId;

    const corpo = montarEventoMeta({
      evento,
      eventId: reserva.eventId,
      funil: etapa.funil as string,
      etapa: etapa.nome as string,
      lead,
    });
    const teste = process.env.META_TEST_EVENT_CODE?.trim();
    const resposta = await requisicao<Record<string, unknown>>(`${pixelId}/events`, {
      method: "POST",
      body: { data: [corpo], ...(teste ? { test_event_code: teste } : {}) },
    });
    await sql`
      UPDATE meta_eventos
         SET status = 'enviado', resposta = ${sql.json(resposta as never)},
             pixel_id = ${pixelId}, pixel_origem = ${pixel.origem}
       WHERE id = ${reserva.id}`;
    return { estado: "enviado", evento, pixelId };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await sql`UPDATE meta_eventos SET status = 'erro', erro = ${erro}, pixel_id = ${pixelId} WHERE id = ${reserva.id}`;
    return { estado: "erro", evento, erro };
  }
}

/**
 * O que os caminhos que põem uma oportunidade numa etapa chamam.
 *
 * NÃO ATRASA E NÃO DERRUBA QUEM CHAMOU: mover o card é a ação; o evento é
 * consequência. Roda depois da resposta, pelo after() do Next — o arraste não
 * espera a Meta. Fora de uma requisição (script, teste) o after() recusa, e aí
 * roda na hora.
 */
export function eventoAoEntrarNaEtapa(oportunidadeId: string, etapaId: string): void {
  const tarefa = async () => {
    try {
      const r = await dispararEventoDaEtapa(oportunidadeId, etapaId);
      if (r.estado === "erro") console.error(`[meta-eventos] ${r.evento} de ${oportunidadeId}: ${r.erro}`);
    } catch (e) {
      console.error("[meta-eventos] falhou ao preparar o evento:", e);
    }
  };
  try {
    after(tarefa);
  } catch {
    void tarefa();
  }
}
