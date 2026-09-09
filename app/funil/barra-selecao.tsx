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
import { Download, Send, Users, UserCog, X } from "lucide-react";
import type { Segmento, Usuario } from "../data";
import {
  adicionarASegmento,
  exportarOportunidades,
  inscreverEmFluxo,
  moverParaResponsavel,
} from "./actions";

export type FluxoDisponivel = { id: string; nome: string };

type Painel = "responsavel" | "segmento" | "fluxo" | null;

export default function BarraSelecao({
  selecionados,
  usuarios,
  segmentos,
  fluxos,
  aoLimpar,
}: {
  selecionados: string[];
  usuarios: Usuario[];
  segmentos: Segmento[];
  fluxos: FluxoDisponivel[];
  aoLimpar: () => void;
}) {
  const [painel, setPainel] = useState<Painel>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, comecar] = useTransition();

  if (selecionados.length === 0) return null;

  const n = selecionados.length;

  function abrir(qual: Painel) {
    setAviso(null);
    setPainel((atual) => (atual === qual ? null : qual));
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
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ml-1.5 mr-1 text-[12px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {n} {n === 1 ? "selecionada" : "selecionadas"}
          </span>

          <Botao Icone={Download} rotulo="Exportar" onClick={exportar} ocupado={ocupado} />
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
            onClick={aoLimpar}
            className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="size-3.5" aria-hidden="true" />
            Limpar
          </button>
        </div>

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
// retorno já diz o que aconteceu.
function Escolha({
  rotulo,
  opcoes,
  aoEscolher,
  vazio,
}: {
  rotulo: string;
  opcoes: { id: string; nome: string }[];
  aoEscolher: (id: string) => void;
  vazio?: string;
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
              className="rounded-lg border border-zinc-200 px-2 py-1 text-[12px] text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {o.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
