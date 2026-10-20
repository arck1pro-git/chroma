"use client";

// O vocabulário das gavetas da direita — a ficha da oportunidade e a gaveta de
// contatos —, redesenhadas em 2026-10-20 ("está um 6, quero um 10"). A régua é
// a ficha de /contatos, a tela mais bem resolvida do CRM: título de grupo em
// caixa alta miúda e sem ícone, nada de caixa dentro de caixa, linha que acende
// no hover em vez de cartão com borda, vazio numa linha só, número com país,
// DDD e nono dígito separados. As duas gavetas montam com estas peças — e só
// com elas —, para que "Reuniões" não seja desenhado de dois jeitos.
//
// Tablet não tem hover (ver a memória do layout deitado): nada aqui depende do
// mouse para aparecer — o copiar fica sempre à vista, só apagado.
import { useState } from "react";
import {
  Bot,
  CalendarCheck2,
  Check,
  Clapperboard,
  Copy,
  History,
  Inbox,
  MessageCircle,
  StickyNote,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Etapa, Historico, Segmento, Tag, Usuario } from "../data";
import { dataHora, iniciais } from "../formato";
import { assuntoDoHistorico, lerObjecao, Selo, type Assunto } from "../contatos/pecas";
import CamadaTopo from "./camada-topo";
import { tintaDe } from "./tinta";

// ── A casca ─────────────────────────────────────────────────────────────────

/**
 * Véu + painel flutuante à direita, no <body> (CamadaTopo): dentro da página a
 * gaveta dividia camada com os cartões do quadro. Caixa que não rola; quem rola
 * é o miolo (<CorpoGaveta>), para o cabeçalho ficar parado.
 */
export function CascaGaveta({
  rotulo,
  aoFechar,
  children,
  depois,
}: {
  rotulo: string;
  aoFechar: () => void;
  children: React.ReactNode;
  /** O que abre POR CIMA da gaveta (o formulário do contato), fora do painel. */
  depois?: React.ReactNode;
}) {
  return (
    <CamadaTopo>
      <div
        className="veu-surge fixed inset-0 z-[300] bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <aside
        className="ficha-entra fixed bottom-3 right-3 top-3 z-[310] flex w-[27rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)] ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
        aria-label={rotulo}
      >
        {children}
      </aside>
      {depois}
    </CamadaTopo>
  );
}

export function CorpoGaveta({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">{children}</div>;
}

// ── Botões ──────────────────────────────────────────────────────────────────

export function BotaoIcone({
  Icone,
  rotulo,
  onClick,
  disabled,
  className = "",
}: {
  Icone: LucideIcon;
  rotulo: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={rotulo}
      title={rotulo}
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 ${className}`}
    >
      <Icone className="size-4" aria-hidden="true" />
    </button>
  );
}

/** A ação de uma seção ("+ Nova", "+ Marcar"), no canto do título. */
export function AcaoSecao({
  Icone,
  children,
  onClick,
  disabled,
}: {
  Icone: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="-my-1 -mr-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
    >
      <Icone className="size-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}

/** Copiar sempre à vista (no tablet não há hover que o revele), só apagado. */
export function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(texto).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1400);
        });
      }}
      aria-label={`Copiar ${rotulo}`}
      title={copiado ? "Copiado" : `Copiar ${rotulo}`}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
    >
      {copiado ? (
        <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

// ── Seções ──────────────────────────────────────────────────────────────────

/**
 * Um assunto da gaveta. A raiz é <section> com borda e recuo próprios — a ficha
 * de /contatos (lateral.tsx) reaproveita pedaços daqui e zera isso por fora com
 * [&>section]:…, então a raiz tem de continuar sendo a <section>.
 */
export function Secao({
  titulo,
  contagem,
  acao,
  children,
}: {
  titulo: React.ReactNode;
  contagem?: number;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-900">
      <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
          {titulo}
          {contagem ? (
            <span className="tabular-nums font-medium text-zinc-300 dark:text-zinc-600">{contagem}</span>
          ) : null}
        </h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Seção sem nada: uma linha discreta, não uma caixa tracejada ocupando espaço. */
export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-[12.5px] text-zinc-400 dark:text-zinc-500">{children}</p>;
}

export function Carregando() {
  return (
    <div className="flex flex-col gap-2 py-1" aria-label="Carregando" role="status">
      <span className="h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
      <span className="h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

// ── Propriedades: rótulo à esquerda, valor à direita ────────────────────────

export function Propriedades({ children }: { children: React.ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>;
}

export function Propriedade({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-start gap-3 py-1">
      <dt className="w-[6.75rem] shrink-0 py-0.5 text-[12.5px] leading-5 text-zinc-500 dark:text-zinc-400">{rotulo}</dt>
      <dd className="flex min-h-6 min-w-0 flex-1 items-center gap-1 break-words text-[13px] leading-5 text-zinc-900 dark:text-zinc-100">
        {children}
      </dd>
    </div>
  );
}

// ── Linhas de lista ─────────────────────────────────────────────────────────

/** Linha que acende no hover — a lista sem cartão com borda em volta de cada item. */
export const LINHA =
  "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:hover:bg-zinc-900 dark:focus-visible:ring-white/20";

/** O mesmo recuo da LINHA, para item que não é clicável. */
export const LINHA_FIXA = "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2";

/** O ícone redondo no começo de uma linha (canal, reunião, automação). */
export function IconeLinha({ Icone, tom = "neutro" }: { Icone: LucideIcon; tom?: "neutro" | "ativo" }) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
        tom === "ativo"
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
      }`}
    >
      <Icone className="size-3.5" aria-hidden="true" />
    </span>
  );
}

// ── Gente ───────────────────────────────────────────────────────────────────

/**
 * Contato em destaque (cabeçalho): círculo escuro, como na ficha de /contatos.
 * Contato numa lista: cinza claro — quinze círculos pretos seguidos pesam mais
 * que os nomes. Pessoa da equipe: a tinta do nome (app/components/tinta.ts), a
 * mesma de Demandas e Configurações.
 */
export function Avatar({
  nome,
  tamanho = "md",
  equipe = false,
  suave = false,
}: {
  nome: string;
  tamanho?: "sm" | "md" | "lg";
  equipe?: boolean;
  suave?: boolean;
}) {
  const medida = { sm: "size-6 text-[9.5px]", md: "size-8 text-[11px]", lg: "size-11 text-[14px]" }[tamanho];
  const cor = equipe
    ? tintaDe(nome)
    : suave
      ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
      : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${medida} ${cor}`} aria-hidden="true">
      {iniciais(nome)}
    </span>
  );
}

// ── A régua do funil ────────────────────────────────────────────────────────

/**
 * Um segmento por etapa do funil, aceso no tom de cada uma até a etapa atual —
 * as colunas do quadro, de lado. Mesmo desenho da ReguaDoFunil de /contatos,
 * com as etapas que o quadro já tem na mão.
 */
export function ReguaEtapas({ etapas, atualId }: { etapas: Etapa[]; atualId: string }) {
  const posicao = etapas.findIndex((e) => e.id === atualId);
  if (posicao < 0) return null;
  return (
    <span
      className="inline-flex w-full gap-[3px]"
      role="img"
      aria-label={`Etapa ${posicao + 1} de ${etapas.length}`}
      title={`${etapas[posicao].nome} — etapa ${posicao + 1} de ${etapas.length}`}
    >
      {etapas.map((e, i) => (
        <span
          key={e.id}
          className={`h-1 flex-1 rounded-full transition-colors ${i <= posicao ? e.cor : "bg-zinc-200 dark:bg-zinc-800"}`}
        />
      ))}
    </span>
  );
}

// ── Segmentos e tags ────────────────────────────────────────────────────────

export function Chips({ segmentos, tags }: { segmentos: Segmento[]; tags: Tag[] }) {
  if (segmentos.length === 0 && tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {segmentos.map((s) => (
        <span
          key={s.id}
          className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {s.nome}
        </span>
      ))}
      {tags.map((t) => (
        <span
          key={t.id}
          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-300 dark:ring-zinc-800"
        >
          {t.nome}
        </span>
      ))}
    </div>
  );
}

// ── Objeções e histórico ────────────────────────────────────────────────────

/** As objeções que a IA registrou, lidas do histórico — o que o lead teme, de relance. */
export function ObjecoesDoHistorico({ historico, limite = 3 }: { historico: Historico[]; limite?: number }) {
  const objecoes = historico.flatMap((h) => {
    const o = lerObjecao(h.descricao);
    return o ? [{ h, o }] : [];
  });
  const [todas, setTodas] = useState(false);
  if (objecoes.length === 0) return null;
  const vistas = todas ? objecoes : objecoes.slice(0, limite);
  return (
    <Secao titulo="Objeções" contagem={objecoes.length}>
      <ul className="flex flex-col gap-3">
        {vistas.map(({ h, o }) => (
          <li key={h.id}>
            <Selo tom="aviso">{o.tema}</Selo>
            <p className="mt-1 text-[12.5px] italic leading-snug text-zinc-700 dark:text-zinc-200">“{o.fala}”</p>
            {o.motivo && (
              <p className="mt-0.5 text-[11.5px] leading-snug text-zinc-400 dark:text-zinc-500">por trás: {o.motivo}</p>
            )}
          </li>
        ))}
      </ul>
      {objecoes.length > limite && (
        <MaisMenos todos={todas} resto={objecoes.length - limite} aoAlternar={() => setTodas((v) => !v)} />
      )}
    </Secao>
  );
}

const ICONE_ASSUNTO: Record<Assunto, LucideIcon> = {
  conversa: MessageCircle,
  negocio: TrendingUp,
  ia: Bot,
  agenda: CalendarCheck2,
  video: Clapperboard,
  nota: StickyNote,
  automacao: Workflow,
  entrada: Inbox,
  sistema: History,
};

/**
 * O histórico em linha do tempo, os mais recentes primeiro e só os primeiros à
 * vista: 47 movimentações corridas empurravam tudo o mais para fora da gaveta.
 * A objeção aparece inteira em "Objeções"; aqui fica só a menção.
 */
export function ListaHistorico({
  historico,
  usuarioPorId,
  inicial = 5,
}: {
  historico: Historico[];
  usuarioPorId: Map<string, Usuario>;
  inicial?: number;
}) {
  const [todos, setTodos] = useState(false);
  const vistos = todos ? historico : historico.slice(0, inicial);
  return (
    <Secao titulo="Histórico" contagem={historico.length}>
      {historico.length === 0 ? (
        <Vazio>Sem movimentações registradas</Vazio>
      ) : (
        <>
          <ol className="flex flex-col">
            {vistos.map((h, i) => {
              const objecao = lerObjecao(h.descricao);
              const Icone = ICONE_ASSUNTO[assuntoDoHistorico(h.descricao)];
              const ultimo = i === vistos.length - 1;
              return (
                <li key={h.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      <Icone className="size-3" aria-hidden="true" />
                    </span>
                    {!ultimo && <span className="my-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />}
                  </div>
                  <div className={`min-w-0 flex-1 pt-0.5 ${ultimo ? "" : "pb-3.5"}`}>
                    <p className="text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-200">
                      {objecao ? (
                        <>
                          Objeção registrada pela IA · <span className="font-medium">{objecao.tema}</span>
                        </>
                      ) : (
                        h.descricao
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                      {(h.autor_id && usuarioPorId.get(h.autor_id)?.nome) || "Sistema"} · {dataHora(h.data_criacao)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {historico.length > inicial && (
            <MaisMenos todos={todos} resto={historico.length - inicial} aoAlternar={() => setTodos((v) => !v)} />
          )}
        </>
      )}
    </Secao>
  );
}

export function MaisMenos({ todos, resto, aoAlternar }: { todos: boolean; resto: number; aoAlternar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoAlternar}
      className="mt-2 rounded-md text-[12px] font-medium text-zinc-500 underline-offset-4 transition hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
    >
      {todos ? "Mostrar menos" : `Ver mais ${resto}`}
    </button>
  );
}

// ── Campo de formulário dentro da gaveta ────────────────────────────────────

export const CAMPO =
  "min-w-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-600";

export const BOTAO_PRIMARIO =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";

export const BOTAO_SECUNDARIO =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";
