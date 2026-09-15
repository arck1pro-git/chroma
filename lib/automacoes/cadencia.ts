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
//
// O QUE NÃO É MENSAGEM CONTINUA NA CORRENTE. Esperar, mudar tag, mudar
// segmento, requisição HTTP — tudo que tem uma saída só não quebra a leitura em
// colunas: vira AÇÃO, pendurada na mensagem que vem depois dela. Antes esses
// blocos derrubavam o `linear` e a cadência inteira sumia da tela por causa de
// uma tag. Agora aparecem entre as colunas, que é onde acontecem.

import { blocoPorTipo } from "./catalogo";
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
  // O mesmo instante em MINUTOS, sem arredondar. `dia` é a régua da tela;
  // este é o que o fluxo tem de verdade — e é por ele que uma espera de 45
  // minutos sobrevive a um salvar, em vez de virar "dia 0" e sumir.
  minutos: number;
  // O que roda entre a mensagem ANTERIOR e esta: esperas, tags, requisições.
  // Vem inteiro do fluxo e volta inteiro no salvar — ver AcaoCadencia.
  acoes: AcaoCadencia[];
  // De qual número esta mensagem sai: id em instancias_uazapi. null = a do
  // .env. É POR MENSAGEM, não por cadência: é assim que uma sequência começa
  // no número do SDR e termina no do closer, e é onde o executor já lia o
  // valor (config.instancia_id do bloco).
  instanciaId: string | null;
};

/**
 * Um bloco que não é mensagem, no caminho entre duas mensagens.
 *
 * `config` vem inteira e opaca: esta é a ÚNICA cópia do bloco que a tela da
 * cadência tem, e é dela que `escreverCadencia` o reconstrói ao salvar. Sem
 * isso, editar uma coluna apagaria as tags e as requisições do fluxo em
 * silêncio — o painel grava o fluxo inteiro a partir das colunas.
 */
export type AcaoCadencia = {
  /** id do nó no fluxo, preservado na volta. */
  id: string;
  tipo: string;
  /** Do catálogo ("Mudar tag"); o tipo cru quando o bloco é desconhecido. */
  rotulo: string;
  /** Linha curta debaixo do rótulo: "2 dias", o título do bloco, ou vazio. */
  detalhe: string;
  config: Record<string, unknown>;
};

export type Cadencia = {
  subetapas: Subetapa[];
  // false quando o fluxo tem desvio/ramo e não cabe em colunas.
  linear: boolean;
  /** O que roda DEPOIS da última mensagem. Quase sempre vazio. */
  acoesFinais: AcaoCadencia[];
};

/** "45 min", "3 h", "2 dias" — a espera dita como gente fala. */
export function duracaoEmTexto(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < MINUTOS_POR_DIA) {
    const h = Math.round(minutos / 60);
    return `${h} h`;
  }
  const d = Math.round(minutos / MINUTOS_POR_DIA);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}

function minutosDe(no: No): number {
  const m = Number(no.config.minutos);
  return Number.isFinite(m) && m > 0 ? m : 0;
}

function acaoDe(id: string, no: No): AcaoCadencia {
  const bloco = blocoPorTipo(no.tipo);
  return {
    id,
    tipo: no.tipo,
    rotulo: bloco?.rotulo ?? no.tipo,
    detalhe:
      no.tipo === "esperar"
        ? duracaoEmTexto(minutosDe(no))
        : texto(no.config.titulo) || texto(no.config.nome),
    config: no.config,
  };
}

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
 * cada bloco de mensagem encontrado vira uma coluna, no dia acumulado, e o que
 * houver entre duas mensagens fica pendurado na de baixo como ação.
 *
 * O CORTE É PELO NÚMERO DE SAÍDAS, não por uma lista de tipos permitidos: um
 * bloco com uma saída só continua a corrente, dois ou mais a bifurcam. Assim um
 * bloco novo no catálogo entra aqui sem ninguém lembrar de atualizar uma lista
 * — e `se`, `alternador` e `verificar_resposta` continuam quebrando, que é o
 * certo: coluna não desenha desvio.
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
  // As ações vistas desde a última mensagem. Esvazia a cada mensagem nova; o
  // que sobrar no fim é o que roda depois da última.
  let pendentes: AcaoCadencia[] = [];
  let linear = !ramificados.has(NO_ENTRADA);
  let minutos = 0;
  let atual = proximo.get(NO_ENTRADA);
  const visitados = new Set<string>();

  while (linear && atual && !visitados.has(atual)) {
    visitados.add(atual);
    const no = definicao.nos[atual];
    if (!no) break;

    if (CANAL_POR_TIPO.has(no.tipo)) {
      subetapas.push({
        id: atual,
        ordem: subetapas.length + 1,
        nome: nomeDoNo(no, subetapas.length + 1),
        canal: CANAL_POR_TIPO.get(no.tipo)!,
        mensagem: texto(no.config.texto),
        assunto: texto(no.config.assunto) || undefined,
        dia: Math.round(minutos / MINUTOS_POR_DIA),
        minutos,
        acoes: pendentes,
        // Cada bloco carrega a sua: é daqui que a coluna mostra por qual
        // número aquela mensagem sai, e é exatamente o campo que o executor
        // lê na hora de resolver base_url/token (lib/uazapi.ts).
        instanciaId: texto(no.config.instancia_id) || null,
      });
      pendentes = [];
    } else if ((blocoPorTipo(no.tipo)?.saidas.length ?? 0) <= 1) {
      // Uma saída (ou nenhuma, no `mudar_fluxo`): a corrente continua, e o
      // bloco vira ação da próxima mensagem. A espera também entra aqui, além
      // de somar no relógio — ela é o que mais se quer ver entre duas colunas.
      if (no.tipo === "esperar") minutos += minutosDe(no);
      pendentes.push(acaoDe(atual, no));
    } else {
      // Bloco que a coluna não sabe desenhar: `se`, `alternador`,
      // `verificar_resposta` — os que têm mais de uma saída.
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

  return { subetapas, linear, acoesFinais: pendentes };
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
 * coluna e a anterior viram os blocos de espera, e as ações de cada coluna
 * voltam entre elas.
 *
 * AS AÇÕES NÃO VÊM DO NAVEGADOR. Quem as passa é o servidor, que releu o fluxo
 * antes de gravar (ver `salvarCadencia`) — o painel só edita mensagem. É o que
 * impede um POST forjado de plantar um `requisicao_http` no fluxo por um campo
 * que a tela nem mostra.
 *
 * O TEMPO TEM UMA FONTE SÓ: o `dia` da coluna. Quando o intervalo que ele pede
 * bate com a soma das esperas que já estavam ali, os blocos voltam INTACTOS, na
 * ordem original — é o caso de quem só mexeu no texto da mensagem, e nada no
 * fluxo muda. Quando não bate (mudaram o dia, ou entrou uma coluna no meio), a
 * espera é recalculada em um bloco só, antes das outras ações da coluna: com
 * duas ou três esperas no mesmo intervalo não há como saber em qual delas o
 * usuário quis pôr a diferença, e inventar um rateio seria pior que juntar.
 */
export function escreverCadencia(
  subetapas: Subetapa[],
  acoesFinais: AcaoCadencia[] = [],
): Omit<DefinicaoFluxo, "layout"> {
  const nos: DefinicaoFluxo["nos"] = {};
  const arestas: DefinicaoFluxo["arestas"] = [];

  // Ids já em uso: preserva o do nó que veio do fluxo (a coluna editada
  // continua sendo o mesmo bloco nas métricas) e evita colisão nos novos.
  const usados = new Set(
    [
      ...subetapas.map((s) => s.id),
      ...subetapas.flatMap((s) => (s.acoes ?? []).map((a) => a.id)),
      ...acoesFinais.map((a) => a.id),
    ].filter(Boolean),
  );

  let anterior = NO_ENTRADA;
  let minutosAnterior = 0;

  /** Pendura o bloco na corrente, na ordem em que ele aparece. */
  const emendar = (id: string, no: No) => {
    nos[id] = no;
    arestas.push({ de: anterior, para: id });
    anterior = id;
  };

  const esperar = (minutos: number, depoisDe: string) => {
    if (minutos <= 0) return;
    emendar(`espera_${depoisDe}`, {
      tipo: "esperar",
      config: { minutos },
    });
  };

  const ordenadas = [...subetapas].sort((a, b) =>
    a.dia === b.dia ? a.ordem - b.ordem : a.dia - b.dia,
  );

  for (const s of ordenadas) {
    const dia = Math.max(0, Math.round(s.dia));
    const msgId = s.id || idLivre(usados, "msg");
    const acoes = s.acoes ?? [];

    // Minutos exatos só valem se ainda descreverem o mesmo dia: editar o dia
    // na tela não atualiza `minutos`, e é justamente essa divergência que diz
    // que o tempo mudou.
    const minutosAgora =
      Number.isFinite(s.minutos) &&
      Math.round(s.minutos / MINUTOS_POR_DIA) === dia
        ? s.minutos
        : dia * MINUTOS_POR_DIA;
    const espera = Math.max(0, minutosAgora - minutosAnterior);

    const somaOriginal = acoes
      .filter((a) => a.tipo === "esperar")
      .reduce((total, a) => total + (Number(a.config.minutos) || 0), 0);

    if (somaOriginal === espera) {
      for (const a of acoes) emendar(a.id, { tipo: a.tipo, config: a.config });
    } else {
      esperar(espera, msgId);
      for (const a of acoes) {
        if (a.tipo === "esperar") continue;
        emendar(a.id, { tipo: a.tipo, config: a.config });
      }
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

    emendar(msgId, { tipo, config });
    minutosAnterior = minutosAgora;
  }

  // O que rodava depois da última mensagem continua depois dela.
  for (const a of acoesFinais) emendar(a.id, { tipo: a.tipo, config: a.config });

  return { schema: "chroma.flow/v1", nos, arestas };
}

// Próximo id livre para uma coluna criada na tela. Exportado porque quem
// monta a subetapa nova é o componente, e ela precisa nascer com id de nó.
export function proximoIdDeMensagem(subetapas: Subetapa[]) {
  return idLivre(new Set(subetapas.map((s) => s.id)), "msg");
}
