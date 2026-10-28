"use client";

// Uma campanha já criada: o mesmo canvas, só de leitura, com quantos estão
// agora em cada bloco, quantos passaram e quantos tomaram cada saída (as
// métricas vêm do GET). Pausar e retomar daqui; pausada ou rascunho, Editar
// abre o construtor. Retomar e ativar mostram antes a mesma revisão da
// campanha nova: o fluxo pode ter mudado enquanto estava pausado.
//
// MÉTRICAS E GASTO (2026-10-28): a rota de métricas da campanha
// (GET …/campanhas/[id]/metricas, MetricasCampanha) dá o funil, o gasto, as
// falhas por motivo e, por bloco, entregues e lidos, que entram nos cartões do
// Enviar template junto do que a lista já trazia (agora, passaram, as saídas).
// Pedida ao abrir e no botão de atualizar, como a lista: sem polling. A
// campanha em rascunho não pede (nada rodou). As "falhas recentes" por
// contato saíram: a coluna não era escrita; ficam as falhas por motivo.
import { useMemo, useState } from "react";
import type { FluxoCampanha as Fluxo, ProblemaDoFluxo } from "@/lib/campanhas-fluxo";
import type { MetricasCampanha } from "@/lib/campanhas-metricas-tipos";
import { dataHora } from "@/lib/formato";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { CheckCircle2, LoaderCircle, Pause, Pencil, Play, RefreshCw, Send, X } from "@/app/components/icones";
import FluxoCampanha from "../fluxo-campanha";
import { botaoAds, botaoPrincipalAds } from "../pecas";
import { useConsulta } from "../use-consulta";
import ConfirmarAtivacao from "./confirmar-ativacao";
import { problemasDaTela, quantosContatos, type MetricasFluxo, type OpcoesFluxo } from "./grafo";
import NumerosCampanha from "./numeros-campanha";
import { pedirCampanha } from "./pedido";

/** Uma campanha como o GET de /api/meta/whatsapp/campanhas devolve (só o que a tela usa). */
export type CampanhaWpp = {
  id: string;
  nome: string;
  segmento_nome: string;
  /** Os segmentos do público (o nó de início edita na campanha pausada ou em rascunho). */
  segmento_ids?: string[];
  telefone_exibicao: string;
  status: string;
  total: number;
  enviados?: number;
  responderam?: number;
  conversoes?: number;
  falharam?: number;
  definicao: Fluxo;
  metricas?: MetricasFluxo | null;
  data_criacao: string;
};

const STATUS: Record<string, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "Rascunho", classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  ativa: { rotulo: "No ar", classe: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  processando: { rotulo: "Enviando", classe: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  pausada: { rotulo: "Pausada", classe: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  concluida: { rotulo: "Concluída", classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  parcial: { rotulo: "Concluída com falhas", classe: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  falhou: { rotulo: "Falhou", classe: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" },
};

export const rotuloDoStatus = (status: string) => STATUS[status]?.rotulo ?? status;

type Acao = "pausar" | "retomar" | "ativar";

export default function VerCampanha({
  campanha,
  templates,
  opcoes,
  aviso,
  aoEditar,
  aoMudar,
  atualizar,
}: {
  campanha: CampanhaWpp;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  /** O retorno da última ação (salvou, ativou), vindo de quem lista. */
  aviso: string;
  aoEditar: () => void;
  /** Depois de pausar, retomar ou ativar: a lista recarrega com o status novo. */
  aoMudar: (mensagem: string) => void;
  atualizar: () => void;
}) {
  const [fazendo, setFazendo] = useState<Acao | null>(null);
  const [confirmando, setConfirmando] = useState<"retomar" | "ativar" | null>(null);
  const [erro, setErro] = useState("");
  // Guardado pelo texto: a próxima ação traz outro aviso, e ele volta a aparecer.
  const [avisoFechado, setAvisoFechado] = useState("");
  // O que o servidor apontou ao retomar ou ativar (tag apagada, IA desligada…):
  // fica marcado no canvas, e o caminho é Editar.
  const [doServidor, setDoServidor] = useState<ProblemaDoFluxo[]>([]);

  // `manter`: atualizar não apaga a faixa; os números de antes ficam até os novos chegarem.
  const {
    dados: numeros,
    erro: erroNumeros,
    carregando: carregandoNumeros,
    atualizar: atualizarNumeros,
  } = useConsulta<MetricasCampanha>(campanha.status === "rascunho" ? null : `/api/meta/whatsapp/campanhas/${campanha.id}/metricas`, { manter: true });

  // Entregues e lidos por bloco entram nos cartões junto do que a lista traz.
  // Campanha sem números na lista (nunca rodou) segue sem a faixa dos cartões.
  const metricasDoCanvas = useMemo<MetricasFluxo | null>(() => {
    const base = campanha.metricas ?? null;
    if (!base || !numeros) return base;
    return { porBloco: { ...base.porBloco, ...numeros.porBloco }, porSaida: base.porSaida };
  }, [campanha.metricas, numeros]);

  function recarregar() {
    atualizar();
    void atualizarNumeros();
  }

  const fluxo = campanha.definicao;
  const daTela = useMemo(() => problemasDaTela(fluxo, templates), [fluxo, templates]);
  const problemas = doServidor.length ? [...daTela, ...doServidor] : daTela;
  const status = STATUS[campanha.status] ?? { rotulo: campanha.status, classe: STATUS.rascunho.classe };
  const editavel = campanha.status === "pausada" || campanha.status === "rascunho";
  const noAr = campanha.status === "ativa" || campanha.status === "processando";
  const publico = `${campanha.segmento_nome} · ${quantosContatos(campanha.total ?? 0)} · por ${campanha.telefone_exibicao}`;

  async function executar(acao: Acao) {
    setFazendo(acao);
    setErro("");
    try {
      const r = await pedirCampanha<{ total?: number }>(`/api/meta/whatsapp/campanhas/${campanha.id}/${acao}`, "POST");
      if (!r.ok) {
        setErro(r.erro);
        setDoServidor(r.problemas);
        if (r.problemas.length) setConfirmando(null);
        return;
      }
      setConfirmando(null);
      void atualizarNumeros();
      aoMudar(
        acao === "pausar"
          ? "Campanha pausada. Ninguém recebe nada até retomar."
          : acao === "retomar"
            ? "Campanha retomada."
            : `Campanha ativada para ${quantosContatos(r.dados.total ?? campanha.total ?? 0)}.`,
      );
    } catch {
      setErro("Não consegui falar com o servidor. Confira a conexão e tente de novo.");
    } finally {
      setFazendo(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-zinc-200 px-4 py-2.5 tela-baixa:py-2 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{campanha.nome}</h2>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.classe}`}>{status.rotulo}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={recarregar}
              disabled={carregandoNumeros}
              aria-label="Atualizar números"
              title="Atualizar números"
              className={`${botaoAds} px-2.5`}
            >
              <RefreshCw className={`size-3.5 ${carregandoNumeros ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
            {noAr && (
              <button type="button" onClick={() => void executar("pausar")} disabled={!!fazendo} className={botaoAds}>
                {fazendo === "pausar" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
                Pausar
              </button>
            )}
            {editavel && (
              <button type="button" onClick={aoEditar} disabled={!!fazendo} className={botaoAds}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Editar
              </button>
            )}
            {editavel && (
              <button
                type="button"
                onClick={() => {
                  setErro("");
                  setConfirmando(campanha.status === "pausada" ? "retomar" : "ativar");
                }}
                disabled={!!fazendo || problemas.length > 0}
                title={problemas.length ? "Há pendências no fluxo: abra em Editar." : undefined}
                className={botaoPrincipalAds}
              >
                {campanha.status === "pausada" ? <Play className="size-3.5" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
                {campanha.status === "pausada" ? "Retomar" : "Ativar"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-zinc-500 dark:text-zinc-400" title={publico}>
          {publico} · criada em {dataHora(campanha.data_criacao)}
        </p>
        <NumerosCampanha metricas={numeros} daLista={campanha} erro={!!erroNumeros && !numeros} />
        {(erro || (aviso && aviso !== avisoFechado)) && (
          <p
            role={erro ? "alert" : "status"}
            className={`mt-2 flex items-center gap-1.5 text-[12px] ${erro ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}
          >
            {!erro && <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 flex-1">{erro || aviso}</span>
            <button
              type="button"
              aria-label="Fechar aviso"
              onClick={() => (erro ? setErro("") : setAvisoFechado(aviso))}
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </p>
        )}
      </header>

      <FluxoCampanha
        fluxo={fluxo}
        templates={templates}
        opcoes={opcoes}
        problemas={problemas}
        metricas={metricasDoCanvas}
        inicio={{
          resumo: campanha.segmento_nome,
          detalhe: quantosContatos(campanha.total ?? 0),
          painel: (
            <div className="space-y-2 text-[12px] text-zinc-700 dark:text-zinc-200">
              <p>{campanha.segmento_nome}</p>
              <p className="text-zinc-500 dark:text-zinc-400">
                {quantosContatos(campanha.total ?? 0)} na campanha · envia por {campanha.telefone_exibicao}
              </p>
            </div>
          ),
        }}
      />

      {confirmando && (
        <ConfirmarAtivacao
          titulo={confirmando === "retomar" ? `Retomar “${campanha.nome}”?` : `Ativar “${campanha.nome}”?`}
          rotuloConfirmar={confirmando === "retomar" ? "Retomar" : "Ativar e enviar"}
          publico={publico}
          fluxo={fluxo}
          templates={templates}
          opcoes={opcoes}
          enviando={fazendo !== null}
          erro={erro}
          aoConfirmar={() => void executar(confirmando)}
          aoCancelar={() => setConfirmando(null)}
        />
      )}
    </div>
  );
}
