"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Search, UserSearch, X } from "lucide-react";
import type {
  Anotacao,
  CampoPersonalizado,
  Contato,
  Etapa,
  Funil,
  Historico,
  Oportunidade,
  Segmento,
  Tag,
  Usuario,
} from "../data";
import { iniciais } from "../formato";
import { normalizar } from "../filtros-comuns";
import { indexarContatos } from "../contatos/filtros";
import {
  CamposContato,
  ChipsContato,
  SecoesContato,
} from "../contatos/detalhes";
import { CamposDoContato } from "../components/campos-personalizados";

// Gaveta da direita da tela inicial. Dois níveis no MESMO painel: lista de
// contatos → dados do contato clicado (voltar traz a lista de volta). Só
// leitura — quem edita é a ficha em app/contatos/ficha.tsx, hoje sem rota.

const semTags: Tag[] = [];

function Avatar({ nome, grande = false }: { nome: string; grande?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-100 font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 ${
        grande ? "size-10 text-xs" : "size-8 text-[10px]"
      }`}
    >
      {iniciais(nome)}
    </span>
  );
}

export default function GavetaContatos({
  contatos,
  segmentosDoContato,
  tagsDoContato,
  oportunidadesDoContato,
  historicoDoContato,
  anotacoesDoContato,
  etapaPorId,
  funilPorId,
  usuarioPorId,
  camposContato,
  aoAbrirOportunidade,
  aoFechar,
}: {
  contatos: Contato[];
  segmentosDoContato: Map<string, Segmento[]>;
  tagsDoContato: Map<string, Tag[]>;
  oportunidadesDoContato: Map<string, Oportunidade[]>;
  historicoDoContato: Map<string, Historico[]>;
  anotacoesDoContato: Map<string, Anotacao[]>;
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
  camposContato: CampoPersonalizado[];
  aoAbrirOportunidade: (id: string) => void;
  aoFechar: () => void;
}) {
  const [termo, setTermo] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);

  // Mesmo índice da lista de /contatos: normalizar (NFD + regex unicode) é o
  // passo caro e o texto do contato não muda enquanto se digita.
  const indice = useMemo(() => indexarContatos(contatos), [contatos]);

  const visiveis = useMemo(() => {
    const busca = normalizar(termo.trim());
    if (!busca) return contatos;
    return contatos.filter((c) => indice.get(c.id)?.includes(busca));
  }, [contatos, indice, termo]);

  const aberto = useMemo(
    () => contatos.find((c) => c.id === abertoId) ?? null,
    [contatos, abertoId],
  );

  // Esc desce um nível por vez: dos dados volta pra lista, da lista fecha a
  // gaveta. Fechar direto perderia a busca digitada sem o usuário ter pedido.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (abertoId) setAbertoId(null);
      else aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [abertoId, aoFechar]);

  return (
    <>
      {/* mesmo véu da ficha de contatos: escurece o resto e fecha ao clicar */}
      <div
        className="veu-surge fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={aoFechar}
        aria-hidden="true"
      />

      <aside
        className="ficha-entra fixed bottom-4 right-4 top-4 z-50 flex w-[25rem] max-w-[92vw] flex-col overflow-hidden rounded-4xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        aria-label={aberto ? `Dados de ${aberto.nome}` : "Contatos"}
      >
        {aberto ? (
          <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setAbertoId(null)}
              aria-label="Voltar para a lista de contatos"
              className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <Avatar nome={aberto.nome} grande />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {aberto.nome}
              </h2>
              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {aberto.cidade}/{aberto.estado}
              </p>
            </div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar contatos"
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>
        ) : (
          <header className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Contatos
              </h2>
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                {contatos.length}
              </span>
              <button
                type="button"
                onClick={aoFechar}
                aria-label="Fechar contatos"
                className="-mr-1 ml-auto shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Buscar por nome, e-mail, telefone…"
                aria-label="Buscar contato"
                autoFocus
                className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {aberto ? (
            <>
              <CamposContato contato={aberto} />
              <ChipsContato
                segmentos={segmentosDoContato.get(aberto.id) ?? []}
                tags={tagsDoContato.get(aberto.id) ?? semTags}
              />
              <CamposDoContato contatoId={aberto.id} definicoes={camposContato} />
              <SecoesContato
                oportunidades={oportunidadesDoContato.get(aberto.id) ?? []}
                anotacoes={anotacoesDoContato.get(aberto.id) ?? []}
                historico={historicoDoContato.get(aberto.id) ?? []}
                etapaPorId={etapaPorId}
                funilPorId={funilPorId}
                usuarioPorId={usuarioPorId}
                aoAbrirOportunidade={aoAbrirOportunidade}
              />
            </>
          ) : visiveis.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <UserSearch
                className="size-8 text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {contatos.length === 0
                  ? "Nenhum contato na base"
                  : "Nenhum contato com esse termo"}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {contatos.length === 0
                  ? "Contatos entram por /contatos ou pelo webhook do chat."
                  : `Os ${contatos.length} da base continuam aqui — só não batem com a busca.`}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col p-2">
              {visiveis.map((c) => {
                const tags = tagsDoContato.get(c.id) ?? semTags;
                const negocios = oportunidadesDoContato.get(c.id)?.length ?? 0;

                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setAbertoId(c.id)}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100"
                    >
                      <Avatar nome={c.nome} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                          {c.nome}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {c.whatsapp || c.email || `${c.cidade}/${c.estado}`}
                          {tags.length > 0 && ` · ${tags[0].nome}`}
                          {tags.length > 1 && ` +${tags.length - 1}`}
                        </span>
                      </span>
                      {negocios > 0 && (
                        <span
                          title={`${negocios} ${negocios === 1 ? "oportunidade" : "oportunidades"}`}
                          className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                        >
                          {negocios}
                        </span>
                      )}
                      <ChevronRight
                        className="size-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </aside>
    </>
  );
}
