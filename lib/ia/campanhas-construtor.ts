// A IA que MONTA A CAMPANHA NO CONSTRUTOR em blocos (pedido dele, 2026-10-28:
// "deve ser possível montar com ia, onde falo o nome do template e a ia monta
// como quero, via chat mesmo"). Conversa ao lado do canvas de
// app/campanhas/fluxo/editor-campanha.tsx e devolve o fluxo INTEIRO, que a tela
// põe no lugar do canvas (EVENTO_DESENHO e DesenhoDaIa, lib/campanhas-fluxo.ts).
// Quem chama é app/api/ia/campanhas/route.ts, no modo `construtor`.
//
// NENHUMA FERRAMENTA DAQUI GRAVA. O desenho só vive no navegador; o que tem
// efeito real é o clique da pessoa em Salvar (PUT da campanha) ou em Ativar e
// Retomar, e essas rotas conferem tudo de novo, com a autoridade de quem clicou:
// forma, permissão, templates no estado de hoje na Meta, banco
// (lib/campanhas-fluxo-entrada.ts) e a trava de id (salvarEdicao). Por isso
// esta IA pode usar TODOS os blocos — texto livre, avisar a equipe, ligar IA,
// mover oportunidade —, e a IA que grava rascunho (lib/ia/campanhas.ts) não: lá
// o fluxo vai para o banco sem ninguém ter olhado o canvas, e a decisão de
// 2026-10-27 ("esses blocos só pela tela, com uma pessoa olhando") continua
// valendo para ela. Aqui a pessoa olha o canvas antes de qualquer clique.
//
// O CONJUNTO É FECHADO: listar_alvos_campanha, ver_fluxo_aberto e
// desenhar_fluxo. Nada de tags e segmentos, de listar campanhas, de criar
// rascunho nem das ferramentas do modo completo do TI (a rota desvia antes dele).
//
// REVISÃO DE SEGURANÇA DO DESENHO (2026-10-28), o que mora aqui:
//   · o fluxo aberto entra no modelo SÓ por ver_fluxo_aberto (nunca no system
//     nem no contexto), com o texto livre embrulhado por comoDado: numa campanha
//     pausada ou rascunho ele pode ter sido escrito por um colega;
//   · link, telefone ou e-mail no que sai para o contato ou para a equipe só
//     passa se a PESSOA escreveu o mesmo trecho (nas falas dela ou no fluxo
//     aberto); senão o desenho NÃO vai para o canvas (contatosNaoEscritos, no
//     arquivo do formato; revisão M1);
//   · id que já rodou na campanha salva não muda de tipo nem volta depois de
//     aposentado (travaDeIds): o motor guarda o estado de cada contato pelo id.
//     Também impede o desenho. As outras conferências viram pendência
//     devolvida ao modelo, e o desenho vai assim mesmo;
//   · o que tem consequência (público, aviso, IA e, por consequenciasDoFluxo,
//     cadência, evento da Meta e outra campanha) volta num eco de frases fixas
//     para o modelo repetir à pessoa;
//   · o contexto da tela é montado no servidor (contextoDoConstrutor; M2);
//   · teto de desenhos por resposta, e a Meta e as opções lidas uma vez. As
//     opções são as mesmas da tela (lerOpcoesDaCampanha).
//
// O formato em que o modelo lê e escreve o fluxo (blocos em lista, snake_case)
// e a regra de link, telefone e e-mail moram em ./campanhas-construtor-formato.ts.
// Aqui: o pedido da rota, as leituras, o eco, as ferramentas e o system.
import "server-only";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { UsuarioLogado } from "@/lib/auth/dal";
import { listaUuid, sql } from "@/lib/db";
import { templatesMeta } from "@/lib/meta";
import { lerOpcoesDaCampanha } from "@/lib/campanhas-opcoes";
import { conferirFluxo, fluxoGravado, idsAposentados, lerFluxoDaEntrada, travaDeIds } from "@/lib/campanhas-fluxo-entrada";
import { consequenciasDoFluxo, LIMITE_AVISO } from "@/lib/campanhas-fluxo-envios";
import {
  CATALOGO_CAMPANHA,
  LIMITES_FLUXO,
  type ContextoDasConsequencias,
  type DesenhoDaIa,
  type FluxoCampanha,
  type OpcoesDaCampanha,
  type ProblemaDoFluxo,
  type TipoBloco,
} from "@/lib/campanhas-fluxo";
import {
  DADOS_NA_CAMPANHA,
  LIMITE,
  lerTemplate,
  linksVariaveisDe,
  midiaDoCabecalho,
  motivoSemEnvio,
  respostasRapidasDe,
  variaveisDoTemplate,
  type TemplateWhatsApp,
} from "@/lib/templates-whatsapp";
import { ehUuid } from "@/lib/validacao";
import {
  blocoParaIa,
  contatosNaoEscritos,
  entradaDoDesenho,
  fluxoDoDesenho,
  semMarcas,
  textosQueSaem,
  type FluxoAberto,
} from "./campanhas-construtor-formato";
import { comoDado, REGRA_DADO_NAO_CONFIAVEL } from "./sanitizar";

/** desenhar_fluxo por resposta: depois disso a ferramenta só manda parar. */
export const TETO_DESENHOS = 6;
/** Idas ao modelo por resposta (lib/ia/conversa.ts): leituras, os desenhos e a resposta final. */
export const ITERACOES_DO_CONSTRUTOR = 10;
/** O corpo do POST, em caracteres: pergunta, histórico e o fluxo aberto. */
export const TETO_CORPO = 200_000;
/** O fluxo aberto, reserializado depois da leitura da forma. */
export const TETO_FLUXO = 50_000;

// ── O pedido ────────────────────────────────────────────────────────────────

export type PedidoDoConstrutor = { waba: string; campanhaId: string | null; fluxoAberto: FluxoAberto };

/**
 * Os campos do modo construtor, conferidos (todos chegam como string). Recusa
 * o corpo e o fluxo grandes demais em vez de cortar: cortado, o modelo veria um
 * fluxo que não é o da tela e o redesenharia sem o pedaço. Fluxo fora da forma
 * NÃO é recusa: vai como problemas para ver_fluxo_aberto, que avisa o modelo em
 * vez de deixá-lo achar que o canvas está vazio.
 */
export function lerPedidoDoConstrutor(
  corpo: Record<string, unknown>,
  tamanho: number,
): { ok: true; pedido: PedidoDoConstrutor } | { ok: false; erro: string; status: number } {
  const recusa = (erro: string, status = 400) => ({ ok: false as const, erro, status });
  if (tamanho > TETO_CORPO) return recusa("A conversa ficou grande demais para a IA. Comece uma conversa nova.", 413);
  const campanha = typeof corpo.campanha === "string" ? corpo.campanha.trim() : "";
  if (campanha && !ehUuid(campanha)) return recusa("Campanha inválida.");
  const waba = typeof corpo.waba === "string" ? corpo.waba.trim() : "";
  if (!/^\d{1,30}$/.test(waba)) return recusa("Escolha a conta do WhatsApp da campanha.");
  if (typeof corpo.fluxo !== "string") return recusa("O fluxo aberto não veio junto da pergunta.");
  let bruto: unknown;
  try {
    bruto = JSON.parse(corpo.fluxo);
  } catch {
    return recusa("O fluxo aberto não veio num formato que o CRM lê.");
  }
  // Posição é só desenho: a IA não usa, e a tela reorganiza o que voltar.
  const fluxoAberto = lerFluxoDaEntrada(bruto && typeof bruto === "object" && !Array.isArray(bruto) ? { ...bruto, posicoes: {} } : bruto);
  if (fluxoAberto.ok) {
    const blocos = Object.values(fluxoAberto.fluxo.blocos);
    if (blocos.length > LIMITES_FLUXO.blocos)
      return recusa(`O fluxo aberto passa de ${LIMITES_FLUXO.blocos} blocos. Tire os que sobram antes de pedir à IA.`);
    if (
      blocos.some(
        (b) =>
          ((b.tipo === "enviar_texto" || b.tipo === "avisar_equipe") && b.texto.length > LIMITES_FLUXO.texto) ||
          (b.tipo === "enviar_arquivo" && b.legenda.length > LIMITES_FLUXO.texto),
      )
    )
      return recusa(`Um texto do fluxo aberto passa de ${LIMITES_FLUXO.texto} caracteres. Encurte antes de pedir à IA.`);
    if (JSON.stringify(fluxoAberto.fluxo).length > TETO_FLUXO)
      return recusa("O fluxo aberto é grande demais para a IA. Divida a campanha ou encurte os textos.");
  }
  return { ok: true, pedido: { waba, campanhaId: campanha || null, fluxoAberto } };
}

/** O que a PESSOA escreveu: a pergunta de agora e os turnos dela no histórico (o que o modelo vê). */
export function falasDaPessoa(pergunta: string, historico: Array<{ role: string; content: unknown }>): string[] {
  return [pergunta, ...historico.flatMap((m) => (m.role === "user" && typeof m.content === "string" ? [m.content] : []))];
}

// ── Leituras ────────────────────────────────────────────────────────────────

type Nomeado = { id: string; nome: string };
const embrulhados = (lista: Nomeado[]) => lista.map((x) => ({ id: x.id, nome: comoDado(x.nome) }));
const nomes = (lista: Nomeado[]) => new Map(lista.map((x) => [x.id, comoDado(x.nome)]));
const uuids = (lista: string[]) => listaUuid([...new Set(lista.filter(ehUuid))]);

/**
 * O que a IA pode escolher: as opções da tela (lerOpcoesDaCampanha, a mesma
 * leitura) e os templates APROVADOS da conta. Só id e nome de gente, IA e
 * número (nunca WhatsApp, prompt ou token); texto livre embrulhado.
 */
function textoDosAlvos(opcoes: OpcoesDaCampanha, aprovados: TemplateWhatsApp[]): string {
  const posicao = new Map<string, number>();
  return JSON.stringify({
    segmentos: opcoes.segmentos.map((s) => ({ id: s.id, nome: comoDado(s.nome), contatos_com_whatsapp: s.contatos })),
    tags: embrulhados(opcoes.tags),
    funis: embrulhados(opcoes.funis),
    // Já vêm na ordem do funil: `ordem` é a posição da etapa dentro dele.
    etapas: opcoes.etapas.map((e) => {
      const ordem = (posicao.get(e.funil_id) ?? 0) + 1;
      posicao.set(e.funil_id, ordem);
      return { id: e.id, nome: comoDado(e.nome), funil_id: e.funil_id, ordem };
    }),
    // O texto e os botões: sem eles o modelo não sabe o que vai em cada {{n}}
    // nem quais saídas o "Aguardar resposta" tem.
    templates: aprovados.map((t) => {
      const motivo = motivoSemEnvio(t);
      return {
        nome: t.nome,
        idioma: t.idioma,
        categoria: t.categoria,
        ...(motivo ? { nao_envia_pelo_crm: comoDado(motivo) } : {}),
        cabecalho: t.cabecalho?.texto ? comoDado(t.cabecalho.texto) : null,
        corpo: comoDado(t.corpo),
        rodape: t.rodape ? comoDado(t.rodape) : null,
        respostas_rapidas: respostasRapidasDe(t).map((r) => comoDado(r)),
        links_com_variavel: linksVariaveisDe(t).map((l) => ({ indice: l.indice, texto: comoDado(l.texto), url: comoDado(l.url) })),
        variaveis: variaveisDoTemplate(t),
        // O arquivo que o cabeçalho pede ("imagem", "video" ou "documento"), que vai em variaveis.midia; null = nenhum.
        midia: midiaDoCabecalho(t),
      };
    }),
    equipe: embrulhados(opcoes.usuarios),
    ias: embrulhados(opcoes.ias),
    numeros_de_aviso: embrulhados(opcoes.instancias),
    // O "Enviar arquivo" e a "Condição" por campo: só id, nome e tipo do
    // arquivo (nunca o caminho), e a chave e o rótulo do campo.
    documentos: opcoes.documentos.map((d) => ({ id: d.id, nome: comoDado(d.nome), tipo: d.tipo })),
    campos_contato: opcoes.camposContato.map((c) => ({ chave: c.chave, rotulo: comoDado(c.rotulo) })),
  });
}

/**
 * O que ver_fluxo_aberto devolve. Fora da forma: os problemas, nunca "vazio"
 * (com vazio o modelo redesenharia do zero e apagaria o trabalho da pessoa).
 * Campanha salva: também os ids aposentados, que não podem voltar.
 */
function textoDoFluxoAberto(aberto: FluxoAberto, campanhaId: string | null, aposentados: string[]): string {
  const campanha = campanhaId
    ? "existente (pausada ou rascunho): os ids dos blocos que já existem são fixos, os aposentados não voltam, e o público não muda por aqui"
    : "nova";
  const extra = campanhaId ? { ids_aposentados: aposentados } : {};
  if (!aberto.ok) {
    return JSON.stringify({
      campanha,
      fora_do_formato: true,
      aviso: "O fluxo aberto está fora do formato que o CRM lê. Não é um canvas vazio: diga à pessoa e pergunte antes de desenhar do zero.",
      problemas: aberto.problemas.map((p) => ({ bloco: p.blocoId, problema: comoDado(p.mensagem) })),
      ...extra,
    });
  }
  const f = aberto.fluxo;
  return JSON.stringify({ campanha, inicio: f.inicio, blocos: Object.entries(f.blocos).map(([id, b]) => blocoParaIa(id, b)), ...extra });
}

/** A campanha em edição como está gravada: só pausada ou rascunho (as outras não se editam). */
async function campanhaEmEdicao(id: string): Promise<{ waba: string; fluxo: FluxoCampanha } | null> {
  const [c] = (await sql`
    SELECT status, waba_id, definicao, template_nome, template_idioma FROM campanhas_whatsapp
     WHERE id = ${id}::uuid AND status IN ('pausada', 'rascunho')`) as unknown as Array<{
    status: string;
    waba_id: string;
    definicao: unknown;
    template_nome: string | null;
    template_idioma: string | null;
  }>;
  return c ? { waba: c.waba_id, fluxo: fluxoGravado(c) } : null;
}

async function segmentosDoPublico(ids: string[]): Promise<{ achados: Nomeado[]; faltou: boolean }> {
  const pedidos = [...new Set(ids.map((i) => i.trim()))].slice(0, 50);
  const validos = pedidos.filter(ehUuid);
  const achados = validos.length
    ? ((await sql`SELECT id, nome FROM segmentos WHERE id = ANY(string_to_array(${uuids(validos)}, ',')::uuid[]) ORDER BY nome`) as unknown as Nomeado[])
    : [];
  return { achados, faltou: achados.length < pedidos.length };
}

// ── O eco do que tem consequência ───────────────────────────────────────────

/**
 * Frases fixas sobre o que o fluxo faz fora da conversa com o contato, para o
 * modelo repetir à pessoa. Os nomes vêm do banco (embrulhados), nunca do que o
 * modelo escreveu: é o que a pessoa vai conferir. O que acontece fora do bloco
 * (cadência, evento da Meta, outra campanha) é consequenciasDoFluxo, a mesma
 * lista que o modal de ativação mostra.
 */
async function ecoDoDesenho(f: FluxoCampanha, publico: Nomeado[] | null, campanhaId: string | null, opcoes: OpcoesDaCampanha): Promise<string[]> {
  const linhas: string[] = [];
  if (!campanhaId) {
    if (publico?.length) {
      const [r] = await sql`
        SELECT count(DISTINCT c.id)::int AS n FROM contatos c JOIN contato_segmentos cs ON cs.contato_id = c.id
         WHERE cs.segmento_id = ANY(string_to_array(${uuids(publico.map((s) => s.id))}, ',')::uuid[]) AND c.whatsapp IS NOT NULL`;
      linhas.push(
        `Público: ${publico.map((s) => comoDado(s.nome)).join(", ")} — ${(r?.n as number) ?? 0} contato(s) com WhatsApp hoje, todos inscritos ao ativar; quem entrar nesses segmentos depois também, enquanto a campanha estiver ativa.`,
      );
    } else linhas.push("Público: nenhum segmento escolhido por você; vale o que está escolhido na tela.");
  }
  const pessoas = nomes(opcoes.usuarios);
  const funis = nomes(opcoes.funis);
  const numeros = nomes(opcoes.instancias);
  const ias = nomes(opcoes.ias);
  for (const [id, b] of Object.entries(f.blocos)) {
    if (b.tipo === "avisar_equipe") {
      const quem = [
        ...b.usuarioIds.map((u) => pessoas.get(u) ?? "(alguém que não está ativo na equipe)"),
        ...(b.responsavelDoFunil ? [`o responsável da oportunidade aberta no funil ${funis.get(b.responsavelDoFunil) ?? "(funil não encontrado)"}`] : []),
      ];
      linhas.push(
        `Aviso à equipe (bloco ${id}): ${quem.join(", ") || "ninguém"} recebe(m) no WhatsApp, pelo número ${numeros.get(b.instanciaId) ?? "(número que não manda aviso)"}, o texto do bloco com o nome do contato e o link da conversa, agrupado a cada rodada.`,
      );
    }
    if (b.tipo === "ligar_ia")
      linhas.push(`Passa para a IA (bloco ${id}): ${ias.get(b.iaId) ?? "(IA não encontrada)"} passa a responder o contato no WhatsApp daqui em diante.`);
  }
  const consequencias: ContextoDasConsequencias = {
    etapasComCadencia: embrulhados(opcoes.consequencias.etapasComCadencia),
    etapasComEventoMeta: embrulhados(opcoes.consequencias.etapasComEventoMeta),
    segmentosEmCampanha: opcoes.consequencias.segmentosEmCampanha.map((s) => ({ segmentoId: s.segmentoId, campanha: comoDado(s.campanha) })),
  };
  for (const c of consequenciasDoFluxo(f, consequencias)) linhas.push(`Fora do bloco (bloco ${c.blocoId}): ${c.texto}`);
  if (linhas.length === (campanhaId ? 0 : 1))
    linhas.push("Fora o público e os envios: sem aviso à equipe, sem IA, sem cadência, sem evento da Meta e sem inscrição em outra campanha.");
  return linhas;
}

const linhaDoProblema = (p: ProblemaDoFluxo) => `- ${p.blocoId ? `[bloco ${p.blocoId}] ` : ""}${p.mensagem}`;
const semRepetir = (p: ProblemaDoFluxo[]) => [...new Map(p.map((x) => [`${x.blocoId}|${x.mensagem}`, x])).values()];

// ── As ferramentas ──────────────────────────────────────────────────────────

/**
 * As três ferramentas do construtor, para UMA resposta. `usuario` é quem está
 * conversando, lido pela rota antes do stream: aqui dentro nada pede sessão ou
 * cookie (o `run` roda depois que a rota já respondeu). `desenho()` é o último
 * desenho que passou nas travas, que a rota manda à tela no fim.
 */
export function ferramentasDoConstrutor(o: {
  usuario: UsuarioLogado;
  waba: string;
  campanhaId: string | null;
  falasDaPessoa: string[];
  fluxoAberto: FluxoAberto;
}) {
  let desenho: DesenhoDaIa | null = null;
  let desenhos = 0;

  // Uma leitura por resposta, e a falha não fica guardada (a próxima tenta de
  // novo): os templates da conta na Meta (todos, para a conferência separar
  // "não está na conta" de "não aprovado") e as opções do banco.
  const umaVez = <T>(ler: () => Promise<T>) => {
    let lido: Promise<T> | null = null;
    return () =>
      (lido ??= ler().catch((e: unknown) => {
        lido = null;
        throw e;
      }));
  };
  const templates = umaVez(async () => (await templatesMeta(o.waba)).map(lerTemplate));
  const opcoes = umaVez(() => lerOpcoesDaCampanha(o.campanhaId ?? undefined));

  // O que a pessoa escreveu, ou já estava no canvas dela: de onde link,
  // telefone e e-mail podem vir.
  const escritos = [...o.falasDaPessoa, ...(o.fluxoAberto.ok ? Object.values(o.fluxoAberto.fluxo.blocos).flatMap(textosQueSaem) : [])];

  const listarAlvos = betaZodTool({
    name: "listar_alvos_campanha",
    description:
      "Lista segmentos (com quantos contatos têm WhatsApp), tags, funis, etapas, os templates aprovados da conta desta campanha (texto, respostas rápidas, links com variável e quantas variáveis pedem), a equipe, as IAs, os números que mandam aviso, os arquivos da biblioteca (documentos) e os campos do contato (campos_contato). Chame antes de desenhar; use só ids daqui.",
    inputSchema: z.object({}),
    run: async () => {
      const [lidas, todos] = await Promise.all([opcoes(), templates()]);
      return textoDosAlvos(lidas, todos.filter((t) => t.status === "APPROVED"));
    },
  });

  const verFluxo = betaZodTool({
    name: "ver_fluxo_aberto",
    description:
      "O fluxo que está no canvas agora, no mesmo formato que desenhar_fluxo recebe; se a campanha é nova ou já salva, e na salva os ids aposentados (que não podem voltar). Chame antes de qualquer ajuste: desenhar_fluxo substitui o canvas inteiro.",
    inputSchema: z.object({}),
    run: async () => {
      const salva = o.campanhaId ? await campanhaEmEdicao(o.campanhaId) : null;
      const aposentados = o.campanhaId && salva ? await idsAposentados(sql, o.campanhaId, salva.fluxo) : [];
      return textoDoFluxoAberto(o.fluxoAberto, o.campanhaId, aposentados);
    },
  });

  const desenhar = betaZodTool({
    name: "desenhar_fluxo",
    description:
      "Põe o fluxo INTEIRO no canvas da pessoa, no lugar do que estava. Não salva nem envia nada. Devolve as pendências (corrija ou pergunte) e o que tem consequência (repita à pessoa).",
    inputSchema: entradaDoDesenho,
    run: async (entrada) => {
      if (++desenhos > TETO_DESENHOS)
        return `LIMITE: já foram ${TETO_DESENHOS} desenhos nesta resposta. Não chame desenhar_fluxo de novo: diga à pessoa o que ficou no canvas e o que falta, e espere a próxima mensagem dela.`;

      const lido = fluxoDoDesenho(entrada);
      if (!lido.ok) return `NÃO DESENHADO: o fluxo está fora do formato.\n${lido.problemas.map(linhaDoProblema).join("\n")}\nCorrija e chame de novo.`;
      const fluxo = lido.fluxo;
      if (!Object.keys(fluxo.blocos).length) return "NÃO DESENHADO: o fluxo não tem nenhum bloco, e apagaria o canvas da pessoa. Desenhe os blocos.";

      if (o.campanhaId) {
        const salva = await campanhaEmEdicao(o.campanhaId);
        if (!salva) return "RECUSADO: esta campanha não está mais pausada nem em rascunho, e não se edita assim. Diga à pessoa para recarregar a tela.";
        if (salva.waba !== o.waba) return "RECUSADO: o editor está numa conta do WhatsApp diferente da campanha. Diga à pessoa para recarregar a tela.";
        const travados = await travaDeIds(sql, o.campanhaId, salva.fluxo, fluxo);
        if (travados.length)
          return `NÃO DESENHADO: id que já rodou nesta campanha não muda de tipo nem volta depois de apagado (quem está nele faria a coisa errada).\n${travados.map(linhaDoProblema).join("\n")}\nMantenha o tipo desses ids, ou use um id NOVO para o bloco novo, e chame de novo.`;
      }

      // Link, telefone ou e-mail que a pessoa não deu não vai para o canvas
      // (revisão de segurança M1, 2026-10-28): o modelo tira ou pergunta.
      const inventados = contatosNaoEscritos(fluxo, escritos);
      if (inventados.length)
        return `NÃO DESENHADO: o texto leva link, telefone ou e-mail que a pessoa não escreveu nesta conversa (nem estava no fluxo aberto).\n${inventados.map(linhaDoProblema).join("\n")}\nTire esses trechos, ou pergunte à pessoa qual vai, e chame de novo.`;

      const pendencias: ProblemaDoFluxo[] = [];
      let publico: Nomeado[] | null = null;
      if (entrada.segmento_ids?.length) {
        if (o.campanhaId) pendencias.push({ blocoId: null, mensagem: "Numa campanha já salva o público não muda por aqui: os segmentos foram ignorados." });
        else {
          const r = await segmentosDoPublico(entrada.segmento_ids);
          if (r.faltou) pendencias.push({ blocoId: null, mensagem: "Um dos segmentos não existe: use os ids de listar_alvos_campanha." });
          publico = r.achados.length ? r.achados : null;
        }
      }
      try {
        pendencias.push(...(await conferirFluxo({ fluxo, wabaId: o.waba, usuario: o.usuario, templates: await templates() })));
      } catch (e) {
        console.error("[ia construtor] não conferiu o desenho:", e);
        throw e;
      }
      const eco = await ecoDoDesenho(fluxo, publico, o.campanhaId, await opcoes());

      const nome = semMarcas(entrada.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      desenho = { fluxo, nome: nome || null, segmentoIds: publico ? publico.map((s) => s.id) : null, campanhaId: o.campanhaId };

      const lista = semRepetir(pendencias);
      return [
        `DESENHADO: o fluxo inteiro (${Object.keys(fluxo.blocos).length} bloco(s)) está no canvas da pessoa, no lugar do que havia. Nada foi salvo nem enviado.`,
        "",
        lista.length
          ? "PENDÊNCIAS (corrija com outro desenhar_fluxo, ou pergunte à pessoa; as que ficarem, diga a ela):"
          : "PENDÊNCIAS: nenhuma agora (o CRM confere de novo ao salvar e ao ativar).",
        ...lista.map(linhaDoProblema),
        "",
        "O QUE TEM CONSEQUÊNCIA (repita à pessoa no resumo final):",
        ...eco.map((l) => `- ${l}`),
      ].join("\n");
    },
  });

  return { ferramentas: [listarAlvos, verFluxo, desenhar], desenho: () => desenho };
}

/** O contexto da tela, montado AQUI (revisão de segurança M2): o que o navegador manda em `contexto` não entra no modo construtor. */
export function contextoDoConstrutor(campanhaId: string | null): string {
  return campanhaId ? "construtor de campanha em blocos; editando uma campanha já salva" : "construtor de campanha em blocos; campanha nova";
}

// ── O system ────────────────────────────────────────────────────────────────

const MARCAS_DO_CONTATO = DADOS_NA_CAMPANHA.map((d) => `{{${d.chave}}} (${d.rotulo.toLowerCase()})`).join(", ");
const CATALOGO_EM_TEXTO = (Object.keys(CATALOGO_CAMPANHA) as TipoBloco[])
  .map((t) => `- ${t} — ${CATALOGO_CAMPANHA[t].rotulo}: ${CATALOGO_CAMPANHA[t].descricao}`)
  .join("\n");

// Estável de propósito (é o prefixo que o cache aproveita): nada de id, data
// ou dado da campanha aqui. O fluxo aberto entra só por ver_fluxo_aberto.
export const SISTEMA_CONSTRUTOR = `Você monta CAMPANHAS DE WHATSAPP OFICIAL no construtor em blocos do AmaanOffice, um CRM, conversando com quem está com o editor da campanha aberto. Responda sempre em português do Brasil.

O QUE VOCÊ FAZ
- Você desenha o fluxo INTEIRO com desenhar_fluxo, e ele aparece no canvas da pessoa no lugar do que estava lá. Você não salva, não ativa e não envia nada: salvar e ativar são cliques da pessoa, depois de revisar o canvas, e o CRM confere tudo de novo nessa hora.
- A pessoa costuma dizer o nome do template e o que quer que aconteça. Monte do jeito que ela pediu.

COMO TRABALHAR
- Chame listar_alvos_campanha antes de desenhar. Use SOMENTE ids, nomes de template e textos de botão que ela devolveu; nunca invente.
- Quando a pessoa pedir um ajuste, ou se o canvas pode já ter blocos, comece por ver_fluxo_aberto. desenhar_fluxo substitui o canvas inteiro: mande TODOS os blocos, inclusive os que não mudaram. Se ver_fluxo_aberto disser que o fluxo está fora do formato, conte à pessoa e pergunte antes de desenhar do zero.
- Campanha já salva (ver_fluxo_aberto diz "existente"): os ids dos blocos que já existem são fixos. Bloco que continua mantém o id e o tipo; bloco novo ganha um id novo, nunca o de um bloco que saiu nem o de outro tipo, nem um dos ids_aposentados que ver_fluxo_aberto lista. O público dela não muda por aqui: não mande segmento_ids.
- Ids de bloco curtos e descritivos: minúsculas, números, _ ou - ("convite", "aguarda1", "aviso_vendas").
- Segmentos, quem recebe aviso, o número que manda o aviso, a IA e o arquivo: só os que a pessoa nomeou. Se ela não disse, ou se o nome bate com mais de um, PERGUNTE antes de desenhar. O mesmo para o que vai numa variável do template.
- desenhar_fluxo devolve PENDÊNCIAS e O QUE TEM CONSEQUÊNCIA. Corrija o que puder com outro desenhar_fluxo; o que depende da pessoa, pergunte. Se ele responder NÃO DESENHADO ou RECUSADO, nada foi para o canvas.

BLOCOS (o "tipo" de cada um)
${CATALOGO_EM_TEXTO}

REGRAS DO FLUXO
- "inicio" é o id do primeiro bloco. Todo bloco precisa ser alcançável a partir dele. Até ${LIMITES_FLUXO.blocos} blocos.
- Sem laço: nenhum caminho volta a um bloco anterior. "Reenviar até responder" se monta EM SEQUÊNCIA: template → aguardar → sem resposta → esperar → template → aguardar…
- "aguardar_resposta" vem depois de um "enviar_template". Em "botoes", uma saída por resposta rápida do ÚLTIMO template enviado antes dele, com o texto EXATO do botão; "palavras" pega resposta escrita que contém o texto; "outra" é qualquer outra resposta; "sem_resposta" é o prazo vencido. Prazo de ${LIMITES_FLUXO.prazoMinimo} a ${LIMITES_FLUXO.prazoMaximo} minutos (1 dia = 1440); se a pessoa não disser, use 1440.
- "esperar": de ${LIMITES_FLUXO.prazoMinimo} a ${LIMITES_FLUXO.prazoMaximo} minutos.
- "enviar_texto" só depois de uma resposta do contato (saída de botão, de palavra ou "outra" de um aguardar_resposta): a Meta só aceita texto livre com a janela de 24 horas aberta. Fora disso, use um template. Até ${LIMITES_FLUXO.texto} caracteres; as únicas marcas que funcionam no texto são ${DADOS_NA_CAMPANHA.map((d) => `{{${d.chave}}}`).join(", ")}.
- Variáveis do template: preencha exatamente as {{n}} que ele pede ("variaveis" em listar_alvos_campanha), na ordem, cada uma com um dado do contato — ${MARCAS_DO_CONTATO} — ou com um texto fixo curto (até ${LIMITE.valorFixo} caracteres). E-mail e telefone do contato não vão em campanha. Link com variável: em variaveis.botoes, na posição "indice" do botão, o final do link. Template cujo "midia" em listar_alvos_campanha não é null (cabeçalho de imagem, vídeo ou documento): variaveis.midia com o id de um arquivo de "documentos" do mesmo tipo (documento = pdf), só o que a pessoa nomeou; no ajuste, mantenha o que veio em ver_fluxo_aberto.
- "avisar_equipe": instancia_id de numeros_de_aviso; usuario_ids da equipe e/ou responsavel_do_funil (o id do funil cujo responsável da oportunidade aberta recebe). Texto curto, até ${LIMITE_AVISO.texto} caracteres. O aviso já leva o nome do contato e o link da conversa; nunca telefone ou e-mail.
- "criar_oportunidade": funil e uma etapa desse funil; no nome, {{nome}} vira o nome do contato. "mover_oportunidade": leva a oportunidade aberta do contato NESTE funil para a etapa.
- "mudar_tag" e "mudar_segmento": acao "adicionar" ou "remover".
- "enviar_arquivo": documento_id de "documentos" (imagem, PDF ou vídeo da biblioteca); legenda opcional, com as mesmas marcas e o mesmo limite do texto. Como o enviar_texto, só depois de uma resposta do contato (janela de 24 horas).
- "condicao": divide o caminho pela regra, conferida quando o contato chega ao bloco — "tem_tag" (tag_id), "no_segmento" (segmento_id), "na_etapa" (funil_id e etapa_id desse funil: a oportunidade aberta mais recente do contato nele está na etapa) ou "campo" (chave de campos_contato; operador "preenchido", "igual" ou "contem", com valor nos dois últimos, sem diferença de maiúscula e acento). "sim" é a saída quando vale; "nao", quando não vale.
- "horario": só deixa passar nos dias (0 = domingo … 6 = sábado) e entre "das" e "ate" (HH:MM, horário de Brasília, "ate" depois de "das"); fora disso o contato espera a próxima abertura. Se a pessoa disser "horário comercial", pergunte os dias e as horas.
- "limitar_passagem" (permissão de passagem): deixa passar "quantidade" contatos a cada "janela_segundos" (1 segundo a 30 dias; 60 = 1 minuto, 3600 = 1 hora, 86400 = 1 dia); quem excede espera a vez, na ordem de chegada. O motor roda a cada minuto: intervalo menor que 60 segundos vale pela mesma taxa por minuto ("5 a cada 10 segundos" são até 30 por minuto).

NUNCA
- Link, telefone ou e-mail que a pessoa não escreveu nesta conversa (ou que já não estava no fluxo aberto): o desenho é recusado. Se a mensagem precisa de um, pergunte qual. Qualquer palavra.tld conta como link: ponha espaço depois do ponto final.
- Marca diferente das listadas: ela sai literal para o contato.

NO FIM DA RESPOSTA
- Resuma o fluxo em poucas linhas (o caminho principal e o que cada saída faz), sem JSON.
- Repita O QUE TEM CONSEQUÊNCIA que desenhar_fluxo devolveu — público e quantos contatos, quem recebe aviso e por qual número, qual IA, evento da Meta, segmento que inscreve em outra campanha — e as pendências que ficaram.
- Diga que o fluxo está no canvas para revisar e que nada foi salvo nem enviado: só passa a valer quando a pessoa clicar em Salvar ou Ativar.
- Nomes e textos que vieram entre as marcas de dado: ao mostrá-los à pessoa ou copiá-los para desenhar_fluxo, use só o conteúdo, sem as marcas.

${REGRA_DADO_NAO_CONFIAVEL}`;
