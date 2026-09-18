"use client";

// Usuários do CRM: nome e iniciais (as que aparecem no avatar do quadro e do
// chat). As iniciais são sugeridas a partir do nome, mas continuam editáveis —
// dois "Fabrício Almeida" na mesma tela precisam de um jeito de se distinguir.
import { useState, useTransition } from "react";
import { Check, Pencil, UserPlus, Users, X } from "lucide-react";
import type { UsuarioConfig } from "../dados";
import { criarUsuario, editarUsuario } from "../actions";
import { botao, campoTexto } from "./ui";

// Deriva iniciais do nome (1ª letra das 2 primeiras palavras) — só pra sugerir.
function iniciaisDe(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

// ── Usuários ─────────────────────────────────────────────────────────────────
export function UsuariosSection({ usuarios }: { usuarios: UsuarioConfig[] }) {
  const [nome, setNome] = useState("");
  const [iniciais, setIniciais] = useState("");
  // O número por onde a automação AVISA a pessoa (bloco "Enviar notificação").
  // Vazio é o normal: quem não recebe aviso não precisa dele.
  const [whatsapp, setWhatsapp] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarUsuario(n, iniciais, whatsapp);
        setNome("");
        setIniciais("");
        setWhatsapp("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar usuário");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <Users className="size-3.5 text-zinc-400" aria-hidden="true" />
          Usuários
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Quem aparece como responsável e autor. O WhatsApp é por onde a
          automação avisa a pessoa — vazio, ela não pode ser escolhida no bloco
          de notificação.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Nome
            </span>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="Ex.: Renan Sampaio"
              className={campoTexto}
            />
          </label>
          <label className="flex w-full flex-col gap-1.5 sm:w-24">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Iniciais
            </span>
            <input
              type="text"
              value={iniciais}
              onChange={(e) => setIniciais(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder={iniciaisDe(nome) || "AB"}
              className={`${campoTexto} text-center uppercase`}
            />
          </label>
          <label className="flex w-full flex-col gap-1.5 sm:w-44">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              WhatsApp
            </span>
            <input
              type="text"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="5547999999999"
              className={`${campoTexto} tabular-nums`}
            />
          </label>
          <button
            type="button"
            onClick={criar}
            disabled={!nome.trim() || salvando}
            className={botao}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            Criar
          </button>
        </div>
        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {usuarios.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhum usuário ainda — crie ao menos um para o chat ter identidade.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {usuarios.map((u) => (
              <UsuarioRow key={u.id} usuario={u} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function UsuarioRow({ usuario }: { usuario: UsuarioConfig }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(usuario.nome);
  const [iniciais, setIniciais] = useState(usuario.iniciais);
  const [whatsapp, setWhatsapp] = useState(usuario.whatsapp ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await editarUsuario(usuario.id, n, iniciais, whatsapp);
        setEditando(false);
      } catch (e) {
        // Mantém em edição E DIZ O MOTIVO: o número inválido é recusado pela
        // action, e sem esta linha a linha só piscava e voltava ao mesmo lugar.
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function cancelar() {
    setNome(usuario.nome);
    setIniciais(usuario.iniciais);
    setWhatsapp(usuario.whatsapp ?? "");
    setErro(null);
    setEditando(false);
  }

  if (editando) {
    return (
      <li className="flex items-center gap-2 py-2">
        <input
          value={iniciais}
          onChange={(e) => setIniciais(e.target.value.toUpperCase())}
          maxLength={4}
          aria-label="Iniciais"
          className={`${campoTexto} w-14 shrink-0 text-center uppercase`}
        />
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") cancelar();
          }}
          autoFocus
          aria-label="Nome"
          className={`${campoTexto} min-w-0 flex-1`}
        />
        <input
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") cancelar();
          }}
          placeholder="5547999999999"
          aria-label="WhatsApp"
          className={`${campoTexto} w-40 shrink-0 tabular-nums`}
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          aria-label="Salvar"
          className="shrink-0 text-zinc-400 transition hover:text-emerald-600"
        >
          <Check className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={cancelar}
          aria-label="Cancelar"
          className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        {erro && <p className="ml-2 shrink-0 text-xs text-red-500">{erro}</p>}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        {usuario.iniciais}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-900 dark:text-zinc-50">
        {usuario.nome}
      </span>
      {/* Sem número, a pessoa não aparece no seletor de "Avisar" da cadência —
          e isso precisa ser visível aqui, que é onde se resolve. */}
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
        {usuario.whatsapp ?? "sem WhatsApp"}
      </span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${usuario.nome}`}
        className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}
