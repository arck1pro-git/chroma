"use client";

import {
  AtSign,
  CalendarDays,
  ChevronRight,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type {
  Anotacao,
  Contato,
  Etapa,
  Funil,
  Historico,
  Oportunidade,
  Segmento,
  Tag,
  Usuario,
} from "../data";
import { brl, dataCurta, dataHora } from "../formato";

// Partes SÓ DE LEITURA da ficha do contato, separadas para a gaveta da tela
// inicial mostrar os mesmos dados sem herdar o resto da ficha (edição, véu,
// painel flutuante, atalho de Esc). Quem edita continua sendo ficha.tsx —
// aqui não há nenhuma server action.

function Secao({
  Icone,
  titulo,
  contagem,
  children,
}: {
  Icone: LucideIcon;
  titulo: string;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        <Icone className="size-3.5" aria-hidden="true" />
        {titulo}
        {contagem !== undefined && contagem > 0 && (
          <span className="tabular-nums text-zinc-300 dark:text-zinc-600">
            {contagem}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
      {children}
    </p>
  );
}

function Campo({
  Icone,
  children,
}: {
  Icone: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-300">
      <Icone className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </p>
  );
}

// Dados de cadastro: contato, canais e quando entrou na base.
export function CamposContato({ contato }: { contato: Contato }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <Campo Icone={Phone}>{contato.whatsapp || "—"}</Campo>
      <Campo Icone={AtSign}>{contato.email || "—"}</Campo>
      <Campo Icone={MapPin}>
        {contato.cidade}/{contato.estado} · {contato.pais}
      </Campo>
      <Campo Icone={CalendarDays}>
        Criado em {dataCurta(contato.data_criacao)}
      </Campo>
    </div>
  );
}

// Segmentos (chip escuro) e tags (chip vazado). Sem nenhum vínculo não rende
// nada — a faixa vazia só abriria um buraco entre os campos e as seções.
export function ChipsContato({
  segmentos,
  tags,
}: {
  segmentos: Segmento[];
  tags: Tag[];
}) {
  if (segmentos.length === 0 && tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-5 pb-4">
      {segmentos.map((s) => (
        <span
          key={s.id}
          className="surge rounded-full bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          {s.nome}
        </span>
      ))}
      {tags.map((t) => (
        <span
          key={t.id}
          className="surge rounded-full px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700"
        >
          {t.nome}
        </span>
      ))}
    </div>
  );
}

// Oportunidades, anotações e histórico do contato.
//
// `aoAbrirOportunidade` é opcional: onde o host sabe abrir a ficha da
// oportunidade (a tela inicial), cada linha vira botão; onde não sabe, vira
// texto. Antes era um link pra /funil?op=, rota que não existe mais — tudo
// mora na raiz agora.
export function SecoesContato({
  oportunidades,
  anotacoes,
  historico,
  etapaPorId,
  funilPorId,
  usuarioPorId,
  aoAbrirOportunidade,
}: {
  oportunidades: Oportunidade[];
  anotacoes: Anotacao[];
  historico: Historico[];
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
  aoAbrirOportunidade?: (id: string) => void;
}) {
  return (
    <>
      <Secao Icone={Wallet} titulo="Oportunidades" contagem={oportunidades.length}>
        {oportunidades.length === 0 ? (
          <Vazio>Nenhuma oportunidade para este contato</Vazio>
        ) : (
          <ul className="flex flex-col gap-2">
            {oportunidades.map((o) => {
              const etapa = etapaPorId.get(o.etapa_id);
              const funil = funilPorId.get(o.funil_id);

              const conteudo = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
                      {o.nome}
                    </p>
                    <p className="flex shrink-0 items-center gap-1 text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                      {brl(o.valor)}
                      {aoAbrirOportunidade && (
                        <ChevronRight
                          className="size-3.5 text-zinc-300 transition group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-400"
                          aria-hidden="true"
                        />
                      )}
                    </p>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className={`size-1.5 rounded-full ${etapa?.cor}`} aria-hidden="true" />
                    <span className="truncate">
                      {funil?.nome} · {etapa?.nome}
                    </span>
                    {o.status !== "aberta" && (
                      <span className="ml-auto shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        {o.status}
                      </span>
                    )}
                  </p>
                </>
              );

              return (
                <li key={o.id}>
                  {aoAbrirOportunidade ? (
                    <button
                      type="button"
                      onClick={() => aoAbrirOportunidade(o.id)}
                      className="group block w-full rounded-xl border border-zinc-200 p-3 text-left outline-none transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50 dark:focus-visible:ring-zinc-100"
                    >
                      {conteudo}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                      {conteudo}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      <Secao Icone={MessageSquare} titulo="Anotações" contagem={anotacoes.length}>
        {anotacoes.length === 0 ? (
          <Vazio>Nada anotado sobre este contato</Vazio>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {anotacoes.map((a) => (
              <li
                key={a.id}
                className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-inset ring-amber-100 dark:bg-amber-500/5 dark:ring-amber-500/15"
              >
                <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
                  {a.texto}
                </p>
                <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {usuarioPorId.get(a.autor_id)?.nome ?? "Autor desconhecido"} ·{" "}
                  {dataHora(a.data_criacao)}
                  {/* anotação se edita (o histórico não) — marcar isso evita
                      discussão sobre "eu não escrevi assim" */}
                  {a.data_atualizacao && " · editada"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao Icone={Clock} titulo="Histórico" contagem={historico.length}>
        {historico.length === 0 ? (
          <Vazio>Sem movimentações registradas</Vazio>
        ) : (
          <ul className="flex flex-col">
            {historico.map((h, i) => (
              <li key={h.id} className="flex gap-3">
                {/* a linha vertical liga os pontos, menos no último item */}
                <div className="flex flex-col items-center">
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600"
                    aria-hidden="true"
                  />
                  {i < historico.length - 1 && (
                    <span
                      className="w-px flex-1 bg-zinc-200 dark:bg-zinc-800"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="pb-4">
                  <p className="text-[13px] leading-snug text-zinc-700 dark:text-zinc-200">
                    {h.descricao}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {usuarioPorId.get(h.autor_id)?.nome ?? "Sistema"} ·{" "}
                    {dataHora(h.data_criacao)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </>
  );
}
