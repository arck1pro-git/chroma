"use client";

// O cartão de uma demanda.
//
// EM REPOUSO ELE MOSTRA SÓ O QUE DECIDE O DIA: o check, o título, uma linha de
// descrição e uma linha de sinais (prazo, prioridade, chamado, de quem veio).
// Clicar abre o resto no próprio cartão — descrição inteira, datas, quem fez,
// editar e excluir. Assim a coluna se lê de relance e nada precisa de hover
// para ser achado.
//
// PRIORIDADE ALTA É UMA BARRA VERMELHA na borda esquerda, além do selo escrito:
// a barra é o que o olho pega descendo a coluna; o texto é o que garante a
// leitura para quem não distingue a cor.
//
// A DEMANDA "PARA TODOS" vira UM cartão (ver `Item`): sem isso, na visão do
// Admin uma demanda para dez pessoas eram dez cartões iguais empurrando o resto
// para baixo. O cartão diz quantas já fizeram e mostra quem falta.
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  CalendarClock,
  Check,
  Flag,
  LifeBuoy,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import type { Demanda } from "@/lib/demandas-tipos";
import { dataHora } from "../formato";
import { diaComSemana, haQuanto, horaDe, prazoEmTexto, type TomDoPrazo } from "./datas";

export type Eu = { id: string; nome: string; departamentoId: string | null };

/**
 * O que vira um cartão. `demandas` são as do cartão nesta coluna (na A fazer,
 * as pendentes); `lote` são todas as irmãs no recorte, feitas ou não — é delas
 * que sai o "2 de 5 feitas". Fora da demanda "para todos", os dois têm uma
 * linha só.
 */
export type Item = { chave: string; demandas: Demanda[]; lote: Demanda[] };

export function ehMinha(d: Demanda, eu: Eu) {
  return (
    d.responsavelId === eu.id ||
    (d.departamentoId !== null && d.departamentoId === eu.departamentoId)
  );
}

const TOM_PRAZO: Record<TomDoPrazo, string> = {
  atrasada: "font-medium text-red-600 dark:text-red-400",
  hoje: "font-medium text-amber-700 dark:text-amber-400",
  perto: "text-zinc-700 dark:text-zinc-300",
  longe: "",
};

const ROTULO_PRIORIDADE = { alta: "Alta", normal: "Normal", baixa: "Baixa" } as const;

/** As iniciais do departamento do chamado: "TI". */
function siglaDe(nome: string | null) {
  return (nome ?? "?").slice(0, 2).toUpperCase();
}

function Avatar({ texto, titulo, feito = false }: { texto: string; titulo: string; feito?: boolean }) {
  return (
    <span
      title={titulo}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ring-2 ring-white dark:ring-zinc-900 ${
        feito
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {texto}
    </span>
  );
}

const botaoAcao =
  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition disabled:opacity-40";

export default function Cartao({
  item,
  eu,
  admin,
  hoje,
  agora,
  aoMarcar,
  aoEditar,
  aoExcluir,
}: {
  item: Item;
  eu: Eu;
  admin: boolean;
  hoje: string;
  agora: string;
  aoMarcar: (id: string, feita: boolean) => void;
  aoEditar: (item: Item) => void;
  aoExcluir: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  // Segundo clique é que exclui, como em Documentos.
  const [confirmando, setConfirmando] = useState(false);
  // O instante entre o clique e a ida para Feitas: o círculo enche e o título
  // é riscado AQUI, onde a pessoa está olhando. Sem essa pausa o cartão sumia
  // no mesmo quadro do clique, e o check parecia não ter acontecido.
  //
  // Guarda QUAL demanda está indo, e não um sim/não: no cartão "para todos" ele
  // continua na coluna depois que a minha sai, e não pode ficar marcado para as
  // dos outros.
  const [concluindo, setConcluindo] = useState<string | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (espera.current) clearTimeout(espera.current);
  }, []);

  const d = item.demandas[0];
  const feita = d.feitaEm !== null;
  const emLote = item.lote.length > 1;
  const chamado = d.departamentoId !== null;
  const alta = d.prioridade === "alta" && !feita;

  // Qual linha o MEU check mexe: a minha dentre as pendentes do cartão, ou a
  // própria feita, se for minha (desmarcar).
  const alvo = item.demandas.find((x) => ehMinha(x, eu)) ?? null;
  // Só o desenho do check e do título: o resto do cartão segue o que está gravado.
  const marcada = feita || (concluindo !== null && concluindo === alvo?.id);
  const podeMexer = admin || (d.criadoPor === eu.id && item.lote.every((x) => !x.feitaEm));
  const prazo = d.prazo ? prazoEmTexto(d.prazo, hoje, feita) : null;
  const feitasNoLote = item.lote.filter((x) => x.feitaEm).length;
  const idsDoCartao = emLote ? item.lote.map((x) => x.id) : [d.id];

  const autor = d.criadoPor === eu.id ? "você" : (d.autor ?? "alguém que saiu");
  const origem = chamado ? `aberto por ${autor}` : d.criadoPor === eu.id ? "criada por você" : `de ${autor}`;
  const quemFez = d.feitaPor === eu.nome ? "você" : (d.feitaPor ?? "alguém que saiu");

  const idDetalhe = `demanda-${d.id}`;

  return (
    <li
      className={`surge relative overflow-hidden rounded-xl border transition-[border-color,box-shadow] ${
        feita
          ? "border-zinc-200/70 bg-white/60 dark:border-zinc-800/70 dark:bg-zinc-900/40"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
      } ${aberto ? "border-zinc-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-zinc-700" : ""}`}
    >
      {alta && (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-red-500 dark:bg-red-500/90" />
      )}

      <div className={`flex items-start gap-3 px-3 ${feita ? "py-2" : "py-2.5"}`}>
        {/* O check. Sem `alvo`, a demanda é de outra pessoa: o círculo fica
            tracejado — dá para ver o estado, não para mudá-lo. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={marcada}
          disabled={!alvo}
          onClick={() => {
            if (!alvo || marcada !== feita) return;
            if (feita) return aoMarcar(alvo.id, false);
            setConcluindo(alvo.id);
            espera.current = setTimeout(() => aoMarcar(alvo.id, true), 280);
          }}
          aria-label={feita ? `Desmarcar “${d.titulo}”` : `Marcar “${d.titulo}” como feita`}
          title={alvo ? (feita ? "Desmarcar" : "Marcar como feita") : "Só quem recebeu dá o check"}
          className={`peer mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition duration-150 active:scale-90 disabled:cursor-default disabled:active:scale-100 ${
            marcada
              ? "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-zinc-950"
              : alvo
                ? "border-zinc-300 text-transparent hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-500 dark:border-zinc-600 dark:hover:bg-emerald-950"
                : "border-dashed border-zinc-300 text-transparent dark:border-zinc-700"
          }`}
        >
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-controls={idDetalhe}
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:focus-visible:ring-zinc-100/10"
        >
          <p
            className={`break-words text-[13px] leading-snug ${
              marcada
                ? "text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-500 dark:decoration-zinc-600"
                : "font-medium text-zinc-900 dark:text-zinc-50"
            }`}
          >
            {d.titulo}
          </p>

          {d.descricao && !aberto && !feita && (
            <p className="mt-0.5 line-clamp-1 text-[12px] text-zinc-500 dark:text-zinc-400">{d.descricao}</p>
          )}

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {chamado && (
              <span className="inline-flex items-center gap-1 font-medium text-sky-700 dark:text-sky-400">
                <LifeBuoy className="size-3" aria-hidden="true" />
                Chamado
              </span>
            )}
            {feita ? (
              <span>
                feita por {quemFez} · {horaDe(d.feitaEm!)}
              </span>
            ) : (
              <>
                {prazo && (
                  <span className={`inline-flex items-center gap-1 ${TOM_PRAZO[prazo.tom]}`}>
                    <CalendarClock className="size-3" aria-hidden="true" />
                    {prazo.texto}
                  </span>
                )}
                {d.prioridade === "alta" && (
                  <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
                    <Flag className="size-3 fill-current" aria-hidden="true" />
                    Alta
                  </span>
                )}
                {d.prioridade === "baixa" && (
                  <span className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
                    <ArrowDown className="size-3" aria-hidden="true" />
                    Baixa
                  </span>
                )}
                {emLote && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" aria-hidden="true" />
                    {feitasNoLote} de {item.lote.length} feitas
                  </span>
                )}
                <span className="text-zinc-400 dark:text-zinc-500">
                  {origem} · {haQuanto(d.dataCriacao, agora, hoje)}
                </span>
              </>
            )}
          </p>
        </button>

        {/* Para quem é — só quando não é para mim, senão é repetir o óbvio. Na
            demanda "para todos", quem AINDA não fez. */}
        {emLote ? (
          <span className="flex shrink-0 -space-x-1.5 pt-px">
            {item.demandas.slice(0, 3).map((x) => (
              <Avatar key={x.id} texto={x.responsavelIniciais ?? "?"} titulo={`Falta: ${x.responsavel ?? "?"}`} />
            ))}
            {item.demandas.length > 3 && (
              <Avatar texto={`+${item.demandas.length - 3}`} titulo={`Faltam mais ${item.demandas.length - 3}`} />
            )}
          </span>
        ) : (
          !ehMinha(d, eu) && (
            <span className="pt-px">
              <Avatar
                texto={chamado ? siglaDe(d.departamento) : (d.responsavelIniciais ?? "?")}
                titulo={`Para ${chamado ? d.departamento : d.responsavel}`}
                feito={feita}
              />
            </span>
          )
        )}
      </div>

      {aberto && (
        <div
          id={idDetalhe}
          className="surge-suave space-y-3 border-t border-zinc-100 pb-3 pl-[42px] pr-3 pt-2.5 dark:border-zinc-800"
        >
          {d.descricao && (
            <p className="whitespace-pre-line break-words text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              {d.descricao}
            </p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
            <dt className="text-zinc-400 dark:text-zinc-500">Para</dt>
            <dd className="text-zinc-700 dark:text-zinc-300">
              {emLote
                ? `${item.lote.length} pessoas, uma demanda para cada`
                : chamado
                  ? `${d.departamento} — qualquer pessoa do departamento`
                  : d.responsavelId === eu.id
                    ? "Você"
                    : d.responsavel}
            </dd>
            <dt className="text-zinc-400 dark:text-zinc-500">{chamado ? "Aberto" : "Criada"}</dt>
            <dd className="text-zinc-700 dark:text-zinc-300">
              {dataHora(d.dataCriacao)} · {autor}
            </dd>
            {d.prazo && (
              <>
                <dt className="text-zinc-400 dark:text-zinc-500">Prazo</dt>
                <dd className="text-zinc-700 dark:text-zinc-300">{diaComSemana(d.prazo, hoje)}</dd>
              </>
            )}
            <dt className="text-zinc-400 dark:text-zinc-500">Prioridade</dt>
            <dd className="text-zinc-700 dark:text-zinc-300">{ROTULO_PRIORIDADE[d.prioridade]}</dd>
            {!emLote && d.feitaEm && (
              <>
                <dt className="text-zinc-400 dark:text-zinc-500">Feita</dt>
                <dd className="text-emerald-700 dark:text-emerald-400">
                  {dataHora(d.feitaEm)} · {quemFez}
                </dd>
              </>
            )}
          </dl>

          {/* Quem já fez e quem falta, na demanda "para todos". */}
          {emLote && (
            <ul className="flex flex-col gap-1.5">
              {[...item.lote]
                .sort((a, b) => Number(Boolean(a.feitaEm)) - Number(Boolean(b.feitaEm)))
                .map((x) => (
                  <li key={x.id} className="flex items-center gap-2 text-[11px]">
                    <Avatar texto={x.responsavelIniciais ?? "?"} titulo={x.responsavel ?? "?"} feito={Boolean(x.feitaEm)} />
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                      {x.responsavelId === eu.id ? "Você" : x.responsavel}
                    </span>
                    {x.feitaEm ? (
                      <span className="text-emerald-700 dark:text-emerald-400">feita · {dataHora(x.feitaEm)}</span>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-500">falta</span>
                    )}
                  </li>
                ))}
            </ul>
          )}

          {podeMexer && (
            <div className="-ml-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => aoEditar(item)}
                className={`${botaoAcao} text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`}
              >
                <Pencil className="size-3" aria-hidden="true" />
                Editar
              </button>
              <button
                type="button"
                onClick={() => (confirmando ? aoExcluir(idsDoCartao) : setConfirmando(true))}
                onBlur={() => setConfirmando(false)}
                className={`${botaoAcao} ${
                  confirmando
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
                }`}
              >
                <Trash2 className="size-3" aria-hidden="true" />
                {confirmando
                  ? emLote
                    ? `Confirmar: excluir das ${item.lote.length} pessoas`
                    : "Confirmar exclusão"
                  : "Excluir"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
