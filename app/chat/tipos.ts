// O que o servidor monta para a tela do chat. Só tipos — o client importa
// daqui, então nada de import de servidor (banco, uazapi, Meta).
import type { Atendimento, Contato, Etapa, Funil, Mensagem, Oportunidade, Usuario } from "../data";
import type { Documento } from "@/lib/documentos";
import type { EstadoIaContato, IaResumo } from "@/lib/ia/catalogo";

export type TipoCanal = "web" | "api";
export type EstadoCanal = "conectado" | "conectando" | "desconectado" | "desconhecido";

/**
 * Um número nosso. `chave` são os dígitos do número — é o que as conversas
 * guardam em `atendimentos.numero_instancia`, e é o que vai na URL (?canal=).
 */
export type CanalChat = {
  chave: string;
  tipo: TipoCanal;
  nome: string;
  perfil: string | null;
  numero: string;
  foto: string | null;
  estado: EstadoCanal;
  /** Conversas (não encerradas) com mensagem que ninguém leu. */
  naoLidas: number;
  naFila: number;
};

/** 'ia' = a IA que atende o contato (lib/ia/atendente.ts); 'automacao' = cadência/campanha. */
export type EnviadaPor = "automacao" | "ia" | "crm" | "aparelho" | null;

export type UltimaMensagem = {
  texto: string;
  tipo: Mensagem["tipo"];
  origem: Mensagem["origem"];
  status: Mensagem["status"];
  enviada_por: EnviadaPor;
  data: string;
};

/** Uma linha da lista de conversas. */
export type ConversaResumo = {
  id: string;
  contato_id: string;
  contato_nome: string;
  contato_whatsapp: string | null;
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

export type ConversaAberta = {
  id: string;
  resumo: ConversaResumo;
  contato: Contato;
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
  /** Motivo quando não dá para mandar daqui (cabeçalho de mídia, botão com variável). */
  bloqueio: string | null;
};
