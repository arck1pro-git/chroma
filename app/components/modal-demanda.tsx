"use client";

// O formulário de demanda, em modal. Serve a três lugares:
//   · "Abrir chamado", no topo do Dashboard — sem o campo "Para": o chamado vai
//     sempre para o TI;
//   · "Nova demanda", em /demandas — com "Para". Todo mundo escolhe entre si
//     mesmo e um chamado para o TI; Admin e TI, também qualquer pessoa ou
//     todos (quem decide é podeCriarPara, em lib/demandas.ts);
//   · "Editar demanda", em /demandas — abre preenchido (`inicial`) e sem "Para":
//     editar não muda o destino.
//
// O CHECKLIST entra só na criação, atrás de um "+ Checklist" para não pesar o
// formulário de quem não precisa. Depois de criada, o checklist se monta no
// próprio cartão (app/demandas/checklist.tsx).
//
// Sai pelo <CamadaTopo>, no <body>: no Dashboard ele precisa ficar por cima do
// quadro e de tudo que flutua sobre ele (ver a escala em camada-topo.tsx).
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  CircleCheck,
  LifeBuoy,
  ListChecks,
  Plus,
  Search,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import CamadaTopo from "./camada-topo";
import {
  avisarQueDemandasMudaram,
  PARA_O_TI,
  PARA_TODOS,
  PRIORIDADES,
  TETO_ITENS,
  TETO_TEXTO_ITEM,
  type DadosDemanda,
  type Prioridade,
  type ResultadoDemanda,
} from "@/lib/demandas-tipos";

/** Uma opção do campo "Para". */
export type Destino = {
  valor: string;
  rotulo: string;
  /** No seletor, as opções com grupo entram numa seção com este nome. */
  grupo?: string;
  /** Uma linha embaixo do campo quando esta opção está escolhida. */
  dica?: string;
  /**
   * O ícone da opção no seletor. Sem ele: o chamado ganha a boia, "todos" as
   * pessoas, e quem está num grupo (a equipe) ganha as iniciais do nome.
   */
  Icone?: LucideIcon;
};

// [color-scheme]: o calendário do campo de prazo é desenhado pelo navegador, e
// sem isto ele abria claro no tema escuro.
const campo =
  "w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-950 outline-none transition [color-scheme:light] placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:[color-scheme:dark] dark:focus:border-zinc-600";

const rotulo = "text-[11px] font-medium text-zinc-600 dark:text-zinc-400";

function classeDaPilula(escolhida: boolean) {
  return `rounded-lg px-3 py-2 text-[12px] font-medium transition ${
    escolhida
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
  }`;
}

export default function ModalDemanda({
  titulo,
  subtitulo,
  botao,
  destinos,
  destinoInicial = "",
  inicial,
  enviar,
  aoFechar,
  aoConcluir,
}: {
  titulo: string;
  subtitulo: string;
  /** Texto do botão de enviar. Com "Chamado para o TI" escolhido, vira "Abrir chamado". */
  botao: string;
  /**
   * Com a lista, aparece o campo "Para". Até três opções viram botões lado a
   * lado — é o caso de quem só cria para si ou para o TI, e um seletor para
   * duas opções esconderia a escolha atrás de um clique. Mais que isso, um
   * seletor: o Admin escolhe entre a equipe inteira.
   */
  destinos?: Destino[];
  /** Já escolhido ao abrir. Vazio obriga a escolher. */
  destinoInicial?: string;
  /** Os valores de quando o modal abre — é o caso de editar. */
  inicial?: Omit<DadosDemanda, "para">;
  enviar: (dados: DadosDemanda) => Promise<ResultadoDemanda>;
  aoFechar: () => void;
  /**
   * Quem chamou mostra o resultado (e fecha o modal). Sem isto, o próprio modal
   * troca o formulário pela confirmação — é o caso do Dashboard, que não tem
   * faixa de aviso.
   */
  aoConcluir?: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(inicial?.titulo ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [prazo, setPrazo] = useState(inicial?.prazo ?? "");
  const [prioridade, setPrioridade] = useState<Prioridade>(inicial?.prioridade ?? "normal");
  const [para, setPara] = useState(destinoInicial);
  const [itens, setItens] = useState<string[]>([]);
  const [novoItem, setNovoItem] = useState("");
  const [comChecklist, setComChecklist] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const idPara = useId();

  // Esc fecha, como nos outros modais — menos no meio do envio, quando sumir
  // com a tela deixaria a pessoa sem saber se a demanda nasceu.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, enviando]);

  // É chamado o modal do Dashboard (sem destinos e sem `inicial`) e a "Nova
  // demanda" com o TI escolhido. Muda o tom dos exemplos e o nome do botão.
  const chamado = destinos ? para === PARA_O_TI : inicial === undefined;
  const escolhido = destinos?.find((d) => d.valor === para);
  const podeEnviar = Boolean(nome.trim()) && (!destinos || Boolean(escolhido)) && !enviando;

  // As soltas primeiro, depois cada grupo na ordem em que aparece.
  const soltos = destinos?.filter((d) => !d.grupo) ?? [];
  const grupos = new Map<string, Destino[]>();
  for (const d of destinos ?? []) {
    if (!d.grupo) continue;
    grupos.set(d.grupo, [...(grupos.get(d.grupo) ?? []), d]);
  }

  function acrescentarItem() {
    const t = novoItem.trim();
    if (!t || itens.length >= TETO_ITENS) return;
    setItens((atuais) => [...atuais, t]);
    setNovoItem("");
  }

  function mandar() {
    if (!podeEnviar) return;
    setErro(null);
    // O passo digitado e ainda sem Enter vai junto: quem clicou em criar quis
    // que ele entrasse.
    const passos = [...itens, novoItem.trim()].filter(Boolean).slice(0, TETO_ITENS);
    iniciar(async () => {
      const r = await enviar({
        titulo: nome,
        descricao,
        prazo,
        prioridade,
        ...(destinos ? { para } : {}),
        ...(passos.length ? { itens: passos } : {}),
      });
      if (!r.ok) {
        setErro(r.mensagem);
        return;
      }
      // A barra lateral recontar: uma demanda nova pode ser da própria pessoa
      // (ou do departamento dela, no chamado aberto pelo TI).
      avisarQueDemandasMudaram();
      if (aoConcluir) aoConcluir(r.mensagem);
      else setFeito(r.mensagem);
    });
  }

  return (
    <CamadaTopo>
      <div
        className="veu-surge fixed inset-0 z-[300] bg-zinc-900/30 dark:bg-black/50"
        onClick={() => !enviando && aoFechar()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="surge fixed left-1/2 top-1/2 z-[310] flex max-h-[90vh] w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-950 dark:text-zinc-50">{titulo}</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{subtitulo}</p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={enviando}
            aria-label="Fechar"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {feito ? (
          <>
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <CircleCheck className="size-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{feito}</p>
            </div>
            <footer className="flex justify-end border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <button
                type="button"
                autoFocus
                onClick={aoFechar}
                className="rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Fechar
              </button>
            </footer>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mandar();
            }}
            className="flex min-h-0 flex-col"
          >
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
              {/* "Para" vem primeiro: é ele que diz se isto é uma tarefa ou um
                  chamado, e os exemplos dos campos de baixo mudam com ele. */}
              {destinos && (
                <div className="flex flex-col gap-1">
                  <span id={idPara} className={rotulo}>
                    Para
                  </span>
                  {destinos.length <= 3 ? (
                    <div role="radiogroup" aria-labelledby={idPara} className="flex flex-wrap gap-1">
                      {destinos.map((d) => (
                        <button
                          key={d.valor}
                          type="button"
                          role="radio"
                          aria-checked={para === d.valor}
                          onClick={() => setPara(d.valor)}
                          className={classeDaPilula(para === d.valor)}
                        >
                          {d.rotulo}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <SeletorDestino
                      idRotulo={idPara}
                      valor={para}
                      soltos={soltos}
                      grupos={grupos}
                      aoEscolher={setPara}
                    />
                  )}
                  {escolhido?.dica && (
                    <span className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                      {escolhido.dica}
                    </span>
                  )}
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className={rotulo}>Título</span>
                <input
                  autoFocus
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={chamado ? "O que está acontecendo" : "O que precisa ser feito"}
                  maxLength={200}
                  className={campo}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={rotulo}>
                  Descrição <span className="font-normal text-zinc-400">(opcional)</span>
                </span>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder={
                    chamado ? "Em que tela, o que você tentou, a mensagem de erro" : "Detalhes, links, onde fica"
                  }
                  className={`${campo} resize-y`}
                />
              </label>

              {inicial === undefined &&
                (comChecklist || itens.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className={`${rotulo} flex items-center gap-1.5`}>
                      <ListChecks className="size-3.5" aria-hidden="true" />
                      Checklist <span className="font-normal text-zinc-400">(opcional)</span>
                    </span>
                    {itens.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {itens.map((t, i) => (
                          <li key={`${i}-${t}`} className="group flex items-center gap-2 rounded-lg px-1 py-0.5">
                            <span className="size-3.5 shrink-0 rounded-[4px] border border-zinc-300 dark:border-zinc-600" aria-hidden="true" />
                            <span className="min-w-0 flex-1 break-words text-[13px] text-zinc-800 dark:text-zinc-200">{t}</span>
                            <button
                              type="button"
                              onClick={() => setItens((atuais) => atuais.filter((_, j) => j !== i))}
                              aria-label={`Tirar “${t}”`}
                              className="shrink-0 rounded p-0.5 text-zinc-300 opacity-0 transition hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600"
                            >
                              <X className="size-3.5" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {itens.length < TETO_ITENS && (
                      <div className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-3 py-1.5 focus-within:border-zinc-400 dark:border-zinc-700 dark:focus-within:border-zinc-600">
                        <Plus className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                        <input
                          autoFocus={itens.length === 0}
                          value={novoItem}
                          maxLength={TETO_TEXTO_ITEM}
                          onChange={(e) => setNovoItem(e.target.value)}
                          onKeyDown={(e) => {
                            // Enter acrescenta o passo, não envia o formulário.
                            if (e.key === "Enter") {
                              e.preventDefault();
                              acrescentarItem();
                            }
                          }}
                          placeholder={itens.length ? "Mais um passo — Enter" : "Primeiro passo — Enter para o próximo"}
                          aria-label="Novo passo do checklist"
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
                        />
                      </div>
                    )}
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {destinos && para !== PARA_O_TI
                        ? "Quem receber marca cada passo; mudar os passos depois é com você."
                        : "O TI marca cada passo; mudar os passos depois é com você."}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setComChecklist(true)}
                    className="-mt-1 inline-flex items-center gap-1.5 self-start rounded-lg px-1.5 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Checklist
                  </button>
                ))}

              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1">
                  <span className={rotulo}>
                    Prazo <span className="font-normal text-zinc-400">(opcional)</span>
                  </span>
                  <input
                    type="date"
                    value={prazo}
                    onChange={(e) => setPrazo(e.target.value)}
                    className={`${campo} w-40 [color-scheme:light] dark:[color-scheme:dark]`}
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <span className={rotulo}>Prioridade</span>
                  <div role="radiogroup" aria-label="Prioridade" className="flex gap-1">
                    {PRIORIDADES.map((p) => (
                      <button
                        key={p.valor}
                        type="button"
                        role="radio"
                        aria-checked={prioridade === p.valor}
                        onClick={() => setPrioridade(p.valor)}
                        className={classeDaPilula(prioridade === p.valor)}
                      >
                        {p.rotulo}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {erro && <p className="text-[12px] text-red-600 dark:text-red-400">{erro}</p>}
            </div>

            <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={aoFechar}
                disabled={enviando}
                className="rounded-full px-4 py-2 text-[13px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!podeEnviar}
                className="rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {enviando ? "Enviando…" : destinos && para === PARA_O_TI ? "Abrir chamado" : botao}
              </button>
            </footer>
          </form>
        )}
      </div>
    </CamadaTopo>
  );
}

// ── O seletor de "Para" ─────────────────────────────────────────────────────
//
// Era um <select> nativo. A lista aberta dele quem desenha é o navegador, com
// as cores do sistema — no tema escuro saía clara e com o texto apagado, e
// nem os grupos ("Equipe") nem quem é quem dava para mostrar direito (pedido
// dele de 2026-10-08: "o seletor personalizado, que dê boa no preto e no
// branco"). Agora é uma lista desenhada aqui, nas cores do app nos dois temas:
// você e o TI em cima, a equipe embaixo com as iniciais de cada um, busca
// quando a equipe passa de oito pessoas, e teclado (setas, Enter, Esc).

/** A partir de quantas opções a busca aparece. */
const BUSCA_A_PARTIR_DE = 9;

function iniciaisDe(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

function semAcento(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** O que aparece à esquerda de cada opção: ícone, ou as iniciais da pessoa. */
function Marca({ d }: { d: Destino }) {
  const Icone =
    d.Icone ?? (d.valor === PARA_O_TI ? LifeBuoy : d.valor === PARA_TODOS ? Users : d.grupo ? null : UserRound);
  const caixa = "size-6";
  if (Icone) {
    return (
      <span
        className={`flex ${caixa} shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}
        aria-hidden="true"
      >
        <Icone className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      className={`flex ${caixa} shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[9px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900`}
      aria-hidden="true"
    >
      {iniciaisDe(d.rotulo)}
    </span>
  );
}

function SeletorDestino({
  idRotulo,
  valor,
  soltos,
  grupos,
  aoEscolher,
}: {
  idRotulo: string;
  valor: string;
  soltos: Destino[];
  grupos: Map<string, Destino[]>;
  aoEscolher: (valor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const listaRef = useRef<HTMLUListElement | null>(null);
  const idLista = useId();
  // Fechar a lista devolve o foco ao botão — por efeito, e não direto no
  // clique: o React Compiler não deixa função de evento ler ref na mesma
  // passagem em que monta a lista.
  const [devolverFoco, setDevolverFoco] = useState(0);
  useEffect(() => {
    if (devolverFoco) botaoRef.current?.focus();
  }, [devolverFoco]);

  const todas = useMemo(() => [...soltos, ...[...grupos.values()].flat()], [soltos, grupos]);
  const escolhido = todas.find((d) => d.valor === valor) ?? null;
  const comBusca = todas.length >= BUSCA_A_PARTIR_DE;

  // O que a lista mostra, já filtrado pela busca, e a mesma ordem achatada para
  // as setas do teclado andarem por ela.
  const termo = semAcento(busca.trim());
  const passa = (d: Destino) => !termo || semAcento(d.rotulo).includes(termo);
  const filtradas: Array<{ titulo: string | null; itens: Destino[] }> = [
    { titulo: null, itens: soltos.filter(passa) },
    ...[...grupos].map(([titulo, lista]) => ({ titulo, itens: lista.filter(passa) })),
  ].filter((s) => s.itens.length > 0);
  // Cada seção sabe em que posição da lista achatada ela começa: é o que liga
  // o item da tela ao índice que as setas movem.
  const secoes = filtradas.map((s, k) => ({
    ...s,
    inicio: filtradas.slice(0, k).reduce((n, x) => n + x.itens.length, 0),
  }));
  const visiveis = filtradas.flatMap((s) => s.itens);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", aoClicar);
    return () => document.removeEventListener("mousedown", aoClicar);
  }, [aberto]);

  // A opção ativa sempre à vista quando as setas a levam para fora da lista.
  useEffect(() => {
    if (!aberto) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [ativo, aberto]);

  function abrir() {
    setBusca("");
    setAtivo(Math.max(0, todas.findIndex((d) => d.valor === valor)));
    setAberto(true);
  }

  function escolher(d: Destino) {
    aoEscolher(d.valor);
    setAberto(false);
    setDevolverFoco((n) => n + 1);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (!aberto) return; // deixa o Esc fechar o modal
      // Fecha só a lista: sem isto, o mesmo Esc fecharia o modal inteiro.
      e.stopPropagation();
      e.preventDefault();
      setAberto(false);
      setDevolverFoco((n) => n + 1);
      return;
    }
    if (!aberto) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((i) => Math.min(i + 1, visiveis.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const d = visiveis[ativo];
      if (d) escolher(d);
    } else if (e.key === "Tab") {
      setAberto(false);
    }
  }

  return (
    <div ref={caixaRef} className="relative" onKeyDown={aoTeclar}>
      <button
        ref={botaoRef}
        type="button"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-labelledby={idRotulo}
        className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-[13px] outline-none transition focus-visible:ring-4 focus-visible:ring-zinc-900/5 dark:focus-visible:ring-zinc-100/5 ${
          aberto
            ? "border-zinc-400 dark:border-zinc-600"
            : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
        }`}
      >
        {escolhido ? (
          <>
            <Marca d={escolhido} />
            <span className="min-w-0 flex-1 truncate font-medium text-zinc-950 dark:text-zinc-50">{escolhido.rotulo}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate px-0.5 text-zinc-400">Escolha para quem</span>
        )}
        <ChevronDown
          className={`size-4 shrink-0 text-zinc-400 transition-transform ${aberto ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {aberto && (
        <div className="surge absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          {comBusca && (
            <div className="relative border-b border-zinc-100 dark:border-zinc-800">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                autoFocus
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setAtivo(0);
                }}
                placeholder="Buscar pessoa"
                aria-label="Buscar pessoa"
                aria-controls={idLista}
                className="w-full bg-transparent py-2.5 pl-8 pr-3 text-[13px] text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
              />
            </div>
          )}
          <ul
            ref={listaRef}
            id={idLista}
            role="listbox"
            aria-labelledby={idRotulo}
            tabIndex={-1}
            className="max-h-64 overflow-y-auto p-1 outline-none"
          >
            {visiveis.length === 0 ? (
              <li className="px-3 py-6 text-center text-[12px] text-zinc-400">Ninguém com “{busca.trim()}”</li>
            ) : (
              secoes.map((s) => (
                <li key={s.titulo ?? "soltos"} role="presentation">
                  {s.titulo && (
                    <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                      {s.titulo}
                    </p>
                  )}
                  <ul role="presentation">
                    {s.itens.map((d, j) => {
                      const i = s.inicio + j;
                      const marcado = d.valor === valor;
                      const emFoco = i === ativo;
                      return (
                        <li
                          key={d.valor}
                          role="option"
                          aria-selected={marcado}
                          data-indice={i}
                          onMouseEnter={() => setAtivo(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => escolher(d)}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                            emFoco ? "bg-zinc-100 dark:bg-zinc-800" : ""
                          } ${marcado ? "font-medium text-zinc-950 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"}`}
                        >
                          <Marca d={d} />
                          <span className="min-w-0 flex-1 truncate">{d.rotulo}</span>
                          {marcado && <Check className="size-4 shrink-0 text-zinc-900 dark:text-zinc-100" aria-hidden="true" />}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
