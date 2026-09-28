"use client";

// A lista de conversas do canal escolhido.
//
// O cabeçalho diz DE QUEM é a caixa que se está olhando (foto, nome, papel e
// conexão do número) — no celular ele é também o botão que troca de canal. Os
// filtros são de estado da conversa, não de canal: o canal já foi escolhido.
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, Inbox, Search, Sparkles, SquarePen, X } from "lucide-react";
import type { CanalChat, ConversaResumo } from "./tipos";
import { ListaCanais } from "./canais";
import {
  Avatar,
  ESTADO,
  Entrega,
  PAPEL,
  SeloCanal,
  canalDaConversa,
  formatarTelefone,
  fotoDoContato,
  previa,
  quandoNaLista,
  tipoDaConversa,
} from "./ui";

export type Filtro = "abertas" | "nao_lidas" | "fila" | "minhas" | "encerradas";

const FILTROS: Array<{ id: Filtro; rotulo: string }> = [
  { id: "abertas", rotulo: "Abertas" },
  { id: "nao_lidas", rotulo: "Não lidas" },
  { id: "fila", rotulo: "Fila" },
  { id: "minhas", rotulo: "Minhas" },
  { id: "encerradas", rotulo: "Encerradas" },
];

export function passaFiltro(c: ConversaResumo, f: Filtro, usuarioId: string) {
  if (f === "encerradas") return c.status === "encerrado";
  if (c.status === "encerrado") return false;
  if (f === "nao_lidas") return c.nao_lidas > 0;
  if (f === "fila") return c.status === "na_fila";
  if (f === "minhas") return c.responsavel_id === usuarioId;
  return true;
}

const VAZIO: Record<Filtro, { titulo: string; texto: string }> = {
  abertas: { titulo: "Nenhuma conversa aberta", texto: "Quando alguém escrever para este número, a conversa aparece aqui." },
  nao_lidas: { titulo: "Tudo lido", texto: "Nenhuma mensagem esperando leitura." },
  fila: { titulo: "Fila vazia", texto: "Mensagem nova sem responsável cai aqui." },
  minhas: { titulo: "Nenhuma conversa sua", texto: "Assuma uma da fila ou comece uma nova." },
  encerradas: { titulo: "Nada encerrado", texto: "Conversas encerradas ficam guardadas aqui." },
};

export function ListaConversas({
  canais,
  canalAtual,
  conversas,
  selecionadaId,
  usuarioId,
  filtro,
  aoFiltrar,
  aoAbrir,
  aoTrocarCanal,
  aoNovaConversa,
  demo,
  oculta,
}: {
  canais: CanalChat[];
  canalAtual: string;
  conversas: ConversaResumo[];
  selecionadaId: string | null;
  usuarioId: string;
  filtro: Filtro;
  aoFiltrar: (f: Filtro) => void;
  aoAbrir: (id: string) => void;
  aoTrocarCanal: (chave: string) => void;
  aoNovaConversa: () => void;
  demo: boolean;
  /** No celular, com uma conversa aberta, a lista cede a tela. */
  oculta: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [menuCanais, setMenuCanais] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // "Agora" congelado por render: as horas relativas ("Ontem") não precisam de
  // relógio correndo, só de estar certas quando a lista é desenhada.
  const [agora] = useState(() => Date.now());

  const canal = canais.find((c) => c.chave === canalAtual);
  const mostrarCanal = canalAtual === "";

  useEffect(() => {
    if (!menuCanais) return;
    const fora = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuCanais(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuCanais(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [menuCanais]);

  const contagem = useMemo(() => {
    const c = {} as Record<Filtro, number>;
    for (const f of FILTROS) c[f.id] = conversas.filter((x) => passaFiltro(x, f.id, usuarioId)).length;
    return c;
  }, [conversas, usuarioId]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, "");
    return conversas.filter((c) => {
      if (!passaFiltro(c, filtro, usuarioId)) return false;
      if (!termo) return true;
      return (
        c.contato_nome.toLowerCase().includes(termo) ||
        (digitos.length >= 3 && (c.contato_whatsapp ?? "").replace(/\D/g, "").includes(digitos))
      );
    });
  }, [conversas, filtro, busca, usuarioId]);

  const papel = canal ? PAPEL[canal.tipo] : null;

  return (
    <section
      className={`min-h-0 w-full flex-col border-r border-zinc-200 bg-white lg:flex lg:w-[340px] lg:shrink-0 dark:border-zinc-800 dark:bg-zinc-950 ${
        oculta ? "hidden" : "flex"
      }`}
    >
      {/* Cabeçalho: de quem é esta caixa. No celular, troca de canal. */}
      <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuCanais((v) => !v)}
          aria-expanded={menuCanais}
          aria-haspopup="menu"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition hover:bg-zinc-50 lg:pointer-events-none dark:hover:bg-zinc-900"
        >
          {canal ? (
            <Avatar nome={canal.perfil ?? canal.nome} src={canal.foto} tamanho={32}>
              <span className={`absolute -bottom-px -right-px size-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950 ${ESTADO[canal.estado].ponto}`} />
            </Avatar>
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <Inbox className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 truncate text-[14px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              <span className="truncate">{canal ? canal.nome : "Todas as conversas"}</span>
              <ChevronDown className="size-3.5 shrink-0 text-zinc-400 lg:hidden" />
            </span>
            <span className="flex items-center gap-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {canal && papel ? (
                <>
                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${papel.chip}`}>
                    <papel.Icone className="size-2.5" />
                    {papel.rotulo}
                  </span>
                  <span className="truncate">{canal.estado === "conectado" ? papel.meio : ESTADO[canal.estado].rotulo}</span>
                </>
              ) : (
                <span>Todos os números</span>
              )}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={aoNovaConversa}
          disabled={demo}
          title={demo ? "Indisponível na demonstração" : "Nova conversa"}
          aria-label="Nova conversa"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <SquarePen className="size-4" />
        </button>

        {menuCanais && (
          <div
            role="menu"
            className="veu-surge absolute inset-x-2 top-[calc(100%+4px)] z-30 max-h-[70vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50 p-2 shadow-xl lg:hidden dark:border-zinc-800 dark:bg-zinc-950"
          >
            <ListaCanais
              canais={canais}
              atual={canalAtual}
              aoEscolher={(chave) => {
                setMenuCanais(false);
                aoTrocarCanal(chave);
              }}
            />
          </div>
        )}
      </header>

      {/* Busca e filtros */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou número"
            aria-label="Buscar conversa"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-8 pr-8 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-600 dark:focus:bg-zinc-900"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Filtrar conversas">
          {FILTROS.map((f) => {
            const ativo = filtro === f.id;
            const n = contagem[f.id];
            const alerta = f.id === "fila" && n > 0 && !ativo;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => aoFiltrar(f.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                  ativo
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                {f.rotulo}
                {f.id !== "encerradas" && n > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                      ativo
                        ? "bg-white/20 dark:bg-zinc-900/15"
                        : alerta
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visiveis.length === 0 ? (
          <li className="flex flex-col items-center gap-2 px-8 py-16 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
              <Inbox className="size-5 text-zinc-400" aria-hidden="true" />
            </span>
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
              {busca ? "Ninguém com esse nome ou número" : VAZIO[filtro].titulo}
            </p>
            <p className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {busca ? "Confira a busca ou troque o filtro." : VAZIO[filtro].texto}
            </p>
          </li>
        ) : (
          visiveis.map((c) => {
            const sel = c.id === selecionadaId;
            const naoLida = c.nao_lidas > 0;
            const u = c.ultima;
            const doCanal = canalDaConversa(canais, c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => aoAbrir(c.id)}
                  aria-current={sel ? "true" : undefined}
                  className={`relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                    sel ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  }`}
                >
                  {sel && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-zinc-900 dark:bg-zinc-100" aria-hidden="true" />}
                  <Avatar nome={c.contato_nome} src={fotoDoContato(c.contato_id, c.numero_instancia, demo)} tamanho={44}>
                    {mostrarCanal && <SeloCanal tipo={tipoDaConversa(c)} />}
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-[13.5px] ${
                          naoLida ? "font-semibold text-zinc-900 dark:text-zinc-50" : "font-medium text-zinc-800 dark:text-zinc-100"
                        }`}
                      >
                        {/^[\d\s+()-]+$/.test(c.contato_nome) ? formatarTelefone(c.contato_nome) : c.contato_nome}
                      </span>
                      <span
                        suppressHydrationWarning
                        className={`shrink-0 text-[11px] tabular-nums ${
                          naoLida ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"
                        }`}
                      >
                        {quandoNaLista(u?.data ?? c.data_criacao, agora)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {u?.origem === "agente" &&
                        (u.enviada_por === "ia" ? (
                          <Sparkles className="size-3.5 shrink-0 text-violet-500" aria-label="Assistente IA" />
                        ) : u.enviada_por === "automacao" ? (
                          <Bot className="size-3.5 shrink-0 text-violet-500" aria-label="Automação" />
                        ) : (
                          <span className="text-zinc-400">
                            <Entrega status={u.status} className="size-3.5" />
                          </span>
                        ))}
                      <span
                        className={`min-w-0 flex-1 truncate text-[12.5px] ${
                          naoLida ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {u ? previa(u.tipo, u.texto) : "Sem mensagens ainda"}
                      </span>
                      {c.status === "na_fila" && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          Fila
                        </span>
                      )}
                      {naoLida && (
                        <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold tabular-nums text-white">
                          {c.nao_lidas > 99 ? "99+" : c.nao_lidas}
                        </span>
                      )}
                    </span>
                    {mostrarCanal && doCanal && (
                      <span className="mt-0.5 block truncate text-[10.5px] text-zinc-400 dark:text-zinc-500">
                        via {doCanal.nome}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
