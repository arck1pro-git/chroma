"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, PanelLeft, X } from "lucide-react";
import type { AgendaGoogle, EventoAgenda, ReuniaoDoSistema } from "@/lib/agenda";
import CamadaTopo from "../components/camada-topo";
import GradeHoras from "./grade-horas";
import GradeMes from "./grade-mes";
import Lista from "./lista";
import Lateral from "./lateral";
import PainelEvento from "./painel-evento";
import { andar, diaDe, janelaDa, tituloDaJanela, VISOES, type Visao } from "./tempo";

// A Agenda: o Google Calendar da conta da empresa em quatro visões, com o que o
// CRM sabe de cada reunião que ele marcou.
//
// O QUE MORA NA URL (?visao, ?data, ?agenda, ?evento) é o que define a tela e
// pode ser mandado para alguém: abrir o link mostra a mesma semana, as mesmas
// agendas e o mesmo evento aberto. Trocar de período ou de agenda vai ao
// servidor (os eventos vêm do Google para aquela janela); abrir um evento e o
// filtro "só do Chroma" ficam no navegador, sem ida ao servidor.
//
// SÓ LEITURA: nada nesta tela cria, muda ou apaga evento no Google.

type Props = {
  visao: Visao;
  data: string;
  hoje: string;
  conta: string;
  agendas: AgendaGoogle[];
  selecionadas: string[];
  /** A escolha de agendas veio da URL (senão, é o padrão do Google e não vai no link). */
  escolhaNaUrl: boolean;
  podeListar: boolean;
  /** Agendas que não deu para ler (nomes). */
  falhas: string[];
  eventos: EventoAgenda[];
  /** O que o CRM sabe dos eventos da janela. */
  sistemaDosEventos: ReuniaoDoSistema[];
  /** As reuniões marcadas pelo CRM (próximas e dos últimos 30 dias), para a lateral. */
  agendados: ReuniaoDoSistema[];
  eventoInicial: string | null;
};

const ROTULO: Record<Visao, { nome: string; tecla: string }> = {
  dia: { nome: "Dia", tecla: "D" },
  semana: { nome: "Semana", tecla: "S" },
  mes: { nome: "Mês", tecla: "M" },
  lista: { nome: "Lista", tecla: "L" },
};

const TECLA: Record<string, Visao> = { d: "dia", s: "semana", w: "semana", m: "mes", l: "lista" };

export default function Agenda(p: Props) {
  const router = useRouter();
  const [navegando, iniciar] = useTransition();
  const [selecionado, setSelecionado] = useState<string | null>(p.eventoInicial);
  const [soSistema, setSoSistema] = useState(false);
  const [lateralAberta, setLateralAberta] = useState(false);

  const agendaPorId = useMemo(() => new Map(p.agendas.map((a) => [a.id, a])), [p.agendas]);
  const sistemaPorEvento = useMemo(
    () => new Map([...p.agendados, ...p.sistemaDosEventos].map((r) => [r.eventoId, r])),
    [p.agendados, p.sistemaDosEventos],
  );
  const eventos = useMemo(
    () => (soSistema ? p.eventos.filter((e) => sistemaPorEvento.has(e.id)) : p.eventos),
    [soSistema, p.eventos, sistemaPorEvento],
  );
  const { dias } = useMemo(() => janelaDa(p.visao, p.data), [p.visao, p.data]);

  // ── Navegação ─────────────────────────────────────────────────────────────

  const endereco = useCallback(
    (o: { visao?: Visao; data?: string; agendas?: string[] | null; evento?: string | null }) => {
      const busca = new URLSearchParams();
      const visao = o.visao ?? p.visao;
      const data = o.data ?? p.data;
      // Sem escolha explícita, as agendas ficam fora do link: vale o padrão do Google.
      const agendas = o.agendas !== undefined ? o.agendas : p.escolhaNaUrl ? p.selecionadas : null;
      if (visao !== "semana") busca.set("visao", visao);
      if (data !== p.hoje) busca.set("data", data);
      if (agendas) {
        if (agendas.length === 0) busca.set("agenda", "");
        for (const id of agendas) busca.append("agenda", id);
      }
      if (o.evento) busca.set("evento", o.evento);
      const texto = busca.toString();
      return texto ? `/agenda?${texto}` : "/agenda";
    },
    [p.visao, p.data, p.hoje, p.escolhaNaUrl, p.selecionadas],
  );

  const ir = useCallback(
    (o: Parameters<typeof endereco>[0]) => {
      setLateralAberta(false);
      iniciar(() => router.push(endereco(o), { scroll: false }));
    },
    [endereco, router],
  );

  // O evento aberto vai para a URL sem ir ao servidor: o link copiado da barra
  // reabre o mesmo painel.
  const abrir = useCallback(
    (id: string) => {
      setSelecionado(id);
      window.history.replaceState(null, "", endereco({ evento: id }));
    },
    [endereco],
  );
  const fechar = useCallback(() => {
    setSelecionado(null);
    window.history.replaceState(null, "", endereco({}));
  }, [endereco]);

  function abrirAgendado(r: ReuniaoDoSistema) {
    setLateralAberta(false);
    if (p.eventos.some((e) => e.id === r.eventoId)) {
      abrir(r.eventoId);
      return;
    }
    // Fora da janela: vai até o dia dela, já com o painel aberto.
    setSelecionado(r.eventoId);
    ir({ data: diaDe(r.inicio), evento: r.eventoId });
  }

  // Atalhos do Google Calendar: T hoje, ←/→ anda, D/S/M/L troca a visão.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (selecionado || e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, select, [contenteditable='true']")) return;
      const tecla = e.key.toLowerCase();
      if (tecla === "t") ir({ data: p.hoje });
      else if (e.key === "ArrowLeft") ir({ data: andar(p.visao, p.data, -1) });
      else if (e.key === "ArrowRight") ir({ data: andar(p.visao, p.data, 1) });
      else if (TECLA[tecla] && TECLA[tecla] !== p.visao) ir({ visao: TECLA[tecla] });
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [selecionado, ir, p.hoje, p.visao, p.data]);

  // ── Painel ────────────────────────────────────────────────────────────────

  const eventoAberto = selecionado ? (p.eventos.find((e) => e.id === selecionado) ?? null) : null;
  const sistemaAberto = selecionado ? (sistemaPorEvento.get(selecionado) ?? null) : null;

  const lateral = (
    <Lateral
      visao={p.visao}
      data={p.data}
      hoje={p.hoje}
      agendas={p.agendas}
      selecionadas={p.selecionadas}
      podeListar={p.podeListar}
      agendados={p.agendados}
      soSistema={soSistema}
      aoEscolherData={(d) => ir({ data: d })}
      aoTrocarAgendas={(ids) => ir({ agendas: ids })}
      aoAbrirAgendado={abrirAgendado}
      aoAlternarSoSistema={() => setSoSistema((v) => !v)}
    />
  );

  const comuns = {
    eventos,
    agendaPorId,
    sistemaPorEvento,
    hoje: p.hoje,
    selecionado,
    aoAbrir: abrir,
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-conteudo">
      {/* Indicador de carregamento: os eventos da janela nova vêm do Google. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 bg-zinc-900 transition-opacity dark:bg-zinc-50 ${
          navegando ? "animate-pulse opacity-100" : "opacity-0"
        }`}
        aria-hidden="true"
      />

      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 px-4 py-3 sm:px-6 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setLateralAberta(true)}
          aria-label="Calendário, agendas e agendados"
          className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 lg:hidden dark:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          <PanelLeft className="size-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => ir({ data: p.hoje })}
          title="Hoje (T)"
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Hoje
        </button>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => ir({ data: andar(p.visao, p.data, -1) })}
            aria-label="Anterior"
            title="Anterior (←)"
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => ir({ data: andar(p.visao, p.data, 1) })}
            aria-label="Próximo"
            title="Próximo (→)"
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>

        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-zinc-900 first-letter:uppercase dark:text-zinc-50">
          <span className="sr-only">Agenda: </span>
          {tituloDaJanela(p.visao, p.data)}
        </h1>
        {navegando && <Loader2 className="size-4 shrink-0 animate-spin text-zinc-400" aria-label="Carregando" />}

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden truncate text-[12px] text-zinc-400 xl:inline" title="Conta Google conectada">
            {p.conta}
          </span>
          <div className="flex gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" role="group" aria-label="Visão">
            {VISOES.map((v) => {
              const ativa = v === p.visao;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => !ativa && ir({ visao: v })}
                  aria-pressed={ativa}
                  title={`${ROTULO[v].nome} (${ROTULO[v].tecla})`}
                  className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
                    ativa
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                  }`}
                >
                  {ROTULO[v].nome}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {p.falhas.length > 0 && (
        <p
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-700 sm:px-6 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          Não deu para ler {p.falhas.length === 1 ? "a agenda" : "as agendas"} {p.falhas.join(", ")}. As outras estão na tela.
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden w-72 shrink-0 overflow-y-auto border-r border-zinc-200 lg:block dark:border-zinc-800"
          aria-label="Calendário e agendas"
        >
          {lateral}
        </aside>

        <main
          className={`flex min-h-0 min-w-0 flex-1 flex-col transition-opacity ${navegando ? "opacity-60" : ""}`}
          aria-busy={navegando}
        >
          {p.selecionadas.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
              Nenhuma agenda marcada. Escolha ao menos uma na lateral.
            </div>
          ) : p.visao === "mes" ? (
            <GradeMes {...comuns} dias={dias} mes={p.data.slice(0, 7)} aoIrParaDia={(d) => ir({ visao: "dia", data: d })} />
          ) : p.visao === "lista" ? (
            <Lista {...comuns} dias={dias} />
          ) : (
            <GradeHoras
              // Remonta ao trocar entre Dia e Semana: a rolagem inicial (perto de
              // agora) só faz sentido na primeira montagem de cada visão.
              key={p.visao}
              {...comuns}
              dias={dias}
              aoIrParaDia={(d) => ir({ visao: "dia", data: d })}
            />
          )}
        </main>
      </div>

      {/* No celular a lateral abre por cima, pela esquerda. */}
      {lateralAberta && (
        <CamadaTopo>
          <div
            className="veu-surge fixed inset-0 z-[300] bg-black/40 backdrop-blur-[1px] lg:hidden"
            onClick={() => setLateralAberta(false)}
            aria-hidden="true"
          />
          <aside
            className="veu-surge fixed inset-y-0 left-0 z-[310] w-80 max-w-[88vw] overflow-y-auto bg-white shadow-2xl lg:hidden dark:bg-zinc-950"
            aria-label="Calendário e agendas"
          >
            <div className="flex justify-end px-3 pt-3">
              <button
                type="button"
                onClick={() => setLateralAberta(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {lateral}
          </aside>
        </CamadaTopo>
      )}

      {selecionado && (eventoAberto || sistemaAberto) && (
        <PainelEvento
          key={selecionado}
          evento={eventoAberto}
          agenda={eventoAberto ? agendaPorId.get(eventoAberto.agendaId) : undefined}
          sistema={sistemaAberto}
          aoFechar={fechar}
        />
      )}
    </div>
  );
}
