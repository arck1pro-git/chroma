"use client";

// Lista de nomes com CRUD. Tags e Segmentos são a MESMA tela: mudam o rótulo,
// o ícone, o gênero da frase e as três actions. Cada uma mora na sua rota
// (../tags, ../segmentos).
//
// A montagem é feita AQUI, não no page.tsx de cada rota, e o motivo é a
// fronteira servidor/cliente: `Icone` é um componente, e componente não
// atravessa essa fronteira como prop — o page.tsx é server e tentar passar o
// ícone de lá derruba a rota com "Functions cannot be passed directly to
// Client Components". Actions atravessam (são "use server"), ícones não. Com
// as duas variantes fechadas neste módulo, as páginas só mandam as linhas.
//
// O DESENHO (redesenho de 2026-10-08): eram pílulas soltas com lápis e
// lixeira de 12px dentro, debaixo de um campo de criar do tamanho da tela.
// Agora é uma lista: o nome, QUANTOS CONTATOS usam (o que muda a decisão de
// renomear ou excluir) e as ações no hover. Criar é a primeira linha da lista;
// com muitos itens, aparece a busca.
import { useState, useTransition } from "react";
import {
  Boxes,
  Check,
  Pencil,
  Plus,
  Search,
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
import { BotaoIcone, Cabecalho, Erro, Painel, Vazio } from "./pecas";

type Nomeado = { id: string; nome: string; contatos?: number };

/** A partir de quantos itens a busca aparece. Abaixo disso, ela é ruído. */
const BUSCA_A_PARTIR_DE = 9;

type Variante = {
  titulo: string;
  descricao: string;
  Icone: LucideIcon;
  /** "tag" / "segmento", no meio da frase. */
  item: string;
  /** "a" / "o": "a tag", "o segmento"; "Nenhuma" / "Nenhum". */
  artigo: "a" | "o";
  /** O passo seguinte, para o estado vazio. */
  depois: string;
  aoCriar: (nome: string) => Promise<unknown>;
  aoEditar: (id: string, nome: string) => Promise<unknown>;
  aoExcluir: (id: string) => Promise<unknown>;
};

export function SecaoTags({ itens }: { itens: Nomeado[] }) {
  return (
    <SecaoNomes
      itens={itens}
      v={{
        titulo: "Tags",
        descricao:
          "Rótulos livres para marcar contatos — origem, interesse, perfil. Aparecem na ficha do contato e filtram o quadro.",
        Icone: TagIcon,
        item: "tag",
        artigo: "a",
        depois: "Depois é só marcar na ficha do contato.",
        aoCriar: criarTag,
        aoEditar: editarTag,
        aoExcluir: deletarTag,
      }}
    />
  );
}

export function SecaoSegmentos({ itens }: { itens: Nomeado[] }) {
  return (
    <SecaoNomes
      itens={itens}
      v={{
        titulo: "Segmentos",
        descricao:
          "Grupos da base de contatos, para disparar e automatizar por público. Um contato pode estar em vários.",
        Icone: Boxes,
        item: "segmento",
        artigo: "o",
        depois: "Depois, adicione contatos pela ficha ou pela seleção do quadro.",
        aoCriar: criarSegmento,
        aoEditar: editarSegmento,
        aoExcluir: deletarSegmento,
      }}
    />
  );
}

function SecaoNomes({ itens, v }: { itens: Nomeado[]; v: Variante }) {
  const [nome, setNome] = useState("");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const nenhum = v.artigo === "a" ? "Nenhuma" : "Nenhum";
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = termo
    ? itens.filter((it) => it.nome.toLocaleLowerCase("pt-BR").includes(termo))
    : itens;

  function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await v.aoCriar(n);
        setNome("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar");
      }
    });
  }

  return (
    <section className="flex flex-col gap-6">
      <Cabecalho
        Icone={v.Icone}
        titulo={v.titulo}
        contagem={itens.length}
        descricao={v.descricao}
      />

      <Painel className="overflow-hidden">
        {/* Criar é a primeira linha: escrever o nome e dar Enter. */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800/80">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
            <Plus className="size-3.5" aria-hidden="true" />
          </span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") criar();
              if (e.key === "Escape") setNome("");
            }}
            placeholder={`Nov${v.artigo} ${v.item} — escreva o nome e tecle Enter`}
            aria-label={`Nome d${v.artigo} nov${v.artigo} ${v.item}`}
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
          />
          {nome.trim() && (
            <button type="button" onClick={criar} disabled={salvando} className={`${botao} h-8 px-3`}>
              {salvando ? "Criando…" : "Criar"}
            </button>
          )}
        </div>
        {erro && (
          <div className="border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800/80">
            <Erro>{erro}</Erro>
          </div>
        )}

        {itens.length >= BUSCA_A_PARTIR_DE && (
          <div className="border-b border-zinc-100 px-5 py-2 dark:border-zinc-800/80">
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-0 size-3.5 text-zinc-400" aria-hidden="true" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={`Buscar entre ${itens.length}`}
                aria-label={`Buscar ${v.item}`}
                className="h-8 w-full bg-transparent pl-6 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
              />
            </label>
          </div>
        )}

        {itens.length === 0 ? (
          <Vazio
            Icone={v.Icone}
            titulo={`${nenhum} ${v.item} ainda`}
            texto={`Crie ${v.artigo} primeir${v.artigo} na linha acima. ${v.depois}`}
          />
        ) : visiveis.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">
            {nenhum} {v.item} com “{busca.trim()}”.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {visiveis.map((it) => (
              <LinhaNome key={it.id} item={it} v={v} />
            ))}
          </ul>
        )}
      </Painel>
    </section>
  );
}

function LinhaNome({ item, v }: { item: Nomeado; v: Variante }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(item.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const contatos = item.contatos ?? 0;

  function salvar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    iniciar(async () => {
      try {
        await v.aoEditar(item.id, n);
        setEditando(false);
      } catch (e) {
        // Fica em edição E diz por quê — antes a falha era engolida e o campo
        // só não fechava.
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function cancelar() {
    setNome(item.nome);
    setErro(null);
    setEditando(false);
  }

  function remover() {
    const pronome = v.artigo === "a" ? "Ela" : "Ele";
    const efeito =
      contatos === 0
        ? "Nenhum contato usa."
        : `${pronome} sai de ${contatos} ${contatos === 1 ? "contato" : "contatos"}.`;
    if (!window.confirm(`Excluir ${v.artigo} ${v.item} "${item.nome}"? ${efeito}`)) return;
    setErro(null);
    iniciar(async () => {
      try {
        await v.aoExcluir(item.id);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao excluir");
      }
    });
  }

  return (
    <li className="group px-5 py-2 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40">
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-400">
          <v.Icone className="size-3.5" aria-hidden="true" />
        </span>

        {editando ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") cancelar();
              }}
              autoFocus
              aria-label={`Nome d${v.artigo} ${v.item}`}
              className={`${campoTexto} h-8 min-w-0 flex-1`}
            />
            <BotaoIcone rotulo="Salvar" onClick={salvar} disabled={salvando || !nome.trim()}>
              <Check className="size-4" aria-hidden="true" />
            </BotaoIcone>
            <BotaoIcone rotulo="Cancelar" onClick={cancelar}>
              <X className="size-4" aria-hidden="true" />
            </BotaoIcone>
          </div>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
              {item.nome}
            </span>
            <span
              className={`shrink-0 text-[12px] tabular-nums ${
                contatos > 0 ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-300 dark:text-zinc-600"
              }`}
            >
              {contatos === 0 ? "nenhum contato" : `${contatos} ${contatos === 1 ? "contato" : "contatos"}`}
            </span>
            <div className="flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
              <BotaoIcone rotulo={`Renomear ${item.nome}`} onClick={() => setEditando(true)}>
                <Pencil className="size-3.5" aria-hidden="true" />
              </BotaoIcone>
              <BotaoIcone rotulo={`Excluir ${item.nome}`} onClick={remover} disabled={salvando} perigo>
                <Trash2 className="size-3.5" aria-hidden="true" />
              </BotaoIcone>
            </div>
          </>
        )}
      </div>
      {erro && (
        <div className="mt-2 pl-10">
          <Erro>{erro}</Erro>
        </div>
      )}
    </li>
  );
}
