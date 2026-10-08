"use client";

// Tela de Demandas: um quadro do que é da pessoa — e outro do que ela mandou.
//
// DOIS QUADROS, em abas no topo:
//   · "Minhas": o que é para eu fazer (as minhas e as do meu departamento, que
//     é como o TI recebe os chamados). Admin e TI trocam o recorte para ver a
//     equipe inteira, só os chamados ou uma pessoa.
//   · "Enviadas" (pedido dele de 2026-10-08, "um kanban de demandas enviadas
//     para acompanhar"): o que EU mandei para outra pessoa ou abri como
//     chamado, até a pessoa dar o check. A minha cópia de uma demanda "para
//     todos" e a que criei para mim mesmo ficam em "Minhas", onde dou o check.
//
// AS COLUNAS SÃO AS MESMAS NOS DOIS (./colunas.ts): Atrasadas, Para hoje, A
// fazer (ou Aguardando) e Feitas. Arrastar um cartão meu para Feitas dá o
// check, e arrastar de volta tira — só se arrasta o cartão que eu posso marcar.
// Clicar abre a gaveta (./detalhe.tsx) com o resto.
//
// OS RECORTES FICAM NUMA LINHA SÓ, com o título e as abas:
//   · quem — em "Minhas", para Admin e TI: todas, só os chamados ou uma
//     pessoa; em "Enviadas": todas, só os chamados ou uma das pessoas para
//     quem eu mandei;
//   · o dia em que a demanda foi CRIADA (o prazo já é a coluna);
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
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  CalendarDays,
  CircleCheck,
  Inbox,
  ListChecks,
  Plus,
  Search,
  SearchX,
  Send,
  Users,
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
import Cartao, { CorpoCartao, ehMinha, type Eu, type Item } from "./cartao";
import { COLUNAS, type ColunaId, type DefinicaoColuna, type Quadro } from "./colunas";
import DetalheDemanda from "./detalhe";
import {
  colunaDoPrazo,
  diaDe,
  OPCOES_DIA,
  passaNoDia,
  rotuloDoDia,
  type ColunaDePrazo,
  type FiltroDia,
} from "./datas";

/**
 * Em "Minhas": "minhas" | "todas" | "chamados" | "p:<id da pessoa>".
 * Em "Enviadas": "g:todas" | "g:chamados" | "g:p:<id da pessoa>".
 */
type Recorte = string;

const RECORTE_INICIAL: Record<Quadro, Recorte> = { minhas: "minhas", enviadas: "g:todas" };

/**
 * Mandada por mim para OUTRA pessoa — ou um chamado para outro departamento. A
 * minha cópia de uma demanda "para todos" e a que criei para mim mesmo ficam no
 * quadro "Minhas", que é onde eu dou o check.
 */
function enviadaPorMim(d: Demanda, eu: Eu) {
  return d.criadoPor === eu.id && !ehMinha(d, eu);
}

function noRecorte(d: Demanda, r: Recorte, eu: Eu) {
  if (r.startsWith("g:")) {
    if (!enviadaPorMim(d, eu)) return false;
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

/** Dentro da coluna: prazo mais perto, depois prioridade, depois a mais nova. */
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

/** O grupo da equipe no seletor de destino. */
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

type Arraste = { chave: string; coluna: ColunaId };

const campoBusca =
  "w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-7 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:border-zinc-500 dark:focus-visible:ring-zinc-100/10";

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
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Edicao | null>(null);
  // A gaveta guarda o id da DEMANDA, não a chave do cartão: a chave muda quando
  // ela passa para Feitas, e a gaveta tem de continuar aberta nela.
  const [aberta, setAberta] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<Arraste | null>(null);
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
  const filtrando = dia !== "qualquer" || termo !== "";

  const quadroMontado = useMemo(() => {
    const visiveis = lista.filter(
      (d) => noRecorte(d, recorte, eu) && passaNoDia(d.dataCriacao, dia, hoje) && passaNaBusca(d, termo),
    );

    const lotes = new Map<string, Demanda[]>();
    for (const d of visiveis) {
      const k = chaveDoLote(d);
      const irmas = lotes.get(k);
      if (irmas) irmas.push(d);
      else lotes.set(k, [d]);
    }

    const pendentes: Record<ColunaDePrazo, Item[]> = { atrasadas: [], hoje: [], fila: [] };
    for (const [chave, lote] of lotes) {
      // A minha primeiro: é ela que o check do cartão marca.
      const falta = lote
        .filter((d) => !d.feitaEm)
        .sort((a, b) => Number(ehMinha(b, eu)) - Number(ehMinha(a, eu)));
      if (!falta.length) continue;
      pendentes[colunaDoPrazo(falta[0].prazo, hoje)].push({ chave, demandas: falta, lote });
    }
    for (const c of Object.values(pendentes)) c.sort(ordemPendente);

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

    return { pendentes, feitasPorDia, totalFeitas: feitas.length };
  }, [lista, recorte, dia, termo, eu, hoje]);
  const { pendentes, feitasPorDia, totalFeitas } = quadroMontado;

  const totalDa = (c: ColunaId) => (c === "feitas" ? totalFeitas : pendentes[c].length);
  const vazio = COLUNAS.every((c) => totalDa(c.id) === 0);

  /** O cartão (e a coluna dele) de uma demanda — para a gaveta e o arraste. */
  function acharItem(achar: (item: Item) => boolean): { item: Item; coluna: ColunaId } | null {
    for (const c of ["atrasadas", "hoje", "fila"] as const) {
      const item = pendentes[c].find(achar);
      if (item) return { item, coluna: c };
    }
    for (const g of feitasPorDia) {
      const item = g.itens.find(achar);
      if (item) return { item, coluna: "feitas" };
    }
    return null;
  }

  // Primeiro o cartão em que ela está à vista; se não, o "para todos" que a
  // contém (a minha cópia saiu para Feitas, mas o cartão do lote continua).
  const naGaveta = aberta
    ? (acharItem((i) => i.demandas.some((x) => x.id === aberta)) ??
      acharItem((i) => i.lote.some((x) => x.id === aberta)))
    : null;
  const emArraste = arrastando ? acharItem((i) => i.chave === arrastando.chave) : null;

  // O número de cada recorte é o que está A FAZER nele — é o que a pessoa
  // procura ao abrir o menu.
  const contar = (r: Recorte) => lista.filter((d) => !d.feitaEm && noRecorte(d, r, eu)).length;
  const atrasadasEm = (r: Recorte) =>
    lista.filter((d) => !d.feitaEm && d.prazo !== null && d.prazo < hoje && noRecorte(d, r, eu)).length;

  // As pessoas para quem EU mandei alguma demanda — é o menu "Quem" do quadro
  // "Enviadas". Sai da própria lista: quem saiu da equipe continua aparecendo
  // enquanto houver demanda dele aqui.
  const destinatarios = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const d of lista) {
      if (d.responsavelId && enviadaPorMim(d, eu)) vistos.set(d.responsavelId, d.responsavel ?? "Alguém que saiu");
    }
    return [...vistos].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [lista, eu]);
  const temChamado = lista.some((d) => enviadaPorMim(d, eu) && d.departamentoId !== null);

  const opcoesRecorte =
    quadro === "enviadas"
      ? [
          { valor: "g:todas", rotulo: `Todas que enviei · ${contar("g:todas")}` },
          ...(temChamado ? [{ valor: "g:chamados", rotulo: `Chamados abertos · ${contar("g:chamados")}` }] : []),
          ...destinatarios.map(([id, nome]) => ({ valor: `g:p:${id}`, rotulo: `${nome} · ${contar(`g:p:${id}`)}` })),
        ]
      : [
          { valor: "minhas", rotulo: `Para mim · ${contar("minhas")}` },
          ...(admin
            ? [
                { valor: "todas", rotulo: `Equipe inteira · ${contar("todas")}` },
                { valor: "chamados", rotulo: `Chamados do TI · ${contar("chamados")}` },
                ...(pessoas ?? []).map((p) => ({
                  valor: `p:${p.id}`,
                  rotulo: `${p.id === eu.id ? "Só as minhas" : p.nome} · ${contar(`p:${p.id}`)}`,
                })),
              ]
            : []),
        ];
  // Sem escolha de verdade (quem não é Admin, em "Minhas"), o menu sai.
  const mostrarQuem = opcoesRecorte.length > 1;

  function trocarQuadro(q: Quadro) {
    setQuadro(q);
    setRecorte(RECORTE_INICIAL[q]);
  }

  // Para onde a "Nova demanda" pode ir: para mim, chamado para o TI e qualquer
  // pessoa da equipe valem para todo mundo; "Todos" só para Admin e TI (e o
  // servidor confere de novo).
  const destinos: Destino[] = [
    { valor: eu.id, rotulo: "Para mim" },
    {
      valor: PARA_O_TI,
      rotulo: "Chamado para o TI",
      dica: "Qualquer pessoa do TI vê e dá o check. Você acompanha em “Enviadas”.",
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
    setAberta(null);
    iniciar(async () => {
      mudarNaTela({ tipo: "remover", ids });
      const r = await excluirDemandas(ids);
      setAviso({ ok: r.ok, texto: r.mensagem });
      avisarQueDemandasMudaram();
    });
  }

  function editar(item: Item) {
    const d = item.demandas[0];
    // A gaveta fecha: o modal é o próximo passo, e os dois abertos brigariam
    // pelo Esc.
    setAberta(null);
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

  // ── Arrastar para Feitas (e de volta) ─────────────────────────────────────
  const sensores = useSensors(
    // 6px de folga: sem isto todo clique viraria arraste e a gaveta nunca abria.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /** Onde o cartão em arraste pode cair: pendente → Feitas; feita → de volta. */
  function aceita(c: ColunaId) {
    if (!arrastando) return false;
    return arrastando.coluna === "feitas" ? c !== "feitas" : c === "feitas";
  }

  function aoIniciarArraste({ active }: DragStartEvent) {
    const dados = active.data.current as { coluna: ColunaId } | undefined;
    if (dados) setArrastando({ chave: String(active.id), coluna: dados.coluna });
  }

  function aoSoltar({ active, over }: DragEndEvent) {
    const de = arrastando?.coluna;
    setArrastando(null);
    const alvoId = (active.data.current as { alvo: string | null } | undefined)?.alvo;
    if (!over || !de || !alvoId) return;
    const para = over.id as ColunaId;
    if (para === de) return;
    if (para === "feitas") marcar(alvoId, true);
    else if (de === "feitas") marcar(alvoId, false);
  }

  const propsDoCartao = {
    quadro,
    eu,
    hoje,
    agora,
    aoMarcar: marcar,
    aoAbrir: setAberta,
  };

  return (
    // @container: o ponto de quebra é a largura DESTA tela, não a da janela —
    // com a barra lateral aberta, uma janela de 1024px deixa só ~760px aqui.
    <div className="@container flex h-screen flex-col overflow-hidden bg-conteudo">
      {/* z-20: os menus dos filtros abrem por cima das colunas. */}
      <header className="relative z-20 shrink-0 px-4 pb-1 pt-4 @md:px-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2.5">
          {/* O título só aparece com folga: abaixo disso a barra lateral já diz
              onde a pessoa está, e a linha fica para as abas e os filtros. */}
          <h1 className="sr-only text-[15px] font-semibold tracking-tight text-zinc-900 @6xl:not-sr-only @6xl:mr-1 @6xl:flex @6xl:items-center @6xl:gap-2 dark:text-zinc-50">
            <ListChecks className="size-[18px]" aria-hidden="true" />
            Demandas
          </h1>

          {!faltaMigration && (
            <>
              {/* Os dois quadros. O número é o que está A FAZER em cada um;
                  fica vermelho quando alguma já passou do prazo. */}
              <div
                role="tablist"
                aria-label="Quadro"
                className="flex w-full gap-0.5 rounded-[10px] bg-zinc-100 p-[3px] ring-1 ring-inset ring-zinc-200/80 @md:w-auto dark:bg-zinc-900 dark:ring-zinc-800"
              >
                {(
                  [
                    ["minhas", "Minhas", Inbox, RECORTE_INICIAL.minhas],
                    ["enviadas", "Enviadas", Send, RECORTE_INICIAL.enviadas],
                  ] as const
                ).map(([valor, rotulo, Icone, r]) => {
                  const n = contar(r);
                  const atrasadas = atrasadasEm(r);
                  const ativo = quadro === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      role="tab"
                      aria-selected={ativo}
                      onClick={() => trocarQuadro(valor)}
                      title={atrasadas ? `${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}` : undefined}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[13px] font-medium transition @md:flex-none ${
                        ativo
                          ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-zinc-800 dark:text-zinc-50 dark:shadow-none"
                          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      }`}
                    >
                      <Icone className="size-3.5" aria-hidden="true" />
                      {rotulo}
                      {n > 0 && (
                        <span
                          className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-semibold leading-[18px] tabular-nums ${
                            atrasadas
                              ? "bg-red-500 text-white"
                              : ativo
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                          }`}
                        >
                          {n}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* No celular os dois filtros dividem uma linha. */}
              <div className="flex w-full items-center gap-2 @md:w-auto">
                {mostrarQuem && (
                  <div className="min-w-0 flex-1 @md:flex-none">
                    <SeletorMenu
                      Icone={Users}
                      rotulo="Quem"
                      valor={recorte}
                      opcoes={opcoesRecorte}
                      aoMudar={setRecorte}
                      botao="w-full @md:w-48"
                      ativo={recorte !== RECORTE_INICIAL[quadro]}
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1 @md:flex-none">
                  <SeletorMenu
                    Icone={CalendarDays}
                    rotulo="Criada em"
                    valor={dia}
                    opcoes={OPCOES_DIA}
                    aoMudar={(v) => setDia(v as FiltroDia)}
                    botao="w-full @md:w-40"
                    ativo={dia !== "qualquer"}
                  />
                </div>
                {filtrando && <BotaoLimpar aoClicar={limparFiltros} />}
              </div>

              <div className="ml-auto flex w-full items-center gap-2 @4xl:w-auto">
                <div className="relative flex-1 @4xl:w-36 @4xl:flex-none @6xl:w-52">
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

                <button
                  type="button"
                  onClick={() => setCriando(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Nova demanda
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {faltaMigration ? (
        <div className="p-5">
          <p className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            A tabela <code>demandas</code> ainda não existe no banco. Rode{" "}
            <code>migration-demandas.sql</code> e recarregue.
          </p>
        </div>
      ) : vazio ? (
        // Quadro inteiro vazio: em vez de quatro colunas dizendo "nada", uma
        // frase só — com o caminho para sair dele.
        <div className="flex min-h-0 flex-1 items-center justify-center p-5">
          {filtrando ? (
            <Vazio Icone={SearchX} titulo="Nada encontrado" texto="Nenhuma demanda com esses filtros.">
              <BotaoLimpar aoClicar={limparFiltros} />
            </Vazio>
          ) : quadro === "enviadas" ? (
            <Vazio
              Icone={Send}
              titulo="Nada enviado ainda"
              texto="O que você mandar para alguém da equipe — ou um chamado para o TI — aparece aqui para você acompanhar até a pessoa dar o check."
            >
              <BotaoNova aoClicar={() => setCriando(true)} />
            </Vazio>
          ) : (
            <Vazio Icone={CircleCheck} titulo="Tudo em dia" texto="Nada para você por aqui." tom="ok">
              <BotaoNova aoClicar={() => setCriando(true)} />
            </Vazio>
          )}
        </div>
      ) : (
        <DndContext
          // id fixo: sem ele o dnd-kit gera os ids de acessibilidade em runtime
          // e eles não batem com o SSR (erro de hidratação no console).
          id="quadro-demandas"
          sensors={sensores}
          collisionDetection={pointerWithin}
          onDragStart={aoIniciarArraste}
          onDragEnd={aoSoltar}
          onDragCancel={() => setArrastando(null)}
        >
          {/* Rola de lado quando as quatro não cabem (tablet, celular): no
              celular cada coluna ocupa quase a tela e encaixa ao rolar. */}
          <main className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain @4xl:snap-none">
            <div className="flex h-full w-max gap-3 px-4 pb-5 pt-3 @md:px-5 @4xl:w-full">
              {COLUNAS.map((def) => (
                <Coluna
                  key={def.id}
                  def={def}
                  quadro={quadro}
                  total={totalDa(def.id)}
                  nota={def.id === "feitas" ? "últimos 90 dias" : undefined}
                  realce={!arrastando ? "nenhum" : aceita(def.id) ? "aceita" : "recusa"}
                >
                  {def.id === "feitas" ? (
                    feitasPorDia.map((g) => (
                      <section key={g.dia} aria-label={rotuloDoDia(g.dia, hoje)} className="flex flex-col gap-1.5">
                        <h3 className="flex items-center gap-1.5 px-1 pt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          {rotuloDoDia(g.dia, hoje)}
                          <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{g.itens.length}</span>
                        </h3>
                        <ul className="flex flex-col gap-1.5">
                          {g.itens.map((item) => (
                            <Cartao key={item.chave} item={item} coluna="feitas" {...propsDoCartao} />
                          ))}
                        </ul>
                      </section>
                    ))
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {pendentes[def.id].map((item) => (
                        <Cartao key={item.chave} item={item} coluna={def.id} {...propsDoCartao} />
                      ))}
                    </ul>
                  )}
                </Coluna>
              ))}
            </div>
          </main>

          {/* A cópia que segue o cursor; o original fica esmaecido. */}
          <DragOverlay dropAnimation={null}>
            {emArraste && <CorpoCartao item={emArraste.item} coluna={emArraste.coluna} {...propsDoCartao} flutuando />}
          </DragOverlay>
        </DndContext>
      )}

      {aviso && (
        <div
          role="status"
          className="surge fixed bottom-6 left-1/2 z-[320] flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-900 py-2.5 pl-4 pr-2.5 text-[13px] text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
        >
          {aviso.ok ? (
            <CircleCheck className="size-4 shrink-0 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
          ) : (
            <span className="size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
          )}
          <span className="flex-1">{aviso.texto}</span>
          <button
            type="button"
            onClick={() => setAviso(null)}
            aria-label="Fechar aviso"
            className="rounded-md p-1 opacity-60 transition hover:bg-white/10 hover:opacity-100 dark:hover:bg-zinc-900/10"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {naGaveta && (
        <DetalheDemanda
          item={naGaveta.item}
          coluna={naGaveta.coluna}
          quadro={quadro}
          eu={eu}
          hoje={hoje}
          aoFechar={() => setAberta(null)}
          aoMarcar={marcar}
          aoEditar={editar}
          aoExcluir={excluir}
          aoMarcarItem={marcarItem}
          montar={MONTAR}
          aoAvisar={(texto) => setAviso({ ok: false, texto })}
        />
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
          // Em "Minhas" abre em "Para mim"; em "Enviadas", sem escolha — quem
          // está ali vai mandar para alguém. O Admin escolhe sempre: com
          // "Todos" no menu, um padrão errado vira dez demandas.
          destinoInicial={admin || quadro === "enviadas" ? "" : eu.id}
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
  def,
  quadro,
  total,
  nota,
  realce,
  children,
}: {
  def: DefinicaoColuna;
  quadro: Quadro;
  total: number;
  nota?: string;
  /** Durante um arraste: se esta coluna recebe o cartão. */
  realce: "nenhum" | "aceita" | "recusa";
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: def.id });
  const sobre = isOver && realce === "aceita";
  const alerta = def.id === "atrasadas" && total > 0;

  return (
    <section
      ref={setNodeRef}
      aria-label={def.rotulo[quadro]}
      // Quase a tela no celular (e encaixa ao rolar); 18rem em tela média; as
      // quatro dividindo a largura do tablet deitado para cima.
      className={`relative flex h-full w-[85cqw] max-w-[22rem] shrink-0 snap-center flex-col rounded-xl transition-[background-color,box-shadow,opacity] duration-150 @2xl:w-72 @2xl:max-w-none @4xl:w-auto @4xl:min-w-0 @4xl:flex-1 ${
        sobre
          ? "bg-emerald-50 ring-2 ring-inset ring-emerald-400/70 dark:bg-emerald-500/10 dark:ring-emerald-500/50"
          : realce === "aceita"
            ? "bg-zinc-100/70 outline-dashed outline-2 -outline-offset-2 outline-zinc-300 dark:bg-zinc-900/50 dark:outline-zinc-700"
            : "bg-zinc-100/70 dark:bg-zinc-900/50"
      } ${realce === "recusa" ? "opacity-60" : ""}`}
    >
      <span className={`h-1 shrink-0 rounded-t-xl ${def.faixa}`} aria-hidden="true" />
      <header className="flex shrink-0 items-center gap-2 px-3.5 pb-2.5 pt-3">
        <h2
          className={`text-[13px] font-semibold ${alerta ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}`}
        >
          {def.rotulo[quadro]}
        </h2>
        <span className="rounded-full bg-white px-1.5 text-[11px] font-medium leading-[18px] tabular-nums text-zinc-500 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700">
          {total}
        </span>
        {nota && <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">{nota}</span>}
      </header>

      {/* Rola por dentro, como as colunas do quadro do Dashboard. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-2">
        {total === 0 ? (
          <p className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 pb-10 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
            {sobre || realce === "aceita"
              ? def.id === "feitas"
                ? "Solte aqui para marcar como feita"
                : "Solte aqui para voltar a fazer"
              : def.vazio[quadro]}
          </p>
        ) : (
          children
        )}
        {total > 0 && realce === "aceita" && (
          <p className="pointer-events-none rounded-lg border border-dashed border-emerald-400/70 py-3 text-center text-[12px] font-medium text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-400">
            {def.id === "feitas" ? "Solte para marcar como feita" : "Solte para voltar a fazer"}
          </p>
        )}
      </div>
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
    <div className="surge-suave flex max-w-sm flex-col items-center gap-1.5 text-center">
      <span
        className={`mb-2 flex size-12 items-center justify-center rounded-2xl ${
          tom === "ok"
            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
            : "bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500"
        }`}
      >
        <Icone className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">{titulo}</p>
      <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{texto}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function BotaoNova({ aoClicar }: { aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-50 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-900"
    >
      <Plus className="size-3.5" aria-hidden="true" />
      Nova demanda
    </button>
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
