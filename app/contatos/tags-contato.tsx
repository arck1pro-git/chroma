"use client";

// Tags e segmentos do contato, com × para tirar e "+" para pôr. Uma peça só
// para os três lugares que mostram o contato: a ficha de /contatos e as duas
// gavetas da tela inicial (a de contatos e a aba Cliente da oportunidade),
// pedido dele em 2026-10-28 ("no contato e na aba lateral de contato
// adiciona para mudar segmentos e tags").
//
// Segmento cheio, tag com contorno (o mesmo desenho dos Chips da gaveta).
// Depois de gravar chama aoMudar; sem ele, router.refresh(), que é o que faz
// as gavetas da tela inicial buscarem a ficha de novo.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "@/app/components/icones";
import { adicionarSegmento, adicionarTag, removerSegmento, removerTag } from "./actions";

type Item = { id: string; nome: string };

export default function TagsDoContato({
  contatoId,
  tags,
  segmentos,
  todasTags,
  todosSegmentos,
  aoMudar,
  className = "",
}: {
  contatoId: string;
  tags: Item[];
  segmentos: Item[];
  /** As tags e os segmentos que existem, para o "+". */
  todasTags: Item[];
  todosSegmentos: Item[];
  aoMudar?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  const tagsLivres = todasTags.filter((t) => !tags.some((x) => x.id === t.id));
  const segmentosLivres = todosSegmentos.filter((s) => !segmentos.some((x) => x.id === s.id));

  function executar(acao: () => Promise<unknown>) {
    setAviso(null);
    iniciar(async () => {
      try {
        await acao();
        if (aoMudar) aoMudar();
        else router.refresh();
      } catch (e) {
        console.error("[contatos] tag ou segmento não gravou:", e);
        setAviso("Não deu certo. Confira se você pode editar contatos.");
      }
    });
  }

  return (
    <div className={className}>
      <div className={`flex flex-wrap items-center gap-1.5 transition ${pendente ? "opacity-60" : ""}`}>
        {segmentos.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-900 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            {s.nome}
            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => removerSegmento(contatoId, s.id))}
              aria-label={`Tirar do segmento ${s.nome}`}
              className="rounded-full p-0.5 opacity-50 transition hover:opacity-100"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-300 dark:ring-zinc-700">
            {t.nome}
            <button
              type="button"
              disabled={pendente}
              onClick={() => executar(() => removerTag(contatoId, t.id))}
              aria-label={`Tirar a tag ${t.nome}`}
              className="rounded-full p-0.5 opacity-50 transition hover:opacity-100"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {tagsLivres.length + segmentosLivres.length > 0 ? (
          <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-200 transition hover:text-zinc-900 hover:ring-zinc-300 dark:text-zinc-500 dark:ring-zinc-800 dark:hover:text-zinc-50">
            <Plus className="size-3" aria-hidden="true" />
            {tags.length + segmentos.length ? "" : "tag ou segmento"}
            <select
              value=""
              disabled={pendente}
              onChange={(e) => {
                const [tipo, id] = e.target.value.split(":");
                if (tipo === "tag") executar(() => adicionarTag(contatoId, id));
                if (tipo === "segmento") executar(() => adicionarSegmento(contatoId, id));
              }}
              aria-label="Adicionar tag ou segmento"
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="" disabled>
                Adicionar…
              </option>
              {tagsLivres.length > 0 && (
                <optgroup label="Tags">
                  {tagsLivres.map((t) => (
                    <option key={t.id} value={`tag:${t.id}`}>
                      {t.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              {segmentosLivres.length > 0 && (
                <optgroup label="Segmentos">
                  {segmentosLivres.map((s) => (
                    <option key={s.id} value={`segmento:${s.id}`}>
                      {s.nome}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        ) : tags.length + segmentos.length === 0 ? (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Sem tags — crie em Configurações</span>
        ) : null}
      </div>
      {aviso && (
        <p role="alert" className="mt-1.5 text-[11.5px] text-red-500 dark:text-red-400">
          {aviso}
        </p>
      )}
    </div>
  );
}
