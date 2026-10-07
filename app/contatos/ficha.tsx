"use client";

// A ficha do contato. Três camadas, de cima para baixo, na ordem em que quem
// atende precisa delas:
//
//   1. QUEM É e ONDE ESTÁ — o cabeçalho: o nome, a etapa de agora com a régua
//      do funil, o contato com cópia num clique, tags e segmentos.
//   2. COMO CHEGOU ATÉ AQUI — a jornada (./jornada.tsx), do anúncio à etapa.
//   3. O QUE ACONTECEU e O QUE CONSULTAR — o feed com anotar no topo
//      (./atividade.tsx) e, ao lado, o que se consulta (./lateral.tsx).
//
// A primeira versão eram nove cartões do mesmo peso empilhados; esta conta a
// história do lead. Os dados vêm de lib/contatos-ficha.ts.
//
// Ações: a única com moldura é Conversar (o que mais se faz depois de ler a
// ficha). Editar é um ícone; excluir mora no menu "mais", em dois passos.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Clock, Mail, MapPin, MessagesSquare, MoreHorizontal, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import type { EtapaComTom, FichaContato } from "@/lib/contatos-ficha";
import type { Ia } from "@/lib/ia/catalogo";
import type { CampoPersonalizado, Etapa, Funil } from "../data";
import { iniciais } from "../formato";
import CamadaTopo from "../components/camada-topo";
import FormContato from "./form-contato";
import {
  adicionarSegmento,
  adicionarTag,
  atualizarContato,
  excluirContato,
  removerSegmento,
  removerTag,
} from "./actions";
import Atividade from "./atividade";
import Jornada from "./jornada";
import Lateral from "./lateral";
import { Copiar, haQuanto, ReguaDoFunil, telefone } from "./pecas";

export type ContextoDaFicha = {
  etapas: Record<string, EtapaComTom>;
  etapasCompletas: Etapa[];
  funis: Funil[];
  tags: { id: string; nome: string }[];
  segmentos: { id: string; nome: string }[];
  camposContato: CampoPersonalizado[];
  usuarios: { id: string; nome: string; iniciais: string }[];
  ias: Ia[];
};

const botaoIcone =
  "rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

export default function Ficha({
  ficha,
  contexto,
  aoMudar,
  aoExcluir,
}: {
  ficha: FichaContato;
  contexto: ContextoDaFicha;
  /** Algo mudou na ficha (nota, tag, edição): recarregar. */
  aoMudar: () => void;
  /** O contato foi excluído. */
  aoExcluir: () => void;
}) {
  const [pendente, iniciar] = useTransition();
  const [editando, setEditando] = useState(false);
  const [menu, setMenu] = useState<"fechado" | "aberto" | "excluir">("fechado");
  const [aviso, setAviso] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { contato, oportunidades, conversas } = ficha;
  const { etapas } = contexto;

  // O menu fecha ao clicar fora — e volta do passo de excluir para fechado.
  useEffect(() => {
    if (menu === "fechado") return;
    const fora = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu("fechado");
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [menu]);

  function executar(acao: () => Promise<unknown>, depois?: () => void) {
    setAviso(null);
    iniciar(async () => {
      try {
        await acao();
        depois?.();
        aoMudar();
      } catch (e) {
        setAviso(e instanceof Error ? e.message : "Não deu certo.");
      }
    });
  }

  const nomeDoAutor = (id: string) => contexto.usuarios.find((u) => u.id === id)?.nome ?? "alguém da equipe";

  const aberta = oportunidades.find((o) => o.status === "aberta");
  const etapaAtual = aberta ? etapas[aberta.etapaId] : null;
  const fechada = !aberta ? oportunidades.find((o) => o.status === "ganha" || o.status === "perdida") : null;
  const conversaRecente = conversas[0];
  const local = [[contato.cidade, contato.estado].filter(Boolean).join("/"), contato.pais && contato.pais !== "Brasil" ? contato.pais : ""]
    .filter(Boolean)
    .join(" · ");

  const tagsLivres = contexto.tags.filter((t) => !ficha.tags.some((x) => x.id === t.id));
  const segmentosLivres = contexto.segmentos.filter((s) => !ficha.segmentos.some((x) => x.id === s.id));

  return (
    <section className="min-w-0 flex-1 overflow-y-auto" aria-label={`Ficha de ${contato.nome}`}>
      {/* ── 1. Quem é e onde está ── */}
      <header className="border-b border-zinc-200 px-6 pb-5 pt-6 dark:border-zinc-800">
        <div className="flex items-start gap-4">
          <span className="relative shrink-0">
            <span className="flex size-14 items-center justify-center rounded-full bg-zinc-900 text-[17px] font-semibold tracking-tight text-white dark:bg-zinc-100 dark:text-zinc-900">
              {iniciais(contato.nome || "?")}
            </span>
            {etapaAtual && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-[3px] ring-white dark:ring-zinc-950 ${etapaAtual.cor}`}
                title={etapaAtual.nome}
                aria-hidden="true"
              />
            )}
          </span>

          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
              {contato.nome || "Sem nome"}
            </h1>

            <div className="mt-1.5 flex min-w-0 items-center gap-2.5 text-[13px]">
              {aberta && etapaAtual ? (
                <>
                  <ReguaDoFunil etapaId={aberta.etapaId} etapas={etapas} largura="w-28" />
                  <span className="truncate">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{etapaAtual.nome}</span>
                    <span className="text-zinc-400 dark:text-zinc-500"> · {etapaAtual.funil}</span>
                  </span>
                </>
              ) : fechada ? (
                <span className={`font-medium ${fechada.status === "ganha" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}`}>
                  {fechada.status === "ganha" ? "Negócio ganho" : "Negócio perdido"}
                </span>
              ) : (
                <span className="text-zinc-400 dark:text-zinc-500">Sem oportunidade aberta</span>
              )}
            </div>

            <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
              {contato.whatsapp && (
                <li className="group flex items-center gap-1.5">
                  <Phone className="size-3.5 text-zinc-400" aria-hidden="true" />
                  <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{telefone(contato.whatsapp)}</span>
                  <Copiar texto={contato.whatsapp.replace(/\D/g, "")} rotulo="WhatsApp" />
                </li>
              )}
              {contato.email && (
                <li className="group flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                  <span className="truncate text-zinc-700 dark:text-zinc-300">{contato.email}</span>
                  <Copiar texto={contato.email} rotulo="e-mail" />
                </li>
              )}
              {local && (
                <li className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-zinc-400" aria-hidden="true" />
                  {local}
                </li>
              )}
              <li className="flex items-center gap-1.5" suppressHydrationWarning>
                <Clock className="size-3.5 text-zinc-400" aria-hidden="true" />
                no CRM {haQuanto(contato.dataCriacao)}
              </li>
            </ul>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {conversaRecente && (
              <Link
                href={`/chat?atendimento=${conversaRecente.id}`}
                className="mr-1.5 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                <MessagesSquare className="size-3.5" aria-hidden="true" />
                Conversar
              </Link>
            )}
            <button type="button" onClick={() => setEditando(true)} className={botaoIcone} aria-label="Editar contato" title="Editar contato">
              <Pencil className="size-4" aria-hidden="true" />
            </button>
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenu((m) => (m === "fechado" ? "aberto" : "fechado"))}
                aria-haspopup="menu"
                aria-expanded={menu !== "fechado"}
                aria-label="Mais ações"
                className={botaoIcone}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </button>
              {menu !== "fechado" && (
                <div
                  role="menu"
                  className="surge absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {menu === "aberto" ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setMenu("excluir")}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Excluir contato…
                    </button>
                  ) : (
                    <div className="p-1.5">
                      <p className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                        Apaga o contato com conversas, anotações e histórico. Com oportunidade no funil, o CRM recusa.
                      </p>
                      <div className="mt-2.5 flex gap-1.5">
                        <button
                          type="button"
                          disabled={pendente}
                          onClick={() =>
                            executar(async () => {
                              const r = await excluirContato(contato.id);
                              if (!r.ok) throw new Error(r.erro ?? "Não consegui excluir.");
                            }, aoExcluir)
                          }
                          className="flex-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
                        >
                          Excluir de vez
                        </button>
                        <button
                          type="button"
                          onClick={() => setMenu("fechado")}
                          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Segmentos (cheios) e tags (contorno), com × e o "+" — sem uma seção
            só para eles: são do contato, moram junto do nome. */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 pl-[72px]">
          {ficha.segmentos.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-900 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              {s.nome}
              <button type="button" onClick={() => executar(() => removerSegmento(contato.id, s.id))} aria-label={`Tirar do segmento ${s.nome}`} className="rounded-full p-0.5 opacity-50 transition hover:opacity-100">
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {ficha.tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-300 dark:ring-zinc-700">
              {t.nome}
              <button type="button" onClick={() => executar(() => removerTag(contato.id, t.id))} aria-label={`Tirar a tag ${t.nome}`} className="rounded-full p-0.5 opacity-50 transition hover:opacity-100">
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {tagsLivres.length + segmentosLivres.length > 0 ? (
            <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-200 transition hover:text-zinc-900 hover:ring-zinc-300 dark:text-zinc-500 dark:ring-zinc-800 dark:hover:text-zinc-50">
              <Plus className="size-3" aria-hidden="true" />
              {ficha.tags.length + ficha.segmentos.length ? "" : "tag ou segmento"}
              <select
                value=""
                onChange={(e) => {
                  const [tipo, id] = e.target.value.split(":");
                  if (tipo === "tag") executar(() => adicionarTag(contato.id, id));
                  if (tipo === "segmento") executar(() => adicionarSegmento(contato.id, id));
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
          ) : ficha.tags.length + ficha.segmentos.length === 0 ? (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Sem tags — crie em Configurações</span>
          ) : null}
        </div>

        {aviso && (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {aviso}
          </p>
        )}
      </header>

      {/* ── 2. Como chegou até aqui ── */}
      <Jornada ficha={ficha} etapas={etapas} />

      {/* ── 3. O que aconteceu, e o que consultar ──
          Container query: as duas colunas dependem da largura DA FICHA (que
          divide a tela com a barra e a lista), não da janela. */}
      <div className="@container">
        <div className="grid gap-x-10 gap-y-8 px-6 py-6 @min-[50rem]:grid-cols-[minmax(0,1fr)_18.5rem]">
          <Atividade ficha={ficha} nomeDoAutor={nomeDoAutor} aoMudar={aoMudar} />
          <Lateral
            ficha={ficha}
            etapas={etapas}
            etapasCompletas={contexto.etapasCompletas}
            funis={contexto.funis}
            camposContato={contexto.camposContato}
            ias={contexto.ias}
          />
        </div>
      </div>

      {editando && (
        <CamadaTopo>
          <FormContato
            inicial={{
              nome: contato.nome,
              email: contato.email,
              whatsapp: contato.whatsapp,
              cidade: contato.cidade,
              estado: contato.estado,
              pais: contato.pais,
            }}
            aoSalvar={(dados) => executar(() => atualizarContato(contato.id, dados), () => setEditando(false))}
            aoFechar={() => setEditando(false)}
          />
        </CamadaTopo>
      )}
    </section>
  );
}

/** Enquanto a ficha chega: o nome já (vem da lista) e o resto em esboço. */
export function FichaCarregando({ nome }: { nome: string }) {
  return (
    <section className="min-w-0 flex-1 overflow-hidden" aria-busy="true" aria-label={`Abrindo ${nome}`}>
      <header className="border-b border-zinc-200 px-6 pb-5 pt-6 dark:border-zinc-800">
        <div className="flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[17px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
            {iniciais(nome || "?")}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">{nome || "Sem nome"}</h1>
            <div className="mt-2.5 h-3 w-56 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
            <div className="mt-3 h-3 w-80 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
          </div>
        </div>
      </header>
      <div className="space-y-4 px-6 py-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="size-7 shrink-0 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-3 w-1/3 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-900" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
