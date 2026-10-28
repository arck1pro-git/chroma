// Ícone, cor e rótulo curto de cada bloco do fluxo da campanha. Mora aqui, e
// não no catálogo (lib/campanhas-fluxo.ts): o catálogo é contrato com o motor,
// que não tem nada a ver com Tailwind nem com ícone — o mesmo corte de
// app/automacoes/aparencia.ts.
//
// Classes literais de propósito: o Tailwind varre o código-fonte, e classe
// montada por concatenação seria purgada no build.
import type { GrupoBloco, TipoBloco } from "@/lib/campanhas-fluxo";
import {
  ArrowRightLeft,
  Bell,
  Bot,
  CirclePlus,
  Clock,
  Funnel,
  GitBranch,
  MessageCircle,
  MessageCircleReply,
  MessageSquareText,
  Paperclip,
  Tag,
  Timer,
  Trophy,
  Users,
  type TipoIcone,
} from "@/app/components/icones";

export const ICONE_DO_BLOCO: Record<TipoBloco, TipoIcone> = {
  enviar_template: MessageSquareText,
  aguardar_resposta: MessageCircleReply,
  enviar_texto: MessageCircle,
  esperar: Timer,
  mudar_tag: Tag,
  mudar_segmento: Users,
  criar_oportunidade: CirclePlus,
  mover_oportunidade: ArrowRightLeft,
  registrar_conversao: Trophy,
  avisar_equipe: Bell,
  ligar_ia: Bot,
  enviar_arquivo: Paperclip,
  horario: Clock,
  condicao: GitBranch,
  limitar_passagem: Funnel,
};

/**
 * O nome na paleta (2026-10-28, pedido dele: "muito texto"): o grupo já diz
 * "Mensagem", então "Template" basta. O cartão e o painel usam o rótulo do
 * catálogo; o title da paleta também.
 */
export const ROTULO_CURTO: Record<TipoBloco, string> = {
  enviar_template: "Template",
  enviar_texto: "Texto",
  enviar_arquivo: "Arquivo",
  aguardar_resposta: "Aguardar resposta",
  esperar: "Esperar",
  horario: "Horário",
  condicao: "Condição",
  limitar_passagem: "Passagem",
  mudar_tag: "Tag",
  mudar_segmento: "Segmento",
  criar_oportunidade: "Criar oportunidade",
  mover_oportunidade: "Mover oportunidade",
  registrar_conversao: "Conversão",
  avisar_equipe: "Avisar equipe",
  ligar_ia: "Passar para a IA",
};

/**
 * Os blocos que só saem com a janela de 24 h aberta (texto livre e arquivo):
 * levam o selo "depois de uma resposta", que explica a janela no title. É o
 * único lugar da tela que fala dela.
 */
export const PEDE_RESPOSTA = new Set<TipoBloco>(["enviar_texto", "enviar_arquivo"]);

export const GRUPOS: Array<{ grupo: GrupoBloco; titulo: string }> = [
  { grupo: "mensagem", titulo: "Mensagem" },
  { grupo: "espera", titulo: "Espera" },
  { grupo: "controle", titulo: "Controle" },
  { grupo: "crm", titulo: "CRM" },
  { grupo: "equipe", titulo: "Equipe" },
];

// Só o quadradinho do ícone tem cor, como no editor de Automações: o resto do
// cartão fica zinc, senão o canvas vira ruído. Âmbar fica de fora: é a cor da
// pendência.
export const COR_DO_GRUPO: Record<GrupoBloco, string> = {
  mensagem:
    "bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-200/70 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:ring-fuchsia-500/20",
  espera:
    "bg-orange-50 text-orange-600 ring-orange-200/70 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20",
  controle: "bg-sky-50 text-sky-600 ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20",
  crm: "bg-emerald-50 text-emerald-600 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  equipe:
    "bg-violet-50 text-violet-600 ring-violet-200/70 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20",
};
