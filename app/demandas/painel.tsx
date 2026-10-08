"use client";

// Tela de Demandas: o que é da pessoa, com o check de feito.
//
// DUAS COLUNAS, A FAZER E FEITAS (pedido dele de 2026-10-07). A fazer é a
// principal e fica mais larga; dar o check passa o cartão para Feitas, e
// desmarcar lá devolve. No celular as duas viram abas — empilhadas, a coluna das
// feitas ficaria escondida debaixo de uma lista comprida.
//
// A FAZER SE AGRUPA PELO PRAZO (atrasadas, hoje, próximos 7 dias, mais adiante,
// sem prazo), que é a pergunta de quem abre a tela: o que eu faço primeiro.
// FEITAS SE AGRUPA PELO DIA em que foi feita: o que eu fiz hoje, ontem.
//
// DOIS QUADROS, em abas no topo (pedido dele de 2026-10-08: "um outro kanban
// de demandas geradas para outras pessoas"): "Minhas", o que é para eu fazer,
// e "Geradas para outros", o que EU mandei para outra pessoa ou abri como
// chamado — para acompanhar até a pessoa dar o check. Os dois têm as mesmas
// colunas e os mesmos filtros; muda só de quem é a demanda. Substituiu o
// recorte "Abertas por mim", que misturava as que a pessoa cria para si.
//
// OS RECORTES FICAM NUMA LINHA SÓ e valem para as duas colunas:
//   · quem, em "Minhas": "Para mim" (as minhas e as do meu departamento, que é
//     como o TI recebe os chamados) e, para Admin e TI, "Todas", só os
//     chamados, ou uma pessoa; em "Geradas para outros": todas, só os chamados
//     ou uma das pessoas para quem eu mandei;
//   · dia: o dia em que a demanda foi CRIADA;
//   · prazo: vencido, vence hoje, próximos 7 dias, sem prazo;
//   · busca, no título, na descrição e nos nomes ("/" leva até ela).
//
// QUEM CRIA O QUÊ ("Nova demanda", para todo mundo): desde 2026-10-08 qualquer
// um cria para si, para qualquer pessoa da equipe ou abre um chamado para o
// TI; "Todos" de uma vez, só Admin e TI. A regra de verdade é podeCriarPara, no
// servidor — aqui só se oferece o que ela aceitaria.
//
// O check e a exclusão são otimistas: o cartão muda na hora, e a ação no
// servidor (revalidatePath) devolve a lista nova no mesmo ida-e-volta.
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  CalendarClock,
  CalendarDays,
  CircleCheck,
  ListChecks,
  Plus,
  Search,
  SearchX,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";
import { SeletorMenu } from "../components/filtros-ui";
import ModalDemanda, { type Destino } from "../components/modal-demanda";
import {
  avisarQueDemandasMudaram,
  PARA_O_TI,
  PARA_TODOS,
  type DadosDemanda,
  type Demanda,
  type Prioridade,
} from "@/lib/demandas-tipos";
import {
  adicionarItemDemanda,
  criarDemanda,
  editarDemanda,
  excluirDemandas,
  marcarDemanda,
  marcarItemDemanda,
  removerItemDemanda,
  renomearItemDemanda,
} from "./acoes";
import type { MontarChecklist } from "./checklist";
import Cartao, { ehMinha, type Eu, type Item } from "./cartao";
import {
  diaDe,
  GRUPOS_DE_PRAZO,
  grupoDoPrazo,
  OPCOES_DIA,
  OPCOES_PRAZO,
  passaNoDia,
  passaNoPrazo,
  rotuloDoDia,
  type FiltroDia,
  type FiltroPrazo,
  type GrupoDePrazo,
} from "./datas";

type Quadro = "minhas" | "geradas";

/**
 * Em "Minhas": "minhas" | "todas" | "chamados" | "p:<id da pessoa>".
 * Em "Geradas para outros": "g:todas" | "g:chamados" | "g:p:<id da pessoa>".
 */
type Recorte = string;

const RECORTE_INICIAL: Record<Quadro, Recorte> = { minhas: "minhas", geradas: "g:todas" };

/**
 * Gerada por mim para OUTRA pessoa — ou um chamado para outro departamento. A
 * minha cópia de uma demanda "para todos" e a que criei para mim mesmo ficam no
 * quadro "Minhas", que é onde eu dou o check.
 */
function geradaParaOutro(d: Demanda, eu: Eu) {
  return d.criadoPor === eu.id && !ehMinha(d, eu);
}

function noRecorte(d: Demanda, r: Recorte, eu: Eu) {
  if (r.startsWith("g:")) {
    if (!geradaParaOutro(d, eu)) return false;
    const s = r.slice(2);
    if (s === "chamados") return d.departamentoId !== null;
    if (s.startsWith("p:")) return d.responsavelId === s.slice(2);
    return true;
  }
  if (r === "todas") return true;
  if (r === "chamados") return d.departamentoId !== null;
  if (r.startsWith("p:")) return d.responsavelId === r.slice(2);
  return ehMinha(d, eu);
}

/** Sem acento e em minúsculas: "Fabricio" acha "Fabrício". */
function normalizar(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function passaNaBusca(d: Demanda, termo: string) {
  if (!termo) return true;
  return normalizar(
    [d.titulo, d.descricao, d.responsavel, d.departamento, d.autor].filter(Boolean).join(" "),
  ).includes(termo);
}

/**
 * As irmãs de uma demanda "para todos" nasceram no MESMO INSERT, então têm o
 * mesmo autor, título e `data_criacao` (o now() é um só por comando). É isso
 * que as junta num cartão, sem coluna de lote no banco. Chamado e demanda
 * avulsa ficam sozinhos.
 */
function chaveDoLote(d: Demanda) {
  return d.responsavelId ? `${d.criadoPor}|${d.dataCriacao}|${d.titulo}` : d.id;
}

const PESO: Record<Prioridade, number> = { alta: 0, normal: 1, baixa: 2 };

/** Dentro do grupo: prazo mais perto, depois prioridade, depois a mais nova. */
function ordemPendente(a: Item, b: Item) {
  const x = a.demandas[0];
  const y = b.demandas[0];
  if (x.prazo !== y.prazo) {
    if (!x.prazo) return 1;
    if (!y.prazo) return -1;
    return x.prazo < y.prazo ? -1 : 1;
  }
  if (x.prioridade !== y.prioridade) return PESO[x.prioridade] - PESO[y.prioridade];
  return x.dataCriacao < y.dataCriacao ? 1 : -1;
}

/** O grupo da equipe no seletor do Admin. */
const EQUIPE = "Equipe — quem tem o módulo Demandas";

type Mudanca =
  | { tipo: "marcar"; id: string; feita: boolean }
  | { tipo: "remover"; ids: string[] }
  | { tipo: "item"; itemId: string; feito: boolean };

// Montar o checklist (acrescentar, renomear, tirar) é de quem criou a demanda e
// não é otimista: espera o servidor, que aplica em todas as cópias de uma
// demanda "para todos" de uma vez — e devolve a lista certa pelo revalidatePath.
const MONTAR: MontarChecklist = {
  adicionar: adicionarItemDemanda,
  renomear: renomearItemDemanda,
  remover: removerItemDemanda,
};

type Edicao = { ids: string[]; inicial: Omit<DadosDemanda, "para"> };

const campoBusca =
  "w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-7 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

export default function PainelDemandas({
  demandas,
  pessoas,
  admin,
  eu,
  hoje,
  agora,
  faltaMigration,
}: {
  demandas: Demanda[];
  /** Quem pode receber — para todo mundo, desde 2026-10-08. */
  pessoas: { id: string; nome: string }[] | null;
  admin: boolean;
  eu: Eu;
  /** "2026-10-07" e o instante do render, em Brasília (ver datas.ts). */
  hoje: string;
  agora: string;
  faltaMigration: boolean;
}) {
  const [quadro, setQuadro] = useState<Quadro>("minhas");
  const [recorte, setRecorte] = useState<Recorte>(RECORTE_INICIAL.minhas);
  const [dia, setDia] = useState<FiltroDia>("qualquer");
  const [prazo, setPrazo] = useState<FiltroPrazo>("qualquer");
  const [busca, setBusca] = useState("");
  const [colunaMovel, setColunaMovel] = useState<"fazer" | "feitas">("fazer");
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Edicao | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [, iniciar] = useTransition();
  const buscaRef = useRef<HTMLInputElement | null>(null);

  const [lista, mudarNaTela] = useOptimistic(demandas, (atual, m: Mudanca) => {
    if (m.tipo === "remover") return atual.filter((d) => !m.ids.includes(d.id));
    if (m.tipo === "item") {
      return atual.map((d) =>
        d.itens.some((i) => i.id === m.itemId)
          ? {
              ...d,
              itens: d.itens.map((i) =>
                i.id === m.itemId
                  ? { ...i, feitoEm: m.feito ? new Date().toISOString() : null, feitoPor: m.feito ? eu.nome : null }
                  : i,
              ),
            }
          : d,
      );
    }
    return atual.map((d) =>
      d.id === m.id
        ? { ...d, feitaEm: m.feita ? new Date().toISOString() : null, feitaPor: m.feita ? eu.nome : null }
        : d,
    );
  });

  // "/" leva à busca, como no resto da web; Esc dentro dela limpa.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      buscaRef.current?.focus();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  // Aviso de sucesso some sozinho; o de problema fica até a pessoa fechar.
  useEffect(() => {
    if (!aviso?.ok) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const termo = normalizar(busca.trim());
  const filtrando = dia !== "qualquer" || prazo !== "qualquer" || termo !== "";

  const { grupos, feitasPorDia, totalAFazer, totalFeitas } = useMemo(() => {
    const visiveis = lista.filter(
      (d) =>
        noRecorte(d, recorte, eu) &&
        passaNoDia(d.dataCriacao, dia, hoje) &&
        passaNoPrazo(d.prazo, prazo, hoje) &&
        passaNaBusca(d, termo),
    );

    const lotes = new Map<string, Demanda[]>();
    for (const d of visiveis) {
      const k = chaveDoLote(d);
      const irmas = lotes.get(k);
      if (irmas) irmas.push(d);
      else lotes.set(k, [d]);
    }

    const porGrupo = new Map<GrupoDePrazo, Item[]>();
    let aFazer = 0;
    for (const [chave, lote] of lotes) {
      // A minha primeiro: é ela que o check do cartão marca.
      const pendentes = lote
        .filter((d) => !d.feitaEm)
        .sort((a, b) => Number(ehMinha(b, eu)) - Number(ehMinha(a, eu)));
      if (!pendentes.length) continue;
      aFazer += pendentes.length;
      const g = grupoDoPrazo(pendentes[0].prazo, hoje);
      const item = { chave, demandas: pendentes, lote };
      const doGrupo = porGrupo.get(g);
      if (doGrupo) doGrupo.push(item);
      else porGrupo.set(g, [item]);
    }

    const grupos = GRUPOS_DE_PRAZO.filter((g) => porGrupo.has(g.grupo)).map((g) => ({
      ...g,
      itens: porGrupo.get(g.grupo)!.sort(ordemPendente),
      total: porGrupo.get(g.grupo)!.reduce((n, i) => n + i.demandas.length, 0),
    }));

    // Feitas: uma por cartão — cada check é um acontecimento, com hora e autor.
    const feitas = visiveis
      .filter((d) => d.feitaEm)
      .sort((a, b) => (a.feitaEm! < b.feitaEm! ? 1 : -1));
    const feitasPorDia: { dia: string; itens: Item[] }[] = [];
    for (const d of feitas) {
      const diaFeita = diaDe(d.feitaEm!);
      const ultimo = feitasPorDia.at(-1);
      const item = { chave: d.id, demandas: [d], lote: [d] };
      if (ultimo?.dia === diaFeita) ultimo.itens.push(item);
      else feitasPorDia.push({ dia: diaFeita, itens: [item] });
    }

    return { grupos, feitasPorDia, totalAFazer: aFazer, totalFeitas: feitas.length };
  }, [lista, recorte, dia, prazo, termo, eu, hoje]);

  // O número de cada recorte é o que está A FAZER nele — é o que a pessoa
  // procura ao abrir o menu.
  const contar = (r: Recorte) => lista.filter((d) => !d.feitaEm && noRecorte(d, r, eu)).length;

  // As pessoas para quem EU mandei alguma demanda — é o menu "Quem" do quadro
  // "Geradas para outros". Sai da própria lista: quem saiu da equipe continua
  // aparecendo enquanto houver demanda dele aqui.
  const destinatarios = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const d of lista) {
      if (d.responsavelId && geradaParaOutro(d, eu)) vistos.set(d.responsavelId, d.responsavel ?? "Alguém que saiu");
    }
    return [...vistos].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [lista, eu]);
  const temChamado = lista.some((d) => geradaParaOutro(d, eu) && d.departamentoId !== null);

  const opcoesRecorte =
    quadro === "geradas"
      ? [
          { valor: "g:todas", rotulo: `Todas que gerei · ${contar("g:todas")}` },
          ...(temChamado ? [{ valor: "g:chamados", rotulo: `Chamados abertos · ${contar("g:chamados")}` }] : []),
          ...destinatarios.map(([id, nome]) => ({ valor: `g:p:${id}`, rotulo: `${nome} · ${contar(`g:p:${id}`)}` })),
        ]
      : [
          { valor: "minhas", rotulo: `Para mim · ${contar("minhas")}` },
          ...(admin
            ? [
                { valor: "todas", rotulo: `Todas · ${contar("todas")}` },
                { valor: "chamados", rotulo: `Chamados do TI · ${contar("chamados")}` },
                ...(pessoas ?? []).map((p) => ({
                  valor: `p:${p.id}`,
                  rotulo: `${p.id === eu.id ? "Só as minhas" : p.nome} · ${contar(`p:${p.id}`)}`,
                })),
              ]
            : []),
        ];

  function trocarQuadro(q: Quadro) {
    setQuadro(q);
    setRecorte(RECORTE_INICIAL[q]);
    setColunaMovel("fazer");
  }

  // Para onde a "Nova demanda" pode ir: para mim, chamado para o TI e qualquer
  // pessoa da equipe valem para todo mundo; "Todos" só para Admin e TI (e o
  // servidor confere de novo).
  const destinos: Destino[] = [
    { valor: eu.id, rotulo: "Para mim" },
    {
      valor: PARA_O_TI,
      rotulo: "Chamado para o TI",
      dica: "Qualquer pessoa do TI vê e dá o check. Você acompanha em “Geradas para outros”.",
    },
    ...(pessoas
      ? [
          ...(admin && pessoas.length > 1
            ? [
                {
                  valor: PARA_TODOS,
                  rotulo: `Todos (${pessoas.length} pessoas)`,
                  grupo: EQUIPE,
                  dica: "Uma demanda para cada pessoa, inclusive você. Cada um dá o check na sua.",
                },
              ]
            : []),
          ...pessoas
            .filter((p) => p.id !== eu.id)
            .map((p) => ({ valor: p.id, rotulo: p.nome, grupo: EQUIPE })),
        ]
      : []),
  ];

  function limparFiltros() {
    setDia("qualquer");
    setPrazo("qualquer");
    setBusca("");
  }

  function marcar(id: string, feita: boolean) {
    setAviso(null);
    iniciar(async () => {
      mudarNaTela({ tipo: "marcar", id, feita });
      const r = await marcarDemanda(id, feita);
      if (!r.ok) setAviso({ ok: false, texto: r.mensagem });
      avisarQueDemandasMudaram();
    });
  }

  function marcarItem(itemId: string, feito: boolean) {
    setAviso(null);
    iniciar(async () => {
      mudarNaTela({ tipo: "item", itemId, feito });
      const r = await marcarItemDemanda(itemId, feito);
      if (!r.ok) setAviso({ ok: false, texto: r.mensagem });
    });
  }

  function excluir(ids: string[]) {
    iniciar(async () => {
      mudarNaTela({ tipo: "remover", ids });
      const r = await excluirDemandas(ids);
      setAviso({ ok: r.ok, texto: r.mensagem });
      avisarQueDemandasMudaram();
    });
  }

  function editar(item: Item) {
    const d = item.demandas[0];
    setEditando({
      ids: item.lote.map((x) => x.id),
      inicial: {
        titulo: d.titulo,
        descricao: d.descricao ?? "",
        prazo: d.prazo ?? "",
        prioridade: d.prioridade,
      },
    });
  }

  const cartao = (item: Item) => (
    <Cartao
      key={item.chave}
      item={item}
      eu={eu}
      hoje={hoje}
      agora={agora}
      aoMarcar={marcar}
      aoEditar={editar}
      aoExcluir={excluir}
      aoMarcarItem={marcarItem}
      montar={MONTAR}
      aoAvisar={(texto) => setAviso({ ok: false, texto })}
    />
  );

  const vazioAFazer = filtrando ? (
    <Vazio Icone={SearchX} titulo="Nada encontrado" texto="Nenhuma demanda a fazer com esses filtros.">
      <BotaoLimpar aoClicar={limparFiltros} />
    </Vazio>
  ) : quadro === "geradas" ? (
    <Vazio
      Icone={Send}
      titulo="Nada pendente com os outros"
      texto="O que você mandar em “Nova demanda” para alguém da equipe — ou um chamado para o TI — aparece aqui até a pessoa dar o check."
    />
  ) : (
    <Vazio Icone={CircleCheck} titulo="Tudo em dia" texto="Nada a fazer por aqui." tom="ok" />
  );

  return (
    // @container: o ponto de quebra é a largura DESTA tela, não a da janela —
    // com a barra lateral aberta, uma janela de 1024px deixa só ~760px aqui.
    <div className="@container flex h-screen flex-col overflow-hidden bg-conteudo">
      {/* z-20: os menus dos filtros abrem por cima das colunas. */}
      <header className="relative z-20 shrink-0 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-1 flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            <ListChecks className="size-4" aria-hidden="true" />
            Demandas
          </h1>

          {/* Os dois quadros. O número é o que está A FAZER em cada um. */}
          {!faltaMigration && (
            <div
              role="tablist"
              aria-label="Quadro"
              className="mr-1 flex gap-0.5 rounded-lg border border-zinc-200 bg-zinc-100/70 p-0.5 dark:border-zinc-800 dark:bg-zinc-900"
            >
              {(
                [
                  ["minhas", "Minhas", contar("minhas")],
                  ["geradas", "Geradas para outros", contar("g:todas")],
                ] as const
              ).map(([valor, rotulo, n]) => (
                <button
                  key={valor}
                  type="button"
                  role="tab"
                  aria-selected={quadro === valor}
                  onClick={() => trocarQuadro(valor)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition ${
                    quadro === valor
                      ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-50 dark:ring-zinc-700"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                  }`}
                >
                  {rotulo}
                  <span className="tabular-nums text-zinc-400">{n}</span>
                </button>
              ))}
            </div>
          )}

          {!faltaMigration && (
            <>
              <SeletorMenu
                Icone={ListChecks}
                rotulo="Quem"
                valor={recorte}
                opcoes={opcoesRecorte}
                aoMudar={setRecorte}
                botao="w-52"
                ativo={recorte !== RECORTE_INICIAL[quadro]}
              />
              <SeletorMenu
                Icone={CalendarDays}
                rotulo="Dia"
                valor={dia}
                opcoes={OPCOES_DIA}
                aoMudar={(v) => setDia(v as FiltroDia)}
                botao="w-44"
                ativo={dia !== "qualquer"}
              />
              <SeletorMenu
                Icone={CalendarClock}
                rotulo="Prazo"
                valor={prazo}
                opcoes={OPCOES_PRAZO}
                aoMudar={(v) => setPrazo(v as FiltroPrazo)}
                botao="w-44"
                ativo={prazo !== "qualquer"}
              />
              {filtrando && <BotaoLimpar aoClicar={limparFiltros} />}

              <div className="relative ml-auto w-full @xl:w-56">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  ref={buscaRef}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setBusca("");
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Buscar"
                  aria-label="Buscar demandas"
                  className={campoBusca}
                />
                {busca ? (
                  <button
                    type="button"
                    onClick={() => setBusca("")}
                    aria-label="Limpar busca"
                    className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-200 px-1 text-[10px] leading-4 text-zinc-400 @xl:block dark:border-zinc-700">
                    /
                  </kbd>
                )}
              </div>
            </>
          )}

          {!faltaMigration && (
            <button
              type="button"
              onClick={() => setCriando(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Nova demanda
            </button>
          )}
        </div>
      </header>

      {aviso && (
        <div
          role="status"
          className={`surge-suave flex shrink-0 items-center gap-2 border-b px-5 py-2 text-[12px] ${
            aviso.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          <span className="flex-1">{aviso.texto}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" className="opacity-60 hover:opacity-100">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {faltaMigration ? (
        <div className="p-5">
          <p className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            A tabela <code>demandas</code> ainda não existe no banco. Rode{" "}
            <code>migration-demandas.sql</code> e recarregue.
          </p>
        </div>
      ) : (
        <>
          {/* Sem largura para duas colunas (celular, janela estreita), elas
              viram abas. */}
          <div role="tablist" aria-label="Colunas" className="flex shrink-0 gap-1 px-5 pt-4 @3xl:hidden">
            {(
              [
                ["fazer", "A fazer", totalAFazer],
                ["feitas", "Feitas", totalFeitas],
              ] as const
            ).map(([valor, rotulo, n]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={colunaMovel === valor}
                onClick={() => setColunaMovel(valor)}
                className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
                  colunaMovel === valor
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                {rotulo} <span className="tabular-nums opacity-60">{n}</span>
              </button>
            ))}
          </div>

          <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-5 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Coluna titulo="A fazer" total={totalAFazer} oculta={colunaMovel !== "fazer"}>
              {grupos.length === 0
                ? vazioAFazer
                : grupos.map((g) => (
                    <section key={g.grupo} aria-label={g.rotulo}>
                      {/* Com um grupo só, o rótulo repetiria o óbvio. */}
                      {grupos.length > 1 && (
                        <h3
                          className={`flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold ${
                            g.grupo === "atrasadas" ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
                          }`}
                        >
                          {g.rotulo}
                          <span className="font-normal tabular-nums opacity-70">{g.total}</span>
                        </h3>
                      )}
                      <ul className="flex flex-col gap-1.5">{g.itens.map(cartao)}</ul>
                    </section>
                  ))}
            </Coluna>

            <Coluna titulo="Feitas" total={totalFeitas} nota="últimos 90 dias" oculta={colunaMovel !== "feitas"}>
              {feitasPorDia.length === 0 ? (
                filtrando ? (
                  <Vazio Icone={SearchX} titulo="Nada encontrado" texto="Nenhuma feita com esses filtros." />
                ) : (
                  <Vazio Icone={CircleCheck} titulo="Nada feito ainda" texto="O que for marcado aparece aqui." />
                )
              ) : (
                feitasPorDia.map((g) => (
                  <section key={g.dia} aria-label={rotuloDoDia(g.dia, hoje)}>
                    <h3 className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      {rotuloDoDia(g.dia, hoje)}
                      <span className="font-normal tabular-nums opacity-70">{g.itens.length}</span>
                    </h3>
                    <ul className="flex flex-col gap-1">{g.itens.map(cartao)}</ul>
                  </section>
                ))
              )}
            </Coluna>
          </main>
        </>
      )}

      {criando && (
        <ModalDemanda
          titulo="Nova demanda"
          subtitulo={
            admin
              ? "Para você, para alguém da equipe, para todos — ou um chamado para o TI."
              : "Para você, para alguém da equipe — ou um chamado para o TI."
          }
          botao="Criar demanda"
          destinos={destinos}
          // No quadro "Minhas" abre em "Para mim"; no "Geradas para outros", sem
          // escolha — quem está ali vai mandar para alguém. O Admin escolhe
          // sempre: com "Todos" no menu, um padrão errado vira dez demandas.
          destinoInicial={admin || quadro === "geradas" ? "" : eu.id}
          enviar={criarDemanda}
          aoFechar={() => setCriando(false)}
          aoConcluir={(mensagem) => {
            setCriando(false);
            setAviso({ ok: true, texto: mensagem });
          }}
        />
      )}

      {editando && (
        <ModalDemanda
          titulo="Editar demanda"
          subtitulo={
            editando.ids.length > 1
              ? `Vale para as ${editando.ids.length} pessoas que receberam.`
              : "Para quem ela vai continua o mesmo."
          }
          botao="Salvar"
          inicial={editando.inicial}
          enviar={(dados) => editarDemanda(editando.ids, dados)}
          aoFechar={() => setEditando(null)}
          aoConcluir={(mensagem) => {
            setEditando(null);
            setAviso({ ok: true, texto: mensagem });
          }}
        />
      )}
    </div>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────────

function Coluna({
  titulo,
  total,
  nota,
  oculta,
  children,
}: {
  titulo: string;
  total: number;
  nota?: string;
  /** Só quando as colunas são abas (tela estreita). */
  oculta: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={titulo}
      className={`min-h-0 flex-col rounded-2xl bg-zinc-100/60 dark:bg-zinc-900/50 ${oculta ? "hidden @3xl:flex" : "flex"}`}
    >
      <header className="hidden shrink-0 items-baseline gap-2 px-4 pb-2 pt-3.5 @3xl:flex">
        <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h2>
        <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">{total}</span>
        {nota && <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">{nota}</span>}
      </header>
      {/* Rola por dentro, como as colunas do quadro do Dashboard. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2 pt-2 @3xl:pt-0">{children}</div>
    </section>
  );
}

function Vazio({
  Icone,
  titulo,
  texto,
  tom,
  children,
}: {
  Icone: LucideIcon;
  titulo: string;
  texto: string;
  tom?: "ok";
  children?: React.ReactNode;
}) {
  return (
    <div className="surge-suave flex flex-col items-center gap-1.5 px-6 py-14 text-center">
      <Icone
        className={`mb-1 size-7 ${tom === "ok" ? "text-emerald-500/70 dark:text-emerald-400/60" : "text-zinc-300 dark:text-zinc-600"}`}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{titulo}</p>
      <p className="max-w-xs text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{texto}</p>
      {children}
    </div>
  );
}

function BotaoLimpar({ aoClicar }: { aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
    >
      Limpar filtros
    </button>
  );
}
