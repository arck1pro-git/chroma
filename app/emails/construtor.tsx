"use client";

import { useEffect, useState } from "react";
import { Code2, Eye, Monitor, Smartphone, X } from "lucide-react";
import type { Email } from "../data";

const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

export type DadosEmail = {
  nome: string;
  assunto: string;
  remetente: string;
  html: string;
};

const HTML_INICIAL = `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:Helvetica,Arial,sans-serif">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px">
        <tr>
          <td style="padding:40px">
            <h1 style="margin:0;font-size:24px;color:#18181b">Título</h1>
            <p style="margin:16px 0 0;font-size:15px;line-height:24px;color:#52525b">
              Escreva aqui.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

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

export default function Construtor({
  email,
  aoSalvar,
  aoFechar,
}: {
  email: Email | null;
  aoSalvar: (dados: DadosEmail) => void;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState(email?.nome ?? "");
  const [assunto, setAssunto] = useState(email?.assunto ?? "");
  const [remetente, setRemetente] = useState(email?.remetente ?? "");
  const [html, setHtml] = useState(email?.html ?? HTML_INICIAL);
  const [aba, setAba] = useState<"html" | "preview">("html");
  const [largura, setLargura] = useState<"desktop" | "mobile">("desktop");

  // O preview é um iframe, e recarregar um iframe a cada tecla digitada trava a
  // digitação. Este atraso segura o srcDoc até a pessoa parar de escrever.
  const [htmlPreview, setHtmlPreview] = useState(html);
  useEffect(() => {
    const id = setTimeout(() => setHtmlPreview(html), 300);
    return () => clearTimeout(id);
  }, [html]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const podeSalvar = nome.trim() !== "" && assunto.trim() !== "";

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!podeSalvar) return;
    aoSalvar({
      nome: nome.trim(),
      assunto: assunto.trim(),
      remetente: remetente.trim(),
      html,
    });
  }

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label={email ? `Editar ${email.nome}` : "Novo e-mail"}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {email ? "Editar e-mail" : "Novo e-mail"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              Cole ou escreva o HTML à esquerda — o preview acompanha.
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

        <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col">
          <div className="grid shrink-0 grid-cols-1 gap-3 border-b border-zinc-200 px-5 py-4 sm:grid-cols-3 dark:border-zinc-800">
            <Campo rotulo="Nome">
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Boas-vindas · trial"
                autoFocus
                required
                className={campoTexto}
              />
            </Campo>
            <Campo rotulo="Assunto">
              <input
                type="text"
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                placeholder="O que aparece na caixa de entrada"
                required
                className={campoTexto}
              />
            </Campo>
            <Campo rotulo="Remetente">
              <input
                type="text"
                value={remetente}
                onChange={(e) => setRemetente(e.target.value)}
                placeholder="Nome <email@dominio.com.br>"
                className={campoTexto}
              />
            </Campo>
          </div>

          {/* Editor e preview: lado a lado no desktop; no estreito viram abas,
              porque duas colunas de 300px não servem pra nenhuma das duas. */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-1 lg:invisible">
              <AbaBotao
                Icone={Code2}
                rotulo="HTML"
                ativo={aba === "html"}
                aoClicar={() => setAba("html")}
              />
              <AbaBotao
                Icone={Eye}
                rotulo="Preview"
                ativo={aba === "preview"}
                aoClicar={() => setAba("preview")}
              />
            </div>

            <div className="flex items-center gap-1">
              <AbaBotao
                Icone={Monitor}
                rotulo="Desktop"
                ativo={largura === "desktop"}
                aoClicar={() => setLargura("desktop")}
              />
              <AbaBotao
                Icone={Smartphone}
                rotulo="Mobile"
                ativo={largura === "mobile"}
                aoClicar={() => setLargura("mobile")}
              />
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
            <div
              className={`min-h-0 border-zinc-200 lg:block lg:border-r dark:border-zinc-800 ${
                aba === "html" ? "block" : "hidden"
              }`}
            >
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                aria-label="HTML do e-mail"
                className="size-full resize-none bg-white px-5 py-4 font-mono text-[12px] leading-relaxed text-zinc-800 outline-none dark:bg-zinc-950 dark:text-zinc-200"
              />
            </div>

            <div
              className={`min-h-0 overflow-auto bg-zinc-100 p-4 lg:block dark:bg-black ${
                aba === "preview" ? "block" : "hidden"
              }`}
            >
              {/* sandbox sem allow-scripts: o HTML aqui é colado de fora, e um
                  <script> num template não pode rodar dentro do CRM. Sem o
                  atributo, o iframe herdaria a origem e executaria tudo. */}
              <iframe
                title="Preview do e-mail"
                srcDoc={htmlPreview}
                sandbox=""
                className={`mx-auto h-full rounded-lg border border-zinc-200 bg-white shadow-sm transition-[max-width] dark:border-zinc-800 ${
                  largura === "mobile" ? "max-w-[390px]" : "max-w-full"
                } w-full`}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={aoFechar}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!podeSalvar}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {email ? "Salvar alterações" : "Criar e-mail"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AbaBotao({
  Icone,
  rotulo,
  ativo,
  aoClicar,
}: {
  Icone: React.ComponentType<{ className?: string }>;
  rotulo: string;
  ativo: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativo}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition ${
        ativo
          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
      }`}
    >
      <Icone className="size-3.5" />
      {rotulo}
    </button>
  );
}
