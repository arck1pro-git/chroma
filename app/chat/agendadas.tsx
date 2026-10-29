"use client";

// As mensagens agendadas de um grupo do WhatsApp (2026-10-29): o formulário
// (texto, arquivo da biblioteca opcional, dia e hora) e a lista das que vão
// sair, com cancelar, mais as últimas que já terminaram. Quem manda na hora é a
// rodada do servidor (lib/mensagens-agendadas.ts); a tela só agenda e mostra.
//
// O dia e a hora são os do relógio de quem agenda (a equipe está em Brasília):
// o navegador converte para o instante certo antes de mandar ao servidor.
import { useEffect, useState, useTransition } from "react";
import type { Documento } from "@/lib/documentos";
import type { MensagemAgendada } from "@/lib/mensagens-agendadas";
import { CalendarClock, CircleX, FileText, Paperclip, X } from "@/app/components/icones";
import { agendarMensagemNoGrupo, cancelarMensagemAgendada } from "./acoes-agendadas";
import { ListaDaBiblioteca } from "./compositor";

const campo =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";
const rotulo = "text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";

const LIMITE_TEXTO = 4096;
const LIMITE_LEGENDA = 1024;

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** A próxima hora cheia, no relógio de quem agenda: o padrão do formulário. */
function proximaHora(): { dia: string; hora: string } {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return { dia: `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`, hora: `${doisDigitos(d.getHours())}:00` };
}

const quando = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const ESTADO: Record<MensagemAgendada["estado"], { rotulo: string; classe: string }> = {
  agendada: { rotulo: "Agendada", classe: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" },
  enviando: { rotulo: "Enviando", classe: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  enviada: { rotulo: "Enviada", classe: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  erro: { rotulo: "Não saiu", classe: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" },
  cancelada: { rotulo: "Cancelada", classe: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
};

export function MensagensAgendadas({
  atendimentoId,
  grupoNome,
  agendadas,
  documentos,
  podeAgendar,
  demo,
  aoFechar,
}: {
  atendimentoId: string;
  grupoNome: string;
  agendadas: MensagemAgendada[];
  documentos: Documento[];
  podeAgendar: boolean;
  demo: boolean;
  aoFechar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [documento, setDocumento] = useState<Documento | null>(null);
  const [biblioteca, setBiblioteca] = useState(false);
  const [{ dia, hora }, setQuando] = useState(proximaHora);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !biblioteca && aoFechar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoFechar, biblioteca]);

  const limite = documento ? LIMITE_LEGENDA : LIMITE_TEXTO;
  const instante = dia && hora ? new Date(`${dia}T${hora}`) : null;
  const problema = !texto.trim() && !documento
    ? "Escreva a mensagem ou escolha um arquivo."
    : texto.length > limite
      ? documento
        ? `Com arquivo, o texto vai como legenda e tem até ${LIMITE_LEGENDA.toLocaleString("pt-BR")} caracteres.`
        : `A mensagem passa de ${LIMITE_TEXTO.toLocaleString("pt-BR")} caracteres.`
      : !instante || Number.isNaN(instante.getTime())
        ? "Escolha o dia e a hora."
        : null;

  const vaoSair = agendadas.filter((a) => a.estado === "agendada" || a.estado === "enviando");
  const terminadas = agendadas.filter((a) => a.estado !== "agendada" && a.estado !== "enviando");

  function agendar() {
    if (problema || !instante || demo) return;
    // No clique, não na renderização: o relógio muda sem a tela saber.
    if (instante.getTime() < Date.now() + 30_000) return setErro("Escolha um horário no futuro.");
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      const r = await agendarMensagemNoGrupo(atendimentoId, { texto, documentoId: documento?.id ?? null, enviarEm: instante.toISOString() });
      if (!r.ok) return setErro(r.erro);
      setTexto("");
      setDocumento(null);
      setQuando(proximaHora());
      if (r.aviso) setAviso(r.aviso);
    });
  }

  function cancelar(id: string) {
    setErro(null);
    iniciar(async () => {
      const r = await cancelarMensagemAgendada(id);
      if (!r.ok) setErro(r.erro);
    });
  }

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Mensagens agendadas"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <CalendarClock className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Mensagens agendadas</h2>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">No grupo {grupoNome}</p>
            </div>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {podeAgendar && (
            <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between">
                  <span className={rotulo}>{documento ? "Legenda" : "Mensagem"}</span>
                  <span className={`text-[10.5px] tabular-nums ${texto.length > limite ? "text-red-500" : "text-zinc-400"}`}>
                    {texto.length.toLocaleString("pt-BR")}/{limite.toLocaleString("pt-BR")}
                  </span>
                </span>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={4}
                  placeholder="Bom dia, pessoal! Lembrete da reunião de hoje às 15h."
                  className={`${campo} resize-y`}
                />
              </label>

              {documento ? (
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <FileText className="size-3.5 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-800 dark:text-zinc-100">{documento.nome}</span>
                  <button type="button" onClick={() => setDocumento(null)} aria-label="Tirar o arquivo" className="rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : biblioteca ? (
                <ListaDaBiblioteca
                  documentos={documentos}
                  vazio="Nenhum arquivo na biblioteca. Suba em Documentos."
                  aoEscolher={(d) => {
                    setDocumento(d);
                    setBiblioteca(false);
                  }}
                  aoFechar={() => setBiblioteca(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setBiblioteca(true)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  <Paperclip className="size-3.5" />
                  Anexar arquivo da biblioteca
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={rotulo}>Dia</span>
                  <input type="date" value={dia} onChange={(e) => setQuando((q) => ({ ...q, dia: e.target.value }))} className={campo} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={rotulo}>Hora</span>
                  <input type="time" value={hora} onChange={(e) => setQuando((q) => ({ ...q, hora: e.target.value }))} className={campo} />
                </label>
              </div>

              {(erro || aviso) && <p className={`text-xs ${erro ? "text-red-500" : "text-amber-600 dark:text-amber-400"}`}>{erro ?? aviso}</p>}
              <div className="flex items-center justify-end gap-3">
                {problema && (texto || documento) ? <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-500 dark:text-zinc-400">{problema}</span> : null}
                <button
                  type="button"
                  onClick={agendar}
                  disabled={Boolean(problema) || salvando || demo}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <CalendarClock className="size-3.5" />
                  Agendar
                </button>
              </div>
            </div>
          )}

          <section className="px-5 py-4">
            <h3 className={rotulo}>Vão sair</h3>
            {vaoSair.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-zinc-500 dark:text-zinc-400">Nenhuma mensagem agendada neste grupo.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {vaoSair.map((a) => (
                  <Item key={a.id} agendada={a} aoCancelar={podeAgendar && a.estado === "agendada" && !demo ? () => cancelar(a.id) : undefined} />
                ))}
              </ul>
            )}
            {terminadas.length > 0 && (
              <>
                <h3 className={`${rotulo} mt-5`}>Últimas</h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {terminadas.map((a) => (
                    <Item key={a.id} agendada={a} />
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Item({ agendada: a, aoCancelar }: { agendada: MensagemAgendada; aoCancelar?: () => void }) {
  const estado = ESTADO[a.estado];
  return (
    <li className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span suppressHydrationWarning className="text-[12px] font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
          {quando.format(new Date(a.enviarEm))}
        </span>
        <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${estado.classe}`}>{estado.rotulo}</span>
        <span className="flex-1" aria-hidden="true" />
        {aoCancelar && (
          <button
            type="button"
            onClick={aoCancelar}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-zinc-500 transition hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <CircleX className="size-3" />
            Cancelar
          </button>
        )}
      </div>
      {a.documento && (
        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-300">
          <FileText className="size-3 shrink-0 text-zinc-400" />
          <span className="truncate">{a.documento.nome}</span>
        </p>
      )}
      {a.texto && <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] text-zinc-700 dark:text-zinc-200">{a.texto}</p>}
      {a.estado === "erro" && a.erro && <p className="mt-1 text-[11.5px] text-red-600 dark:text-red-400">{a.erro}</p>}
      {a.autor && <p className="mt-1 text-[10.5px] text-zinc-400 dark:text-zinc-500">Agendada por {a.autor}</p>}
    </li>
  );
}
