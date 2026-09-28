"use client";

// Criar oportunidade a partir da conversa: o contato é fixo (o dela); aqui se
// escolhe funil, etapa, nome, valor e responsável.
import { useEffect, useMemo, useState, useTransition } from "react";
import { Wallet, X } from "lucide-react";
import type { Contato, Etapa, Funil, Usuario } from "../data";
import { criarOportunidade } from "./actions";

const campoModal =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";
const rotulo = "text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";

export function NovaOportunidade({
  contato,
  funis,
  etapas,
  usuarios,
  usuarioId,
  aoFechar,
}: {
  contato: Contato;
  funis: Funil[];
  etapas: Etapa[];
  usuarios: Usuario[];
  usuarioId: string;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [responsavelId, setResponsavelId] = useState(usuarioId);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  // Só funis com ao menos uma etapa — sem etapa não há onde a oportunidade cair.
  const funisValidos = useMemo(() => funis.filter((f) => etapas.some((e) => e.funil_id === f.id)), [funis, etapas]);
  const [funilId, setFunilId] = useState(funisValidos[0]?.id ?? "");
  const etapasDoFunil = useMemo(
    () => etapas.filter((e) => e.funil_id === funilId).sort((a, b) => a.ordem - b.ordem),
    [etapas, funilId],
  );
  const [etapaId, setEtapaId] = useState(etapasDoFunil[0]?.id ?? "");

  function trocarFunil(id: string) {
    setFunilId(id);
    setEtapaId(etapas.filter((e) => e.funil_id === id).sort((a, b) => a.ordem - b.ordem)[0]?.id ?? "");
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoFechar]);

  function criar() {
    const n = nome.trim();
    if (!n || !funilId || !etapaId) return;
    setErro(null);
    iniciar(async () => {
      const r = await criarOportunidade(contato.id, funilId, etapaId, n, Number(valor) || 0, responsavelId || null);
      if (r.erro) setErro(r.erro);
      else aoFechar();
    });
  }

  return (
    <div
      className="veu-surge fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Nova oportunidade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <Wallet className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Nova oportunidade</h2>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">Para {contato.nome}</p>
            </div>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
            <X className="size-4" />
          </button>
        </header>

        {funisValidos.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
            Você ainda não tem um funil com etapas. Crie um em <span className="font-medium text-zinc-700 dark:text-zinc-200">Configurações</span> antes de criar oportunidades.
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className={rotulo}>Nome</span>
              <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Unidade 1204" autoFocus className={campoModal} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={rotulo}>Valor (R$)</span>
                <input type="number" min={0} step={100} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" className={`${campoModal} tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={rotulo}>Responsável</span>
                <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className={campoModal}>
                  <option value="">Sem responsável</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={rotulo}>Funil</span>
                <select value={funilId} onChange={(e) => trocarFunil(e.target.value)} className={campoModal}>
                  {funisValidos.map((f) => (
                    <option key={f.id} value={f.id}>{f.nome}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={rotulo}>Etapa</span>
                <select value={etapaId} onChange={(e) => setEtapaId(e.target.value)} className={campoModal}>
                  {etapasDoFunil.map((e) => (
                    <option key={e.id} value={e.id}>{e.nome}</option>
                  ))}
                </select>
              </label>
            </div>
            {erro && <p className="text-xs text-red-500">{erro}</p>}
            <div className="mt-1 flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button type="button" onClick={aoFechar} className="rounded-lg border border-zinc-300 px-3 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">
                Cancelar
              </button>
              <button type="button" onClick={criar} disabled={!nome.trim() || !etapaId || salvando} className="rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200">
                Criar oportunidade
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
