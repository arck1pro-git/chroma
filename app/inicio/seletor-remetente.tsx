"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Send, Smartphone, UserRound } from "lucide-react";
import CamadaTopo from "../components/camada-topo";
import { INSTANCIA_RESPONSAVEL } from "@/lib/automacoes/saida";
import type { InstanciaEscolhivel } from "./cadencias";

export default function SeletorRemetente({
  valor,
  instancias,
  aoMudar,
}: {
  valor: string | null;
  instancias: InstanciaEscolhivel[];
  aoMudar: (id: string | null) => void;
}) {
  const id = useId();
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState<{ left: number; top: number; width: number; maxHeight: number; acima: boolean } | null>(null);
  const [ativo, setAtivo] = useState(0);
  const opcoes = [
    { id: INSTANCIA_RESPONSAVEL, nome: "Responsável da oportunidade", detalhe: "Usa o WhatsApp vinculado ao responsável", Icone: UserRound, aviso: false },
    ...instancias.map((i) => ({ id: i.id, nome: i.nome, detalhe: i.numero || "WhatsApp ainda não pareado", Icone: Smartphone, aviso: !i.numero })),
    { id: null, nome: "Sem seleção", detalhe: "Escolher o remetente depois", Icone: Send, aviso: false },
  ];
  const selecionada = opcoes.find((o) => o.id === valor);
  const responsavel = valor === INSTANCIA_RESPONSAVEL;
  const Icone = selecionada?.Icone ?? Send;
  const aberto = posicao !== null;

  function abrir(indice?: number) {
    const rect = botao.current!.getBoundingClientRect();
    const abaixo = window.innerHeight - rect.bottom - 14;
    const acima = abaixo < 260 && rect.top > abaixo;
    const width = Math.min(320, window.innerWidth - 24);
    setPosicao({
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      top: acima ? rect.top - 6 : rect.bottom + 6,
      width,
      maxHeight: Math.min(340, Math.max(0, acima ? rect.top - 18 : abaixo)),
      acima,
    });
    setAtivo(indice ?? Math.max(0, opcoes.findIndex((o) => o.id === valor)));
  }

  function escolher(indice: number) {
    aoMudar(opcoes[indice].id);
    setPosicao(null);
    botao.current?.focus();
  }

  useEffect(() => {
    if (!aberto) return;
    function fora(e: PointerEvent) {
      const alvo = e.target as Node;
      if (!botao.current?.contains(alvo) && !lista.current?.contains(alvo)) setPosicao(null);
    }
    function reposicionar(e: Event) {
      // Rolagem dentro das opções permanece aberta; a do quadro fecha o menu.
      if (e.target instanceof Node && lista.current?.contains(e.target)) return;
      setPosicao(null);
    }
    document.addEventListener("pointerdown", fora);
    window.addEventListener("resize", reposicionar);
    window.addEventListener("scroll", reposicionar, true);
    return () => {
      document.removeEventListener("pointerdown", fora);
      window.removeEventListener("resize", reposicionar);
      window.removeEventListener("scroll", reposicionar, true);
    };
  }, [aberto]);

  useEffect(() => {
    if (aberto) document.getElementById(`${id}-opcao-${ativo}`)?.scrollIntoView({ block: "nearest" });
  }, [aberto, ativo, id]);

  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
      <Send className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
      <span id={`${id}-rotulo`} className="w-14 shrink-0">Sai por</span>
      <button
        ref={botao}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-rotulo ${id}-valor`}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? `${id}-lista` : undefined}
        aria-activedescendant={aberto ? `${id}-opcao-${ativo}` : undefined}
        onBlur={() => setPosicao(null)}
        onClick={() => aberto ? setPosicao(null) : abrir()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && aberto) {
            e.preventDefault();
            e.stopPropagation();
            setPosicao(null);
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            if (!aberto) abrir(e.key === "End" ? opcoes.length - 1 : undefined);
            else setAtivo(e.key === "Home" ? 0 : e.key === "End" ? opcoes.length - 1 : (ativo + (e.key === "ArrowDown" ? 1 : -1) + opcoes.length) % opcoes.length);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (aberto) escolher(ativo);
            else abrir();
          } else if (e.key === "Tab") setPosicao(null);
          else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const indice = opcoes.findIndex((o) => o.nome.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()));
            if (indice >= 0) {
              e.preventDefault();
              if (aberto) setAtivo(indice);
              else abrir(indice);
            }
          }
        }}
        className={`group flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-violet-500/30 ${responsavel ? "border-violet-200 bg-violet-50/70 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500"}`}
      >
        <Icone className={`size-3.5 shrink-0 ${responsavel ? "text-violet-500" : "text-zinc-400"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span id={`${id}-valor`} className="block text-[12px] font-medium leading-4">
            {selecionada?.nome ?? "Número removido"}
          </span>
          {selecionada && valor && (
            <span className={`mt-0.5 block truncate text-[10px] ${selecionada.aviso ? "text-amber-600 dark:text-amber-400" : responsavel ? "text-violet-500 dark:text-violet-400" : "text-zinc-400"}`}>
              {responsavel ? "Conforme a oportunidade" : selecionada.detalhe}
            </span>
          )}
        </span>
        <ChevronDown className={`size-3.5 shrink-0 text-zinc-400 transition-transform ${aberto ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {posicao && (
        <CamadaTopo>
          <div
            ref={lista}
            id={`${id}-lista`}
            role="listbox"
            aria-labelledby={`${id}-rotulo`}
            onPointerDown={(e) => e.preventDefault()}
            style={{ left: posicao.left, top: posicao.top, width: posicao.width, maxHeight: posicao.maxHeight, transform: posicao.acima ? "translateY(-100%)" : undefined }}
            className="fixed z-[400] overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-950/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/30"
          >
            {opcoes.map((opcao, indice) => (
              <div
                key={opcao.id ?? "vazio"}
                id={`${id}-opcao-${indice}`}
                role="option"
                aria-selected={opcao.id === valor}
                onClick={() => escolher(indice)}
                onMouseMove={() => setAtivo(indice)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors ${indice === ativo ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${indice === 1 || opcao.id === null ? "border-t border-zinc-100 dark:border-zinc-800" : ""}`}
              >
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${opcao.id === INSTANCIA_RESPONSAVEL ? "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                  <opcao.Icone className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-zinc-800 dark:text-zinc-100">{opcao.nome}</span>
                  <span className={`mt-0.5 block text-[10px] leading-4 ${opcao.aviso ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}>{opcao.detalhe}</span>
                </span>
                {opcao.id === valor && <Check className="size-3.5 shrink-0 text-violet-500" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </CamadaTopo>
      )}
    </div>
  );
}
