// O que um fluxo de campanha (lib/campanhas-fluxo.ts) MANDA e o que ele causa
// fora do bloco. Puro, sem server-only (revisões de 2026-10-28): a tela mostra
// enquanto se monta, o servidor confere ao salvar e ao ativar
// (conferirFluxo, lib/campanhas-fluxo-entrada.ts), a IA do construtor ecoa
// (lib/ia/campanhas-construtor.ts) e o webhook decide se a IA de atendimento
// fala. Uma regra só nos quatro lugares: antes a tela tinha a própria cópia,
// que já divergia da do servidor.
//
//   · problemasDosEnvios: cada envio contra os templates da conta (na conta,
//     aprovado e preenchível), o texto livre e a legenda do arquivo só com as
//     marcas da campanha e os limites do aviso à equipe;
//   · consequenciasDoFluxo: frases curtas do que acontece fora do bloco
//     (cadência da etapa, evento da Meta, inscrição em outra campanha). Texto
//     e arquivo não têm: o que fazem é só a mensagem ao contato;
//   · campanhaFalaAntesDeEsperar e iaResponde: o filtro da IA calada na
//     resposta consumida (app/api/meta/whatsapp/webhook/route.ts);
//   · tipoDoArquivoDaCampanha e problemaDoArquivoDaCampanha: que arquivo da
//     biblioteca o "Enviar arquivo" manda (tipo, formato e tamanho).
import {
  saidasDe,
  type ContextoDasConsequencias,
  type Destino,
  type FluxoCampanha,
  type OpcaoDaCampanha,
  type ProblemaDoFluxo,
} from "@/lib/campanhas-fluxo";
import {
  ARQUIVO_DO_CABECALHO,
  DADOS_NA_CAMPANHA,
  problemaDoArquivoDoCabecalho,
  problemaNoEnvio,
  type TemplateWhatsApp,
} from "@/lib/templates-whatsapp";

/**
 * O aviso à equipe, por mensagem e por chamada: nada de aviso sem teto. Mora
 * aqui (e não no envio, lib/aviso-equipe-whatsapp.ts) porque a tela confere o
 * texto e as pessoas do bloco enquanto se monta.
 */
export const LIMITE_AVISO = {
  /** Linhas de uma mensagem; o resto vira "… e mais N". */
  linhas: 20,
  /** Pessoas avisadas numa chamada. */
  destinatarios: 20,
  /** Caracteres do texto de cada linha. */
  texto: 200,
} as const;

const MARCA = /\{\{([a-z_]+)\}\}/g;
const CHAVES_NA_CAMPANHA = new Set<string>(DADOS_NA_CAMPANHA.map((d) => d.chave));

/**
 * O que impede cada envio. `templates` são TODOS os da conta do WhatsApp da
 * campanha, em qualquer situação: é o que separa "não está nesta conta" de
 * "ainda não foi aprovado". O mínimo de cada bloco e o grafo são de
 * problemasDoFluxo; o banco, de conferirFluxo.
 */
export function problemasDosEnvios(f: FluxoCampanha, templates: TemplateWhatsApp[]): ProblemaDoFluxo[] {
  const p: ProblemaDoFluxo[] = [];
  const blocos = Object.entries(f.blocos);
  if (blocos.length && !blocos.some(([, b]) => b.tipo === "enviar_template"))
    p.push({ blocoId: null, mensagem: "O fluxo precisa enviar ao menos um template." });
  for (const [id, b] of blocos) {
    if (b.tipo === "enviar_template" && b.template_nome) {
      const t = templates.find((x) => x.nome === b.template_nome && x.idioma === b.template_idioma);
      const problema = !t
        ? `O template “${b.template_nome}” não está nesta conta do WhatsApp.`
        : t.status !== "APPROVED"
          ? `O template “${b.template_nome}” ainda não foi aprovado pela Meta.`
          : problemaNoEnvio(t, b.variaveis);
      if (problema) p.push({ blocoId: id, mensagem: problema });
    }
    // O texto livre e a legenda do arquivo saem ao contato pelo mesmo caminho:
    // só as marcas da campanha (o resto sairia literal).
    const livre = b.tipo === "enviar_texto" ? { texto: b.texto, onde: "No texto" } : b.tipo === "enviar_arquivo" ? { texto: b.legenda, onde: "Na legenda" } : null;
    if (livre) {
      const sobra = [...livre.texto.matchAll(MARCA)].find((m) => !CHAVES_NA_CAMPANHA.has(m[1]));
      const resto = livre.texto.replace(MARCA, "");
      if (sobra || /\{\{|\}\}/.test(resto))
        p.push({ blocoId: id, mensagem: `${livre.onde}, só as marcas ${DADOS_NA_CAMPANHA.map((d) => `{{${d.chave}}}`).join(", ")}.` });
    }
    if (b.tipo === "avisar_equipe") {
      if (b.texto.length > LIMITE_AVISO.texto) p.push({ blocoId: id, mensagem: `O aviso tem até ${LIMITE_AVISO.texto} caracteres.` });
      if (b.usuarioIds.length > LIMITE_AVISO.destinatarios)
        p.push({ blocoId: id, mensagem: `São até ${LIMITE_AVISO.destinatarios} pessoas por aviso.` });
    }
  }
  return p;
}

/**
 * O que, fora do bloco, acontece quando ele roda — só onde o motor de fato faz
 * (lib/campanhas-whatsapp.ts, executarAcao):
 *   · "Mover oportunidade" passa por lib/mover-etapa.ts: entra na cadência
 *     rodando da etapa e, se a etapa mudou, manda o evento dela à Meta;
 *   · "Criar oportunidade" é um INSERT direto: manda o evento da etapa, mas NÃO
 *     inscreve na cadência dela;
 *   · "Segmento" (adicionar) inscreve, pelo gatilho do banco, em toda campanha
 *     ATIVA que tem aquele segmento.
 * Os nomes vêm do contexto como estão (a IA passa os dela já embrulhados).
 */
export function consequenciasDoFluxo(f: FluxoCampanha, ctx: ContextoDasConsequencias): Array<{ blocoId: string; texto: string }> {
  const nome = (lista: OpcaoDaCampanha[], id: string) => lista.find((x) => x.id === id)?.nome;
  const r: Array<{ blocoId: string; texto: string }> = [];
  for (const [id, b] of Object.entries(f.blocos)) {
    if (b.tipo === "mover_oportunidade") {
      const etapa = nome(ctx.etapasComCadencia, b.etapaId);
      if (etapa) r.push({ blocoId: id, texto: `Entra na cadência da etapa “${etapa}”, que manda WhatsApp a quem chega.` });
    }
    if (b.tipo === "criar_oportunidade" || b.tipo === "mover_oportunidade") {
      const etapa = nome(ctx.etapasComEventoMeta, b.etapaId);
      if (etapa) r.push({ blocoId: id, texto: `A etapa “${etapa}” manda o evento de conversão à Meta.` });
    }
    if (b.tipo === "mudar_segmento" && b.acao === "adicionar") {
      const campanhas = [...new Set(ctx.segmentosEmCampanha.filter((s) => s.segmentoId === b.segmentoId).map((s) => s.campanha))];
      if (campanhas.length)
        r.push({ blocoId: id, texto: `Inscreve o contato também na campanha ativa ${campanhas.map((c) => `“${c}”`).join(", ")}.` });
    }
  }
  return r;
}

/**
 * O caminho que a resposta tomou MANDA mensagem ao contato (template, texto ou
 * arquivo) antes da próxima espera? É o filtro da IA de atendimento na mensagem
 * que a campanha consumiu (decisão da coordenação, 2026-10-28): calada só
 * quando a campanha está falando — senão a pessoa receberia a campanha e a IA
 * ao mesmo tempo. Quando o caminho só faz ações de CRM, avisa a equipe ou
 * termina (e no formato antigo, que depois do Aguardar só tem ações), a
 * mensagem segue para a IA como antes. "Passar para a IA" no caminho entrega à
 * IA de qualquer jeito (o webhook olha o que a rodada ligou). Destino null =
 * fim: não fala.
 *
 * Os blocos de 2026-10-28: a "Condição" se decide só quando o contato chega
 * nela, então valem as DUAS saídas (basta uma falar); "Horário de envio" e
 * "Permissão de passagem" contam como passagem, não como espera — dentro da
 * janela, ou com vaga, a campanha fala na hora.
 */
export function campanhaFalaAntesDeEsperar(f: FluxoCampanha, destino: Destino): boolean {
  const vistos = new Set<string>();
  const fila: Destino[] = [destino];
  while (fila.length) {
    const id = fila.pop()!;
    if (!id || !Object.hasOwn(f.blocos, id) || vistos.has(id)) continue;
    vistos.add(id);
    const b = f.blocos[id];
    if (b.tipo === "enviar_template" || b.tipo === "enviar_texto" || b.tipo === "enviar_arquivo") return true;
    if (b.tipo === "aguardar_resposta" || b.tipo === "esperar") continue;
    for (const s of saidasDe(b)) fila.push(s.destino);
  }
  return false;
}

/**
 * O tipo do arquivo da biblioteca que o "Enviar arquivo" manda: imagem, PDF ou
 * vídeo; null para o resto (áudio, planilha…). As opções da tela, a conferência
 * ao salvar e o motor no envio leem por aqui (documentos.tipo e o mime).
 */
export function tipoDoArquivoDaCampanha(d: { tipo: string; mime: string }): "imagem" | "pdf" | "video" | null {
  if (d.tipo === "imagem") return "imagem";
  if (d.tipo === "video") return "video";
  const mime = d.mime.split(";")[0].trim().toLowerCase();
  return d.tipo === "documento" && mime === "application/pdf" ? "pdf" : null;
}

/**
 * O que impede este arquivo (já conferido que existe e não está arquivado) de
 * sair pelo "Enviar arquivo" (null = vai). Além do tipo, o formato e o tamanho
 * que a Cloud API aceita — as mesmas regras do cabeçalho de mídia do template
 * (ARQUIVO_DO_CABECALHO, lib/templates-whatsapp.ts): um webp ou um vídeo acima
 * de 16 MB passaria na ativação e falharia contato a contato. A tela filtra a
 * lista por aqui; a conferência e o motor conferem de novo com a linha do banco.
 */
export function problemaDoArquivoDaCampanha(d: { tipo: string; mime: string; tamanho: number }): string | null {
  const tipo = tipoDoArquivoDaCampanha(d);
  if (!tipo) return "Pela campanha vão só imagem, PDF ou vídeo.";
  const pede = tipo === "pdf" ? "documento" : tipo;
  return problemaDoArquivoDoCabecalho(pede, { ...d, arquivado: false }) ? `Pela campanha vai ${ARQUIVO_DO_CABECALHO[pede].pede}.` : null;
}

/**
 * A IA de atendimento responde esta mensagem? A que nenhuma campanha consumiu,
 * sim; a consumida, só se a campanha não está falando (`calaIa` vem de
 * campanhaFalaAntesDeEsperar) ou se a rodada que ela destravou ligou a IA.
 */
export function iaResponde(consumo: { calaIa: boolean } | undefined, ligouIa: boolean): boolean {
  return !consumo?.calaIa || ligouIa;
}
