"use client";

// A barra que aparece quando há cartões marcados no kanban.
//
// FLUTUANTE, e não uma faixa no topo: o quadro já é alto e cada pixel roubado
// do topo empurra os cartões para fora da tela. Flutuando no rodapé, ela só
// existe quando há seleção e não reposiciona nada.
//
// TODAS as ações são de LOTE e vão para server actions em ./actions.ts, que
// peneiram os ids de novo — o que chega do navegador nunca é confiável, mesmo
// tendo saído daqui.
import { useState, useTransition } from "react";
import type { Segmento, Usuario } from "@/lib/entidades";
import { Columns3, Download, Send, Trash2, Users, UserCog, X } from "@/app/components/icones";
import {
  adicionarASegmento,
  excluirOportunidades,
  exportarOportunidades,
  inscreverEmFluxo,
  moverParaEtapa,
  moverParaResponsavel,
} from "./actions";

export type FluxoDisponivel = { id: string; nome: string };

/** Uma etapa do funil aberto, destino do "Mover para a etapa". */
export type EtapaDestino = { id: string; nome: string };

type Painel = "etapa" | "responsavel" | "segmento" | "fluxo" | null;

export default function BarraSelecao({
  selecionados,
  etapas,
  usuarios,
  segmentos,
  fluxos,
  aoLimpar,
}: {
  selecionados: string[];
  /** As etapas do funil aberto, na ordem do quadro. */
  etapas: EtapaDestino[];
  usuarios: Usuario[];
  segmentos: Segmento[];
  fluxos: FluxoDisponivel[];
  aoLimpar: () => void;
}) {
  const [painel, setPainel] = useState<Painel>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [armado, setArmado] = useState(false);
  // Etapa com cadência à espera do "Mover": mover é desfazível, a mensagem que
  // a cadência manda não é. Quem diz que precisa confirmar, e quantas recebem,
  // é o servidor (moverParaEtapa) — só o botão "Mover" daqui confirma.
  const [confirmando, setConfirmando] = useState<{ etapa: EtapaDestino; quantas: number } | null>(null);
  const [ocupado, comecar] = useTransition();

  if (selecionados.length === 0) return null;

  const n = selecionados.length;

  function abrir(qual: Painel) {
    setAviso(null);
    setArmado(false);
    setConfirmando(null);
    setPainel((atual) => (atual === qual ? null : qual));
  }

  function moverPara(etapa: EtapaDestino, confirmado = false) {
    comecar(async () => {
      const r = await moverParaEtapa(selecionados, etapa.id, confirmado);
      if (r.confirmar) {
        setAviso(null);
        setConfirmando({ etapa, quantas: r.confirmar });
        return;
      }
      setConfirmando(null);
      setAviso({ ok: r.ok, texto: r.mensagem });
      setPainel(null);
    });
  }

  /**
   * Excluir não dá para desfazer, e por isso é em dois cliques (como mover para
   * etapa com cadência, que manda mensagem): o primeiro arma o botão, o segundo apaga. Um `confirm()`
   * faria o mesmo, mas a contagem fica no próprio botão — "Excluir 12?" é a
   * pergunta inteira, sem tirar os olhos do quadro.
   *
   * Dando certo, a seleção é LIMPA e a barra some com ela: os cartões deixaram
   * de existir, e uma barra dizendo "12 selecionadas" sobre doze cartões que
   * sumiram seria a única leitura errada possível desta tela. O sumiço dos
   * cartões é o retorno. Falhando, a seleção fica e o aviso explica.
   */
  function excluir() {
    if (!armado) {
      setAviso(null);
      setPainel(null);
      setArmado(true);
      return;
    }
    comecar(async () => {
      const r = await excluirOportunidades(selecionados);
      setArmado(false);
      if (r.ok) {
        aoLimpar();
        return;
      }
      setAviso({ ok: false, texto: r.mensagem });
    });
  }

  // Toda ação segue o mesmo roteiro: roda, mostra o que aconteceu, fecha o
  // menu. A seleção NÃO é limpa — depois de mover de responsável é comum
  // querer mandar os mesmos cartões para um segmento.
  function executar(promessa: Promise<{ ok: boolean; mensagem: string }>) {
    comecar(async () => {
      const r = await promessa;
      setAviso({ ok: r.ok, texto: r.mensagem });
      setPainel(null);
    });
  }

  function exportar() {
    comecar(async () => {
      const r = await exportarOportunidades(selecionados);
      if (!r.ok || !r.conteudo) {
        setAviso({ ok: false, texto: r.mensagem ?? "Não consegui exportar." });
        return;
      }
      // O arquivo nasce e morre no navegador: o servidor devolve o texto, e o
      // download é um Blob local. Assim não há arquivo temporário no servidor
      // nem URL de export adivinhável com dado de cliente dentro.
      const blob = new Blob([r.conteudo], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `oportunidades-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setAviso({ ok: true, texto: `${n} ${n === 1 ? "linha exportada" : "linhas exportadas"}.` });
    });
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ml-1.5 mr-1 text-[12px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {n} {n === 1 ? "selecionada" : "selecionadas"}
          </span>

          <Botao Icone={Download} rotulo="Exportar" onClick={exportar} ocupado={ocupado} />
          <Botao
            Icone={Columns3}
            rotulo="Etapa"
            onClick={() => abrir("etapa")}
            ativo={painel === "etapa"}
            ocupado={ocupado}
          />
          <Botao
            Icone={UserCog}
            rotulo="Responsável"
            onClick={() => abrir("responsavel")}
            ativo={painel === "responsavel"}
            ocupado={ocupado}
          />
          <Botao
            Icone={Users}
            rotulo="Segmento"
            onClick={() => abrir("segmento")}
            ativo={painel === "segmento"}
            ocupado={ocupado}
          />
          <Botao
            Icone={Send}
            rotulo="Automação"
            onClick={() => abrir("fluxo")}
            ativo={painel === "fluxo"}
            ocupado={ocupado}
          />

          <button
            type="button"
            onClick={excluir}
            onBlur={() => setArmado(false)}
            disabled={ocupado}
            className={`ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${
              armado
                ? "bg-red-600 text-white hover:bg-red-700"
                : "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            }`}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {armado ? `Excluir ${n}?` : "Excluir"}
          </button>

          <button
            type="button"
            onClick={aoLimpar}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="size-3.5" aria-hidden="true" />
            Limpar
          </button>
        </div>

        {painel === "etapa" && (
          <Escolha
            rotulo="Mover para a etapa"
            vazio="Nenhuma etapa neste funil."
            opcoes={etapas}
            desligado={ocupado}
            aoEscolher={(id) => {
              const etapa = etapas.find((e) => e.id === id);
              if (etapa) moverPara(etapa);
            }}
          />
        )}

        {confirmando && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-zinc-200 px-1.5 pt-1.5 dark:border-zinc-800">
            <p className="mr-auto text-[11.5px] text-amber-700 dark:text-amber-500">
              {confirmando.quantas} {confirmando.quantas === 1 ? "entra" : "entram"} na cadência de “{confirmando.etapa.nome}” e
              {confirmando.quantas === 1 ? " recebe" : " recebem"} as mensagens dela. Mover mesmo assim?
            </p>
            <button
              type="button"
              onClick={() => moverPara(confirmando.etapa, true)}
              disabled={ocupado}
              className="rounded-lg bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Mover
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(null)}
              disabled={ocupado}
              className="rounded-lg px-2 py-1 text-[12px] text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Cancelar
            </button>
          </div>
        )}

        {painel === "responsavel" && (
          <Escolha
            rotulo="Passar para"
            // "Sem responsável" é opção legítima, não ausência de escolha:
            // devolver o card à fila é uma operação que se faz de propósito.
            opcoes={[
              { id: "", nome: "Sem responsável" },
              ...usuarios.map((u) => ({ id: u.id, nome: u.nome })),
            ]}
            aoEscolher={(id) =>
              executar(moverParaResponsavel(selecionados, id || null))
            }
          />
        )}

        {painel === "segmento" && (
          <Escolha
            rotulo="Adicionar ao segmento"
            vazio="Nenhum segmento cadastrado — crie um em Configurações."
            opcoes={segmentos.map((s) => ({ id: s.id, nome: s.nome }))}
            aoEscolher={(id) => executar(adicionarASegmento(selecionados, id))}
          />
        )}

        {painel === "fluxo" && (
          <Escolha
            rotulo="Inscrever na automação"
            vazio="Nenhuma automação de oportunidade publicada."
            opcoes={fluxos.map((f) => ({ id: f.id, nome: f.nome }))}
            aoEscolher={(id) => executar(inscreverEmFluxo(selecionados, id))}
          />
        )}

        {aviso && (
          <p
            className={`mt-1.5 px-1.5 text-[11px] ${
              aviso.ok
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-amber-700 dark:text-amber-500"
            }`}
          >
            {aviso.texto}
          </p>
        )}
      </div>
    </div>
  );
}

function Botao({
  Icone,
  rotulo,
  onClick,
  ativo = false,
  ocupado,
}: {
  Icone: React.ComponentType<{ className?: string }>;
  rotulo: string;
  onClick: () => void;
  ativo?: boolean;
  ocupado: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${
        ativo
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
      }`}
    >
      <Icone className="size-3.5" />
      {rotulo}
    </button>
  );
}

// Lista de opções que aparece abaixo da barra. Um clique = a ação inteira: com
// seleção + confirmar seriam dois cliques para o mesmo resultado, e o aviso de
// retorno já diz o que aconteceu. A exceção é a etapa com cadência: aí o
// servidor devolve `confirmar` e quem executa é o botão "Mover" da barra.
// `desligado` enquanto uma ação roda: um segundo clique num lote longo
// entraria na fila e repetiria a ação.
function Escolha({
  rotulo,
  opcoes,
  aoEscolher,
  vazio,
  desligado = false,
}: {
  rotulo: string;
  opcoes: { id: string; nome: string }[];
  aoEscolher: (id: string) => void;
  vazio?: string;
  desligado?: boolean;
}) {
  return (
    <div className="mt-1.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
      <p className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </p>
      {opcoes.length === 0 ? (
        <p className="px-1.5 pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          {vazio ?? "Nada disponível."}
        </p>
      ) : (
        <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto px-1 pb-0.5">
          {opcoes.map((o) => (
            <button
              key={o.id || "nenhum"}
              type="button"
              onClick={() => aoEscolher(o.id)}
              disabled={desligado}
              className="rounded-lg border border-zinc-200 px-2 py-1 text-[12px] text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {o.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
