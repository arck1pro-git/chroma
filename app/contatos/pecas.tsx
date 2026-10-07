"use client";

// As peças pequenas da ficha de contato: formatos, a régua do funil, o botão
// de copiar, o selo. Num arquivo só porque as quatro partes da ficha (cabeçalho,
// jornada, atividade, lateral) usam as mesmas — e um "3 dias" escrito de dois
// jeitos na mesma tela é o tipo de coisa que denuncia remendo.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { EtapaComTom } from "@/lib/contatos-ficha";

const FUSO = "America/Sao_Paulo";

/** "+55 (47) 99934-6074". Fora do padrão BR, os dígitos com "+". */
export function telefone(bruto: string) {
  const d = bruto.replace(/\D/g, "");
  if (!d) return "";
  const comPais = d.length === 10 || d.length === 11 ? `55${d}` : d;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(comPais);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${comPais}`;
}

/** "1:05", "12:30", "1:02:03". */
export function tempo(segundos: number) {
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const resto = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${resto}` : `${m}:${resto}`;
}

/** "R$ 1,3 mi", "R$ 350 mil", "R$ 9.800". */
export function dinheiro(valor: number) {
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toFixed(1).replace(/\.0$/, "").replace(".", ",")} mi`;
  if (valor >= 10_000) return `R$ ${Math.round(valor / 1_000)} mil`;
  return `R$ ${Math.round(valor).toLocaleString("pt-BR")}`;
}

/** 'YYYY-MM-DD' de um instante, no fuso de Brasília. */
export function diaDe(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(iso));
}

function diasEntre(deIso: string, ateIso: string) {
  return Math.round((new Date(diaDe(ateIso)).getTime() - new Date(diaDe(deIso)).getTime()) / 86_400_000);
}

export function hora(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO }).format(new Date(iso));
}

/** "05 out", e com o ano quando não é o corrente. */
export function dataCurta(iso: string) {
  const d = new Date(iso);
  const mesmoAno = diaDe(iso).slice(0, 4) === diaDe(new Date().toISOString()).slice(0, 4);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: mesmoAno ? undefined : "numeric", timeZone: FUSO })
    .format(d)
    .replace(/\./g, "")
    .replace(/ de /g, " ");
}

/** "13:42" hoje, "ontem", "há 3 d", "05 out" — o tempo da lista. */
export function quando(iso: string) {
  const dias = diasEntre(iso, new Date().toISOString());
  if (dias <= 0) return hora(iso);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} d`;
  return dataCurta(iso);
}

/** O cabeçalho de um dia no feed: "Hoje", "Ontem", "sex, 03 out". */
export function rotuloDoDia(dia: string) {
  const hoje = diaDe(new Date().toISOString());
  const dias = Math.round((new Date(hoje).getTime() - new Date(dia).getTime()) / 86_400_000);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  const d = new Date(`${dia}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })
    .format(d)
    .replace(/\./g, "")
    .replace(/ de /g, " ");
}

/** "há 29 dias", "há 3 meses" — há quanto tempo está no CRM. */
export function haQuanto(iso: string) {
  const dias = diasEntre(iso, new Date().toISOString());
  if (dias < 1) return "desde hoje";
  if (dias === 1) return "desde ontem";
  if (dias < 60) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return meses < 24 ? `há ${meses} meses` : `há ${Math.round(meses / 12)} anos`;
}

/**
 * A régua do funil: um segmento por etapa, no tom de cada uma até a etapa
 * atual e apagado depois dela. É o desenho das colunas do quadro, de lado —
 * quanto mais escuro o último tom aceso, mais perto do fechamento.
 */
export function ReguaDoFunil({
  etapaId,
  etapas,
  largura = "w-32",
}: {
  etapaId: string;
  etapas: Record<string, EtapaComTom>;
  largura?: string;
}) {
  const atual = etapas[etapaId];
  if (!atual) return null;
  const doFunil = Object.values(etapas)
    .filter((e) => e.funilId === atual.funilId)
    .sort((a, b) => a.ordem - b.ordem);
  const posicao = doFunil.findIndex((e) => e.id === etapaId);
  return (
    <span
      className={`inline-flex ${largura} shrink-0 gap-0.5`}
      role="img"
      aria-label={`Etapa ${posicao + 1} de ${doFunil.length} do funil ${atual.funil}`}
      title={`${atual.nome} — etapa ${posicao + 1} de ${doFunil.length}`}
    >
      {doFunil.map((e, i) => (
        <span
          key={e.id}
          className={`h-1.5 flex-1 rounded-full ${i <= posicao ? e.cor : "bg-zinc-200 dark:bg-zinc-800"}`}
        />
      ))}
    </span>
  );
}

export function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1400);
      }}
      aria-label={`Copiar ${rotulo}`}
      title={copiado ? "Copiado" : `Copiar ${rotulo}`}
      className="rounded p-0.5 text-zinc-300 opacity-0 transition hover:text-zinc-900 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-50"
    >
      {copiado ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
    </button>
  );
}

export type Tom = "neutro" | "bom" | "ruim" | "aviso";

export function Selo({ children, tom = "neutro" }: { children: React.ReactNode; tom?: Tom }) {
  const cores = {
    neutro: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    bom: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    ruim: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
    aviso: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  }[tom];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cores}`}>
      {children}
    </span>
  );
}

/** O título de um grupo da lateral: pequeno, em caixa alta, sem moldura. */
export function TituloDeGrupo({ children, acao }: { children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">{children}</h3>
      {acao}
    </div>
  );
}

// ── O histórico, por assunto ──────────────────────────────────────────────────
//
// lib/historico.ts e a IA escrevem frases com começo fixo ("Movida de",
// "Objeção registrada pela IA", "Reunião marcada"…). É por esse começo que o
// feed sabe o assunto de cada linha, para o ícone e o filtro.

export type Assunto = "conversa" | "negocio" | "ia" | "agenda" | "video" | "nota" | "automacao" | "entrada" | "sistema";

export function assuntoDoHistorico(descricao: string): Assunto {
  if (/^(Movida de|Oportunidade ")/.test(descricao)) return "negocio";
  if (/^(Reunião|Aviso da reunião)/.test(descricao)) return "agenda";
  if (/^(Objeção registrada pela IA|IA |.*pela IA)/.test(descricao)) return "ia";
  if (/(automação|cadência)/i.test(descricao)) return "automacao";
  if (/^Abriu o vídeo/.test(descricao)) return "video";
  return "sistema";
}

export type Objecao = { tema: string; fala: string; motivo: string | null; resposta: string | null };

/**
 * A objeção que a IA registra, em partes. O formato (lib/ia/atendente.ts) é
 *   Objeção registrada pela IA (tema): "fala" — por trás: motivo — resposta: …
 * e o tema pode ter parênteses dentro ("estrutura (SCP)") — por isso o tema
 * vai até o primeiro `): "`, e não até o primeiro ")".
 */
export function lerObjecao(descricao: string): Objecao | null {
  const m =
    /^Objeção registrada pela IA \((.+?)\):\s*"([\s\S]*?)"(?:\s*—\s*por trás:\s*([\s\S]*?))?(?:\s*—\s*resposta:\s*([\s\S]*))?\s*$/.exec(
      descricao,
    );
  if (m) return { tema: m[1], fala: m[2], motivo: m[3]?.trim() || null, resposta: m[4]?.trim() || null };
  // Formato antigo, sem aspas: a frase inteira é a fala.
  const solto = /^Objeção registrada pela IA \((.+?)\):\s*([\s\S]*)$/.exec(descricao);
  return solto ? { tema: solto[1], fala: solto[2], motivo: null, resposta: null } : null;
}
