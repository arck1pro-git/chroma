"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  ListTree,
  LogIn,
  Pencil,
  Search,
  Send,
  Trash2,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { dataHora } from "../formato";
import FluxoComMetricas from "./fluxo-metricas";
import { ExecucoesPorDia } from "./graficos";
import {
  buscarContatosParaInscrever,
  desinscreverDaAutomacao,
  dispararParaSegmento,
  excluirFluxo,
  inscreverNaAutomacao,
} from "./acoes";
import { VERSAO_COMPILADOR } from "@/lib/automacoes/compilador";
import type { DetalheFluxo, Fluxo, SegmentoParaDisparo } from "./dados";

type Aba = "visao" | "inscritos" | "execucoes";

const ABAS: { id: Aba; rotulo: string; Icone: LucideIcon }[] = [
  { id: "visao", rotulo: "Visao geral", Icone: ListTree },
  { id: "inscritos", rotulo: "Inscritos", Icone: Users },
  { id: "execucoes", rotulo: "Execucoes", Icone: Clock },
];

// Rótulo de cada estado de inscrição, no vocabulário de quem olha a lista. O
// estado cru ('pendente') responde à pergunta do motor; este responde à de quem
// quer saber se a pessoa ainda vai receber mensagem.
const ESTADO_INSCRITO: Record<string, { rotulo: string; classe: string }> = {
  pendente: {
    rotulo: "Entrando",
    classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  },
  rodando: {
    rotulo: "Rodando",
    classe:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  esperando: {
    rotulo: "Esperando",
    classe: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  },
  pausada: {
    rotulo: "Pausado",
    classe: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

// De onde veio a inscrição. Responde "por que esta pessoa está recebendo isto?"
// — a pergunta que aparece quando alguém reclama de ter recebido mensagem.
const ORIGEM: Record<string, string> = {
  manual: "à mão",
  segmento: "segmento",
  etapa: "cadência da etapa",
  api: "webhook",
  lista: "lista",
  fluxo: "outro fluxo",
};

function Kpi({
  rotulo,
  valor,
  detalhe,
  atencao,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  atencao?: boolean;
}) {
  return (
    <div className="surge rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </p>
      {/* Figura proporcional, não tabular: em tamanho grande o tabular deixa
          números como 121 com espaçamento frouxo. */}
      <p
        className={`mt-1 text-xl font-semibold tracking-tight ${
          atencao
            ? "text-rose-600 dark:text-rose-400"
            : "text-zinc-900 dark:text-zinc-50"
        }`}
      >
        {valor}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {detalhe}
      </p>
    </div>
  );
}

function Bloco({
  titulo,
  Icone,
  contagem,
  children,
}: {
  titulo: string;
  Icone: LucideIcon;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        <Icone className="size-3.5" aria-hidden="true" />
        {titulo}
        {contagem !== undefined && (
          <span className="tabular-nums text-zinc-300 dark:text-zinc-600">
            {contagem}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

function VisaoGeral({ detalhe }: { detalhe: DetalheFluxo }) {
  const total = detalhe.porDia.reduce((s, d) => s + d.sucesso + d.erro, 0);
  const erros = detalhe.porDia.reduce((s, d) => s + d.erro, 0);
  const taxa = total > 0 ? Math.round(((total - erros) / total) * 100) : 0;

  const comDuracao = detalhe.execucoes.filter((e) => e.duracao_ms !== null);
  const media =
    comDuracao.length > 0
      ? Math.round(
          comDuracao.reduce((s, e) => s + (e.duracao_ms ?? 0), 0) /
            comDuracao.length,
        )
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          rotulo="Execuções"
          valor={String(total)}
          detalhe="Últimos 14 dias"
        />
        <Kpi
          rotulo="Taxa de sucesso"
          valor={total > 0 ? `${taxa}%` : "—"}
          detalhe={`${erros} ${erros === 1 ? "falha" : "falhas"}`}
          atencao={taxa > 0 && taxa < 90}
        />
        <Kpi
          rotulo="Duração média"
          valor={media !== null ? `${(media / 1000).toFixed(1)}s` : "—"}
          detalhe="Da entrada ao fim"
        />
        <Kpi
          rotulo="Leads no fluxo"
          valor={String(detalhe.leads.length)}
          detalhe="Parados numa espera"
        />
      </div>

      <Bloco titulo="Execuções por dia" Icone={Clock}>
        <ExecucoesPorDia dados={detalhe.porDia} />
      </Bloco>

      {/* Largura cheia: é um canvas, não um cartão de lista — espremido em meia
          coluna os ramos do "Se" não cabem lado a lado. */}
      <Bloco titulo="Execuções por bloco" Icone={ListTree}>
        <FluxoComMetricas detalhe={detalhe} />
      </Bloco>

      <div className="grid grid-cols-1 gap-3">
        <Bloco
          titulo="Leads dentro do fluxo"
          Icone={Users}
          contagem={detalhe.leads.length}
        >
          {detalhe.leads.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
              Ninguém parado neste fluxo
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {detalhe.leads.map((l) => (
                <li
                  key={l.execucao_id}
                  className="flex items-center gap-2.5 rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800"
                >
                  <Hourglass
                    className="size-3.5 shrink-0 text-amber-500"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-zinc-900 dark:text-zinc-50">
                      {l.contato_nome}
                    </p>
                    <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                      Em “{l.rotulo_no}” desde {dataHora(l.parado_desde)}
                    </p>
                  </div>
                  {l.retomar_em && (
                    <p className="shrink-0 text-right text-[10px] text-zinc-400 dark:text-zinc-500">
                      retoma
                      <br />
                      {dataHora(l.retomar_em)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Bloco>
      </div>
    </div>
  );
}

// ── A lista de inscritos ────────────────────────────────────────────────────
//
// Não existe tabela de lista: inscrever É criar a execução, então esta tela é a
// leitura das execuções vivas. É por isso que cada linha mostra o ESTADO —
// "dentro" não é um sim/não, é em que ponto da cadência a pessoa está.
function Inscritos({
  fluxo,
  detalhe,
}: {
  fluxo: Fluxo;
  detalhe: DetalheFluxo;
}) {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [saindo, remover] = useTransition();

  // O workflow que está no n8n é o que foi compilado na publicação. Publicado
  // antes da guarda de inscrição existir, ele não consulta o CRM entre um passo
  // e outro — e aí desinscrever marca o banco e a mensagem sai do mesmo jeito.
  // Dizer isso é obrigatório: um botão que promete parar e não para é pior que
  // botão nenhum.
  const motorDesatualizado =
    detalhe.versaoNoMotor !== null &&
    detalhe.versaoNoMotor !== VERSAO_COMPILADOR;

  return (
    <div className="flex flex-col gap-3">
      {motorDesatualizado && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Este fluxo foi publicado por uma versão anterior do compilador
            (v{detalhe.versaoNoMotor}). Nela o motor não confere a inscrição
            antes de enviar, então tirar alguém daqui <strong>não impede</strong>{" "}
            a mensagem já agendada. Publique de novo para fechar isso.
          </span>
        </p>
      )}

      {fluxo.entidade_alvo === "contato" ? (
        <InscreverContato fluxo={fluxo} aoAvisar={setAviso} />
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Automação de oportunidade: quem entra são cards, e a inscrição sai do
          funil ou da cadência da etapa. Aqui dá para ver quem está dentro e
          tirar.
        </p>
      )}

      {aviso && (
        <p
          className={`text-[11px] ${
            aviso.ok
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-500"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      {detalhe.inscritos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-16 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          Ninguém inscrito nesta automação
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {detalhe.inscritos.map((i, ordem) => {
              const selo = ESTADO_INSCRITO[i.estado] ?? {
                rotulo: i.estado,
                classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
              };
              return (
                <li
                  key={i.execucao_id}
                  style={{ animationDelay: `${Math.min(ordem, 6) * 14}ms` }}
                  className="surge-suave flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                      {i.nome}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      Entrou {dataHora(i.iniciado_em)} · {ORIGEM[i.origem] ?? i.origem}
                      {i.origem_nome && ` “${i.origem_nome}”`}
                      {i.retomar_em && ` · retoma ${dataHora(i.retomar_em)}`}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${selo.classe}`}
                  >
                    {selo.rotulo}
                  </span>

                  <button
                    type="button"
                    disabled={saindo}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Tirar ${i.nome} desta automação? A inscrição é cancelada e as mensagens que faltavam não são enviadas. O que já saiu continua no histórico.`,
                        )
                      ) {
                        return;
                      }
                      remover(async () => {
                        const r = await desinscreverDaAutomacao(
                          fluxo.id,
                          i.entidade_tipo,
                          i.entidade_id,
                        );
                        setAviso({
                          ok: r.ok,
                          texto: r.ok ? r.mensagem : r.erro,
                        });
                      });
                    }}
                    aria-label={`Tirar ${i.nome} da automação`}
                    title="Tirar da automação"
                    className="shrink-0 text-zinc-400 transition hover:text-red-500 disabled:opacity-40"
                  >
                    <UserMinus className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A busca do "inscrever à mão". Só para fluxo de contato. */
function InscreverContato({
  fluxo,
  aoAvisar,
}: {
  fluxo: Fluxo;
  aoAvisar: (a: { ok: boolean; texto: string }) => void;
}) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<
    { id: string; nome: string; whatsapp: string | null }[]
  >([]);
  const [buscando, buscar] = useTransition();
  const [inscrevendo, inscrever] = useTransition();

  // Busca ao soltar a tecla, com o termo que ESTÁ no campo — sem debounce
  // porque a consulta é LIMIT 8 e o resultado só substitui a lista anterior.
  function procurar(valor: string) {
    setTermo(valor);
    if (valor.trim().length < 2) {
      setAchados([]);
      return;
    }
    buscar(async () => {
      setAchados(await buscarContatosParaInscrever(fluxo.id, valor));
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
        Inscrever um contato
      </h3>
      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        Ele entra pelo começo da automação e recebe a cadência inteira. Quem já
        está dentro não aparece na busca.
      </p>

      <div className="relative mt-2.5">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={termo}
          onChange={(e) => procurar(e.target.value)}
          placeholder="Buscar por nome ou WhatsApp…"
          aria-label="Buscar contato"
          className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-[12px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400"
        />
      </div>

      {termo.trim().length >= 2 && (
        <ul className="mt-2 flex flex-col gap-1">
          {achados.length === 0 ? (
            <li className="px-1 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">
              {buscando ? "Buscando…" : "Ninguém novo com esse nome ou número."}
            </li>
          ) : (
            achados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={inscrevendo}
                  onClick={() =>
                    inscrever(async () => {
                      const r = await inscreverNaAutomacao(fluxo.id, [c.id]);
                      aoAvisar({ ok: r.ok, texto: r.ok ? r.mensagem : r.erro });
                      if (r.ok) {
                        setTermo("");
                        setAchados([]);
                      }
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
                >
                  <UserPlus
                    className="size-3.5 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-zinc-900 dark:text-zinc-50">
                      {c.nome}
                    </span>
                    {c.whatsapp && (
                      <span className="block truncate text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                        {c.whatsapp}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Execucoes({ detalhe }: { detalhe: DetalheFluxo }) {
  if (detalhe.execucoes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-16 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        Este fluxo ainda não executou
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {detalhe.execucoes.map((e, i) => {
          const bloco = e.erro_no
            ? detalhe.porBloco.find((b) => b.no_id === e.erro_no)
            : null;

          return (
            <li
              key={e.id}
              style={{ animationDelay: `${Math.min(i, 6) * 14}ms` }}
              className="surge-suave flex items-start gap-3 px-4 py-2.5"
            >
              <span className="mt-0.5 shrink-0">
                {e.estado === "sucesso" && (
                  <CircleCheck
                    className="size-4 text-emerald-600 dark:text-emerald-400"
                    aria-label="Sucesso"
                  />
                )}
                {e.estado === "erro" && (
                  <CircleX
                    className="size-4 text-rose-600 dark:text-rose-400"
                    aria-label="Erro"
                  />
                )}
                {e.estado === "esperando" && (
                  <Hourglass
                    className="size-4 text-amber-500"
                    aria-label="Esperando"
                  />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-zinc-900 dark:text-zinc-50">
                  {e.contato_nome}
                </p>
                {e.erro_msg ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-rose-600 dark:text-rose-400">
                    {bloco ? `${bloco.rotulo}: ` : ""}
                    {e.erro_msg}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {e.estado === "esperando"
                      ? "Aguardando uma espera terminar"
                      : "Concluída sem erro"}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {dataHora(e.iniciado_em)}
                </p>
                <p className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                  {e.duracao_ms !== null
                    ? `${(e.duracao_ms / 1000).toFixed(1)}s`
                    : "em curso"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "Disparar para um determinado segmento".
 *
 * Só aparece em fluxo de CONTATO: segmento é do contato, e um contato pode ter
 * zero ou várias oportunidades — inscrever uma por ele seria o CRM escolhendo
 * qual negócio recebe a mensagem. Fluxo de oportunidade dispara pela etapa, no
 * painel da cadência.
 *
 * A contagem de contatos aparece ANTES do clique, no próprio seletor: "disparar
 * para 12 mil pessoas" não pode ser descoberto depois de disparar.
 */
function DisparoPorSegmento({
  fluxo,
  segmentos,
}: {
  fluxo: Fluxo;
  segmentos: SegmentoParaDisparo[];
}) {
  const [segmentoId, setSegmentoId] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, comecar] = useTransition();

  if (fluxo.entidade_alvo !== "contato") return null;

  const escolhido = segmentos.find((s) => s.id === segmentoId);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
        Disparar para um segmento
      </h3>
      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        Inscreve os contatos do segmento nesta automação. Quem já está dentro
        não entra de novo.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select
          value={segmentoId}
          onChange={(e) => {
            setSegmentoId(e.target.value);
            setAviso(null);
          }}
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          aria-label="Segmento"
        >
          <option value="">Escolha um segmento…</option>
          {segmentos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome} ({s.contatos})
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={!segmentoId || enviando || !escolhido?.contatos}
          onClick={() =>
            comecar(async () => {
              const r = await dispararParaSegmento(fluxo.id, segmentoId);
              setAviso({ ok: r.ok, texto: r.ok ? r.mensagem : r.erro });
            })
          }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          title={
            escolhido && !escolhido.contatos
              ? "Este segmento não tem contatos"
              : "Inscrever os contatos do segmento"
          }
        >
          <Send className="size-3.5" aria-hidden="true" />
          {enviando ? "Disparando…" : "Disparar"}
        </button>
      </div>

      {aviso && (
        <p
          className={`mt-2 text-[11px] ${
            aviso.ok
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-500"
          }`}
        >
          {aviso.texto}
        </p>
      )}
    </div>
  );
}

export default function PainelLateral({
  fluxo,
  detalhe,
  segmentos,
}: {
  fluxo: Fluxo;
  detalhe: DetalheFluxo;
  segmentos: SegmentoParaDisparo[];
}) {
  const [aba, setAba] = useState<Aba>("visao");
  const router = useRouter();
  const [apagando, excluir] = useTransition();
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);

  return (
    <section
      key={fluxo.id}
      className="surge flex min-h-0 min-w-0 flex-1 flex-col bg-conteudo"
    >
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-start gap-3 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {fluxo.nome}
            </h2>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              <LogIn className="size-3 shrink-0" aria-hidden="true" />
              Por inscricao <span aria-hidden="true">·</span> v
              {fluxo.numero_versao ?? 1}
            </p>
          </div>
          {/* Editar sai da aba e vira link: o builder precisa da tela inteira,
              espremido ao lado da lista a paleta e o canvas nao cabem. */}
          <Link
            href={`/automacoes/${fluxo.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Editar
          </Link>

          {/* Só o ícone, e cinza: é a ação irreversível do cabeçalho e não deve
              ter o mesmo peso visual de Editar, que é a de todo dia. */}
          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  `Excluir "${fluxo.nome}"? As inscrições em andamento são canceladas e o workflow sai do n8n. O histórico do que já foi enviado permanece.`,
                )
              ) {
                return;
              }
              excluir(async () => {
                const r = await excluirFluxo(fluxo.id);
                if (r.ok) router.push("/automacoes");
                else setErroExcluir(r.erro);
              });
            }}
            disabled={apagando}
            aria-label={`Excluir ${fluxo.nome}`}
            title="Excluir automação"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex gap-1 px-3 pt-2" aria-label="Secoes do fluxo">
          {ABAS.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              type="button"
              onClick={() => setAba(id)}
              aria-current={aba === id ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
                aba === id
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              <Icone className="size-3.5" aria-hidden="true" />
              {rotulo}
            </button>
          ))}
        </nav>
      </header>

      {erroExcluir && (
        <p className="shrink-0 border-b border-zinc-200 px-4 py-2 text-[12px] text-amber-700 dark:border-zinc-800 dark:text-amber-500">
          {erroExcluir}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {aba === "visao" ? (
          <div className="flex flex-col gap-4">
            <DisparoPorSegmento fluxo={fluxo} segmentos={segmentos} />
            <VisaoGeral detalhe={detalhe} />
          </div>
        ) : aba === "inscritos" ? (
          <Inscritos fluxo={fluxo} detalhe={detalhe} />
        ) : (
          <Execucoes detalhe={detalhe} />
        )}
      </div>
    </section>
  );
}
