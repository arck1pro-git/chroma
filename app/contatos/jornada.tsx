"use client";

// A JORNADA do lead, numa faixa: de onde veio até onde está — o anúncio, a
// entrada, a primeira conversa, o vídeo, a reunião, a etapa de agora.
//
// É a pergunta que toda ficha de CRM deixa para quem lê montar de cabeça,
// juntando datas de cinco cartões diferentes. Aqui ela vem pronta, em ordem, e
// o último marco — onde ele está agora — aceso no tom da etapa, o mesmo da
// coluna do quadro.
//
// Só entra marco que existe: lead que chegou ontem pelo WhatsApp tem uma
// jornada curta, e está certo que pareça curta.
import {
  CalendarCheck2,
  Clapperboard,
  Flag,
  Inbox,
  Megaphone,
  MessageCircle,
  ThumbsDown,
  Trophy,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { EtapaComTom, FichaContato } from "@/lib/contatos-ficha";
import { dataCurta, dinheiro } from "./pecas";

type Marco = {
  chave: string;
  Icone: LucideIcon;
  rotulo: string;
  detalhe: string | null;
  quando: string | null;
  /** O marco de agora: aceso no tom da etapa. */
  tom?: string;
};

const CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  whatsapp_oficial: "WhatsApp oficial",
  instagram: "Instagram",
  email: "E-mail",
};

function marcos(ficha: FichaContato, etapas: Record<string, EtapaComTom>): Marco[] {
  const { origem, conversas, videos, reunioes, oportunidades, historico, contato } = ficha;
  const lista: Marco[] = [];

  // De onde veio (sem data: é a causa, não um acontecimento).
  if (origem.anuncio || origem.campanha) {
    lista.push({
      chave: "anuncio",
      Icone: Megaphone,
      rotulo: origem.anuncio ? "Anúncio" : "Campanha",
      detalhe: origem.anuncio ?? origem.campanha,
      quando: null,
    });
  } else if (origem.fonte) {
    lista.push({ chave: "fonte", Icone: Megaphone, rotulo: "Origem", detalhe: origem.fonte, quando: null });
  }

  // Como entrou.
  const criado = new Date(contato.dataCriacao).getTime();
  const perto = (iso: string) => Math.abs(new Date(iso).getTime() - criado) < 10 * 60_000;
  const captacao = origem.captacoes[0];
  const primeiras = conversas
    .filter((c) => c.primeiraEm)
    .sort((a, b) => a.primeiraEm!.localeCompare(b.primeiraEm!));
  const primeira = primeiras[0];
  const entrouPorMensagem = !captacao && primeira?.primeiraEm && perto(primeira.primeiraEm);

  if (captacao) {
    lista.push({ chave: "entrada", Icone: Inbox, rotulo: "Entrou", detalhe: captacao.webhook, quando: captacao.quando });
  } else if (entrouPorMensagem) {
    lista.push({
      chave: "entrada",
      Icone: MessageCircle,
      rotulo: "Mandou mensagem",
      detalhe: CANAL[primeira.canal] ?? primeira.canal,
      quando: primeira.primeiraEm,
    });
  } else {
    lista.push({ chave: "entrada", Icone: UserPlus, rotulo: "Cadastrado", detalhe: "no CRM", quando: contato.dataCriacao });
  }

  if (primeira?.primeiraEm && !entrouPorMensagem) {
    const total = conversas.reduce((s, c) => s + c.mensagens, 0);
    lista.push({
      chave: "conversa",
      Icone: MessageCircle,
      rotulo: "1ª conversa",
      detalhe: `${total} ${total === 1 ? "mensagem" : "mensagens"}`,
      quando: primeira.primeiraEm,
    });
  }

  if (videos.length) {
    const primeiro = [...videos].sort((a, b) => a.primeira.localeCompare(b.primeira))[0];
    const melhor = Math.max(...videos.map((v) => (v.duracao ? Math.min(1, v.cobertura / v.duracao) : 0)));
    lista.push({
      chave: "video",
      Icone: Clapperboard,
      rotulo: videos.length === 1 ? "Viu o vídeo" : `Viu ${videos.length} vídeos`,
      detalhe: videos.length === 1 ? `${Math.round(melhor * 100)}% de ${primeiro.nome}` : `até ${Math.round(melhor * 100)}%`,
      quando: primeiro.primeira,
    });
  }

  if (reunioes.length) {
    const primeiraReuniao = [...reunioes].sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
    lista.push({
      chave: "reuniao",
      Icone: CalendarCheck2,
      rotulo: reunioes.length === 1 ? "Reunião" : `${reunioes.length} reuniões`,
      detalhe: primeiraReuniao.pelaIa ? "marcada pela IA" : `com ${primeiraReuniao.autor ?? "a equipe"}`,
      quando: primeiraReuniao.inicio,
    });
  }

  // Ordem do tempo para o que tem data; a origem (sem data) vem antes de tudo.
  const semData = lista.filter((m) => !m.quando);
  const comData = lista.filter((m) => m.quando).sort((a, b) => a.quando!.localeCompare(b.quando!));

  // Onde está agora: a oportunidade aberta mais nova, ou o desfecho da última.
  const aberta = oportunidades.find((o) => o.status === "aberta");
  const fechada = oportunidades.find((o) => o.status === "ganha" || o.status === "perdida");
  let agora: Marco | null = null;
  if (aberta) {
    const etapa = etapas[aberta.etapaId];
    // Desde quando está nesta etapa: a última mudança de etapa que caiu nela.
    const entrada = historico.find(
      (h) => h.oportunidadeId === aberta.id && etapa && h.descricao.endsWith(` para ${etapa.nome}`),
    );
    agora = {
      chave: "agora",
      Icone: Flag,
      rotulo: etapa?.nome ?? "Etapa removida",
      detalhe: aberta.valor > 0 ? `${etapa?.funil ?? "funil"} · ${dinheiro(aberta.valor)}` : (etapa?.funil ?? "funil"),
      quando: entrada?.quando ?? aberta.dataCriacao,
      tom: etapa?.cor ?? "bg-zinc-900",
    };
  } else if (fechada) {
    agora = {
      chave: "agora",
      Icone: fechada.status === "ganha" ? Trophy : ThumbsDown,
      rotulo: fechada.status === "ganha" ? "Ganho" : "Perdido",
      detalhe: dinheiro(fechada.valor),
      quando: null,
      tom: fechada.status === "ganha" ? "bg-emerald-600" : "bg-zinc-500",
    };
  }

  return [...semData, ...comData, ...(agora ? [agora] : [])];
}

export default function Jornada({ ficha, etapas }: { ficha: FichaContato; etapas: Record<string, EtapaComTom> }) {
  const lista = marcos(ficha, etapas);
  if (lista.length < 2) return null;

  return (
    <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">Jornada</h3>
      <ol className="rolagem-oculta -mx-1 flex overflow-x-auto px-1 pb-1">
        {lista.map((m, i) => {
          const ultimo = i === lista.length - 1;
          return (
            <li key={m.chave} className="relative min-w-[8.5rem] flex-1 pr-3">
              {!ultimo && (
                <span className="absolute left-3 right-0 top-3 h-px bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />
              )}
              <span
                className={`relative flex size-6 items-center justify-center rounded-full ${
                  m.tom
                    ? `${m.tom} text-white shadow-sm`
                    : "border border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
                }`}
              >
                <m.Icone className="size-3" aria-hidden="true" />
              </span>
              <p
                className={`mt-2 truncate text-[12px] ${
                  m.tom ? "font-semibold text-zinc-900 dark:text-zinc-50" : "font-medium text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {m.rotulo}
              </p>
              {m.detalhe && (
                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={m.detalhe}>
                  {m.detalhe}
                </p>
              )}
              <p className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {m.quando ? (m.chave === "agora" ? `desde ${dataCurta(m.quando)}` : dataCurta(m.quando)) : " "}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
