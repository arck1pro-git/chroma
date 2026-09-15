"use client";

// Campos personalizados da ficha de contato e da de oportunidade.
//
// A `chave` é derivada do rótulo e NUNCA muda: é ela que indexa o valor dentro
// do jsonb de cada registro (ver ../actions.ts). Por isso a tela só deixa
// editar o rótulo — renomear a chave orfanaria todo valor já gravado.
import { useState, useTransition } from "react";
import { Check, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { CampoPersonalizado } from "../dados";
import {
  criarCampoPersonalizado,
  editarCampoPersonalizado,
  excluirCampoPersonalizado,
} from "../actions";
import { botao, campoTexto } from "./ui";

const TIPOS_CAMPO = [
  { valor: "texto", rotulo: "Texto" },
  { valor: "numero", rotulo: "Número" },
  { valor: "data", rotulo: "Data" },
  { valor: "opcao", rotulo: "Opções" },
] as const;

export function CamposSection({ campos }: { campos: CampoPersonalizado[] }) {
  const [entidade, setEntidade] = useState<"contato" | "oportunidade">("contato");
  const [rotulo, setRotulo] = useState("");
  const [tipo, setTipo] = useState<string>("texto");
  const [opcoes, setOpcoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const daEntidade = campos.filter((c) => c.entidade === entidade);

  function criar() {
    const r = rotulo.trim();
    if (!r) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarCampoPersonalizado(entidade, r, tipo, opcoes);
        setRotulo("");
        setOpcoes("");
        setTipo("texto");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar campo");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <SlidersHorizontal className="size-3.5 text-zinc-400" aria-hidden="true" />
          Campos personalizados
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Informação que varia de contato para contato e não cabe numa coluna
          fixa — perguntas de formulário, origem, qualificação.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {/* Cada ficha tem sua própria lista: um campo de contato não aparece na
            oportunidade e vice-versa. */}
        <div className="mb-3 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {(["contato", "oportunidade"] as const).map((chave) => {
            const ativo = entidade === chave;
            const quantos = campos.filter((c) => c.entidade === chave).length;
            return (
              <button
                key={chave}
                type="button"
                onClick={() => setEntidade(chave)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition ${
                  ativo
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {chave === "contato" ? "Contato" : "Oportunidade"}
                <span className="ml-1.5 tabular-nums text-zinc-400">{quantos}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Nome do campo
            </span>
            <input
              type="text"
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="Ex.: Faixa de investimento"
              className={campoTexto}
            />
          </label>
          <label className="flex w-full flex-col gap-1.5 sm:w-32">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Tipo
            </span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className={campoTexto}
            >
              {TIPOS_CAMPO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={criar}
            disabled={!rotulo.trim() || salvando}
            className={botao}
          >
            <Plus className="size-4" aria-hidden="true" />
            Criar
          </button>
        </div>

        {tipo === "opcao" && (
          <label className="mt-2 flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Opções (separadas por vírgula)
            </span>
            <input
              type="text"
              value={opcoes}
              onChange={(e) => setOpcoes(e.target.value)}
              placeholder="até 50 mil, 50 a 100 mil, acima de 100 mil"
              className={campoTexto}
            />
          </label>
        )}

        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {daEntidade.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhum campo nesta ficha ainda.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {daEntidade.map((c) => (
              <CampoRow key={c.id} campo={c} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CampoRow({ campo }: { campo: CampoPersonalizado }) {
  const [editando, setEditando] = useState(false);
  const [rotulo, setRotulo] = useState(campo.rotulo);
  const [tipo, setTipo] = useState<string>(campo.tipo);
  const [opcoes, setOpcoes] = useState(campo.opcoes.join(", "));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const r = rotulo.trim();
    if (!r) return;
    setErro(null);
    iniciar(async () => {
      try {
        await editarCampoPersonalizado(campo.id, r, tipo, opcoes);
        setEditando(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function cancelar() {
    setRotulo(campo.rotulo);
    setTipo(campo.tipo);
    setOpcoes(campo.opcoes.join(", "));
    setErro(null);
    setEditando(false);
  }

  function remover() {
    if (
      !window.confirm(
        `Excluir o campo "${campo.rotulo}"? Ele some das fichas, mas os valores já preenchidos continuam guardados — recriar um campo com o mesmo nome traz tudo de volta.`,
      )
    )
      return;
    iniciar(() => {
      excluirCampoPersonalizado(campo.id);
    });
  }

  if (editando) {
    return (
      <li className="flex flex-col gap-2 py-2.5">
        <div className="flex items-center gap-2">
          <input
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
              if (e.key === "Escape") cancelar();
            }}
            autoFocus
            aria-label="Nome do campo"
            className={`${campoTexto} min-w-0 flex-1 py-1`}
          />
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo"
            className={`${campoTexto} w-28 shrink-0 py-1`}
          >
            {TIPOS_CAMPO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
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
        </div>
        {tipo === "opcao" && (
          <input
            value={opcoes}
            onChange={(e) => setOpcoes(e.target.value)}
            placeholder="Opções separadas por vírgula"
            aria-label="Opções"
            className={`${campoTexto} py-1`}
          />
        )}
        {erro && <p className="text-xs text-red-500">{erro}</p>}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          {campo.rotulo}
        </p>
        {/* A chave é o que está gravado no banco — mostro porque ela não muda
            no rename, e é por ela que a IA e as consultas encontram o valor. */}
        <p className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          {campo.chave}
          {campo.opcoes.length > 0 && ` · ${campo.opcoes.join(" / ")}`}
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {TIPOS_CAMPO.find((t) => t.valor === campo.tipo)?.rotulo ?? campo.tipo}
      </span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${campo.rotulo}`}
        className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={remover}
        disabled={salvando}
        aria-label={`Excluir ${campo.rotulo}`}
        className="shrink-0 text-zinc-400 transition hover:text-red-500"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}
