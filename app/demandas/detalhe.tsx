"use client";

// A gaveta de uma demanda: abre da direita, por cima do quadro, com a mesma
// casca da ficha da oportunidade e do painel de evento da Agenda (véu, faixa de
// cor, cabeçalho fixo, miolo rolando, ações no pé).
//
// É AQUI QUE A DEMANDA SE RESOLVE: o check grande, o checklist inteiro, a
// descrição sem corte, para quem foi e quem já fez (na demanda "para todos"),
// e editar/excluir para quem criou. O cartão do quadro só resume.
import { useEffect, useRef, useState } from "react";
import { ArrowDown, CalendarClock, Check, Flag, LifeBuoy, Pencil, Trash2, Users, X } from "lucide-react";
import CamadaTopo from "../components/camada-topo";
import { dataHora } from "../formato";
import Checklist, { type MontarChecklist } from "./checklist";
import { Avatar, alvoDo, ehMinha, siglaDe, type Eu, type Item } from "./cartao";
import { definicaoDe, type ColunaId, type Quadro } from "./colunas";
import { diaComSemana, diaDe, horaDe, prazoEmTexto, rotuloDoDia } from "./datas";

const ROTULO_PRIORIDADE = { alta: "Alta", normal: "Normal", baixa: "Baixa" } as const;

const TOM_STATUS: Record<ColunaId, string> = {
  atrasadas: "text-red-600 dark:text-red-400",
  hoje: "text-amber-700 dark:text-amber-400",
  fila: "text-zinc-500 dark:text-zinc-400",
  andamento: "text-violet-700 dark:text-violet-400",
  feitas: "text-emerald-700 dark:text-emerald-400",
};

export default function DetalheDemanda({
  item,
  coluna,
  quadro,
  eu,
  hoje,
  aoFechar,
  aoMarcar,
  aoEditar,
  aoExcluir,
  aoMarcarItem,
  montar,
  aoAvisar,
}: {
  item: Item;
  coluna: ColunaId;
  quadro: Quadro;
  eu: Eu;
  hoje: string;
  aoFechar: () => void;
  aoMarcar: (id: string, feita: boolean) => void;
  aoEditar: (item: Item) => void;
  aoExcluir: (ids: string[]) => void;
  aoMarcarItem: (itemId: string, feito: boolean) => void;
  montar: MontarChecklist;
  aoAvisar: (texto: string) => void;
}) {
  const fechar = useRef<HTMLButtonElement>(null);
  // Segundo clique é que exclui, como em Documentos.
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    fechar.current?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const d = item.demandas[0];
  const feita = d.feitaEm !== null;
  const emLote = item.lote.length > 1;
  const chamado = d.departamentoId !== null;
  const alvo = alvoDo(item, eu);
  // Editar, excluir e montar o checklist: só quem criou (regra dele,
  // 2026-10-07) — o servidor confere de novo em lib/demandas.ts.
  const podeMexer = d.criadoPor === eu.id;
  const def = definicaoDe(coluna);
  const autor = d.criadoPor === eu.id ? "Você" : (d.autor ?? "Alguém que saiu");
  const quemFez = (nome: string | null) => (nome === eu.nome ? "você" : (nome ?? "alguém que saiu"));
  const feitasNoLote = item.lote.filter((x) => x.feitaEm).length;
  const idsDoCartao = emLote ? item.lote.map((x) => x.id) : [d.id];

  // O checklist que aparece: o da MINHA cópia quando a demanda é minha; no
  // cartão "para todos" de quem não recebeu, a lista em si, sem o check de
  // ninguém — o de cada pessoa aparece como "2/5" ao lado do passo.
  const baseDoChecklist =
    alvo ?? (emLote ? { ...d, itens: d.itens.map((i) => ({ ...i, feitoEm: null, feitoPor: null })) } : d);

  // A linha de cima da gaveta: o estado da demanda em uma frase.
  let status: string;
  if (feita) {
    const dia = rotuloDoDia(diaDe(d.feitaEm!), hoje);
    const quando = dia === "Hoje" || dia === "Ontem" ? dia.toLowerCase() : `em ${dia}`;
    status = `Feita ${quando} às ${horaDe(d.feitaEm!)} · ${quemFez(d.feitaPor)}`;
  } else if (coluna === "andamento") {
    // Em andamento é o checklist começado (ver colunas.ts): diz quanto andou,
    // e o prazo junto — começar não tira o atraso.
    const base = alvo ?? d;
    const feitos = base.itens.filter((i) => i.feitoEm).length;
    status = `Em andamento · ${feitos} de ${base.itens.length} passos${d.prazo ? ` · ${prazoEmTexto(d.prazo, hoje, false).texto.toLowerCase()}` : ""}`;
  } else if (d.prazo) status = prazoEmTexto(d.prazo, hoje, false).texto;
  else status = quadro === "enviadas" ? "Aguardando · sem prazo" : "A fazer · sem prazo";

  // Para quem foi, com rosto.
  const destino = emLote
    ? { nome: `${item.lote.length} pessoas`, texto: null, Icone: Users }
    : chamado
      ? { nome: d.departamento ?? "?", texto: siglaDe(d.departamento), Icone: LifeBuoy }
      : { nome: d.responsavelId === eu.id ? "Você" : (d.responsavel ?? "Alguém que saiu"), texto: d.responsavelIniciais, Icone: null };

  return (
    <CamadaTopo>
      <div className="veu-surge fixed inset-0 z-[300] bg-black/30 backdrop-blur-[1px] dark:bg-black/50" onClick={aoFechar} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Demanda ${d.titulo}`}
        className="ficha-entra fixed bottom-3 right-3 top-3 z-[310] flex w-[28rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className={`h-1.5 shrink-0 ${def.faixa}`} aria-hidden="true" />

        <header className="shrink-0 border-b border-zinc-200 px-5 pb-4 pt-3.5 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium ${TOM_STATUS[coluna]}`}>
                <span className="inline-flex items-center gap-1">
                  {feita ? (
                    <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                  ) : (
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                  )}
                  {status}
                </span>
                {chamado && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-sky-700 ring-1 ring-inset ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20">
                    <LifeBuoy className="size-3" aria-hidden="true" />
                    Chamado
                  </span>
                )}
                {d.prioridade === "alta" && (
                  <span className="inline-flex items-center gap-0.5 font-semibold text-red-600 dark:text-red-400">
                    <Flag className="size-3 fill-current" aria-hidden="true" />
                    Prioridade alta
                  </span>
                )}
              </p>
              <h2 className="mt-1.5 break-words text-[17px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
                {d.titulo}
              </h2>
            </div>
            <button
              ref={fechar}
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* O check grande: quem recebeu resolve daqui. Quem mandou vê para
              quem está. */}
          {alvo ? (
            <button
              type="button"
              onClick={() => aoMarcar(alvo.id, !alvo.feitaEm)}
              className={`mt-3.5 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition active:scale-[0.98] ${
                alvo.feitaEm
                  ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25 dark:hover:bg-emerald-500/15"
                  : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              }`}
            >
              <span
                className={`flex size-4 items-center justify-center rounded-full border-[1.5px] ${
                  alvo.feitaEm ? "border-emerald-500 bg-emerald-500 text-white dark:text-zinc-950" : "border-current"
                }`}
                aria-hidden="true"
              >
                {alvo.feitaEm && <Check className="size-2.5" strokeWidth={3.5} />}
              </span>
              {alvo.feitaEm ? "Feita — desmarcar" : "Marcar como feita"}
            </button>
          ) : (
            !feita &&
            !emLote && (
              <p className="mt-3.5 inline-flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-[12px] text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">
                <Avatar nome={destino.nome} texto={destino.texto} tamanho="xs" />
                Aguardando {chamado ? `o ${destino.nome}` : destino.nome}
              </p>
            )
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {d.descricao && (
            <Secao titulo="Descrição">
              <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                {d.descricao}
              </p>
            </Secao>
          )}

          <Checklist
            base={baseDoChecklist}
            lote={item.lote}
            podeMarcar={Boolean(alvo)}
            podeMontar={podeMexer}
            demandaPendente={baseDoChecklist.feitaEm === null}
            eu={eu}
            aoMarcarItem={aoMarcarItem}
            montar={montar}
            aoFecharDemanda={() => alvo && aoMarcar(alvo.id, true)}
            aoAvisar={aoAvisar}
          />

          <Secao titulo="Detalhes">
            <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2.5 text-[12px]">
              <dt className="text-zinc-400 dark:text-zinc-500">Para</dt>
              <dd className="flex min-w-0 items-center gap-2 text-zinc-800 dark:text-zinc-200">
                {destino.Icone ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <destino.Icone className="size-3" aria-hidden="true" />
                  </span>
                ) : (
                  <Avatar nome={destino.nome} texto={destino.texto} tamanho="xs" />
                )}
                <span className="truncate">
                  {destino.nome}
                  {chamado && <span className="text-zinc-400 dark:text-zinc-500"> · qualquer pessoa do departamento</span>}
                </span>
              </dd>

              <dt className="text-zinc-400 dark:text-zinc-500">{chamado ? "Aberto por" : "Criada por"}</dt>
              <dd className="flex min-w-0 items-center gap-2 text-zinc-800 dark:text-zinc-200">
                <Avatar nome={d.autor ?? "?"} tamanho="xs" />
                <span className="truncate">
                  {autor}
                  <span className="text-zinc-400 dark:text-zinc-500"> · {dataHora(d.dataCriacao)}</span>
                </span>
              </dd>

              <dt className="text-zinc-400 dark:text-zinc-500">Prazo</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">
                {d.prazo ? diaComSemana(d.prazo, hoje) : <span className="text-zinc-400 dark:text-zinc-500">Sem prazo</span>}
              </dd>

              <dt className="text-zinc-400 dark:text-zinc-500">Prioridade</dt>
              <dd className="flex items-center gap-1 text-zinc-800 dark:text-zinc-200">
                {d.prioridade === "alta" && <Flag className="size-3 fill-current text-red-500" aria-hidden="true" />}
                {d.prioridade === "baixa" && <ArrowDown className="size-3 text-zinc-400" aria-hidden="true" />}
                {ROTULO_PRIORIDADE[d.prioridade]}
              </dd>

              {!emLote && d.feitaEm && (
                <>
                  <dt className="text-zinc-400 dark:text-zinc-500">Feita em</dt>
                  <dd className="text-emerald-700 dark:text-emerald-400">
                    {dataHora(d.feitaEm)} · {quemFez(d.feitaPor)}
                  </dd>
                </>
              )}
            </dl>
          </Secao>

          {/* Quem já fez e quem falta, na demanda "para todos". */}
          {emLote && (
            <Secao titulo={`Quem já fez · ${feitasNoLote} de ${item.lote.length}`}>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
                <span
                  className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                  style={{ width: `${(feitasNoLote / item.lote.length) * 100}%` }}
                />
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {[...item.lote]
                  .sort((a, b) => Number(Boolean(a.feitaEm)) - Number(Boolean(b.feitaEm)))
                  .map((x) => (
                    <li key={x.id} className="flex items-center gap-2.5 py-2 text-[12px]">
                      <Avatar nome={x.responsavel ?? "?"} texto={x.responsavelIniciais} tamanho="sm" apagado={Boolean(x.feitaEm)} />
                      <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">
                        {x.responsavelId === eu.id ? "Você" : x.responsavel}
                      </span>
                      {x.itens.length > 0 && (
                        <span className="tabular-nums text-zinc-400 dark:text-zinc-500" title="Passos feitos do checklist">
                          {x.itens.filter((i) => i.feitoEm).length}/{x.itens.length}
                        </span>
                      )}
                      {x.feitaEm ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
                          {dataHora(x.feitaEm)}
                        </span>
                      ) : (
                        <span className="text-zinc-400 dark:text-zinc-500">{ehMinha(x, eu) ? "falta você" : "falta"}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </Secao>
          )}
        </div>

        {podeMexer && (
          <footer className="flex shrink-0 items-center gap-1 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => aoEditar(item)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Editar
            </button>
            <button
              type="button"
              onClick={() => (confirmando ? aoExcluir(idsDoCartao) : setConfirmando(true))}
              onBlur={() => setConfirmando(false)}
              className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ${
                confirmando
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              }`}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {confirmando
                ? emLote
                  ? `Confirmar: excluir das ${item.lote.length} pessoas`
                  : "Confirmar exclusão"
                : "Excluir"}
            </button>
          </footer>
        )}
      </aside>
    </CamadaTopo>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{titulo}</h3>
      {children}
    </section>
  );
}
