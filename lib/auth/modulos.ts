// O catálogo de módulos: a lista do que EXISTE.
//
// Quem tem acesso a cada um está no banco (departamento_modulos), e é por isso
// que o TI muda permissão na tela sem deploy. O que NÃO dá pra tirar do código
// é esta lista: um módulo é uma rota com page.tsx, e nenhuma linha de banco cria
// uma rota. A tabela responde "o Comercial vê /agenda?"; este arquivo responde
// "existe /agenda?".
//
// SEM `server-only` de propósito: a barra lateral é client component e precisa
// do rótulo e do href pra desenhar os itens. Aqui só há dado inerte — nada de
// consulta, nada de segredo. Quem decide acesso é ./permissoes.ts, que é
// server-only e é onde a checagem tem que ficar.
//
// MÓDULO NOVO: acrescente a linha aqui, crie o page.tsx com `exigirModulo()` e
// vá em /configuracoes/acessos marcar quem recebe. Ele nasce sem ninguém — do
// mesmo jeito que rota nova nasce protegida no proxy.ts.

export type ChaveModulo =
  | "inicio"
  | "chat"
  | "contatos"
  | "agenda"
  | "demandas"
  | "metricas"
  | "emails"
  | "automacoes"
  | "campanhas"
  | "templates"
  | "blog"
  | "webhooks"
  | "documentos"
  | "videos"
  | "contextos"
  | "meta"
  | "integracoes"
  | "configuracoes";

/**
 * Até onde a pessoa enxerga dentro do módulo. Espelha o CHECK da coluna
 * `departamento_modulos.escopo`.
 */
export type Escopo = "proprio" | "todos";

export type Modulo = {
  chave: ChaveModulo;
  rotulo: string;
  href: string;
  /**
   * O módulo sabe filtrar por dono? Só quem é `escopavel` oferece a escolha
   * entre "próprio" e "todos" na tela de acessos.
   *
   * Hoje, só o Dashboard: com escopo 'proprio', `carregarFunil` só traz as
   * oportunidades em que a pessoa é a responsável (app/funil/dados.ts), e o
   * quadro, os totais e a exportação saem todos dessa mesma consulta. A
   * Métricas foi escopável até 2026-10-07; agora quem vê a equipe é o
   * departamento (Admin e TI), como nas Demandas.
   *
   * A regra continua valendo para os próximos: só marque escopável o módulo que
   * FILTRA. Bandeira sem filtro promete na tela o que o dado não cumpre.
   */
  escopavel: boolean;
  /**
   * Aparece na barra lateral? /meta e /integracoes continuam fora — a barra é
   * pro que se usa todo dia, e isso já era assim antes das permissões.
   * Configurações também é false: ela tem lugar próprio, no rodapé da barra.
   */
  naBarra: boolean;
  /** Uma linha, mostrada na tela de acessos pra quem for marcar saber o que é. */
  descricao: string;
};

// A ORDEM É A DA BARRA LATERAL. Mexer aqui mexe no menu de todo mundo.
export const MODULOS: readonly Modulo[] = [
  {
    chave: "inicio",
    rotulo: "Dashboard",
    href: "/",
    escopavel: true,
    naBarra: true,
    descricao:
      "Quadro do funil, oportunidades e a gaveta de contatos. Com escopo 'próprio', cada pessoa vê só as oportunidades em que é a responsável.",
  },
  {
    chave: "chat",
    rotulo: "Chat",
    href: "/chat",
    escopavel: false,
    naBarra: true,
    descricao: "Conversas de WhatsApp e a fila de atendimento.",
  },
  {
    chave: "contatos",
    rotulo: "Contatos",
    href: "/contatos",
    escopavel: false,
    naBarra: true,
    descricao:
      "A base de contatos com a ficha completa de cada um: origem, oportunidades, conversas, reuniões, vídeos que recebeu, automações e histórico. Vê todos os contatos — não filtra por responsável.",
  },
  {
    chave: "agenda",
    rotulo: "Agenda",
    href: "/agenda",
    escopavel: false,
    naBarra: true,
    descricao:
      "Compromissos da semana no Google Calendar da conta conectada em Integrações, com o lead de cada reunião marcada pelo CRM.",
  },
  {
    chave: "demandas",
    rotulo: "Demandas",
    href: "/demandas",
    // Não é escopável: quem cria para os outros e vê as de todo mundo é o
    // DEPARTAMENTO (Admin e TI, em lib/demandas.ts), decisão dele de
    // 2026-10-07. O resto vê as suas e cria só para si ou para o TI.
    escopavel: false,
    naBarra: true,
    descricao:
      "Tarefas de cada pessoa, com o check de feito, e os chamados para o TI. Cada um cria demandas para si ou abre chamado para o TI (também pelo botão do Dashboard); Admin e TI criam para qualquer pessoa ou para todos e veem as de todos. O TI precisa do módulo para receber os chamados.",
  },
  {
    chave: "metricas",
    rotulo: "Métricas",
    href: "/metricas",
    // Não é mais escopável (2026-10-07): quem vê a equipe e filtra por pessoa
    // é o DEPARTAMENTO — Admin e TI, a mesma regra das Demandas
    // (administraDemandas em lib/demandas.ts). O escopo marcado em Acessos não
    // muda nada aqui, e por isso a tela de Acessos deixa de oferecê-lo.
    escopavel: false,
    naBarra: true,
    descricao:
      "Demandas geradas e entregues por dia, semana e mês. Admin e TI veem a equipe toda e filtram por pessoa; os demais veem só os próprios números.",
  },
  {
    chave: "emails",
    rotulo: "E-mails",
    href: "/emails",
    escopavel: false,
    naBarra: true,
    descricao: "Disparos por e-mail.",
  },
  {
    chave: "automacoes",
    rotulo: "Automações",
    href: "/automacoes",
    escopavel: false,
    naBarra: true,
    descricao: "Fluxos e cadências — o que dispara sozinho para o contato.",
  },
  {
    chave: "campanhas",
    rotulo: "Campanhas",
    href: "/campanhas",
    escopavel: false,
    naBarra: true,
    descricao: "Campanhas de mídia.",
  },
  {
    chave: "templates",
    rotulo: "Templates",
    href: "/templates",
    escopavel: false,
    naBarra: true,
    descricao: "Templates oficiais do WhatsApp enviados para aprovação na Meta.",
  },
  {
    chave: "blog",
    rotulo: "Blog",
    href: "/blog",
    escopavel: false,
    naBarra: true,
    descricao: "Blogs, artigos e as chaves de publicação.",
  },
  {
    chave: "webhooks",
    rotulo: "Webhooks",
    href: "/webhooks",
    escopavel: false,
    naBarra: true,
    descricao: "Captação de formulário de site e o que cada um faz ao chegar.",
  },
  {
    chave: "documentos",
    rotulo: "Documentos",
    href: "/documentos",
    escopavel: false,
    naBarra: true,
    descricao:
      "Biblioteca de arquivos (PDF, imagem, vídeo) para anexar na cadência e no chat. Quem tem o módulo vê e sobe arquivo para todo mundo — o acervo é da empresa, não de cada um.",
  },
  {
    chave: "videos",
    rotulo: "Vídeos",
    href: "/videos",
    escopavel: false,
    naBarra: true,
    descricao:
      "Vídeos com link rastreável: o link leva o WhatsApp do lead, e a tela mostra quem abriu e quanto assistiu.",
  },
  {
    chave: "contextos",
    rotulo: "Contextos",
    href: "/contextos",
    escopavel: false,
    naBarra: true,
    descricao: "O que a IA sabe sobre o negócio ao responder.",
  },
  {
    chave: "meta",
    rotulo: "Meta",
    href: "/meta",
    escopavel: false,
    naBarra: false,
    descricao: "Integração com a Meta.",
  },
  {
    chave: "integracoes",
    rotulo: "Integrações",
    href: "/integracoes",
    escopavel: false,
    naBarra: false,
    descricao: "Conexões com sistemas de fora.",
  },
  {
    chave: "configuracoes",
    rotulo: "Configurações",
    href: "/configuracoes",
    escopavel: false,
    naBarra: false,
    descricao:
      "Funis, etapas, tags, segmentos, usuários, campos e WhatsApp. Não inclui a tela de Acessos — essa é do departamento que administra.",
  },
] as const;

const PORA_CHAVE = new Map(MODULOS.map((m) => [m.chave, m]));

export function moduloPorChave(chave: ChaveModulo): Modulo {
  const m = PORA_CHAVE.get(chave);
  // Impossível pelo tipo; existe pro caso de a chave vir do BANCO, onde não há
  // CHECK que a prenda ao catálogo (ver migration-departamentos.sql).
  if (!m) throw new Error(`Módulo desconhecido: ${chave}`);
  return m;
}

/**
 * A chave veio do banco e ainda está no catálogo? Módulo removido do código
 * deixa linha órfã em `departamento_modulos`, e essa linha tem que ser ignorada
 * em silêncio — não virar erro na cara de quem abriu a tela.
 */
export function ehChaveModulo(valor: string): valor is ChaveModulo {
  return PORA_CHAVE.has(valor as ChaveModulo);
}

export function ehEscopo(valor: string): valor is Escopo {
  return valor === "proprio" || valor === "todos";
}
