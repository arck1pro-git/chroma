import { Clock, User } from "lucide-react";
import type { Contato, Oportunidade, Tag, Usuario } from "../data";
import { brl } from "../formato";

// Cartão de oportunidade do kanban. Fica fora de funil.tsx porque a tela
// inicial monta o mesmo quadro em modo leitura — os dois lugares têm que
// mostrar o card idêntico, senão a home vira um segundo desenho pra manter.
//
// Recebe contato/responsável/tags já resolvidos em vez dos Maps: quem sabe de
// onde vêm é o quadro (contexto no funil, props na home).
export default function CartaoOportunidade({
  oportunidade,
  contato,
  responsavel,
  tags,
  arrastando = false,
}: {
  oportunidade: Oportunidade;
  contato?: Contato;
  responsavel?: Usuario;
  tags: Tag[];
  arrastando?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 dark:bg-zinc-900 ${
        arrastando
          ? "border-zinc-300 shadow-lg dark:border-zinc-600"
          : "border-zinc-200 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
      }`}
    >
      <h3 className="text-sm font-semibold leading-5 text-zinc-900 dark:text-zinc-50">
        {oportunidade.nome}
      </h3>

      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <User className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {contato?.nome}
          {contato && (
            <span className="text-zinc-400 dark:text-zinc-500">
              {" · "}
              {contato.cidade}/{contato.estado}
            </span>
          )}
        </span>
      </p>

      <p className="mt-3 text-base font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
        {brl(oportunidade.valor)}
      </p>

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {tags.slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700"
            >
              {t.nome}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="px-1 py-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
              +{tags.length - 2}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <span className="inline-flex items-center gap-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          {oportunidade.dias_na_etapa}{" "}
          {oportunidade.dias_na_etapa === 1 ? "dia" : "dias"} na etapa
        </span>
        <span
          className="flex size-6 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          title={`Responsável: ${responsavel?.nome ?? "sem responsável"}`}
        >
          {responsavel?.iniciais ?? "—"}
        </span>
      </div>
    </div>
  );
}
