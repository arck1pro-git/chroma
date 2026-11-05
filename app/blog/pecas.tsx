"use client";

// As peças que as telas do Blog repetem: as tags, o selo de SEO, o campo com
// contador, o botão de excluir em dois passos, o interruptor, o aviso que sobe
// do rodapé, a variação de um período para o outro e a sobreposição do artigo.
// A gaveta de configuração usa a casca compartilhada (app/components/gaveta.tsx).
//
// Estão juntas aqui porque cada uma aparece em três ou quatro lugares — e
// porque as faixas (o que é "curto demais" num título SEO) não podem divergir
// entre o painel do artigo e o quadro: é a mesma régua do checklist em
// lib/artigo.ts.
import { useEffect, useState } from "react";
import { ARTIGO_STATUS_LABEL, type ArtigoStatus } from "@/lib/artigo";
import { dataDoInstante } from "@/lib/formato";
import { variacao } from "@/lib/blog-google-tipos";
import { ArrowDown, ArrowUp, Check, CircleCheck, Trash2, X } from "@/app/components/icones";
import CamadaTopo from "@/app/components/camada-topo";

/** Pastilha discreta para rótulos e status. */
export function Tag({
  children,
  tom = "neutro",
}: {
  children: React.ReactNode;
  tom?: "neutro" | "pendente" | "aprovado";
}) {
  const tons = {
    neutro:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    // Em revisão é âmbar e não cinza: é o estado que PEDE alguma coisa. Cinza
    // diria "arquivado", e é justamente o contrário — nada vai ao ar sem sair
    // daqui.
    pendente:
      "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    aprovado:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  };
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${tons[tom]}`}
    >
      {children}
    </span>
  );
}

export function TagStatus({ status }: { status: ArtigoStatus }) {
  return <Tag tom={status}>{ARTIGO_STATUS_LABEL[status]}</Tag>;
}

/**
 * O selo `SEO n`. A cor é o mesmo corte que o checklist usa: 80+ é verde,
 * 55+ é âmbar, abaixo disso é vermelho — não porque o Google use esses números,
 * mas porque abaixo de 55 sempre há um item marcado como erro.
 */
export function SeloSeo({ nota, grande }: { nota: number; grande?: boolean }) {
  const tom =
    nota >= 80
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : nota >= 55
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold tabular-nums ${tom} ${
        grande ? "px-2.5 py-1 text-[13px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      SEO {nota}
    </span>
  );
}

/**
 * Campo de texto com contador. `min`/`max` NÃO limitam a digitação — só pintam
 * o contador quando o valor sai da faixa. Cortar o texto no limite faria a
 * pessoa perder o que escreveu; avisar deixa a decisão com ela.
 */
export function Campo({
  rotulo,
  valor,
  aoMudar,
  dica,
  min,
  max,
  linhas,
  mono,
  placeholder,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  dica?: string;
  min?: number;
  max?: number;
  linhas?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  const n = valor.length;
  const fora =
    (min !== undefined && n < min) || (max !== undefined && n > max) || n === 0;

  const classe = `w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600 ${
    mono ? "font-mono text-[12px] leading-relaxed" : ""
  }`;

  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
          {rotulo}
        </span>
        {(min !== undefined || max !== undefined) && (
          <span
            className={`text-[10px] tabular-nums ${
              fora
                ? "font-medium text-amber-600 dark:text-amber-400"
                : "text-zinc-400 dark:text-zinc-500"
            }`}
          >
            {n}
            {min !== undefined && max !== undefined ? ` / ${min}–${max}` : ""}
          </span>
        )}
      </span>

      {linhas ? (
        <textarea
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          rows={linhas}
          placeholder={placeholder}
          className={`${classe} resize-y`}
        />
      ) : (
        <input
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          placeholder={placeholder}
          className={classe}
        />
      )}

      {dica && (
        <span className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          {dica}
        </span>
      )}
    </label>
  );
}

/**
 * Excluir em dois passos, sem window.confirm.
 *
 * O primeiro clique troca o rótulo pelo que vai acontecer de verdade ("Excluir
 * blog e 12 artigo(s)") e só o segundo executa. Apagar um blog leva os artigos
 * junto por CASCADE — a contagem no rótulo é o que impede a pessoa de descobrir
 * isso depois.
 */
export function BotaoExcluir({
  rotulo,
  confirmacao,
  aoConfirmar,
  ocupado,
}: {
  rotulo: string;
  confirmacao: string;
  aoConfirmar: () => void;
  ocupado?: boolean;
}) {
  const [armado, setArmado] = useState(false);

  return (
    <button
      type="button"
      disabled={ocupado}
      onBlur={() => setArmado(false)}
      onClick={() => (armado ? aoConfirmar() : setArmado(true))}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${
        armado
          ? "bg-red-600 text-white hover:bg-red-700"
          : "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
      }`}
    >
      <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
      {armado ? confirmacao : rotulo}
    </button>
  );
}

/** Botão primário com o estado "Salvo!" de 2s — o retorno de que gravou. */
export function BotaoSalvar({
  aoSalvar,
  salvando,
  salvo,
  rotulo = "Salvar",
}: {
  aoSalvar: () => void;
  salvando: boolean;
  salvo: boolean;
  rotulo?: string;
}) {
  return (
    <button
      type="button"
      onClick={aoSalvar}
      disabled={salvando}
      className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {salvo && <Check className="size-3.5" aria-hidden="true" />}
      {salvando ? "Salvando…" : salvo ? "Salvo!" : rotulo}
    </button>
  );
}

/** Liga/desliga com `role="switch"`. Quem chama decide se salva na hora. */
export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  desabilitado,
}: {
  ligado: boolean;
  aoMudar: (novo: boolean) => void;
  rotulo: string;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={() => aoMudar(!ligado)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        ligado ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all ${ligado ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

export type AvisoTela = { ok: boolean; texto: string } | null;

/**
 * O aviso que sobe do rodapé depois de um gesto (publicou, voltou para revisão,
 * falhou). Some sozinho em 5 s — é retorno, não decisão. O mesmo desenho do
 * aviso do quadro de Demandas.
 */
export function Aviso({ aviso, aoFechar }: { aviso: AvisoTela; aoFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(aoFechar, 5000);
    return () => clearTimeout(t);
  }, [aviso, aoFechar]);

  if (!aviso) return null;
  return (
    <div
      role="status"
      className="surge fixed bottom-6 left-1/2 z-[320] flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-900 py-2.5 pl-4 pr-2.5 text-[13px] text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
    >
      {aviso.ok ? (
        <CircleCheck className="size-4 shrink-0 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
      ) : (
        <span className="size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
      )}
      <span className="flex-1">{aviso.texto}</span>
      <button
        type="button"
        onClick={aoFechar}
        aria-label="Fechar aviso"
        className="rounded-md p-1 opacity-60 transition hover:bg-white/10 hover:opacity-100 dark:hover:bg-zinc-900/10"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * A variação contra o período anterior: "▲ 12%" verde ou "▼ 8%" vermelho. Na
 * posição média, MENOR é melhor — `menorEMelhor` inverte a cor, não a seta: a
 * seta diz o que o número fez, a cor diz se foi bom.
 */
export function Variacao({
  atual,
  anterior,
  menorEMelhor,
}: {
  atual: number;
  anterior: number;
  menorEMelhor?: boolean;
}) {
  const v = variacao(atual, anterior);
  if (v === null) {
    return atual > 0 ? (
      <span className="text-[11px] font-medium text-sky-600 dark:text-sky-400">novo</span>
    ) : null;
  }
  if (Math.abs(v) < 0.005) {
    return <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">estável</span>;
  }
  const subiu = v > 0;
  const bom = menorEMelhor ? !subiu : subiu;
  const Seta = subiu ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
        bom ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      <Seta className="size-2.5" aria-hidden="true" />
      {Math.abs(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0 })}%
      <span className="sr-only">{bom ? " (melhorou)" : " (piorou)"}</span>
    </span>
  );
}

/** Um grupo de opções exclusivas em pílula (período, métrica). */
export function Segmentos<T extends string | number>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
}: {
  opcoes: { id: T; rotulo: string }[];
  valor: T;
  aoMudar: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800/80">
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === valor}
          onClick={() => aoMudar(o.id)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
            o.id === valor
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          }`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * "agora", "há 12 min", "há 3 h", "ontem", "há 4 dias" — e a data a partir de
 * uma semana. Só para o que é buscado no NAVEGADOR (notícias, rodadas da
 * automação): no que vem renderizado do servidor, o minuto entre o SSR e a
 * hidratação faria o React acusar texto diferente.
 */
export function tempoAtras(iso: string, agora = Date.now()): string {
  const min = Math.round((agora - Date.parse(iso)) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return dataDoInstante(iso);
}

/**
 * A frase de erro de uma resposta das rotas: as do Blog devolvem `{ error }`,
 * a portaria do módulo (lib/auth/dal.ts) devolve `{ erro }`.
 */
export function mensagemDeErro(dados: unknown, padrao: string): string {
  const d = (dados ?? {}) as { error?: unknown; erro?: unknown };
  const texto = typeof d.error === "string" ? d.error : typeof d.erro === "string" ? d.erro : "";
  return texto || padrao;
}

/** "https://www.infomoney.com.br/x" → "infomoney.com.br". */
export function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Prefixa os ids do HTML da prévia.
 *
 * O corpo do artigo vira <h2 id="conclusao"> — e a aplicação em volta também
 * tem elementos com id. Sem o prefixo, um artigo com a seção "Contatos"
 * colidiria com um id da própria tela, e o clique no índice rolaria para o
 * lugar errado. Os href de âncora acompanham, senão o índice aponta para nada.
 *
 * Só a PRÉVIA leva o prefixo. O "Copiar HTML" entrega os ids limpos, porque lá
 * o artigo é a página inteira e quem colide é o CMS, não a nossa tela.
 */
export function prefixarIds(html: string): string {
  return html
    .replace(/ id="/g, ' id="previa-')
    .replace(/ href="#/g, ' href="#previa-');
}

/**
 * A folha que abre POR CIMA da tela, centralizada — o artigo em edição.
 *
 * POR QUE NÃO É UMA GAVETA: o artigo é texto longo, e a leitura pede largura e
 * o meio da tela; a gaveta é para configuração (o blog), que é uma coluna de
 * campos. Por cima, a tela de trás continua reconhecível atrás do véu.
 *
 * No <body> (CamadaTopo), na camada das gavetas (z-300/310): acima do botão da
 * IA (z-210) e sem herdar o empilhamento da página.
 *
 * Fecha no Esc e no clique fora. `aoFechar` é chamado sem confirmação: quem
 * tem rascunho não salvo é o painel de dentro, e é ele que avisa.
 */
export function Sobreposicao({
  rotulo,
  aoFechar,
  medida = "h-[min(92vh,60rem)] w-[min(64rem,94vw)]",
  children,
}: {
  rotulo: string;
  aoFechar: () => void;
  medida?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return (
    <CamadaTopo>
      <div
        className="veu-surge fixed inset-0 z-[300] bg-zinc-950/40 backdrop-blur-[2px]"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        className={`surge fixed left-1/2 top-1/2 z-[310] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800 ${medida}`}
      >
        {children}
      </div>
    </CamadaTopo>
  );
}
