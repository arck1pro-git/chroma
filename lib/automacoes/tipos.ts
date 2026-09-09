// Tipos do módulo de Automações. Formato "chroma.flow/v1" — ver
// docs/automacoes-arquitetura.md §5.
//
// Regra que sustenta a troca de motor: NADA aqui pode mencionar n8n. Este
// arquivo descreve regra de negócio; a tradução para o executor vive só em
// lib/automacoes/motores/<motor>/.

export type Familia = "condicao" | "acao";

// Agrupa por assunto do CRM, não por tipo técnico. É o que decide a cor no
// builder e a seção na paleta — quem procura "mover de etapa" pensa em
// oportunidade, não em "ação de escrita".
export type Dominio =
  | "condicao"
  | "contato"
  | "oportunidade"
  | "comunicacao"
  | "integracao"
  | "controle";

// Saída nomeada de um bloco. É o que vira `ramo` na aresta e permite o
// "├─ Sim / └─ Não" do desenho original — uma lista de passos não conseguiria.
export type Saida = {
  id: string;
  rotulo: string;
};

// Contrato de semântica (§5.4 do documento). Existe para que trocar de motor
// seja verificável em vez de torcida: um adaptador que não garanta o que está
// declarado aqui deve FALHAR na compilação, não publicar algo que se comporta
// diferente.
export type Contrato = {
  // "imediata": resolve dentro da execução corrente.
  // "sobrevive_reinicio": o motor tem que retomar depois de cair.
  durabilidade: "imediata" | "sobrevive_reinicio";
  // Escreve fora do CRM ou dispara algo irreversível (mensagem, HTTP).
  // Governa o modo simulação e o rate limit — ver §2.2 do documento.
  efeitoColateral: boolean;
  // Duração máxima suportada, em ISO-8601 de duração. Só para blocos de espera.
  duracaoMaxima?: string;
};

export type Bloco = {
  // Id estável, gravado no JSON do fluxo. NUNCA renomear sem migração: fluxos
  // publicados referenciam esta string.
  tipo: string;
  familia: Familia;
  dominio: Dominio;
  rotulo: string;
  descricao: string;
  // Todo bloco tem exatamente uma entrada: o único nó sem entrada é o de
  // entrada do fluxo, que não é um bloco do catálogo.
  entradas: 1;
  saidas: Saida[];
  contrato: Contrato;
  // Depende de coisa que ainda não existe no CRM (entidade tarefas, agendador).
  // A paleta mostra, mas marcado — honesto é melhor que esconder.
  indisponivel?: string;
};

// ── Definição de fluxo (o JSON que vai para o banco) ────────────────────────

export type Operador =
  | "igual"
  | "diferente"
  | "contem"
  | "comeca_com"
  | "maior_que"
  | "menor_que"
  | "entre"
  | "vazio"
  | "preenchido"
  | "mudou"
  | "mudou_de_para";

export type Condicao =
  | { op: "e" | "ou"; condicoes: Condicao[] }
  | { op: "nao"; condicao: Condicao }
  | { campo: string; operador: Operador; valor?: unknown };

export type No = {
  tipo: string;
  config: Record<string, unknown>;
};

export type Aresta = {
  de: string;
  para: string;
  ramo?: string;
};

export type Posicao = { x: number; y: number };

// Sem gatilho: o fluxo não reage a evento, ele recebe inscrições. Contato ou
// oportunidade é ADICIONADO ao fluxo (pela tela, por uma lista, ou por um
// "Mudar fluxo" de outro), e a execução começa no nó de entrada.
export type DefinicaoFluxo = {
  schema: "chroma.flow/v1";
  // Mapa e não array: a aresta referencia por id, e mapa impede id duplicado
  // por construção.
  nos: Record<string, No>;
  arestas: Aresta[];
  // Só apresentação. Separado da lógica para que arrastar um bloco na tela não
  // gere diff semântico ao comparar versões (§3.5 do documento).
  layout: Record<string, Posicao>;
};

// Raiz do grafo: por onde a entidade inscrita entra. Não é um bloco do
// catálogo — não se arrasta, não se apaga, e não tem configuração.
export const NO_ENTRADA = "__entrada__";
