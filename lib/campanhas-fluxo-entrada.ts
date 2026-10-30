// O que CHEGA para virar campanha em blocos (lib/campanhas-fluxo.ts) — da tela,
// da IA de campanhas ou do banco —, antes de gravar, ativar ou retomar:
//
//   · lerFluxoDaEntrada: a FORMA, com zod. Tipos, inteiros nos prazos, ids no
//     padrão, tamanhos com teto. O que o contrato já explica com frase própria
//     (prazo de 5 min a 30 dias, até 10 palavras, até 60 blocos) fica para
//     problemasDoFluxo: aqui o teto é só contra abuso.
//   · fluxoSalvo e fluxoGravado: o que já está gravado, como o motor roda e a
//     tela mostra — o v2 pela mesma forma, o formato antigo convertido. Moram
//     aqui (e não no motor) para quem só lê, como a IA do construtor, não
//     carregar o motor inteiro (revisão de 2026-10-28).
//   · conferirFluxo: o que depende de fora — a permissão de QUEM salva ou ativa
//     (o motor roda sem sessão: a autoridade é a dessa pessoa), os templates da
//     conta na Meta (nunca os que vieram no corpo; a regra de cada envio é
//     problemasDosEnvios, lib/campanhas-fluxo-envios.ts) e o banco (tag,
//     segmento, funil e etapa coerentes, usuário ativo, IA, número de aviso,
//     arquivo da biblioteca ativo e de tipo que a campanha manda, campo
//     personalizado do contato; os da Condição também; o arquivo do cabeçalho de
//     mídia do template, do tipo que o cabeçalho pede).
//   · travaDeIds: na edição, id que já rodou não muda de tipo nem volta depois
//     de aposentado (o motor guarda o estado de cada contato pelo id).
//
// IDS E PROTÓTIPO (revisão de segurança do desenho, 2026-10-27): os blocos são
// chaves de um objeto. Um id "constructor" faria `blocos[id]` achar a função do
// Object e o motor andar por um "bloco" que ninguém criou; "__proto__" some no
// parse. Por isso o id segue ^[a-z0-9_-]{1,40}$, não pode ser nome do
// Object.prototype nem o nó fixo de início, e o motor ainda confere Object.hasOwn.
import "server-only";
import { z } from "zod";
import { listaUuid, sql } from "@/lib/db";
import { templatesMeta } from "@/lib/meta";
import { podeOperar } from "@/lib/auth/permissoes";
import type { UsuarioLogado } from "@/lib/auth/dal";
import { ehUuid } from "@/lib/validacao";
import { instanciasParaAviso } from "@/lib/aviso-equipe-whatsapp";
import {
  lerTemplate,
  midiaDoCabecalho,
  problemaDoArquivoDoCabecalho,
  type TemplateWhatsApp,
  type ValoresDoEnvio,
} from "@/lib/templates-whatsapp";
import {
  blocosQueMudaramDeTipo,
  exigenciasDoFluxo,
  fluxoDoFormatoAntigo,
  NO_INICIO,
  problemasDoFluxo,
  templateDoFluxo,
  VERSAO_FLUXO,
  type AcaoAntiga,
  type BlocoCampanha,
  type FluxoCampanha,
  type ProblemaDoFluxo,
  type RegraCondicao,
} from "@/lib/campanhas-fluxo";
import { problemaDoArquivoDaCampanha, problemasDosEnvios } from "@/lib/campanhas-fluxo-envios";

// ── Forma ───────────────────────────────────────────────────────────────────

const PADRAO_ID = /^[a-z0-9_-]{1,40}$/;

/** Id de bloco que pode ser chave: no padrão, fora do Object.prototype e diferente do início. */
export function ehIdDeBloco(id: string): boolean {
  return PADRAO_ID.test(id) && !(id in Object.prototype) && id !== NO_INICIO;
}

const idBloco = z.string().refine(ehIdDeBloco, "id de bloco fora do padrão");
const destino = idBloco.nullable();
/** Vazio vale (o contrato pede "Escolha…"); preenchido, só uuid. */
const uuidOuVazio = z.string().refine((v) => v === "" || ehUuid(v), "id inválido");
/** Minutos inteiros. O intervalo de verdade (5 min a 30 dias) é do contrato. */
const minutos = z.number().int().min(0).max(1_000_000);
/** Posição vazia de lista volta de JSON como null. */
const valor = (max: number) => z.string().max(max).nullable().transform((v) => v ?? "");

const variaveis = z.object({
  cabecalho: z.array(valor(500)).max(1),
  corpo: z.array(valor(500)).max(100),
  botoes: z.array(valor(100)).max(10).optional(),
  /** O arquivo da biblioteca no cabeçalho de imagem, vídeo ou documento do template (2026-10-28). */
  midia: z.string().refine(ehUuid, "id inválido").nullable().optional(),
});

/** A pergunta da "Condição". A chave do campo segue o formato de campos_personalizados (app/configuracoes/acoes-campos.ts). */
const regraEsquema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("tem_tag"), tagId: uuidOuVazio }),
  z.object({ tipo: z.literal("no_segmento"), segmentoId: uuidOuVazio }),
  z.object({ tipo: z.literal("na_etapa"), funilId: uuidOuVazio, etapaId: uuidOuVazio }),
  z.object({
    tipo: z.literal("campo"),
    chave: z.string().regex(/^[a-z0-9_]{0,40}$/),
    operador: z.enum(["preenchido", "igual", "contem"]),
    valor: z.string().max(200),
  }),
]);

const blocoEsquema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("enviar_template"),
    template_nome: z.string().max(512),
    template_idioma: z.string().regex(/^[A-Za-z_]{0,20}$/),
    variaveis,
    proximo: destino,
  }),
  z.object({
    tipo: z.literal("aguardar_resposta"),
    prazo_minutos: minutos,
    botoes: z
      .record(z.string().min(1).max(60), destino)
      .refine((b) => Object.keys(b).length <= 20, "botões demais"),
    palavras: z.array(z.object({ contem: z.string().max(100), proximo: destino })).max(50),
    outra: destino,
    sem_resposta: destino,
  }),
  z.object({ tipo: z.literal("enviar_texto"), texto: z.string().max(4000), proximo: destino }),
  z.object({ tipo: z.literal("esperar"), minutos, proximo: destino }),
  z.object({ tipo: z.literal("mudar_tag"), acao: z.enum(["adicionar", "remover"]), tagId: uuidOuVazio, proximo: destino }),
  z.object({ tipo: z.literal("mudar_segmento"), acao: z.enum(["adicionar", "remover"]), segmentoId: uuidOuVazio, proximo: destino }),
  z.object({ tipo: z.literal("criar_oportunidade"), funilId: uuidOuVazio, etapaId: uuidOuVazio, nome: z.string().max(160), proximo: destino }),
  z.object({ tipo: z.literal("mover_oportunidade"), funilId: uuidOuVazio, etapaId: uuidOuVazio, proximo: destino }),
  z.object({ tipo: z.literal("registrar_conversao"), proximo: destino }),
  z.object({
    tipo: z.literal("avisar_equipe"),
    instanciaId: uuidOuVazio,
    usuarioIds: z.array(z.string().refine(ehUuid, "id inválido")).max(50),
    responsavelDoFunil: z.string().refine(ehUuid, "id inválido").nullable(),
    texto: z.string().max(2000),
    proximo: destino,
  }),
  z.object({ tipo: z.literal("ligar_ia"), iaId: uuidOuVazio, proximo: destino }),
  // Blocos de 2026-10-28. Os limites com frase própria (dias, HH:MM, quantidade,
  // intervalo) são de problemasDoFluxo; aqui, só o teto contra abuso.
  z.object({ tipo: z.literal("condicao"), regra: regraEsquema, sim: destino, nao: destino }),
  z.object({
    tipo: z.literal("horario"),
    dias: z.array(z.number().int().min(-1_000).max(1_000)).max(7),
    das: z.string().max(5),
    ate: z.string().max(5),
    proximo: destino,
  }),
  z.object({ tipo: z.literal("enviar_arquivo"), documentoId: uuidOuVazio, legenda: z.string().max(4000), proximo: destino }),
  z.object({
    tipo: z.literal("limitar_passagem"),
    quantidade: z.number().int().min(0).max(1_000_000),
    janela_segundos: z.number().int().min(0).max(100_000_000),
    proximo: destino,
  }),
  // De 2026-10-30. De 2 a 10 caminhos, com frase própria, em problemasDoFluxo.
  z.object({ tipo: z.literal("alternar"), saidas: z.array(destino).max(50) }),
]);

const coordenada = z.number().min(-1_000_000).max(1_000_000);

const fluxoEsquema = z.object({
  versao: z.literal(VERSAO_FLUXO),
  inicio: destino,
  blocos: z.record(idBloco, blocoEsquema).refine((b) => Object.keys(b).length <= 200, "blocos demais"),
  posicoes: z
    .record(z.string().max(40), z.object({ x: coordenada, y: coordenada }))
    .refine((p) => Object.keys(p).length <= 201, "posições demais"),
});

/** Posição é só desenho: a de bloco que não existe mais é descartada, sem erro. */
function comPosicoesDosBlocos(f: z.infer<typeof fluxoEsquema>): FluxoCampanha {
  const posicoes = Object.fromEntries(
    Object.entries(f.posicoes).filter(([id]) => id === NO_INICIO || Object.hasOwn(f.blocos, id)),
  );
  return { versao: VERSAO_FLUXO, inicio: f.inicio, blocos: f.blocos as Record<string, BlocoCampanha>, posicoes };
}

/**
 * O fluxo que veio da tela ou da IA, na forma do contrato, ou o que está fora
 * dela, com o bloco a destacar. A forma só: o resto é de conferirFluxo.
 */
export function lerFluxoDaEntrada(bruto: unknown): { ok: true; fluxo: FluxoCampanha } | { ok: false; problemas: ProblemaDoFluxo[] } {
  const r = fluxoEsquema.safeParse(bruto);
  if (r.success) return { ok: true, fluxo: comPosicoesDosBlocos(r.data) };
  const problemas = r.error.issues.slice(0, 20).map((i): ProblemaDoFluxo => {
    const [raiz, bloco, ...campo] = i.path.map(String);
    if (raiz === "blocos" && bloco !== undefined && ehIdDeBloco(bloco))
      return { blocoId: bloco, mensagem: campo.length ? `O campo “${campo.join(".")}” deste bloco está fora do formato.` : "Este bloco está fora do formato." };
    if (raiz === "versao") return { blocoId: null, mensagem: "O fluxo está num formato que o CRM não conhece." };
    return { blocoId: null, mensagem: `O fluxo está fora do formato${raiz ? ` (${i.path.map(String).join(".")})` : ""}.` };
  });
  return { ok: false, problemas };
}

/** A recusa das rotas: o primeiro problema como `erro` e a lista inteira para a tela destacar os blocos. */
export function recusaDoFluxo(problemas: ProblemaDoFluxo[]): Response {
  return Response.json({ erro: problemas[0]?.mensagem ?? "O fluxo tem um problema.", problemas }, { status: 400 });
}

/** O fluxo v2 gravado no banco, pela mesma forma; null quando não confere (o motor registra a falha). */
export function fluxoSalvo(valor: unknown): FluxoCampanha | null {
  const r = fluxoEsquema.safeParse(valor);
  return r.success ? comPosicoesDosBlocos(r.data) : null;
}

// ── Definição gravada ───────────────────────────────────────────────────────
//
// GRAVADA COMO TEXTO (até 2026-10-27): a definição ia como
// `${JSON.stringify(definicao)}::jsonb`, que grava uma STRING JSON. As
// campanhas já ativadas assim continuam com os padrões de propósito: ler a
// string faria campanhas no ar começarem a executar ações que nunca rodaram. O
// RASCUNHO, que nunca rodou, é lido de verdade (definicaoDoRascunho).

/** As colunas da campanha: o template delas vale quando a definição antiga não traz o seu. */
export type Coluna = { template_nome?: string | null; template_idioma?: string | null };

/**
 * A definição como FLUXO. v2 passa pela forma acima (a que não confere vira
 * fluxo vazio, e o motor registra a falha); o formato antigo é convertido por
 * fluxoDoFormatoAntigo, com o template das colunas — inclusive o IDIOMA, que
 * antes caía em pt_BR e recusava campanha antiga de template em outra língua.
 */
export function lerDefinicao(valor: unknown, coluna?: Coluna): FluxoCampanha {
  if (valor && typeof valor === "object" && (valor as { versao?: unknown }).versao === VERSAO_FLUXO) {
    return fluxoSalvo(valor) ?? { versao: VERSAO_FLUXO, inicio: null, blocos: {}, posicoes: {} };
  }
  return fluxoDoFormatoAntigo(definicaoAntiga(valor, coluna));
}

/** A definição de um RASCUNHO: o gravado como string JSON é lido de verdade, porque nunca rodou. */
export function definicaoDoRascunho(valor: unknown, coluna: Coluna): FluxoCampanha {
  let bruto = valor;
  if (typeof valor === "string") {
    try {
      bruto = JSON.parse(valor);
    } catch {
      bruto = {};
    }
  }
  return lerDefinicao(bruto, coluna);
}

/**
 * O fluxo de uma campanha como ela roda (ou rodaria, se rascunho): o que a tela
 * mostra e o que a trava de id compara antes de gravar uma edição.
 */
export function fluxoGravado(c: Coluna & { status: string; definicao: unknown }): FluxoCampanha {
  return c.status === "rascunho" ? definicaoDoRascunho(c.definicao, c) : lerDefinicao(c.definicao, c);
}

/** O formato de antes (template → espera → respondeu/expirou → ações), com os padrões. A IA que grava rascunho ainda escreve nele. */
export function definicaoAntiga(valor: unknown, coluna?: Coluna): Parameters<typeof fluxoDoFormatoAntigo>[0] {
  const bruto = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  // Inteiro: a forma do fluxo (zod) só aceita minuto inteiro.
  const espera = Math.min(43_200, Math.max(5, Math.round(Number(bruto.espera_minutos)) || 1440));
  const texto = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : "");
  return {
    template_nome: texto(bruto.template_nome, 512) || coluna?.template_nome || "",
    template_idioma: texto(bruto.template_idioma, 20) || coluna?.template_idioma || "pt_BR",
    espera_minutos: espera,
    variaveis: lerVariaveis(bruto.variaveis),
    ao_responder: lerAcoes(bruto.ao_responder),
    ao_expirar: lerAcoes(bruto.ao_expirar),
  };
}

function lerVariaveis(valor: unknown): ValoresDoEnvio {
  const v = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  const lista = (x: unknown, maximo: number, tamanho: number) =>
    Array.isArray(x) ? x.slice(0, maximo).map((i) => (typeof i === "string" ? i.slice(0, tamanho) : "")) : [];
  return {
    cabecalho: lista(v.cabecalho, 1, 500),
    corpo: lista(v.corpo, 100, 500),
    // O final do link de cada botão com variável, pela posição do botão.
    ...(Array.isArray(v.botoes) ? { botoes: lista(v.botoes, 10, 100) } : {}),
  };
}

function lerAcoes(valor: unknown): AcaoAntiga[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .flatMap((v): AcaoAntiga[] => {
      if (!v || typeof v !== "object") return [];
      const a = v as Record<string, unknown>;
      if (a.tipo === "registrar_lead") return [{ tipo: "registrar_lead" }];
      if (a.tipo === "adicionar_tag" && typeof a.tagId === "string") return [{ tipo: a.tipo, tagId: a.tagId }];
      if (a.tipo === "adicionar_segmento" && typeof a.segmentoId === "string") return [{ tipo: a.tipo, segmentoId: a.segmentoId }];
      if (a.tipo === "criar_oportunidade" && typeof a.funilId === "string" && typeof a.etapaId === "string") {
        return [{ tipo: a.tipo, funilId: a.funilId, etapaId: a.etapaId, nome: typeof a.nome === "string" ? a.nome.slice(0, 160) : "Oportunidade da campanha" }];
      }
      return [];
    })
    .slice(0, 20);
}

// ── Trava de ids na edição ──────────────────────────────────────────────────

/**
 * Ids que já RODARAM nesta campanha (têm evento de bloco ou de envio) e saíram
 * da definição gravada: aposentados. Reaproveitar um faria o motor achar que o
 * bloco novo já rodou — tentativaAnterior e jaComecou leem esses eventos pelo
 * id — e pular um envio ou uma espera (revisões de 2026-10-28).
 */
export async function idsAposentados(db: typeof sql, campanhaId: string, gravado: FluxoCampanha): Promise<string[]> {
  const linhas = (await db`
    SELECT DISTINCT detalhe->>'bloco' AS bloco FROM campanha_whatsapp_eventos
     WHERE campanha_id = ${campanhaId}::uuid AND tipo IN ('bloco', 'enviando') AND detalhe ? 'bloco'`) as unknown as Array<{ bloco: string | null }>;
  return linhas
    .map((l) => l.bloco)
    .filter((b): b is string => !!b && !Object.hasOwn(gravado.blocos, b))
    .sort();
}

/**
 * O que impede gravar `novo` por cima de `gravado`: bloco que mudou de tipo
 * (blocosQueMudaramDeTipo) e id aposentado reaproveitado. A tela nunca faz
 * nenhum dos dois; quem pode é a IA, que reescreve o fluxo, ou um PUT à mão.
 */
export async function travaDeIds(db: typeof sql, campanhaId: string, gravado: FluxoCampanha, novo: FluxoCampanha): Promise<ProblemaDoFluxo[]> {
  const aposentados = new Set(await idsAposentados(db, campanhaId, gravado));
  return [
    ...blocosQueMudaramDeTipo(gravado, novo),
    ...Object.keys(novo.blocos)
      .filter((id) => aposentados.has(id))
      .map((id) => ({
        blocoId: id,
        mensagem: "Este id já foi de um bloco que rodou nesta campanha e foi apagado: o motor acharia que ele já rodou. Use um id novo.",
      })),
  ];
}

// ── Conferência ─────────────────────────────────────────────────────────────

type QuemConfere = Pick<UsuarioLogado, "modulos" | "permissoes">;

/**
 * Tudo o que impede gravar, ativar ou retomar: permissão de quem pede, o
 * contrato (grafo e mínimo de cada bloco), cada template no estado de HOJE na
 * Meta e o banco. Vazio = pode. Lança só no erro da Meta (a rota responde com
 * respostaErroMeta).
 *
 * `templates`: TODOS os de `wabaId`, já lidos da Meta NESTA requisição por quem
 * chama (a IA do construtor confere a cada desenho e lê a Meta uma vez só).
 * Nunca o que veio do corpo: sem eles, a leitura é feita aqui.
 */
export async function conferirFluxo(e: {
  fluxo: FluxoCampanha;
  wabaId: string;
  usuario: QuemConfere;
  templates?: TemplateWhatsApp[];
}): Promise<ProblemaDoFluxo[]> {
  // Sem a permissão, nem consulta o resto: a resposta já é não.
  const permissao = faltasDePermissao(e.fluxo, e.usuario);
  if (permissao.length) return permissao;
  const templates = e.templates ?? (await templatesMeta(e.wabaId)).map(lerTemplate);
  const aprovados = templates.filter((t) => t.status === "APPROVED");
  return [
    ...problemasDoFluxo(e.fluxo, aprovados.map(templateDoFluxo)),
    ...problemasDosEnvios(e.fluxo, templates),
    ...(await problemasNoBanco(e.fluxo)),
    ...(await problemasDaMidia(e.fluxo, templates)),
  ];
}

/**
 * O arquivo do cabeçalho de mídia de cada "Enviar template" (variaveis.midia,
 * pedido dele em 2026-10-28: "templates aprovados com vídeo e fotos"), contra a
 * linha do banco: existe na biblioteca e serve ao cabeçalho que o template pede
 * (problemaDoArquivoDoCabecalho: não arquivado, tipo, formato e tamanho que a
 * Meta aceita). Arquivo faltando ou sobrando é de problemaNoEnvio; template
 * fora da conta, de problemasDosEnvios.
 */
async function problemasDaMidia(f: FluxoCampanha, templates: TemplateWhatsApp[]): Promise<ProblemaDoFluxo[]> {
  const comMidia = Object.entries(f.blocos).flatMap(([id, b]) =>
    b.tipo === "enviar_template" && b.variaveis.midia ? [{ id, b, midia: b.variaveis.midia }] : [],
  );
  if (!comMidia.length) return [];
  const docs = new Map(
    (
      (await sql`SELECT id, tipo, mime, tamanho::float8 AS tamanho, arquivado FROM documentos
                  WHERE id = ANY(string_to_array(${listaUuid([...new Set(comMidia.map((x) => x.midia).filter(ehUuid))])}, ',')::uuid[])`) as unknown as Array<{
        id: string;
        tipo: string;
        mime: string;
        tamanho: number;
        arquivado: boolean;
      }>
    ).map((d) => [d.id, d]),
  );
  const p: ProblemaDoFluxo[] = [];
  for (const { id, b, midia } of comMidia) {
    const d = docs.get(midia);
    const t = templates.find((x) => x.nome === b.template_nome && x.idioma === b.template_idioma);
    const pede = t ? midiaDoCabecalho(t) : null;
    const m = !d ? "O arquivo do cabeçalho não está mais na biblioteca." : pede ? problemaDoArquivoDoCabecalho(pede, d) : null;
    if (m) p.push({ blocoId: id, mensagem: m });
  }
  return p;
}

/** exigenciasDoFluxo contra quem está salvando: basta uma das opções de cada exigência. */
export function faltasDePermissao(f: FluxoCampanha, usuario: QuemConfere): ProblemaDoFluxo[] {
  return exigenciasDoFluxo(f)
    .filter(
      (ex) =>
        !ex.algumDe.some(
          (o) =>
            (o.operacao ? podeOperar(usuario, o.modulo, o.operacao) : usuario.modulos.has(o.modulo)) &&
            (!o.escopoTodos || usuario.modulos.get(o.modulo) === "todos"),
        ),
    )
    .map((ex) => ({ blocoId: null, mensagem: `Você não tem permissão para ${ex.motivo}: tire esse bloco ou peça a quem tem.` }));
}

/** Os ids escolhidos existem e combinam: só o que está preenchido (o vazio já tem frase no contrato). */
async function problemasNoBanco(f: FluxoCampanha): Promise<ProblemaDoFluxo[]> {
  const blocos = Object.entries(f.blocos);
  const de = <T extends BlocoCampanha["tipo"]>(tipo: T) =>
    blocos.filter((x): x is [string, Extract<BlocoCampanha, { tipo: T }>] => x[1].tipo === tipo);
  const uuids = (lista: string[]) => listaUuid([...new Set(lista.filter(ehUuid))]);

  // As regras das Condições entram nas mesmas consultas dos blocos de ação.
  const regras = de("condicao").map(([, b]) => b.regra);
  const regraDe = <T extends RegraCondicao["tipo"]>(tipo: T) => regras.filter((r): r is Extract<RegraCondicao, { tipo: T }> => r.tipo === tipo);
  const tags = [...de("mudar_tag").map(([, b]) => b.tagId), ...regraDe("tem_tag").map((r) => r.tagId)];
  const segmentos = [...de("mudar_segmento").map(([, b]) => b.segmentoId), ...regraDe("no_segmento").map((r) => r.segmentoId)];
  const naOportunidade = [...de("criar_oportunidade").map(([, b]) => b), ...de("mover_oportunidade").map(([, b]) => b), ...regraDe("na_etapa")];
  const avisos = de("avisar_equipe");
  const funis = [...naOportunidade.map((b) => b.funilId), ...avisos.flatMap(([, b]) => (b.responsavelDoFunil ? [b.responsavelDoFunil] : []))];
  const usuarios = avisos.flatMap(([, b]) => b.usuarioIds);
  const ias = de("ligar_ia").map(([, b]) => b.iaId);
  const documentos = de("enviar_arquivo").map(([, b]) => b.documentoId);
  const campos = regraDe("campo").length > 0;

  const ids = (linhas: Array<{ id: string }>) => new Set(linhas.map((l) => l.id));
  const vazio = Promise.resolve([] as Array<{ id: string; funil_id?: string }>);
  const [achadasTags, achadosSegmentos, achadosFunis, etapas, ativos, achadasIas, instancias, achadosDocumentos, chaves] = await Promise.all([
    tags.length ? sql`SELECT id FROM tags WHERE id = ANY(string_to_array(${uuids(tags)}, ',')::uuid[])` : vazio,
    segmentos.length ? sql`SELECT id FROM segmentos WHERE id = ANY(string_to_array(${uuids(segmentos)}, ',')::uuid[])` : vazio,
    funis.length ? sql`SELECT id FROM funis WHERE id = ANY(string_to_array(${uuids(funis)}, ',')::uuid[])` : vazio,
    naOportunidade.length
      ? sql`SELECT id, funil_id FROM etapas WHERE id = ANY(string_to_array(${uuids(naOportunidade.map((b) => b.etapaId))}, ',')::uuid[])`
      : vazio,
    usuarios.length ? sql`SELECT id FROM usuarios WHERE ativo AND id = ANY(string_to_array(${uuids(usuarios)}, ',')::uuid[])` : vazio,
    ias.length ? sql`SELECT id FROM ias WHERE id = ANY(string_to_array(${uuids(ias)}, ',')::uuid[])` : vazio,
    avisos.length ? instanciasParaAviso() : Promise.resolve([]),
    documentos.length
      ? sql`SELECT id, tipo, mime, tamanho::float8 AS tamanho, arquivado FROM documentos WHERE id = ANY(string_to_array(${uuids(documentos)}, ',')::uuid[])`
      : Promise.resolve([]),
    campos ? sql`SELECT chave FROM campos_personalizados WHERE entidade = 'contato'` : Promise.resolve([]),
  ]);
  const setTags = ids(achadasTags);
  const setSegmentos = ids(achadosSegmentos);
  const setFunis = ids(achadosFunis);
  const funilDaEtapa = new Map((etapas as Array<{ id: string; funil_id: string }>).map((e) => [e.id, e.funil_id]));
  const setAtivos = ids(ativos);
  const setIas = ids(achadasIas);
  const setInstancias = new Set(instancias.map((i) => i.id));
  const docs = new Map(
    (achadosDocumentos as unknown as Array<{ id: string; tipo: string; mime: string; tamanho: number; arquivado: boolean }>).map((d) => [d.id, d]),
  );
  const setChaves = new Set((chaves as unknown as Array<{ chave: string }>).map((c) => c.chave));
  const funilEEtapa = (b: { funilId: string; etapaId: string }): string | null => {
    if (!b.funilId || !b.etapaId) return null;
    if (!setFunis.has(b.funilId)) return "Esse funil não existe mais.";
    return funilDaEtapa.get(b.etapaId) === b.funilId ? null : "A etapa não é deste funil.";
  };
  const regraNoBanco = (r: RegraCondicao): string | null => {
    switch (r.tipo) {
      case "tem_tag":
        return r.tagId && !setTags.has(r.tagId) ? "A tag da condição não existe mais." : null;
      case "no_segmento":
        return r.segmentoId && !setSegmentos.has(r.segmentoId) ? "O segmento da condição não existe mais." : null;
      case "na_etapa":
        return funilEEtapa(r);
      case "campo":
        return r.chave && !setChaves.has(r.chave) ? "Esse campo não é um campo personalizado do contato." : null;
    }
  };

  const p: ProblemaDoFluxo[] = [];
  for (const [id, b] of blocos) {
    const m = ((): string | null => {
      switch (b.tipo) {
        case "mudar_tag":
          return b.tagId && !setTags.has(b.tagId) ? "Essa tag não existe mais." : null;
        case "mudar_segmento":
          return b.segmentoId && !setSegmentos.has(b.segmentoId) ? "Esse segmento não existe mais." : null;
        case "criar_oportunidade":
        case "mover_oportunidade":
          return funilEEtapa(b);
        case "condicao":
          return regraNoBanco(b.regra);
        case "enviar_arquivo": {
          if (!b.documentoId) return null;
          const d = docs.get(b.documentoId);
          if (!d) return "Esse arquivo não está mais na biblioteca.";
          if (d.arquivado) return "Esse arquivo foi arquivado na biblioteca.";
          return problemaDoArquivoDaCampanha(d);
        }
        case "avisar_equipe":
          if (b.instanciaId && !setInstancias.has(b.instanciaId))
            return "Esse número não manda aviso (removido, sem WhatsApp pareado ou compartilhado com o SprintHub).";
          if (b.usuarioIds.some((u) => !setAtivos.has(u))) return "Alguém escolhido para o aviso não está mais ativo.";
          return b.responsavelDoFunil && !setFunis.has(b.responsavelDoFunil) ? "O funil do responsável não existe mais." : null;
        case "ligar_ia":
          return b.iaId && !setIas.has(b.iaId) ? "Essa IA não existe mais." : null;
        default:
          return null;
      }
    })();
    if (m) p.push({ blocoId: id, mensagem: m });
  }
  return p;
}
