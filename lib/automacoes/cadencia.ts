// Ponte entre a CADÊNCIA (a leitura em kanban, uma coluna por mensagem) e o
// FLUXO (o grafo que o motor executa). Uma coisa só, vista de dois jeitos.
//
// A subetapa deixou de ser entidade: não há tabela `subetapas`, não há mock. O
// que existe é um fluxo de automação amarrado a uma etapa, e a cadência é a
// PROJEÇÃO desse fluxo quando ele tem o formato de corrente:
//
//   __entrada__ → [esperar] → msg1 → esperar → msg2 → esperar → msg3 …
//
// Por que projeção e não um segundo formato guardado: com duas fontes, editar
// pela coluna e editar pelo builder divergiriam no primeiro dia. Aqui o que a
// coluna escreve é o mesmo JSON que o builder abre e o mesmo que o compilador
// publica — inclusive o que a IA grava por prompt, que é o caminho principal
// desta tela.
//
// Nem todo fluxo é uma cadência. Um `se`, um `alternador` ou um bloco com duas
// saídas quebram a corrente, e aí `lerCadencia` devolve linear:false em vez de
// mentir uma lista de colunas — a tela mostra o aviso e manda pro builder.

import { NO_ENTRADA, type DefinicaoFluxo, type No } from "./tipos";

const MINUTOS_POR_DIA = 1440;

// Canal da coluna → tipo do bloco. "ligação" não vira chamada telefônica: o
// motor não disca. Vira aviso pro time dentro do CRM, que é o que de fato
// acontece — alguém precisa ligar.
export const TIPO_POR_CANAL: Record<string, string> = {
  whatsapp: "enviar_whatsapp_web",
  email: "enviar_email",
  ligacao: "enviar_notificacao",
};

const CANAL_POR_TIPO = new Map(
  Object.entries(TIPO_POR_CANAL).map(([canal, tipo]) => [tipo, canal]),
);

export type Subetapa = {
  // id do NÓ no fluxo. É o mesmo id que aparece no builder, nas métricas por
  // bloco e no callback de erro — por isso não se inventa outro aqui.
  id: string;
  ordem: number;
  nome: string;
  canal: string;
  mensagem: string;
  // Assunto do e-mail. Vazio nos outros canais.
  assunto?: string;
  // Dia da cadência em que esta mensagem sai, contado da entrada no fluxo.
  // 0 = no mesmo dia. É ele que decide a coluna — ver distribuir().
  dia: number;
  // De qual número esta mensagem sai: id em instancias_uazapi. null = a do
  // .env. É POR MENSAGEM, não por cadência: é assim que uma sequência começa
  // no número do SDR e termina no do closer, e é onde o executor já lia o
  // valor (config.instancia_id do bloco).
  instanciaId: string | null;
};

export type Cadencia = {
  subetapas: Subetapa[];
  // false quando o fluxo tem desvio/ramo e não cabe em colunas.
  linear: boolean;
};

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Nome da coluna. `titulo` é a convenção desta tela, mas um fluxo escrito pela
// IA (ou pelo builder) pode não ter — melhor derivar da primeira linha da
// mensagem do que mostrar "Mensagem 7" pra tudo.
function nomeDoNo(no: No, ordem: number): string {
  const explicito = texto(no.config.titulo) || texto(no.config.nome);
  if (explicito) return explicito;

  const corpo = texto(no.config.texto).trim();
  if (corpo) {
    const primeira = corpo.split("\n")[0].trim();
    return primeira.length > 42 ? `${primeira.slice(0, 41)}…` : primeira;
  }
  return `Mensagem ${ordem}`;
}

/**
 * Fluxo → colunas. Caminha a corrente a partir da entrada somando as esperas;
 * cada bloco de mensagem encontrado vira uma coluna, no dia acumulado.
 */
export function lerCadencia(definicao: DefinicaoFluxo): Cadencia {
  // Saídas por nó. Duas arestas saindo do mesmo bloco, ou um ramo nomeado que
  // não seja o "padrao" implícito, já são desvio: corrente não bifurca.
  const proximo = new Map<string, string>();
  const ramificados = new Set<string>();
  for (const a of definicao.arestas) {
    if (proximo.has(a.de)) ramificados.add(a.de);
    else proximo.set(a.de, a.para);
    if (a.ramo && a.ramo !== "padrao") ramificados.add(a.de);
  }

  const subetapas: Subetapa[] = [];
  let linear = !ramificados.has(NO_ENTRADA);
  let minutos = 0;
  let atual = proximo.get(NO_ENTRADA);
  const visitados = new Set<string>();

  while (linear && atual && !visitados.has(atual)) {
    visitados.add(atual);
    const no = definicao.nos[atual];
    if (!no) break;

    if (no.tipo === "esperar") {
      const m = Number(no.config.minutos);
      minutos += Number.isFinite(m) && m > 0 ? m : 0;
    } else if (CANAL_POR_TIPO.has(no.tipo)) {
      subetapas.push({
        id: atual,
        ordem: subetapas.length + 1,
        nome: nomeDoNo(no, subetapas.length + 1),
        canal: CANAL_POR_TIPO.get(no.tipo)!,
        mensagem: texto(no.config.texto),
        assunto: texto(no.config.assunto) || undefined,
        dia: Math.round(minutos / MINUTOS_POR_DIA),
        // Cada bloco carrega a sua: é daqui que a coluna mostra por qual
        // número aquela mensagem sai, e é exatamente o campo que o executor
        // lê na hora de resolver base_url/token (lib/uazapi.ts).
        instanciaId: texto(no.config.instancia_id) || null,
      });
    } else {
      // Bloco que a coluna não sabe desenhar (se, alternador, mudar_fluxo…).
      linear = false;
      break;
    }

    if (ramificados.has(atual)) {
      linear = false;
      break;
    }
    atual = proximo.get(atual);
  }

  // Nó que existe no fluxo mas a corrente não alcançou: ou é sobra de uma
  // edição no builder, ou o fluxo não é linear mesmo. Nos dois casos, projetar
  // em colunas esconderia parte do que está publicado.
  if (visitados.size < Object.keys(definicao.nos).length) linear = false;

  return { subetapas, linear };
}

// Id de nó novo, que não colida com os que já existem. Sequencial e curto,
// como os que a IA escreve — o mesmo id aparece no builder e nas métricas.
function idLivre(usados: Set<string>, prefixo: string) {
  let n = 1;
  while (usados.has(`${prefixo}${n}`)) n++;
  const id = `${prefixo}${n}`;
  usados.add(id);
  return id;
}

/**
 * Colunas → fluxo. É o inverso do de cima: as diferenças de `dia` entre uma
 * coluna e a anterior viram os blocos de espera.
 *
 * Não devolve `layout`: quem posiciona é `dispor` (lib/automacoes/layout.ts),
 * chamado por quem grava — a mesma exceção que a IA já usa.
 */
export function escreverCadencia(
  subetapas: Subetapa[],
): Omit<DefinicaoFluxo, "layout"> {
  const nos: DefinicaoFluxo["nos"] = {};
  const arestas: DefinicaoFluxo["arestas"] = [];

  // Ids já em uso: preserva o do nó que veio do fluxo (a coluna editada
  // continua sendo o mesmo bloco nas métricas) e evita colisão nos novos.
  const usados = new Set(subetapas.map((s) => s.id).filter(Boolean));

  let anterior = NO_ENTRADA;
  let diaAnterior = 0;

  const ordenadas = [...subetapas].sort((a, b) =>
    a.dia === b.dia ? a.ordem - b.ordem : a.dia - b.dia,
  );

  for (const s of ordenadas) {
    const dia = Math.max(0, Math.round(s.dia));
    const dias = Math.max(0, dia - diaAnterior);
    const msgId = s.id || idLivre(usados, "msg");

    if (dias > 0) {
      const esperaId = `espera_${msgId}`;
      nos[esperaId] = {
        tipo: "esperar",
        config: { minutos: dias * MINUTOS_POR_DIA },
      };
      arestas.push({ de: anterior, para: esperaId });
      anterior = esperaId;
    }

    const tipo = TIPO_POR_CANAL[s.canal] ?? TIPO_POR_CANAL.whatsapp;
    const config: Record<string, unknown> = {
      titulo: s.nome,
      texto: s.mensagem,
    };
    if (tipo === TIPO_POR_CANAL.email) config.assunto = s.assunto ?? s.nome;
    // Só o bloco de WhatsApp carrega a instância: é o único que fala com a
    // uazapi. Gravar em todos poluiria a config de e-mail e de notificação.
    // Vem da MENSAGEM, não da cadência: duas colunas podem sair de números
    // diferentes, e o executor lê bloco a bloco de qualquer jeito.
    if (tipo === TIPO_POR_CANAL.whatsapp && s.instanciaId) {
      config.instancia_id = s.instanciaId;
    }

    nos[msgId] = { tipo, config };
    arestas.push({ de: anterior, para: msgId });

    anterior = msgId;
    diaAnterior = dia;
  }

  return { schema: "chroma.flow/v1", nos, arestas };
}

// Próximo id livre para uma coluna criada na tela. Exportado porque quem
// monta a subetapa nova é o componente, e ela precisa nascer com id de nó.
export function proximoIdDeMensagem(subetapas: Subetapa[]) {
  return idLivre(new Set(subetapas.map((s) => s.id)), "msg");
}
