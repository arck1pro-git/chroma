// Catálogo de blocos — FONTE ÚNICA do módulo de Automações.
//
// Builder (que blocos existem, o que o painel mostra), validador (o que é
// obrigatório) e compilador (como vira nó do motor) leem daqui. Sem isso,
// adicionar um bloco vira edição em três arquivos que saem de sincronia.
//
// Sem ícone e sem classe de cor: isto é domínio, não apresentação. O mapa de
// ícone/cor vive em app/automacoes/aparencia.ts, junto da UI que os usa.
//
// Não existe bloco de gatilho: o fluxo não reage a evento, ele recebe
// inscrições — contato ou oportunidade é ADICIONADO a ele. O nó de entrada é
// fixo no canvas e não vem daqui (ver NO_ENTRADA em ./tipos).

import type { Bloco, Saida } from "./tipos";

// Saídas reaproveitadas. `padrao` é o "seguiu em frente" da maioria dos blocos.
const PADRAO: Saida[] = [{ id: "padrao", rotulo: "" }];
const SIM_NAO: Saida[] = [
  { id: "verdadeiro", rotulo: "Sim" },
  { id: "falso", rotulo: "Não" },
];

// Atalhos de contrato: a esmagadora maioria dos blocos é imediata, e o que
// muda entre eles é só ter ou não efeito colateral.
const LEITURA = { durabilidade: "imediata", efeitoColateral: false } as const;
const ESCRITA = { durabilidade: "imediata", efeitoColateral: true } as const;

// ── Condições ───────────────────────────────────────────────────────────────

const CONDICOES: Bloco[] = [
  {
    tipo: "se",
    familia: "condicao",
    dominio: "condicao",
    rotulo: "If",
    descricao: "Avalia uma condição e separa o fluxo em Sim e Não.",
    entradas: 1,
    saidas: SIM_NAO,
    contrato: LEITURA,
  },
  {
    tipo: "alternador",
    familia: "condicao",
    dominio: "condicao",
    rotulo: "Alternador",
    descricao: "Vários caminhos a partir de um valor, com saída padrão.",
    entradas: 1,
    saidas: [
      { id: "caso_1", rotulo: "Caso 1" },
      { id: "caso_2", rotulo: "Caso 2" },
      { id: "padrao", rotulo: "Padrão" },
    ],
    contrato: LEITURA,
  },
];

// ── Ações ───────────────────────────────────────────────────────────────────

const ACOES: Bloco[] = [
  // Oportunidade
  {
    tipo: "criar_oportunidade",
    familia: "acao",
    dominio: "oportunidade",
    rotulo: "Criar oportunidade",
    descricao: "Abre um negócio para o contato, em funil e etapa escolhidos.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },
  {
    tipo: "atualizar_oportunidade",
    familia: "acao",
    dominio: "oportunidade",
    rotulo: "Atualizar oportunidade",
    descricao: "Muda etapa, responsável, valor ou status do negócio.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },

  // Comunicação
  {
    tipo: "enviar_whatsapp_web",
    familia: "acao",
    dominio: "comunicacao",
    rotulo: "Enviar WhatsApp (web)",
    descricao: "Pela uazapi, número não-oficial. Sujeito a limite de disparo.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },
  {
    tipo: "enviar_whatsapp_oficial",
    familia: "acao",
    dominio: "comunicacao",
    rotulo: "Enviar WhatsApp (oficial)",
    descricao: "Pela API oficial, com template aprovado e janela de 24h.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
    indisponivel: "A API oficial ainda não está integrada",
  },
  {
    tipo: "enviar_email",
    familia: "acao",
    dominio: "comunicacao",
    rotulo: "Enviar e-mail",
    descricao: "Envia e-mail a partir de um template.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },
  {
    tipo: "enviar_notificacao",
    familia: "acao",
    dominio: "comunicacao",
    rotulo: "Enviar notificação",
    descricao: "Avisa alguém do time dentro do CRM. Não vai para o contato.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },
  {
    tipo: "verificar_resposta",
    familia: "acao",
    dominio: "comunicacao",
    rotulo: "Verificar resposta",
    descricao: "Segura o fluxo até o contato responder, ou até o prazo acabar.",
    entradas: 1,
    saidas: [
      { id: "respondeu", rotulo: "Respondeu" },
      { id: "nao_respondeu", rotulo: "Não" },
    ],
    contrato: {
      durabilidade: "sobrevive_reinicio",
      efeitoColateral: false,
      duracaoMaxima: "P30D",
    },
  },

  // Contato
  {
    tipo: "atualizar_contato",
    familia: "acao",
    dominio: "contato",
    rotulo: "Atualizar contato",
    descricao: "Escreve um ou mais campos do cadastro do contato.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },
  {
    tipo: "mudar_tag",
    familia: "acao",
    dominio: "contato",
    rotulo: "Mudar tag",
    descricao: "Adiciona ou remove uma tag do contato.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },
  {
    tipo: "mudar_segmento",
    familia: "acao",
    dominio: "contato",
    rotulo: "Mudar segmento",
    descricao: "Adiciona ou remove um segmento do contato.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },

  // Controle
  {
    tipo: "esperar",
    familia: "acao",
    dominio: "controle",
    rotulo: "Esperar",
    descricao: "Pausa o fluxo por um tempo. Retoma mesmo após reinício.",
    entradas: 1,
    saidas: PADRAO,
    contrato: {
      durabilidade: "sobrevive_reinicio",
      efeitoColateral: false,
      duracaoMaxima: "P30D",
    },
  },
  {
    tipo: "mudar_fluxo",
    familia: "acao",
    dominio: "controle",
    rotulo: "Mudar fluxo",
    descricao: "Encerra aqui e passa a execução para outro fluxo.",
    entradas: 1,
    saidas: [],
    contrato: ESCRITA,
  },

  // Integração
  {
    tipo: "requisicao_http",
    familia: "acao",
    dominio: "integracao",
    rotulo: "Request HTTP",
    descricao: "Chamada HTTP a um serviço externo da allowlist.",
    entradas: 1,
    saidas: PADRAO,
    contrato: ESCRITA,
  },
];

export const CATALOGO: Bloco[] = [...CONDICOES, ...ACOES];

const PORTIPO = new Map(CATALOGO.map((b) => [b.tipo, b]));

export function blocoPorTipo(tipo: string): Bloco | undefined {
  return PORTIPO.get(tipo);
}

// Categorias da paleta, na ordem em que aparecem. Oportunidade e Comunicação
// vêm primeiro por serem o eixo destas automações; Integração e Controle por
// último, que é o uso mais raro. "Gatilhos" não está aqui de propósito.
export const SECOES: {
  dominio: Bloco["dominio"];
  titulo: string;
  descricao: string;
}[] = [
  { dominio: "oportunidade", titulo: "Oportunidade", descricao: "Mexer no negócio" },
  { dominio: "comunicacao", titulo: "Comunicação", descricao: "Falar com o contato" },
  { dominio: "contato", titulo: "Contato", descricao: "Cadastro, tags e segmentos" },
  { dominio: "condicao", titulo: "Condições", descricao: "Desvios e filtros" },
  { dominio: "controle", titulo: "Controle", descricao: "Espera e encadeamento" },
  { dominio: "integracao", titulo: "Integração", descricao: "Sair do CRM" },
];

// Agrupamento pronto: o catálogo é constante em tempo de execução, então filtrar
// por domínio a cada render da paleta seria trabalho repetido à toa.
export const BLOCOS_POR_DOMINIO = new Map<Bloco["dominio"], Bloco[]>(
  SECOES.map((s) => [s.dominio, CATALOGO.filter((b) => b.dominio === s.dominio)]),
);
