"use client";

// O módulo Contatos: a base à esquerda, a ficha do contato aberto à direita
// (./ficha.tsx).
//
// TROCAR DE CONTATO É INSTANTÂNEO. A lista fica parada no navegador e só a
// ficha viaja (app/api/contatos/ficha); a tela guarda as fichas já abertas, e
// pré-carrega o vizinho de cima e o de baixo do contato aberto e o que está sob
// o mouse — quando o clique (ou a seta) chega, a ficha quase sempre já está aqui. O ?contato= continua na URL — via
// history.replaceState, que o roteador do Next acompanha — para o link e o F5
// abrirem o mesmo contato.
//
// A LISTA filtra aqui, sem ir ao banco a cada tecla: busca por nome, WhatsApp
// (qualquer pedaço do número), e-mail ou cidade; recortes numa linha só, em
// dropdown (a régua do app). Agrupada pelo QUANDO — Hoje, Ontem, Esta semana —
// porque é assim que se procura alguém com quem se falou. Desenha 200 por vez.
//
// TECLADO: "/" vai para a busca, ↑ ↓ troca de contato, Enter na busca abre o
// primeiro resultado. Quem atende o dia todo não tira a mão do teclado.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Plus, Search, UsersRound } from "lucide-react";
import type { ContatoNaLista, EtapaComTom, FichaContato } from "@/lib/contatos-ficha";
import { iniciais } from "../formato";
import { normalizar } from "../filtros-comuns";
import CamadaTopo from "../components/camada-topo";
import FormContato from "./form-contato";
import { criarContato } from "./actions";
import Ficha, { FichaCarregando, type ContextoDaFicha } from "./ficha";
import { diaDe, dinheiro, quando } from "./pecas";

type Recorte = "todos" | "abertas" | "sem_oportunidade" | "conversaram" | "sem_conversa" | "videos";
type Ordem = "atividade" | "novos" | "nome";

const RECORTES: { valor: Recorte; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "abertas", rotulo: "Com oportunidade aberta" },
  { valor: "sem_oportunidade", rotulo: "Sem oportunidade aberta" },
  { valor: "conversaram", rotulo: "Já conversaram" },
  { valor: "sem_conversa", rotulo: "Nunca conversaram" },
  { valor: "videos", rotulo: "Viram vídeo" },
];

const seletor =
  "min-w-0 flex-1 cursor-pointer rounded-md bg-transparent px-1.5 py-1 text-[12px] text-zinc-500 outline-none transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

const POR_VEZ = 200;

/** O grupo de um contato na lista, pelo dia da data que ordena. */
function grupoDe(iso: string, hoje: string) {
  const dias = Math.round((new Date(hoje).getTime() - new Date(diaDe(iso)).getTime()) / 86_400_000);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  if (dias < 7) return "Esta semana";
  if (dias < 31) return "Este mês";
  return "Antes";
}

export default function PainelContatos({
  contatos,
  ficha: fichaDoServidor,
  ...contexto
}: { contatos: ContatoNaLista[]; ficha: FichaContato | null } & ContextoDaFicha) {
  const router = useRouter();
  const buscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const [busca, setBusca] = useState("");
  const termo = useDeferredValue(busca);
  const [recorte, setRecorte] = useState<Recorte>("todos");
  const [tag, setTag] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("atividade");
  const [quantos, setQuantos] = useState(POR_VEZ);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O contato aberto e as fichas já carregadas. A do servidor (a da URL, ou a
  // que acabou de ser atualizada por um router.refresh) vale mais que a guardada.
  const [selecionadoId, setSelecionadoId] = useState<string | null>(fichaDoServidor?.contato.id ?? null);
  const [guardadas, setGuardadas] = useState<Record<string, FichaContato>>({});
  const atualId = selecionadoId ?? fichaDoServidor?.contato.id ?? null;
  const fichaAtual =
    atualId && fichaDoServidor?.contato.id === atualId ? fichaDoServidor : atualId ? guardadas[atualId] : null;

  // Pedidos em voo: o mesmo contato não é buscado duas vezes ao mesmo tempo
  // (o pré-carregamento e o clique podem cair juntos).
  const emVoo = useRef(new Set<string>());
  const pairar = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buscar(id: string) {
    if (guardadas[id] || fichaDoServidor?.contato.id === id || emVoo.current.has(id)) return;
    emVoo.current.add(id);
    fetch(`/api/contatos/ficha?id=${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<FichaContato>) : null))
      .then((f) => {
        if (f) setGuardadas((g) => ({ ...g, [id]: f }));
      })
      .catch(() => {})
      .finally(() => emVoo.current.delete(id));
  }

  function abrir(id: string) {
    setSelecionadoId(id);
    window.history.replaceState(null, "", `/contatos?contato=${id}`);
    buscar(id);
  }

  /** Algo mudou na ficha aberta: a do servidor vem nova pelo refresh. */
  function recarregar() {
    if (atualId) {
      setGuardadas((g) => {
        const resto = { ...g };
        delete resto[atualId];
        return resto;
      });
    }
    router.refresh();
  }

  const indice = useMemo(
    () =>
      new Map(
        contatos.map((c) => [
          c.id,
          `${normalizar(c.nome)} ${normalizar(c.cidade)} ${c.email.toLowerCase()} ${c.whatsapp.replace(/\D/g, "")}`,
        ]),
      ),
    [contatos],
  );

  const visiveis = useMemo(() => {
    const t = normalizar(termo.trim());
    const digitos = termo.replace(/\D/g, "");
    const lista = contatos.filter((c) => {
      if (t) {
        const alvo = indice.get(c.id) ?? "";
        if (!alvo.includes(t) && !(digitos.length >= 4 && alvo.includes(digitos))) return false;
      }
      if (tag && !c.tagIds.includes(tag)) return false;
      switch (recorte) {
        case "abertas":
          return c.abertas > 0;
        case "sem_oportunidade":
          return c.abertas === 0;
        case "conversaram":
          return c.conversou;
        case "sem_conversa":
          return !c.conversou;
        case "videos":
          return c.viuVideo;
        default:
          return true;
      }
    });
    return lista.sort((a, b) =>
      ordem === "nome"
        ? a.nome.localeCompare(b.nome, "pt-BR")
        : ordem === "novos"
          ? b.dataCriacao.localeCompare(a.dataCriacao)
          : b.ultimaAtividade.localeCompare(a.ultimaAtividade),
    );
  }, [contatos, indice, termo, recorte, tag, ordem]);

  const desenhados = visiveis.slice(0, quantos);

  // Os vizinhos do aberto, um instante depois de ele abrir: é para onde a seta
  // e o olho vão em seguida.
  useEffect(() => {
    const i = visiveis.findIndex((c) => c.id === atualId);
    if (i === -1) return;
    const t = setTimeout(() => {
      for (const j of [i + 1, i - 1]) if (visiveis[j]) buscar(visiveis[j].id);
    }, 250);
    return () => clearTimeout(t);
    // buscar lê o estado do render atual; o que decide refazer é trocar de
    // contato ou de lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atualId, visiveis]);

  // Teclado: "/" busca; ↑ ↓ trocam de contato (na busca ou fora de campo).
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      const naBusca = alvo === buscaRef.current;
      const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName) || alvo.isContentEditable;
      if (e.key === "/" && !digitando && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        buscaRef.current?.focus();
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (naBusca || !digitando)) {
        if (visiveis.length === 0) return;
        e.preventDefault();
        const i = visiveis.findIndex((c) => c.id === atualId);
        const proximo = e.key === "ArrowDown" ? Math.min(visiveis.length - 1, i + 1) : Math.max(0, i - 1);
        const alvoId = visiveis[i === -1 ? 0 : proximo].id;
        abrir(alvoId);
        listaRef.current?.querySelector(`[data-id="${alvoId}"]`)?.scrollIntoView({ block: "nearest" });
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  });

  const filtrando = Boolean(termo.trim()) || recorte !== "todos" || Boolean(tag);
  const agrupar = ordem !== "nome";
  const hoje = diaDe(new Date().toISOString());
  const previa = contatos.find((c) => c.id === atualId);

  async function criar(dados: Parameters<typeof criarContato>[0]) {
    setErro(null);
    try {
      const id = await criarContato(dados);
      setCriando(false);
      setSelecionadoId(id);
      router.push(`/contatos?contato=${id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui criar o contato.");
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="shrink-0 space-y-3 px-4 pb-2 pt-4">
          <div className="flex items-center gap-2">
            <h1 className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                <UsersRound className="size-4 self-center" aria-hidden="true" />
                Contatos
              </span>
              <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {filtrando ? `${visiveis.length} de ${contatos.length}` : contatos.length}
              </span>
            </h1>
            <button
              type="button"
              onClick={() => setCriando(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Novo
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setQuantos(POR_VEZ);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && visiveis[0]) abrir(visiveis[0].id);
                if (e.key === "Escape") {
                  setBusca("");
                  buscaRef.current?.blur();
                }
              }}
              placeholder="Buscar nome, número, e-mail…"
              aria-label="Buscar contato"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-8 pr-8 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white focus-visible:ring-2 focus-visible:ring-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-700 dark:focus:bg-zinc-950"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-zinc-200 px-1.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
              /
            </kbd>
          </div>

          <div className="-mx-1.5 flex gap-0.5">
            <select value={recorte} onChange={(e) => setRecorte(e.target.value as Recorte)} aria-label="Recorte" className={seletor}>
              {RECORTES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.rotulo}
                </option>
              ))}
            </select>
            {contexto.tags.length > 0 && (
              <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" className={seletor}>
                <option value="">Qualquer tag</option>
                {contexto.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            )}
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar" className={seletor}>
              <option value="atividade">Atividade recente</option>
              <option value="novos">Mais novos</option>
              <option value="nome">Nome A–Z</option>
            </select>
          </div>
        </div>

        <ul ref={listaRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Contatos">
          {desenhados.map((c, i) => {
            const etapa: EtapaComTom | null = c.etapaId ? contexto.etapas[c.etapaId] ?? null : null;
            const ativo = c.id === atualId;
            const grupo = agrupar ? grupoDe(ordem === "novos" ? c.dataCriacao : c.ultimaAtividade, hoje) : null;
            const grupoAnterior =
              agrupar && i > 0 ? grupoDe(ordem === "novos" ? desenhados[i - 1].dataCriacao : desenhados[i - 1].ultimaAtividade, hoje) : null;
            return (
              <li key={c.id}>
                {grupo && grupo !== grupoAnterior && (
                  <p className="sticky top-0 z-10 bg-conteudo/95 px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400 backdrop-blur-sm dark:text-zinc-500" suppressHydrationWarning>
                    {grupo}
                  </p>
                )}
                <a
                  href={`/contatos?contato=${c.id}`}
                  data-id={c.id}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    abrir(c.id);
                  }}
                  // Sob o mouse por um instante = provável clique: já busca.
                  onMouseEnter={() => {
                    if (pairar.current) clearTimeout(pairar.current);
                    pairar.current = setTimeout(() => buscar(c.id), 120);
                  }}
                  onMouseLeave={() => {
                    if (pairar.current) clearTimeout(pairar.current);
                  }}
                  aria-current={ativo ? "page" : undefined}
                  className={`relative flex items-center gap-3 rounded-lg px-2.5 py-2 transition ${
                    ativo ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  }`}
                >
                  <span className="relative shrink-0">
                    <span
                      className={`flex size-9 items-center justify-center rounded-full text-[11px] font-semibold ${
                        ativo
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {iniciais(c.nome || "?")}
                    </span>
                    {etapa && (
                      <span
                        className={`absolute -bottom-px -right-px size-2.5 rounded-full ring-2 ${
                          ativo ? "ring-zinc-100 dark:ring-zinc-900" : "ring-white dark:ring-zinc-950"
                        } ${etapa.cor}`}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                        {c.nome || "Sem nome"}
                      </span>
                      <time
                        dateTime={c.ultimaAtividade}
                        suppressHydrationWarning
                        className="shrink-0 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500"
                      >
                        {quando(ordem === "novos" ? c.dataCriacao : c.ultimaAtividade)}
                      </time>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="min-w-0 flex-1 truncate">
                        {etapa ? etapa.nome : (c.origem ?? (c.cidade || "sem oportunidade aberta"))}
                      </span>
                      {c.viuVideo && <Clapperboard className="size-3 shrink-0 text-zinc-400" aria-label="viu vídeo" />}
                      {c.abertas > 0 && c.valorAberto > 0 && (
                        <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">{dinheiro(c.valorAberto)}</span>
                      )}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}

          {visiveis.length > quantos && (
            <li className="pt-2">
              <button
                type="button"
                onClick={() => setQuantos((q) => q + POR_VEZ)}
                className="w-full rounded-lg py-2 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                Mostrar mais {Math.min(POR_VEZ, visiveis.length - quantos)} de {visiveis.length - quantos}
              </button>
            </li>
          )}

          {visiveis.length === 0 && (
            <li className="px-4 py-16 text-center">
              <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                {contatos.length === 0 ? "A base está vazia" : "Ninguém com esse filtro"}
              </p>
              <p className="mt-1 text-[12px] text-zinc-400 dark:text-zinc-500">
                {contatos.length === 0 ? "Crie o primeiro contato no botão Novo." : "Tente outro termo ou volte para Todos."}
              </p>
            </li>
          )}
        </ul>
      </aside>

      {fichaAtual ? (
        <Ficha
          key={fichaAtual.contato.id}
          ficha={fichaAtual}
          contexto={contexto}
          aoMudar={recarregar}
          aoExcluir={() => {
            setSelecionadoId(null);
            router.push("/contatos");
          }}
        />
      ) : atualId && previa ? (
        <FichaCarregando nome={previa.nome} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
          <UsersRound className="size-6 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
          <p className="mt-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Escolha alguém na lista</p>
          <p className="text-[12px] text-zinc-400 dark:text-zinc-500">
            ou aperte <kbd className="rounded border border-zinc-200 px-1 text-[10px] dark:border-zinc-700">/</kbd> para buscar
          </p>
        </div>
      )}

      {criando && (
        <CamadaTopo>
          <FormContato aoSalvar={(d) => void criar(d)} aoFechar={() => setCriando(false)} />
          {erro && (
            <p role="alert" className="fixed bottom-6 left-1/2 z-[330] -translate-x-1/2 rounded-lg bg-red-600 px-3 py-2 text-[12px] text-white shadow-lg">
              {erro}
            </p>
          )}
        </CamadaTopo>
      )}
    </div>
  );
}
