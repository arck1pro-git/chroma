"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { entrar, type EstadoLogin } from "./acoes";

// Botão separado só para poder usar useFormStatus: o hook lê o <form> que o
// envolve, então ele precisa ser um componente DENTRO do form, não o próprio.
function Botao() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 h-9 rounded-lg bg-zinc-900 text-[14px] font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}

export default function Formulario({ de }: { de: string | null }) {
  const [estado, acao] = useActionState<EstadoLogin, FormData>(entrar, {
    erro: null,
  });

  return (
    <form action={acao} className="flex flex-col gap-3">
      {/* Para onde voltar depois de entrar. Vai no form e não na sessão porque
          é dado da tentativa, não da pessoa — e o servidor confere que aponta
          pra dentro do CRM antes de usar (destinoSeguro, em acoes.ts). */}
      {de && <input type="hidden" name="de" value={de} />}

      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          className="h-9 rounded-lg border border-zinc-300 bg-transparent px-2.5 text-[14px] text-zinc-900 outline-none transition focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:text-zinc-50 dark:focus-visible:border-zinc-100"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
          Senha
        </span>
        <input
          name="senha"
          type="password"
          required
          autoComplete="current-password"
          className="h-9 rounded-lg border border-zinc-300 bg-transparent px-2.5 text-[14px] text-zinc-900 outline-none transition focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:text-zinc-50 dark:focus-visible:border-zinc-100"
        />
      </label>

      {/* role="alert" para o leitor de tela anunciar a recusa: sem isso, quem
          navega por teclado não descobre que o envio falhou. */}
      {estado.erro && (
        <p
          role="alert"
          className="surge rounded-lg bg-red-50 px-2.5 py-2 text-[13px] text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {estado.erro}
        </p>
      )}

      <Botao />
    </form>
  );
}
