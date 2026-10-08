"use client";

// As peças das Configurações — o vocabulário visual das sete abas.
//
// REDESENHO DE 2026-10-08 ("olhe aba por aba e faça um redesign"). Antes cada
// aba tinha a própria gramática: título de 13px colado num formulário de criar,
// rótulos em caixa-alta, uma borda por linha, checkbox nativo ao lado de
// select nativo. Agora todas falam a mesma língua:
//
// · Cabecalho — o título de verdade da aba (ícone, nome, uma frase do que ela
//   resolve) e, à direita, a ação principal. É o único lugar com botão cheio.
// · Painel — o cartão branco onde mora o conteúdo; linhas separadas por fio,
//   não cada uma numa caixa.
// · Vazio — o estado sem nada, que ensina o que fazer em vez de só dizer "nada".
// · Interruptor — liga/desliga onde antes havia checkbox: é um estado que vale
//   já, não uma marcação esperando um "salvar".
//
// Tudo em zinc, como o resto do app. A cor que aparece aqui é a que significa
// alguma coisa: o tom do funil, o verde de conectado, o âmbar de atenção.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, TriangleAlert, type LucideIcon } from "lucide-react";
import { amostraDoTom, corValida, TONS_FUNIL } from "@/lib/cores-funil";
import { tintaDe } from "../../components/tinta";

// ── Cabeçalho da aba ────────────────────────────────────────────────────────
export function Cabecalho({
  Icone,
  titulo,
  descricao,
  contagem,
  acao,
}: {
  Icone: LucideIcon;
  titulo: string;
  descricao: ReactNode;
  /** O número ao lado do título — quantos itens a aba guarda. */
  contagem?: number;
  acao?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          <Icone className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {titulo}
            {contagem !== undefined && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[12px] font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {contagem}
              </span>
            )}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {descricao}
          </p>
        </div>
      </div>
      {acao && <div className="flex shrink-0 items-center gap-2">{acao}</div>}
    </header>
  );
}

// ── Painel ──────────────────────────────────────────────────────────────────
export function Painel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      {children}
    </div>
  );
}

/** A faixa de título de um painel: nome do bloco, uma linha de ajuda, ação. */
export function PainelTopo({
  titulo,
  descricao,
  acao,
  contagem,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  contagem?: number;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-800/80">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
          {titulo}
          {contagem !== undefined && (
            <span className="text-[12px] font-normal tabular-nums text-zinc-400 dark:text-zinc-500">
              {contagem}
            </span>
          )}
        </h2>
        {descricao && (
          <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{descricao}</p>
        )}
      </div>
      {acao}
    </div>
  );
}

// ── Vazio ───────────────────────────────────────────────────────────────────
export function Vazio({
  Icone,
  titulo,
  texto,
  acao,
}: {
  Icone: LucideIcon;
  titulo: string;
  texto: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50 text-zinc-400 shadow-sm dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-950 dark:text-zinc-500">
        <Icone className="size-5" aria-hidden="true" />
      </span>
      <p className="text-[14px] font-medium text-zinc-900 dark:text-zinc-50">{titulo}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        {texto}
      </p>
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}

// ── Botão de ícone ──────────────────────────────────────────────────────────
// 32px de área para um ícone de 14–16px: o lápis e a lixeira de antes eram
// alvos de 14px, e errar o clique numa lixeira é o pior erro desta tela.
export function BotaoIcone({
  rotulo,
  onClick,
  perigo = false,
  disabled = false,
  children,
  className = "",
}: {
  rotulo: string;
  onClick: () => void;
  perigo?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={rotulo}
      title={rotulo}
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition disabled:pointer-events-none disabled:opacity-40 ${
        perigo
          ? "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          : "hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      } ${className}`}
    >
      {children}
    </button>
  );
}

// ── Interruptor ─────────────────────────────────────────────────────────────
export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
  disabled = false,
}: {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  rotulo: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      title={rotulo}
      disabled={disabled}
      onClick={() => aoMudar(!ligado)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors duration-200 focus-visible:ring-4 focus-visible:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-zinc-100/10 ${
        ligado ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
      }`}
    >
      <span
        className={`inline-block size-4 rounded-full shadow-sm ring-1 ring-black/5 transition-transform duration-200 ${
          ligado
            ? "translate-x-[18px] bg-white dark:bg-zinc-900"
            : "translate-x-0.5 bg-white"
        }`}
      />
    </button>
  );
}

// ── Avisos ──────────────────────────────────────────────────────────────────
export function Erro({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
    >
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function Atencao({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-3 text-[12px] leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
      <TriangleAlert className="mt-px size-4 shrink-0 text-amber-500" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// ── Avatar ──────────────────────────────────────────────────────────────────
// Um tom por pessoa, tirado do nome (app/components/tinta.ts): a mesma cor
// que a pessoa tem em Demandas.
export function Avatar({
  nome,
  iniciais,
  tamanho = "md",
}: {
  nome: string;
  iniciais: string;
  tamanho?: "sm" | "md";
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${tintaDe(nome)} ${
        tamanho === "sm" ? "size-6 text-[9px]" : "size-9 text-[11px]"
      }`}
      aria-hidden="true"
    >
      {iniciais}
    </span>
  );
}

// ── Telefone ────────────────────────────────────────────────────────────────
/** "5547999346074" → "+55 47 99934-6074". Fora do padrão brasileiro, só o "+". */
export function formatarTelefone(digitos: string | null | undefined): string | null {
  if (!digitos) return null;
  const d = digitos.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    const corte = resto.length - 4;
    return `+55 ${ddd} ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }
  return `+${d}`;
}

// ── Cores do funil ──────────────────────────────────────────────────────────
/** As 13 amostras em linha — onde há espaço para mostrar todas (criar funil). */
export function PaletaCores({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (cor: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Cor do funil">
      {TONS_FUNIL.map(({ id, rotulo }) => (
        <Amostra key={id} id={id} rotulo={rotulo} ativo={id === valor} aoEscolher={aoMudar} />
      ))}
    </div>
  );
}

function Amostra({
  id,
  rotulo,
  ativo,
  aoEscolher,
}: {
  id: string;
  rotulo: string;
  ativo: boolean;
  aoEscolher: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      aria-label={rotulo}
      title={rotulo}
      onClick={() => aoEscolher(id)}
      className={`flex size-6 items-center justify-center rounded-full ${amostraDoTom(id)} transition hover:scale-110 ${
        ativo
          ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-white dark:ring-zinc-100 dark:ring-offset-zinc-950"
          : ""
      }`}
    >
      {ativo && <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

/**
 * A cor do funil já criado: UMA amostra que abre a paleta. As 13 bolinhas
 * sempre à mostra no cabeçalho de cada funil eram o objeto mais barulhento da
 * tela — para uma escolha que se faz uma vez.
 */
export function SeletorCor({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (cor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const painelRef = useRef<HTMLDivElement | null>(null);
  const rotuloAtual = TONS_FUNIL.find((t) => t.id === corValida(valor))?.rotulo ?? "";

  // Esc fecha, e o foco entra na paleta ao abrir — quem chegou pelo teclado
  // continua nele.
  useEffect(() => {
    if (!aberto) return;
    painelRef.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="true"
        title={`Cor do funil: ${rotuloAtual}`}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white pl-1.5 pr-2 text-[12px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-50"
      >
        <span className={`size-4 rounded-full ${amostraDoTom(valor)}`} aria-hidden="true" />
        {rotuloAtual}
        <ChevronDown className="size-3.5 text-zinc-400" aria-hidden="true" />
      </button>

      {aberto && (
        <>
          {/* clicar fora fecha */}
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} aria-hidden="true" />
          <div
            ref={painelRef}
            className="surge absolute right-0 top-full z-50 mt-2 w-[236px] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="mb-2.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              As etapas recebem tons desta cor, do claro ao escuro.
            </p>
            <div className="grid grid-cols-7 gap-2" role="radiogroup" aria-label="Cor do funil">
              {TONS_FUNIL.map(({ id, rotulo }) => (
                <Amostra
                  key={id}
                  id={id}
                  rotulo={rotulo}
                  ativo={id === corValida(valor)}
                  aoEscolher={(c) => {
                    aoMudar(c);
                    setAberto(false);
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
