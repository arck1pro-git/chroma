// O que uma IA de atendimento pode fazer além de conversar, e os tipos que a
// tela e o servidor dividem. Sem "server-only": a gaveta de IAs lê o catálogo
// para desenhar as caixas de marcar, e lib/ia/atendente.ts lê para dar as
// ferramentas ao modelo.
//
// Ação nova = uma linha aqui + a ferramenta em lib/ia/atendente.ts. O banco
// guarda só a chave (ias.acoes, text[]), sem CHECK — não precisa migration.

export const ACOES_IA = [
  {
    chave: "passar_para_humano",
    rotulo: "Passar a conversa para uma pessoa",
    descricao:
      "Quando o cliente pede alguém, quer negociar, fechar ou agendar, ou reclama, ela entrega a conversa à equipe e se desliga para esse contato. Desmarcada, ela nunca sai da conversa: nesses casos avisa a equipe e continua atendendo.",
  },
  {
    chave: "mover_etapa",
    rotulo: "Mover a oportunidade entre etapas",
    descricao:
      "Ela pode mudar a oportunidade do contato de etapa, dentro do mesmo funil, quando o prompt disser em que situação. Conta como arrastar o card: entra no histórico, na cadência e no pixel da etapa nova — e quem atende dali em diante é a IA dessa etapa.",
  },
  {
    chave: "registrar_objecao",
    rotulo: "Registrar objeções no histórico",
    descricao:
      "Quando o cliente levanta uma objeção (taxa, garantia, prazo, material antes, decisor…), ela anota no histórico do contato a frase dele, a categoria, o que estava por trás e como respondeu. É o banco vivo de objeções para a equipe revisar; não muda nada na conversa.",
  },
  {
    chave: "agendar_reuniao",
    rotulo: "Agendar a reunião no Google Calendar",
    descricao:
      "Com a agenda conectada em Integrações, ela oferece os horários livres do especialista (seg a sex, 10h às 18h, reuniões de 1h, nos próximos 10 dias úteis) e marca a reunião com link do Meet quando o cliente escolhe. A reunião fica ligada à oportunidade, entra no histórico, e o contato com e-mail recebe o convite. Quem já tem reunião marcada não recebe outra.",
  },
] as const;

export type AcaoIa = (typeof ACOES_IA)[number]["chave"];

export const CHAVES_ACOES: readonly string[] = ACOES_IA.map((a) => a.chave);

/** Uma IA de atendimento (a linha de `ias`). */
export type Ia = {
  id: string;
  nome: string;
  prompt: string;
  acoes: string[];
  /** Mensagem do celular que liga/desliga esta IA no contato (lib/ia/contato-ia.ts). */
  palavra_chave: string | null;
  /**
   * Minutos de silêncio antes de cada retomada, contados da mensagem anterior
   * dela (lib/ia/retomada.ts). Vazio = não retoma.
   */
  retomar_apos: number[];
  /** Janela da retomada, em horas cheias de Brasília: das `retomar_das` às `retomar_ate` (exclusiva). */
  retomar_das: number;
  retomar_ate: number;
  data_criacao: string;
};

export type IaResumo = Pick<Ia, "id" | "nome">;

/**
 * Quem atende o contato, do jeito que o interruptor precisa para se desenhar.
 * `valor` e `iaId` são as colunas do contato; `etapas` e `iaDaEtapa` dizem o
 * que vale quando ele segue a etapa.
 */
export type EstadoIaContato = {
  /** contatos.ia: true ligada à mão, false desligada à mão, null segue a etapa. */
  valor: boolean | null;
  /** contatos.ia_id: a IA escolhida quando ligada à mão. */
  iaId: string | null;
  /** Etapas COM IA em que ele tem oportunidade aberta ("Qualificação, Proposta"), ou null. */
  etapas: string | null;
  /** Nome da IA dessas etapas, ou null. */
  iaDaEtapa: string | null;
};

export const LIMITE_NOME_IA = 80;
export const LIMITE_PROMPT_IA = 20_000;
export const LIMITE_PALAVRA_IA = 40;

/** Retomadas por silêncio: quantas no máximo e o menor e o maior tempo de cada uma, em minutos. */
export const MAX_RETOMADAS = 5;
export const RETOMADA_MIN_MINUTOS = 15;
export const RETOMADA_MAX_MINUTOS = 30 * 24 * 60;
