"use client";

// Lista de nomes com CRUD. Tags e Segmentos são a MESMA tela: mudam o rótulo,
// o ícone e as três actions. Cada uma mora na sua rota (../tags, ../segmentos).
//
// A montagem é feita AQUI, não no page.tsx de cada rota, e o motivo é a
// fronteira servidor/cliente: `Icone` é um componente, e componente não
// atravessa essa fronteira como prop — o page.tsx é server e tentar passar o
// ícone de lá derruba a rota com "Functions cannot be passed directly to
// Client Components". Actions atravessam (são "use server"), ícones não. Com
// as duas variantes fechadas neste módulo, as páginas só mandam as linhas.
import { useState, useTransition } from "react";
import {
  Boxes,
  Check,
  Pencil,
  Plus,
  Tag as TagIcon,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  criarSegmento,
  criarTag,
  deletarSegmento,
  deletarTag,
  editarSegmento,
  editarTag,
} from "../actions";
import { botao, campoTexto } from "./ui";

type Nomeado = { id: string; nome: string };

export function SecaoTags({ itens }: { itens: Nomeado[] }) {
  return (
    <SecaoNomes
      titulo="Tags"
      descricao="Rótulos para classificar contatos."
      Icone={TagIcon}
      itens={itens}
      rotuloItem="tag"
      avisoExcluir="Ela será removida de todos os contatos."
      aoCriar={criarTag}
      aoEditar={editarTag}
      aoExcluir={deletarTag}
    />
  );
}

export function SecaoSegmentos({ itens }: { itens: Nomeado[] }) {
  return (
    <SecaoNomes
      titulo="Segmentos"
      descricao="Grupos para segmentar a base de contatos."
      Icone={Boxes}
      itens={itens}
      rotuloItem="segmento"
      avisoExcluir="Ele será removido de todos os contatos."
      aoCriar={criarSegmento}
      aoEditar={editarSegmento}
      aoExcluir={deletarSegmento}
    />
  );
}

function SecaoNomes({
  titulo,
  descricao,
  Icone,
  itens,
  rotuloItem,
  avisoExcluir,
  aoCriar,
  aoEditar,
  aoExcluir,
}: {
  titulo: string;
  descricao: string;
  Icone: LucideIcon;
  itens: { id: string; nome: string }[];
  rotuloItem: string;
  avisoExcluir: string;
  aoCriar: (nome: string) => Promise<unknown>;
  aoEditar: (id: string, nome: string) => Promise<unknown>;
  aoExcluir: (id: string) => Promise<unknown>;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await aoCriar(n);
        setNome("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar");
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          <Icone className="size-3.5 text-zinc-400" aria-hidden="true" />
          {titulo}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{descricao}</p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex gap-2">
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder={`Novo ${rotuloItem}`}
            className={`${campoTexto} flex-1`}
          />
          <button
            type="button"
            onClick={criar}
            disabled={!nome.trim() || salvando}
            className={botao}
          >
            <Plus className="size-4" aria-hidden="true" />
            Criar
          </button>
        </div>
        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {itens.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhum {rotuloItem} ainda.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {itens.map((it) => (
              <LinhaNome
                key={it.id}
                item={it}
                rotuloItem={rotuloItem}
                avisoExcluir={avisoExcluir}
                aoEditar={aoEditar}
                aoExcluir={aoExcluir}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LinhaNome({
  item,
  rotuloItem,
  avisoExcluir,
  aoEditar,
  aoExcluir,
}: {
  item: { id: string; nome: string };
  rotuloItem: string;
  avisoExcluir: string;
  aoEditar: (id: string, nome: string) => Promise<unknown>;
  aoExcluir: (id: string) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(item.nome);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    iniciar(async () => {
      try {
        await aoEditar(item.id, n);
        setEditando(false);
      } catch {
        // mantém em edição
      }
    });
  }

  function remover() {
    if (!window.confirm(`Excluir "${item.nome}"? ${avisoExcluir}`)) return;
    iniciar(() => {
      aoExcluir(item.id);
    });
  }

  if (editando) {
    return (
      <li className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-900">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") {
              setNome(item.nome);
              setEditando(false);
            }
          }}
          autoFocus
          className="w-28 bg-transparent text-xs text-zinc-900 outline-none dark:text-zinc-50"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          aria-label="Salvar"
          className="text-zinc-400 transition hover:text-emerald-600"
        >
          <Check className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setNome(item.nome);
            setEditando(false);
          }}
          aria-label="Cancelar"
          className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </li>
    );
  }

  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
      <span>{item.nome}</span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${rotuloItem} ${item.nome}`}
        className="text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        <Pencil className="size-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={remover}
        disabled={salvando}
        aria-label={`Excluir ${rotuloItem} ${item.nome}`}
        className="text-zinc-400 transition hover:text-red-500"
      >
        <Trash2 className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
}
