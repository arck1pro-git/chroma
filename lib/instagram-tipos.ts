// Tipos do canal de Instagram do chat (2026-10-26): comentários das postagens
// e as regras da IA que responde a eles. Só tipos — a tela importa daqui, então
// nada de import de servidor. As DMs não estão aqui: viram conversa comum
// (atendimentos.canal = 'instagram', numero_instancia = id da conta).

/** Uma conta profissional do Instagram que o CRM atende (lib/social/perfis.ts). */
export type ContaInstagram = {
  /** Id da conta profissional (17841…): é a `chave` do canal no chat e o `numero_instancia` das DMs. */
  id: string;
  /** O @, sem a arroba. */
  usuario: string;
  nome: string;
  /** Página do Facebook ligada à conta: é por ela que sai o direct. */
  paginaId: string;
};

/** Uma postagem da conta, lida da Graph API (não fica no banco). */
export type PostagemInstagram = {
  id: string;
  legenda: string;
  /** IMAGE, VIDEO, CAROUSEL_ALBUM… como a Meta devolve. */
  tipo: string;
  miniatura: string | null;
  link: string;
  /** ISO 8601. */
  quando: string;
  /** Total de comentários segundo a Meta. */
  comentarios: number;
  /** Comentários de terceiros registrados no CRM que ninguém marcou como lidos. */
  naoLidos: number;
};

export type ComentarioInstagram = {
  /** Id da linha em instagram_comentarios. */
  id: string;
  /** Id do comentário na Meta. */
  comentarioId: string;
  /** Comentário respondido (thread); null = comentário na postagem. */
  paiId: string | null;
  autorUsuario: string | null;
  texto: string;
  /** Feito pela própria conta (as nossas respostas). */
  daConta: boolean;
  /** Quem respondeu, quando daConta: a IA, alguém pelo CRM, ou pelo app do celular. */
  enviadaPor: "ia" | "crm" | "aparelho" | null;
  contatoId: string | null;
  /** A conversa de direct do autor com esta conta, se já existir. */
  atendimentoId: string | null;
  /** ISO 8601 — a hora do comentário. */
  quando: string;
  lido: boolean;
  /** Por que o private reply não pode ser usado; null quando está disponível. */
  motivoDirect?: string | null;
};

export type PaginaComentariosInstagram = {
  comentarios: ComentarioInstagram[];
  antes: string | null;
  temMais: boolean;
};

/** IA que responde comentários. midiaId null = todas as postagens da conta; a da postagem vence. */
export type RegraIaInstagram = {
  contaId: string;
  midiaId: string | null;
  iaId: string;
  ligada: boolean;
};

/** O que a aba "Comentários" de uma conta mostra. */
export type ComentariosDaConta = {
  conta: ContaInstagram;
  postagens: PostagemInstagram[];
  /** Postagem aberta (?postagem=); null = nenhuma escolhida. */
  postagemId: string | null;
  /** Comentários da postagem aberta, do mais antigo ao mais novo; vazio sem postagem. */
  comentarios: ComentarioInstagram[];
  /** Regras da conta (a geral e as das postagens). */
  regras: RegraIaInstagram[];
  /**
   * Responder em público e ligar a IA falam pela marca: só quem tem o módulo
   * Meta (Admin e TI). As ações conferem de novo; isto só esconde os controles.
   */
  podeAdministrar: boolean;
  podeResponderPublico?: boolean;
  podeResponderDirect?: boolean;
  antesComentarios?: string | null;
  temMaisComentarios?: boolean;
  /** Falha ao ler as postagens na Meta: a tela mostra e segue com o que tiver. */
  erro: string | null;
};
