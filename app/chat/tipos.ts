// O que o servidor monta para a tela do chat. Só tipos — o client importa
// daqui, então nada de import de servidor (banco, uazapi, Meta).
import type { Atendimento, Contato, Etapa, Funil, Mensagem, Oportunidade, Usuario } from "@/lib/entidades";
import type { Documento } from "@/lib/documentos";
import type { EstadoIaContato, IaResumo } from "@/lib/ia/catalogo";
import type { ComentariosDaConta } from "@/lib/instagram-tipos";
import type { MidiaDoCabecalho } from "@/lib/templates-whatsapp";

/** "instagram" = uma conta profissional do Instagram (DMs e comentários), desde 2026-10-26. */
export type TipoCanal = "web" | "api" | "instagram";
export type EstadoCanal = "conectado" | "conectando" | "desconectado" | "desconhecido";

/**
 * Um número nosso, ou uma conta do Instagram. `chave` são os dígitos do número
 * (no Instagram, o id da conta) — é o que as conversas guardam em
 * `atendimentos.numero_instancia`, e é o que vai na URL (?canal=).
 */
export type CanalChat = {
  chave: string;
  tipo: TipoCanal;
  nome: string;
  perfil: string | null;
  /** O número legível; no Instagram, o @. */
  numero: string;
  foto: string | null;
  estado: EstadoCanal;
  /** Conversas (não encerradas) com mensagem que ninguém leu. */
  naoLidas: number;
  naFila: number;
  /** Só no Instagram: comentários de terceiros que ninguém leu. */
  comentariosNaoLidos?: number;
};

/** No canal de Instagram: as conversas de direct ou os comentários das postagens (?aba=). */
export type AbaInstagram = "direct" | "comentarios";

/** 'ia' = a IA que atende o contato (lib/ia/atendente.ts); 'automacao' = cadência/campanha. */
export type EnviadaPor = "automacao" | "ia" | "crm" | "aparelho" | null;

export type UltimaMensagem = {
  texto: string;
  tipo: Mensagem["tipo"];
  origem: Mensagem["origem"];
  status: Mensagem["status"];
  enviada_por: EnviadaPor;
  data: string;
  /** Num grupo: quem mandou (mensagens.remetente_nome). */
  remetente?: string | null;
};

/**
 * Uma linha da lista de conversas. Conversa de GRUPO do WhatsApp (2026-10-29):
 * contato_id null, grupo_id preenchido e contato_nome com o nome do grupo.
 */
export type ConversaResumo = {
  id: string;
  contato_id: string | null;
  grupo_id: string | null;
  contato_nome: string;
  contato_whatsapp: string | null;
  /** Fixada no topo da lista, para toda a equipe (null = não está). */
  fixada_em: string | null;
  responsavel_id: string | null;
  status: Atendimento["status"];
  canal: Atendimento["canal"];
  numero_instancia: string | null;
  data_criacao: string;
  nao_lidas: number;
  ultima: UltimaMensagem | null;
  /**
   * API oficial: até quando dá para mandar texto livre — a última mensagem do
   * contato + 24h. `null` = o contato nunca escreveu (só template).
   */
  janela_ate: string | null;
};

export type MensagemChat = Mensagem & {
  erro: string | null;
  enviada_por: EnviadaPor;
};

/** O grupo do WhatsApp de uma conversa de grupo. */
export type GrupoChat = { id: string; nome: string; jid: string; foto: string | null };

export type ConversaAberta = {
  id: string;
  resumo: ConversaResumo;
  /** null na conversa de grupo: o que é do contato (ficha, oportunidades, IA) não se aplica. */
  contato: Contato | null;
  grupo: GrupoChat | null;
  mensagens: MensagemChat[];
  oportunidades: Oportunidade[];
  /** Quem atende o contato: o ajuste dele (contatos.ia/ia_id) e o que a etapa diria. */
  ia: EstadoIaContato;
  /** O mesmo contato falando com OUTROS números nossos. */
  outras: Array<{ id: string; numero_instancia: string | null; canal: Atendimento["canal"]; status: Atendimento["status"] }>;
};

export type DadosChat = {
  canais: CanalChat[];
  /** Canal escolhido: a chave, ou "" = todos. */
  canal: string;
  conversas: ConversaResumo[];
  aberta: ConversaAberta | null;
  usuarios: Usuario[];
  funis: Funil[];
  etapas: Etapa[];
  documentos: Documento[];
  /** As IAs de atendimento, para o "ligada à mão" do interruptor do contato. */
  ias: IaResumo[];
  /** Canal de Instagram: a aba aberta (?aba=). Fora do Instagram, "direct". */
  aba: AbaInstagram;
  /** Só com um canal de Instagram e a aba "comentarios"; senão null. */
  instagram: ComentariosDaConta | null;
  /** Dados fictícios (só em desenvolvimento, ?demo=1): nada é gravado nem enviado. */
  demo: boolean;
};

/** Um template aprovado, pronto para o seletor do compositor. */
export type TemplateChat = {
  nome: string;
  idioma: string;
  categoria: string;
  cabecalho: string | null;
  corpo: string;
  rodape: string | null;
  botoes: string[];
  variaveisCabecalho: number;
  variaveisCorpo: number;
  /**
   * Os botões de link que terminam em {{1}} (lib/templates-whatsapp.ts,
   * linksVariaveisDe): cada um pede o final do link no envio, em
   * `botoes[indice]` de enviarTemplate. `indice` é a posição entre todos os botões.
   */
  linksVariaveis: Array<{ indice: number; texto: string; url: string }>;
  /**
   * O arquivo que o cabeçalho de mídia pede (midiaDoCabecalho, desde
   * 2026-10-28): o tipo do documento da biblioteca que vai em `midia` de
   * enviarTemplate. null = cabeçalho de texto ou sem cabeçalho.
   */
  midia: MidiaDoCabecalho | null;
  /** Motivo quando não dá para mandar daqui (cabeçalho de localização, variável com nome, link fora do padrão). */
  bloqueio: string | null;
};
