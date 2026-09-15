"use client";

// As peças que as quatro telas do Blog repetem: as tags, o selo de SEO, o campo
// com contador e o botão de excluir em dois passos.
//
// Estão juntas aqui porque cada uma aparece em três ou quatro lugares — e
// porque as faixas (o que é "curto demais" num título SEO) não podem divergir
// entre o painel do artigo e a prévia do modal: é a mesma régua do checklist em
// lib/artigo.ts.
import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { ARTIGO_STATUS_LABEL, type ArtigoStatus } from "@/lib/artigo";

/** Pastilha discreta — usada para a auditoria do blog e para o status. */
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
    // Pendente é âmbar e não cinza: é o estado que PEDE alguma coisa. Cinza
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

/**
 * A folha que abre ANCORADA no botão que a chamou — sai do ícone, não do meio
 * da tela.
 *
 * POR QUE NÃO É A `Sobreposicao`: aquela é para o artigo, que ocupa a tela e é
 * onde se trabalha. Conexão e RSS são consulta rápida a partir de um botão da
 * coluna; centralizadas, perdiam a ligação com o que foi clicado e davam a uma
 * caixa de três campos a cerimônia de uma tela inteira.
 *
 * Fica por cima de tudo (`z-50`, acima da página) e o pai precisa ser
 * `relative`: é dele que saem o `left-0` e o `top-full`. Alinha pela borda
 * ESQUERDA do botão e cresce para a direita, que é para onde há tela — os dois
 * botões ficam no começo da faixa de conteúdo. A largura vem de fora porque
 * cada folha precisa da sua.
 */
export function Balao({
  rotulo,
  aoFechar,
  medida = "w-[min(34rem,90vw)]",
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
    <>
      {/* Apanhador de clique, SEM COR: a folha é pequena e sai de um botão da
          coluna — escurecer a tela atrás dela trataria uma consulta rápida
          como se fosse um passo modal, e esconderia justamente a lista que
          diz de onde ela saiu. Invisível, ele só existe para o clique fora
          fechar. */}
      <div
        className="fixed inset-0 z-40"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        className={`surge absolute left-0 top-full z-50 mt-2 flex max-h-[70vh] max-w-[calc(100vw-3rem)] origin-top-left flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800 ${medida}`}
      >
        {children}
      </div>
    </>
  );
}

/**
 * O cabeçalho de uma folha do `Balao`: ícone, nome e Fechar.
 *
 * Existe para Conexão e RSS não escreverem a mesma barra duas vezes — o painel
 * do artigo tem a sua, com abas e status, e não passa por aqui.
 */
export function CabecalhoFolha({
  icone: Icone,
  titulo,
  aoFechar,
}: {
  icone: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  titulo: string;
  aoFechar: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <Icone className="size-4 shrink-0 text-zinc-500" aria-hidden={true} />
      <h2 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
        {titulo}
      </h2>
      <button
        type="button"
        onClick={aoFechar}
        className="ml-auto rounded-full px-2 py-1 text-[12px] text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        Fechar
      </button>
    </header>
  );
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

/** O véu + painel fixo à direita, com a animação que o resto do app já usa. */
export function Gaveta({
  largura,
  aoFechar,
  children,
}: {
  largura: string;
  aoFechar: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        className="veu-surge fixed inset-0 z-40 bg-zinc-900/20 dark:bg-black/40"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <aside
        className={`ficha-entra fixed right-0 top-0 z-50 flex h-screen w-full flex-col border-l border-zinc-200 bg-conteudo dark:border-zinc-800 ${largura}`}
      >
        {children}
      </aside>
    </>
  );
}

/**
 * A folha que abre POR CIMA da tela, centralizada — o artigo em edição.
 *
 * POR QUE NÃO É A `Gaveta`: a gaveta encosta na direita, e na tela do blog a
 * direita já é das notícias. Abrir o artigo ali cobriria justamente a coluna de
 * onde ele saiu. Por cima, o texto ganha largura de leitura e a tela de trás
 * continua reconhecível atrás do véu.
 *
 * Fecha no Esc e no clique fora. `aoFechar` é chamado sem confirmação: quem
 * tem rascunho não salvo é o painel de dentro, e é ele que avisa.
 *
 * `medida` é a única coisa que muda entre os três usos: o artigo ocupa quase a
 * tela, Conexão e RSS são folhas pequenas. Vem como classe e não como
 * "grande"/"pequeno" porque quem abre é quem sabe de quanto precisa.
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
    <>
      <div
        className="veu-surge fixed inset-0 z-40 bg-zinc-900/30 dark:bg-black/50"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        className={`surge fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800 ${medida}`}
      >
        {children}
      </div>
    </>
  );
}
