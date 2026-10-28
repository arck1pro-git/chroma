// Ícone e cor de cada bloco do fluxo da campanha. Mora aqui, e não no catálogo
// (lib/campanhas-fluxo.ts): o catálogo é contrato com o motor, que não tem
// nada a ver com Tailwind nem com ícone — o mesmo corte de
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
  MessageCircle,
  MessageCircleReply,
  MessageSquareText,
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
};

export const GRUPOS: Array<{ grupo: GrupoBloco; titulo: string }> = [
  { grupo: "mensagem", titulo: "Mensagem" },
  { grupo: "espera", titulo: "Espera" },
  { grupo: "crm", titulo: "CRM" },
  { grupo: "equipe", titulo: "Equipe" },
];

// Só o quadradinho do ícone tem cor, como no editor de Automações: o resto do
// cartão fica zinc, senão o canvas vira ruído.
export const COR_DO_GRUPO: Record<GrupoBloco, string> = {
  mensagem:
    "bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-200/70 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:ring-fuchsia-500/20",
  espera:
    "bg-orange-50 text-orange-600 ring-orange-200/70 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20",
  crm: "bg-emerald-50 text-emerald-600 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  equipe:
    "bg-violet-50 text-violet-600 ring-violet-200/70 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20",
};
