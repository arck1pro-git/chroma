"use client";

// O painel do contato, à direita da conversa: quem é, por quais números ele
// fala com a empresa, e as oportunidades dele.
//
// "Também conversa com" existe porque o mesmo cliente pode estar no comercial
// E numa automação ao mesmo tempo — e quem responde precisa saber que há outra
// conversa correndo antes de prometer algo.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, Mail, MapPin, Phone, Plus, Wallet, X } from "lucide-react";
import type { Etapa, Funil } from "../data";
import { brl, localizacao } from "../formato";
import { InterruptorIaContato } from "../components/interruptor-ia-contato";
import type { IaResumo } from "@/lib/ia/catalogo";
import type { CanalChat, ConversaAberta } from "./tipos";
import { Avatar, PAPEL, canalDaConversa, formatarTelefone, fotoDoContato, tipoDaConversa } from "./ui";

export function PainelDetalhes({
  aberta,
  canais,
  funis,
  etapas,
  demo,
  aoFechar,
  aoIrPara,
  aoNovaOportunidade,
  ias,
  aoDefinirIa,
}: {
  ias: IaResumo[];
  aoDefinirIa: (valor: boolean | null, iaId: string | null) => Promise<{ erro?: string }>;
  aberta: ConversaAberta;
  canais: CanalChat[];
  funis: Funil[];
  etapas: Etapa[];
  demo: boolean;
  aoFechar: () => void;
  aoIrPara: (atendimentoId: string) => void;
  aoNovaOportunidade: () => void;
}) {
  const { contato, resumo, oportunidades, outras } = aberta;
  const [copiado, setCopiado] = useState(false);
  const etapaPorId = new Map(etapas.map((e) => [e.id, e]));
  const funilPorId = new Map(funis.map((f) => [f.id, f]));
  const nome = /^[\d\s+()-]+$/.test(contato.nome) ? formatarTelefone(contato.nome) : contato.nome;
  const lugar = localizacao(contato, true);

  function copiar() {
    navigator.clipboard?.writeText((contato.whatsapp ?? "").replace(/\D/g, "")).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  }

  return (
    <aside
      className="veu-surge absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-zinc-200 bg-white shadow-2xl sm:w-[320px] dark:border-zinc-800 dark:bg-zinc-950"
      aria-label="Dados do contato"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Contato</span>
        <button type="button" onClick={aoFechar} aria-label="Fechar" className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-2 border-b border-zinc-100 px-5 py-6 text-center dark:border-zinc-900">
          <Avatar nome={contato.nome} src={fotoDoContato(contato.id, resumo.numero_instancia, demo)} tamanho={84} />
          <p className="mt-1 text-[16px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{nome}</p>
          {contato.whatsapp && (
            <button
              type="button"
              onClick={copiar}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] tabular-nums text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="Copiar número"
            >
              {formatarTelefone(contato.whatsapp)}
              {copiado ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3 opacity-60" />}
            </button>
          )}
        </div>

        <dl className="flex flex-col gap-3 border-b border-zinc-100 px-5 py-4 text-[12.5px] dark:border-zinc-900">
          {contato.email && (
            <Linha Icone={Mail} rotulo="E-mail">
              <a href={`mailto:${contato.email}`} className="truncate text-zinc-800 hover:underline dark:text-zinc-200">{contato.email}</a>
            </Linha>
          )}
          {lugar && (
            <Linha Icone={MapPin} rotulo="Local">
              <span className="text-zinc-800 dark:text-zinc-200">{lugar}</span>
            </Linha>
          )}
          <Linha Icone={Phone} rotulo="Nesta conversa">
            <CanalLinha canal={canalDaConversa(canais, resumo)} tipo={tipoDaConversa(resumo)} />
          </Linha>
        </dl>

        <section className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-900">
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Atendimento por IA</h3>
          <InterruptorIaContato
            estado={aberta.ia}
            ias={ias}
            aoDefinir={aoDefinirIa}
            desabilitado={demo}
          />
        </section>

        {outras.length > 0 && (
          <section className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-900">
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Também conversa com</h3>
            <ul className="flex flex-col gap-1">
              {outras.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => aoIrPara(o.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <CanalLinha canal={canalDaConversa(canais, o)} tipo={tipoDaConversa(o)} />
                    <span className="shrink-0 text-[10.5px] text-zinc-400">
                      {o.status === "encerrado" ? "encerrada" : o.status === "na_fila" ? "na fila" : "aberta"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">Oportunidades</h3>
            <button
              type="button"
              onClick={aoNovaOportunidade}
              disabled={demo}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <Plus className="size-3" /> Nova
            </button>
          </div>
          {oportunidades.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-[12px] text-zinc-400 dark:border-zinc-800">
              Nenhuma oportunidade para este contato.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {oportunidades.map((o) => {
                const et = etapaPorId.get(o.etapa_id);
                return (
                  <li key={o.id}>
                    <Link
                      href={`/?op=${o.id}`}
                      className="flex items-center gap-2.5 rounded-xl border border-zinc-200 px-3 py-2 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                      <Wallet className="size-3.5 shrink-0 text-zinc-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-zinc-900 dark:text-zinc-50">{o.nome}</span>
                        <span className="flex items-center gap-1.5 truncate text-[11px] text-zinc-500">
                          {et && <span className={`size-1.5 shrink-0 rounded-full ${et.cor}`} />}
                          {et ? `${funilPorId.get(o.funil_id)?.nome ?? ""} · ${et.nome}` : "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-zinc-600 dark:text-zinc-300">{brl(o.valor)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

function Linha({
  Icone,
  rotulo,
  children,
}: {
  Icone: typeof Mail;
  rotulo: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icone className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1">
        <dt className="text-[10.5px] text-zinc-400">{rotulo}</dt>
        <dd className="flex min-w-0">{children}</dd>
      </div>
    </div>
  );
}

function CanalLinha({ canal, tipo }: { canal: CanalChat | undefined; tipo: "web" | "api" }) {
  const papel = PAPEL[tipo];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${papel.chip}`}>
        <papel.Icone className="size-2.5" />
        {papel.rotulo}
      </span>
      <span className="truncate text-[12px] text-zinc-700 dark:text-zinc-300">{canal ? canal.nome : "número removido"}</span>
    </span>
  );
}
