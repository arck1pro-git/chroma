// Ícone e cor por bloco. Vive aqui, não no catálogo: lib/automacoes/catalogo.ts
// é domínio (o que o bloco faz) e será lido também pelo validador e pelo
// compilador, que não têm nada a ver com Tailwind nem com lucide.
//
// As classes são literais de propósito — o Tailwind varre o código-fonte, então
// classe montada por concatenação seria purgada no build (mesmo motivo do
// @source inline em globals.css, para as cores de etapa que vêm do banco).

import {
  BadgeCheck,
  Bell,
  CirclePlus,
  GitBranch,
  Globe,
  Mail,
  MessageCircle,
  MessageCircleReply,
  MessagesSquare,
  PencilLine,
  Route,
  Shuffle,
  Tag,
  Timer,
  UserPen,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Dominio } from "@/lib/automacoes/tipos";

export const ICONES: Record<string, LucideIcon> = {
  // condições
  se: GitBranch,
  alternador: Route,

  // ações — oportunidade
  criar_oportunidade: CirclePlus,
  atualizar_oportunidade: PencilLine,

  // ações — comunicação
  enviar_whatsapp_web: MessageCircle,
  enviar_whatsapp_oficial: BadgeCheck,
  enviar_email: Mail,
  enviar_notificacao: Bell,
  verificar_resposta: MessageCircleReply,

  // ações — contato
  atualizar_contato: UserPen,
  mudar_tag: Tag,
  mudar_segmento: Users,

  // ações — controle
  esperar: Timer,
  mudar_fluxo: Shuffle,

  // ações — integração
  requisicao_http: Globe,
};

export const ICONE_PADRAO = Workflow;

// Ícone da categoria na paleta. Repetir aqui um ícone que também representa um
// bloco é aceitável: são níveis diferentes de navegação e nunca aparecem lado a
// lado.
export const ICONES_DOMINIO: Record<Dominio, LucideIcon> = {
  condicao: GitBranch,
  contato: Users,
  oportunidade: Wallet,
  comunicacao: MessagesSquare,
  integracao: Globe,
  controle: Timer,
};

// Só o quadradinho do ícone recebe cor. O resto do cartão fica zinc, como o
// funil faz com as etapas — a tela tem 45 blocos, colorir tudo viraria ruído.
export const CORES: Record<Dominio, string> = {
  condicao:
    "bg-violet-50 text-violet-600 ring-violet-200/70 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20",
  contato:
    "bg-sky-50 text-sky-600 ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20",
  oportunidade:
    "bg-emerald-50 text-emerald-600 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  comunicacao:
    "bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-200/70 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:ring-fuchsia-500/20",
  integracao:
    "bg-cyan-50 text-cyan-600 ring-cyan-200/70 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/20",
  controle:
    "bg-orange-50 text-orange-600 ring-orange-200/70 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20",
};
