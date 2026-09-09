"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Mail,
  MailPlus,
  Pencil,
  SearchX,
} from "lucide-react";
import { emails as emailsSeed, usuarioPorId, type Email } from "../data";
import { dataHora } from "../formato";
import Construtor, { type DadosEmail } from "./construtor";

// Estado local espelhando a tabela `emails`. Enquanto não há banco, criar e
// editar mexem neste array; quando o SELECT/INSERT entrar, só a origem muda.
export default function ListaEmails() {
  const [emails, setEmails] = useState<Email[]>(emailsSeed);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | Email["status"]>(
    "todos",
  );
  // null = fechado; "novo" = criar; um Email = editar aquele.
  const [editor, setEditor] = useState<Email | "novo" | null>(null);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return emails.filter((e) => {
      if (filtroStatus !== "todos" && e.status !== filtroStatus) return false;
      if (!termo) return true;
      return (
        e.nome.toLowerCase().includes(termo) ||
        e.assunto.toLowerCase().includes(termo)
      );
    });
  }, [emails, busca, filtroStatus]);

  const prontos = useMemo(
    () => emails.filter((e) => e.status === "pronto").length,
    [emails],
  );

  const fechar = useCallback(() => setEditor(null), []);

  const salvar = useCallback(
    (dados: DadosEmail) => {
      const agora = new Date().toISOString();

      if (editor && editor !== "novo") {
        // Editar: preserva id/autor/criação, carimba atualização.
        const id = editor.id;
        setEmails((lista) =>
          lista.map((e) =>
            e.id === id ? { ...e, ...dados, data_atualizacao: agora } : e,
          ),
        );
      } else {
        // Nasce rascunho: quem acabou de colar um HTML não revisou nada ainda.
        setEmails((lista) => [
          {
            id: `e-${agora}`,
            ...dados,
            status: "rascunho",
            autor_id: "u-mk",
            data_criacao: agora,
            data_atualizacao: null,
          },
          ...lista,
        ]);
      }
      setEditor(null);
    },
    [editor],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-3.5 xl:px-16 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <Mail className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              E-mails
            </h1>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {emails.length} {emails.length === 1 ? "modelo" : "modelos"} ·{" "}
              {prontos} {prontos === 1 ? "pronto" : "prontos"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setEditor("novo")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <MailPlus className="size-4" aria-hidden="true" />
          Novo e-mail
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-6 py-2.5 xl:px-16 dark:border-zinc-800">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou assunto"
          className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10"
        />
        <div className="flex items-center gap-1">
          {(["todos", "pronto", "rascunho"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFiltroStatus(s)}
              aria-pressed={filtroStatus === s}
              className={`rounded-full px-3 py-1 text-[12px] font-medium capitalize transition ${
                filtroStatus === s
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {s === "todos" ? "Todos" : s === "pronto" ? "Prontos" : "Rascunhos"}
            </button>
          ))}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4 xl:px-16">
        <div className="mx-auto max-w-[1600px]">
          {visiveis.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-2 py-20 text-center">
              <SearchX
                className="size-8 text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Nenhum e-mail por aqui
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {emails.length === 0
                  ? "Crie o primeiro com o botão Novo e-mail."
                  : "Ajuste a busca ou o filtro de status."}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visiveis.map((email) => (
                <li key={email.id}>
                  <button
                    type="button"
                    onClick={() => setEditor(email)}
                    className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left transition hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                  >
                    {/* Miniatura real: o mesmo HTML, num iframe travado e sem
                        interação, encolhido pra caber no cartão. */}
                    <div className="relative h-36 shrink-0 overflow-hidden border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-black">
                      <iframe
                        title=""
                        aria-hidden="true"
                        tabIndex={-1}
                        srcDoc={email.html}
                        sandbox=""
                        className="pointer-events-none absolute left-0 top-0 h-[300%] w-[300%] origin-top-left scale-[0.333] border-0"
                      />
                      <span className="absolute right-2 top-2">
                        <Selo status={email.status} />
                      </span>
                      <span className="absolute inset-0 flex items-center justify-center bg-zinc-900/0 opacity-0 transition group-hover:bg-zinc-900/5 group-hover:opacity-100 dark:group-hover:bg-zinc-50/5">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900/90 px-3 py-1.5 text-[12px] font-medium text-white dark:bg-zinc-50/90 dark:text-zinc-900">
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Abrir no construtor
                        </span>
                      </span>
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-1 p-3.5">
                      <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                        {email.nome}
                      </p>
                      <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                        {email.assunto}
                      </p>
                      <p className="mt-auto truncate pt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                        {usuarioPorId.get(email.autor_id)?.nome ?? "—"} ·{" "}
                        {dataHora(email.data_atualizacao ?? email.data_criacao)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {editor !== null && (
        <Construtor
          email={editor === "novo" ? null : editor}
          aoSalvar={salvar}
          aoFechar={fechar}
        />
      )}
    </div>
  );
}

function Selo({ status }: { status: Email["status"] }) {
  const pronto = status === "pronto";
  const Icone = pronto ? CheckCircle2 : FileText;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset backdrop-blur ${
        pronto
          ? "bg-emerald-50/90 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
          : "bg-white/90 text-zinc-500 ring-zinc-200 dark:bg-zinc-900/90 dark:text-zinc-400 dark:ring-zinc-700"
      }`}
    >
      <Icone className="size-3" aria-hidden="true" />
      {pronto ? "Pronto" : "Rascunho"}
    </span>
  );
}
