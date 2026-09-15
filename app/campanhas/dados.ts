// Leitura do módulo Campanhas.
//
// UMA CAMPANHA É UM FLUXO. A ideia é a mesma da cadência de etapa: um workflow
// no n8n que o CRM publica e acompanha. O que muda é de onde vem o público —
// aqui é um SEGMENTO de contatos, não as oportunidades de uma etapa — e o
// bloco de LIBERAR LOTE, que existe só aqui.
//
// POR QUE O LOTE EXISTE, e por que ele é o bloco mais importante desta tela:
// disparar para 1.840 contatos de uma vez é o jeito mais rápido de a linha ser
// bloqueada pelo WhatsApp. O bloco segura a fila e solta N por vez, a cada T —
// a campanha inteira passa a ter um ritmo, em vez de um pico.
//
// ── ESTE MÓDULO AINDA NÃO TOCA O BANCO ──────────────────────────────────────
//
// O canal é a API OFICIAL do WhatsApp, que ainda não está ligada (o que existe
// hoje é a uazapi, que é WhatsApp Web e serve o chat e as cadências). Sem
// canal, uma campanha gravada no banco seria uma campanha que nunca dispara —
// e uma tabela vazia esperando um recurso é pior que nenhuma.
//
// Então a tela lê app/mock/campanhas.json. Os TIPOS abaixo é que são o
// contrato: quando a API entrar, `carregarCampanhas` troca o import do JSON por
// SQL, e a tela não muda. É a mesma escolha registrada em app/page.tsx, quando
// a raiz lia mock enquanto a base estava vazia.
import mock from "../mock/campanhas.json";

/**
 * DOIS ESTADOS, e só dois: ativa manda, pausada não manda. "Rascunho" e
 * "encerrada" saíram porque não mudavam nada no mundo — campanha sem mensagem
 * escrita simplesmente não dispara, e campanha que acabou é uma pausada com a
 * fila vazia. Dois estados são dois botões e uma pergunta: está mandando?
 */
export type EstadoCampanha = "ativa" | "pausada";

/**
 * Onde um lead pode estar dentro da campanha.
 *
 * NÃO há estado "converteu": quem diz que o lead deu resultado é o BLOCO em
 * que ele está (ver `meta` em Bloco). Um estado e um bloco dizendo a mesma
 * coisa sairiam de sincronia — e o bloco é o que a campanha desenha.
 */
export type EstadoLead = "na_fila" | "andando" | "respondeu" | "falhou";

export type Segmento = {
  id: string;
  nome: string;
  contatos: number;
};

/**
 * Um bloco da campanha. É a mesma corrente da cadência — mensagem, espera —
 * com o LOTE na frente e a META no fim.
 *
 * A META É O QUE A CAMPANHA CONTA. Ela não manda nada e não espera nada: é a
 * linha de chegada, e o rótulo dela nomeia a métrica na tela. "Leads gerados"
 * numa campanha, "Entradas na comunidade" noutra — o número grande no fim da
 * linha muda de nome junto, porque o resultado de uma campanha não é o mesmo
 * de outra. Sem bloco de meta a campanha roda igual; só não tem resultado para
 * mostrar, e a tela diz isso em vez de inventar um.
 */
export type Bloco =
  | {
      id: string;
      tipo: "liberar_lote";
      /** Quantos leads saem da fila por vez. */
      quantidade: number;
      /** De quanto em quanto tempo, em minutos. */
      minutos: number;
    }
  | { id: string; tipo: "esperar"; minutos: number }
  | { id: string; tipo: "mensagem"; nome: string; texto: string }
  | { id: string; tipo: "meta"; rotulo: string };

export type LeadNaCampanha = {
  id: string;
  nome: string;
  whatsapp: string;
  /** Em qual bloco ele está AGORA. */
  blocoId: string;
  estado: EstadoLead;
};

export type Campanha = {
  id: string;
  nome: string;
  segmentoId: string;
  estado: EstadoCampanha;
  criadaEm: string;
  /**
   * Quantas mensagens a campanha já mandou. NÃO é o número de leads: uma
   * sequência de três mensagens manda três por lead que chegou até o fim.
   */
  enviadas: number;
  /**
   * Preço de uma mensagem, em reais.
   *
   * SIMPLIFICAÇÃO CONHECIDA: a API oficial cobra por JANELA DE CONVERSA de 24h,
   * não por mensagem — três mensagens no mesmo dia são uma cobrança só, e o
   * preço muda por categoria (marketing, utilidade, serviço) e por país. Com o
   * canal ligado, o gasto passa a vir do faturamento da Meta em vez desta
   * multiplicação. Até lá o número serve para comparar campanhas entre si, que
   * é para o que ele é olhado.
   */
  custoPorMensagem: number;
  blocos: Bloco[];
  leads: LeadNaCampanha[];
};

export type DadosCampanhas = {
  campanhas: Campanha[];
  segmentos: Segmento[];
};

export function carregarCampanhas(): DadosCampanhas {
  return {
    campanhas: mock.campanhas as Campanha[],
    segmentos: mock.segmentos as Segmento[],
  };
}

// ── Contas da tela ──────────────────────────────────────────────────────────
//
// Funções puras, e por isso vivem aqui e não no componente: a mesma conta
// aparece no cartão da lista e no cabeçalho do painel, e duas cópias
// divergiriam na primeira correção.

export type ResumoCampanha = {
  publico: number;
  naFila: number;
  andando: number;
  responderam: number;
  falharam: number;
  /** Quantos já saíram da fila, de 0 a 100. */
  progresso: number;

  enviadas: number;
  /** enviadas x preço da mensagem. */
  gasto: number;

  /** Dos que receberam, quantos responderam. */
  taxaResposta: number;
  /** Quanto custou cada resposta. 0 quando ninguém respondeu. */
  custoPorResposta: number;

  /**
   * O resultado da campanha, nomeado pelo bloco de meta. `null` quando a
   * campanha não tem meta — a tela mostra o vazio em vez de um zero que
   * pareceria fracasso.
   */
  meta: { rotulo: string; total: number; custo: number } | null;
};

export function resumoDaCampanha(
  campanha: Campanha,
  segmentos: Segmento[],
): ResumoCampanha {
  const segmento = segmentos.find((s) => s.id === campanha.segmentoId);
  const publico = segmento?.contatos ?? campanha.leads.length;

  const conta = (e: EstadoLead) =>
    campanha.leads.filter((l) => l.estado === e).length;

  const naFila = conta("na_fila");
  const saiuDaFila = campanha.leads.length - naFila;
  const responderam = conta("respondeu");
  const gasto = campanha.enviadas * campanha.custoPorMensagem;

  // Chegar no bloco de meta É o resultado. Conta por POSIÇÃO e não por estado
  // do lead, porque é o bloco que define o que a campanha persegue.
  const blocoMeta = campanha.blocos.find((b) => b.tipo === "meta");
  const naMeta = blocoMeta
    ? campanha.leads.filter((l) => l.blocoId === blocoMeta.id).length
    : 0;

  // A BASE DAS TAXAS É QUEM RECEBEU, não o público do segmento. Com uma fila de
  // 1.840 e 40 disparados, dividir por 1.840 diria "2% de resposta" no primeiro
  // dia de uma campanha que está indo bem — e a decisão tomada em cima disso
  // seria desligar a campanha errada.
  const receberam = saiuDaFila;
  const taxa = (n: number) =>
    receberam > 0 ? Math.round((n / receberam) * 1000) / 10 : 0;

  return {
    publico,
    naFila,
    andando: conta("andando"),
    responderam,
    falharam: conta("falhou"),
    progresso: publico > 0 ? Math.round((saiuDaFila / publico) * 100) : 0,

    enviadas: campanha.enviadas,
    gasto,

    taxaResposta: taxa(responderam),
    custoPorResposta: responderam > 0 ? gasto / responderam : 0,

    meta:
      blocoMeta && blocoMeta.tipo === "meta"
        ? {
            rotulo: blocoMeta.rotulo,
            total: naMeta,
            custo: naMeta > 0 ? gasto / naMeta : 0,
          }
        : null,
  };
}

/** "40 a cada 1 h" — o ritmo do lote, dito de uma vez. */
export function ritmoDoLote(quantidade: number, minutos: number): string {
  return `${quantidade} a cada ${duracao(minutos)}`;
}

/** "45 min", "2 h", "3 dias" — a mesma régua de lib/automacoes/cadencia.ts. */
export function duracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) {
    const h = Math.round(minutos / 60);
    return `${h} h`;
  }
  const d = Math.round(minutos / 1440);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}

/**
 * Quanto tempo a campanha leva para soltar o público inteiro, pelo ritmo do
 * lote. É a pergunta que todo mundo faz depois de escolher o segmento — e a
 * resposta muda a decisão: 1.840 contatos a 40 por hora são dois dias de
 * disparo.
 */
export function tempoDeEscoamento(
  publico: number,
  quantidade: number,
  minutos: number,
): string {
  if (quantidade <= 0 || publico <= 0) return "—";
  const levas = Math.ceil(publico / quantidade);
  // A primeira leva sai na hora; as outras esperam o intervalo.
  return duracao(Math.max(0, levas - 1) * minutos);
}
