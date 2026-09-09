"use client";

import { useEffect, useState } from "react";
import { User, Users, X } from "lucide-react";
import { SeletorMenu } from "../components/filtros-ui";
import type { Contato, Usuario } from "../data";

// Estilo dos campos de texto — mesmo dos selects/filtros, só sem a seta.
const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

export type DadosOportunidade = {
  nome: string;
  contato_id: string;
  valor: number;
  responsavel_id: string;
};

function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </span>
      {children}
    </label>
  );
}

export default function FormOportunidade({
  etapaNome,
  contatos,
  usuarios,
  aoCriar,
  aoFechar,
}: {
  etapaNome: string;
  contatos: Contato[];
  usuarios: Usuario[];
  aoCriar: (dados: DadosOportunidade) => void;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [contatoId, setContatoId] = useState("");
  const [valor, setValor] = useState("");
  const [responsavelId, setResponsavelId] = useState("");

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    aoCriar({
      nome: nome.trim(),
      contato_id: contatoId,
      valor: Number(valor) || 0,
      responsavel_id: responsavelId,
    });
  }

  return (
    // O container é o próprio véu: clicar em volta do card fecha; o card para a
    // propagação para o clique dentro não fechar.
    <div
      className="veu-surge fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label={`Nova oportunidade em ${etapaNome}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Nova oportunidade
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              Etapa: {etapaNome}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={enviar} className="flex flex-col gap-4 px-5 py-4">
          <Campo rotulo="Nome">
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Projeto residencial"
              autoFocus
              required
              className={campoTexto}
            />
          </Campo>

          <Campo rotulo="Contato">
            <SeletorMenu
              Icone={User}
              rotulo="Selecionar contato"
              valor={contatoId}
              opcoes={[
                { valor: "", rotulo: "Sem contato" },
                ...contatos.map((c) => ({ valor: c.id, rotulo: c.nome })),
              ]}
              aoMudar={setContatoId}
              botao="w-full"
              ativo={contatoId !== ""}
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Valor (R$)">
              <input
                type="number"
                min={0}
                step={100}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0"
                className={`${campoTexto} tabular-nums`}
              />
            </Campo>

            <Campo rotulo="Responsável">
              <SeletorMenu
                Icone={Users}
                rotulo="Selecionar"
                valor={responsavelId}
                opcoes={[
                  { valor: "", rotulo: "Sem responsável" },
                  ...usuarios.map((u) => ({ valor: u.id, rotulo: u.nome })),
                ]}
                aoMudar={setResponsavelId}
                botao="w-full"
                ativo={responsavelId !== ""}
              />
            </Campo>
          </div>

          <div className="mt-1 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={aoFechar}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!nome.trim()}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Criar oportunidade
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
