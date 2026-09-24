"use client";

import { useEffect, useState } from "react";
import { Pencil, UserPlus, X } from "lucide-react";

const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

export type DadosContato = {
  nome: string;
  email: string;
  whatsapp: string;
  cidade: string;
  estado: string;
  pais: string;
};

function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </span>
      {children}
    </label>
  );
}

/**
 * Um formulário só para criar e para editar.
 *
 * O que muda entre os dois é o que cabe em três strings (título, subtítulo,
 * rótulo do botão) e o estado inicial dos campos — não é diferença que valha um
 * segundo componente para sair de sincronia com este.
 *
 * `inicial` ausente = novo contato.
 */
export default function FormContato({
  inicial,
  aoSalvar,
  aoFechar,
}: {
  inicial?: DadosContato;
  aoSalvar: (dados: DadosContato) => void;
  aoFechar: () => void;
}) {
  const editando = inicial !== undefined;

  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [whatsapp, setWhatsapp] = useState(inicial?.whatsapp ?? "");
  const [cidade, setCidade] = useState(inicial?.cidade ?? "");
  const [estado, setEstado] = useState(inicial?.estado ?? "");
  // País quase sempre é Brasil na base; começar preenchido poupa o campo mais
  // comum sem impedir a troca.
  const [pais, setPais] = useState(inicial?.pais ?? "Brasil");

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
    aoSalvar({
      nome: nome.trim(),
      email: email.trim(),
      whatsapp: whatsapp.trim(),
      cidade: cidade.trim(),
      estado: estado.trim(),
      pais: pais.trim() || "Brasil",
    });
  }

  return (
    <div
      className="veu-surge fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label={editando ? "Editar contato" : "Registrar novo contato"}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              {editando ? (
                <Pencil className="size-4" aria-hidden="true" />
              ) : (
                <UserPlus className="size-4" aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {editando ? "Editar contato" : "Novo contato"}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Só o nome é obrigatório.
              </p>
            </div>
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
              placeholder="Ex.: Mariana Alves"
              autoFocus
              required
              className={campoTexto}
            />
          </Campo>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="E-mail">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com.br"
                className={campoTexto}
              />
            </Campo>
            <Campo rotulo="WhatsApp">
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+55 11 90000-0000"
                className={campoTexto}
              />
            </Campo>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo rotulo="Cidade">
              <input
                type="text"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                placeholder="São Paulo"
                className={campoTexto}
              />
            </Campo>
            <Campo rotulo="Estado">
              <input
                type="text"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                placeholder="SP"
                className={campoTexto}
              />
            </Campo>
            <Campo rotulo="País">
              <input
                type="text"
                value={pais}
                onChange={(e) => setPais(e.target.value)}
                placeholder="Brasil"
                className={campoTexto}
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
              {editando ? "Salvar alterações" : "Registrar contato"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
