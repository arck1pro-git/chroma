"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlignLeft,
  AtSign,
  Bot,
  CalendarCheck2,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  HelpCircle,
  MapPin,
  MessageCircle,
  Phone,
  Repeat,
  User,
  Users,
  Video,
  Wallet,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { AgendaGoogle, EventoAgenda, ParticipanteEvento, ReuniaoDoSistema } from "@/lib/agenda";
import CamadaTopo from "../components/camada-topo";
import { brl, dataHora, iniciais, localizacao } from "../formato";
import { diaDe, diaPorExtenso, duracao, intervalo } from "./tempo";
import { useAgora } from "./relogio";
import { comCor, corDe, PONTO_COR, quemMarcou } from "./visual";

// O painel do evento: abre da direita, por cima da agenda, com a mesma casca da
// ficha da oportunidade e da gaveta de contatos (véu, cabeçalho fixo, miolo
// rolando). Quando a reunião foi marcada pelo CRM, mostra QUEM é o cliente e a
// oportunidade, com os atalhos para a ficha e para a conversa.
//
// Só leitura: nada aqui altera o evento no Google.

type Props = {
  /** O evento como veio do Google; null quando só o CRM sabe dele (agenda escondida, ou removido lá). */
  evento: EventoAgenda | null;
  agenda: AgendaGoogle | undefined;
  sistema: ReuniaoDoSistema | null;
  aoFechar: () => void;
};

export default function PainelEvento({ evento, agenda, sistema, aoFechar }: Props) {
  const agora = useAgora();
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fechar.current?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const inicio = evento?.inicio ?? sistema?.inicio ?? "";
  const fim = evento?.fim ?? sistema?.fim ?? "";
  const diaInteiro = evento?.diaInteiro ?? false;
  const titulo = evento?.titulo ?? (sistema ? `Reunião — ${sistema.contato.nome}` : "");
  const cor = evento ? corDe(evento, agenda) : "#71717a";
  const passou = agora !== null && fim !== "" && new Date(fim).getTime() <= agora;

  return (
    <CamadaTopo>
      <div className="veu-surge fixed inset-0 z-[300] bg-black/40 backdrop-blur-[1px]" onClick={aoFechar} aria-hidden="true" />

      <aside
        className="ficha-entra fixed bottom-4 right-4 top-4 z-[310] flex w-[27rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        aria-label={`Evento ${titulo}`}
        role="dialog"
        aria-modal="true"
        style={comCor(cor)}
      >
        {/* Faixa da cor da agenda: a mesma pista visual da grade. */}
        <div className={`h-1.5 shrink-0 ${PONTO_COR}`} aria-hidden="true" />

        <header className="shrink-0 border-b border-zinc-200 px-5 pb-4 pt-3 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                <span className={`size-2 shrink-0 rounded-sm ${PONTO_COR}`} aria-hidden="true" />
                {agenda?.nome ?? "Agenda principal"}
              </p>
              <h2 className="mt-1 line-clamp-3 text-[17px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
                {titulo}
              </h2>
            </div>
            <button
              ref={fechar}
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {sistema && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
              {sistema.autor ? <CalendarCheck2 className="size-3.5" aria-hidden="true" /> : <Bot className="size-3.5" aria-hidden="true" />}
              Agendada pelo Chroma {quemMarcou(sistema)} · {dataHora(sistema.marcadaEm)}
            </p>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!evento && sistema && (
            <p className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              O evento não está na tela: a agenda dele está desmarcada no filtro, ou ele foi removido do Google. Os dados
              abaixo são os que o CRM gravou ao marcar.
            </p>
          )}

          {/* Quando */}
          <Linha Icone={Clock}>
            {inicio && (
              <>
                <p className="text-[14px] font-medium text-zinc-900 dark:text-zinc-50">{diaPorExtenso(diaDe(inicio))}</p>
                <p className="mt-0.5 text-[13px] tabular-nums text-zinc-600 dark:text-zinc-300">
                  {intervalo(inicio, fim, diaInteiro)}
                  {!diaInteiro && <span className="text-zinc-400"> · {duracao(inicio, fim)}</span>}
                </p>
              </>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {evento?.recorrente && (
                <Etiqueta>
                  <Repeat className="size-3" aria-hidden="true" /> Se repete
                </Etiqueta>
              )}
              {evento && !evento.ocupa && <Etiqueta>Não bloqueia a agenda</Etiqueta>}
              {passou && <Etiqueta>Já aconteceu</Etiqueta>}
            </div>
          </Linha>

          {evento?.meet && <BlocoMeet link={evento.meet} />}

          {evento?.local && (
            <Linha Icone={MapPin}>
              <a
                href={
                  /^https?:\/\//.test(evento.local)
                    ? evento.local
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(evento.local)}`
                }
                target="_blank"
                rel="noreferrer"
                className="break-words text-[13px] text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100"
              >
                {evento.local}
              </a>
            </Linha>
          )}

          {sistema && <BlocoCliente sistema={sistema} />}

          {sistema?.oportunidade && <BlocoOportunidade op={sistema.oportunidade} />}

          {evento && evento.participantes.length > 0 && (
            <BlocoParticipantes participantes={evento.participantes} organizador={evento.organizador} />
          )}

          {evento?.descricao && (
            <Secao Icone={AlignLeft} titulo="Descrição">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                <ComLinks texto={evento.descricao} />
              </p>
            </Secao>
          )}
        </div>

        {evento?.link && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <p className="min-w-0 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {evento.organizador ? `Organizado por ${evento.organizador}` : "Google Calendar"}
            </p>
            <a
              href={evento.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Abrir no Google
            </a>
          </footer>
        )}
      </aside>
    </CamadaTopo>
  );
}

// ── Peças ─────────────────────────────────────────────────────────────────────

function Linha({ Icone, children }: { Icone: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-3.5">
      <Icone className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Secao({
  Icone,
  titulo,
  contagem,
  children,
}: {
  Icone: LucideIcon;
  titulo: string;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        <Icone className="size-3.5" aria-hidden="true" />
        {titulo}
        {contagem !== undefined && <span className="tabular-nums text-zinc-300 dark:text-zinc-600">{contagem}</span>}
      </h3>
      {children}
    </section>
  );
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
      {children}
    </span>
  );
}

function BlocoMeet({ link }: { link: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Linha Icone={Video}>
      <div className="flex items-center gap-2">
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Video className="size-4" aria-hidden="true" />
          Entrar no Google Meet
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1600);
            });
          }}
          aria-label="Copiar link do Meet"
          title="Copiar link"
          className="rounded-lg border border-zinc-200 p-2 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          {copiado ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <p className="mt-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{link.replace(/^https:\/\//, "")}</p>
    </Linha>
  );
}

function BlocoCliente({ sistema }: { sistema: ReuniaoDoSistema }) {
  const c = sistema.contato;
  const lugar = localizacao(c);
  return (
    <Secao Icone={User} titulo="Cliente">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[12px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          {iniciais(c.nome)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{c.nome}</p>
          {lugar && <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">{lugar}</p>}
        </div>
      </div>

      <dl className="mt-3 flex flex-col gap-1.5">
        <Dado Icone={Phone} rotulo="WhatsApp">
          {c.whatsapp || "—"}
        </Dado>
        <Dado Icone={AtSign} rotulo="E-mail">
          {c.email ? (
            <a href={`mailto:${c.email}`} className="underline-offset-2 hover:underline">
              {c.email}
            </a>
          ) : (
            "—"
          )}
        </Dado>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {sistema.oportunidade && (
          <Link
            href={`/?op=${sistema.oportunidade.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Wallet className="size-3.5" aria-hidden="true" />
            Abrir oportunidade
          </Link>
        )}
        {sistema.atendimentoId && (
          <Link
            href={`/chat?atendimento=${sistema.atendimentoId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <MessageCircle className="size-3.5" aria-hidden="true" />
            Ver conversa
          </Link>
        )}
      </div>
    </Secao>
  );
}

function Dado({ Icone, rotulo, children }: { Icone: LucideIcon; rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-zinc-700 dark:text-zinc-200">
      <Icone className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
      <dt className="sr-only">{rotulo}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

const STATUS_OP: Record<string, string> = {
  aberta: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  ganha: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  perdida: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
};

function BlocoOportunidade({ op }: { op: NonNullable<ReuniaoDoSistema["oportunidade"]> }) {
  return (
    <Secao Icone={Wallet} titulo="Oportunidade">
      <Link
        href={`/?op=${op.id}`}
        className="block rounded-xl border border-zinc-200 p-3 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{op.nome}</p>
          <p className="shrink-0 text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{brl(op.valor)}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="min-w-0 truncate">{[op.funil, op.etapa].filter(Boolean).join(" · ") || "Sem etapa"}</span>
          <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-medium capitalize ${STATUS_OP[op.status] ?? STATUS_OP.aberta}`}>
            {op.status}
          </span>
        </div>
      </Link>
    </Secao>
  );
}

const RESPOSTA: Record<ParticipanteEvento["resposta"], { Icone: LucideIcon; rotulo: string; cor: string }> = {
  aceito: { Icone: CheckCircle2, rotulo: "Confirmou", cor: "text-emerald-600 dark:text-emerald-400" },
  recusou: { Icone: XCircle, rotulo: "Recusou", cor: "text-rose-600 dark:text-rose-400" },
  talvez: { Icone: HelpCircle, rotulo: "Talvez", cor: "text-amber-600 dark:text-amber-400" },
  pendente: { Icone: Circle, rotulo: "Sem resposta", cor: "text-zinc-400" },
};

function BlocoParticipantes({
  participantes,
  organizador,
}: {
  participantes: ParticipanteEvento[];
  organizador: string | null;
}) {
  const confirmados = participantes.filter((p) => p.resposta === "aceito").length;
  return (
    <Secao Icone={Users} titulo="Participantes" contagem={participantes.length}>
      <p className="-mt-1.5 mb-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {confirmados} de {participantes.length} {participantes.length === 1 ? "confirmou" : "confirmaram"}
        {organizador ? ` · organizado por ${organizador}` : ""}
      </p>
      <ul className="flex flex-col gap-2">
        {participantes.map((p, i) => {
          const r = RESPOSTA[p.resposta];
          const nome = p.nome ?? p.email ?? "Convidado";
          return (
            <li key={`${p.email ?? p.nome}-${i}`} className="flex items-center gap-2.5">
              <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                {iniciais(nome.replace(/@.*/, ""))}
                <r.Icone
                  className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-zinc-950 ${r.cor}`}
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{nome}</span>
                  {p.organizador && <Etiqueta>organizador</Etiqueta>}
                  {p.conta && <Etiqueta>esta conta</Etiqueta>}
                </span>
                <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {p.nome && p.email ? `${p.email} · ` : ""}
                  {r.rotulo}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}

/** URL vira link; o resto fica texto. Nada de HTML do Google é interpretado. */
const LINK = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

function ComLinks({ texto }: { texto: string }) {
  const partes = texto.split(LINK);
  return (
    <>
      {partes.map((p, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            className="break-all text-zinc-900 underline underline-offset-2 dark:text-zinc-50"
          >
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
