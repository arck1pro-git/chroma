"use client";

// As peças de formulário do painel do bloco. Os controles usam o campo das
// telas de Campanhas (campoAds, em ../pecas.tsx); aqui fica só o que o painel
// repete: rótulo, grupo de vários controles, a lista de opções, funil e
// etapa, alternador, número e prazo com unidade, a dica "?" e o selo
// "depois de uma resposta".
//
// MENOS TEXTO (pedido dele, 2026-10-28: "muito texto em algumas partes"): a
// regra que importa vai num "?" ao lado do rótulo (Dica), e não num parágrafo
// embaixo de cada campo. O "?" mostra a frase no title e, no toque (tablet não
// tem hover), num balão que fecha ao sair dele. É um span com papel de botão,
// e não um <button>: dentro do <fieldset disabled> da campanha no ar o botão
// ficaria morto, e a dica vale também para quem só lê. Fica dentro do <label>
// sem roubar o rótulo do campo (span não é "labelable"), e o clique nele não
// passa para o campo.
import { useState } from "react";
import { HelpCircle, Reply } from "@/app/components/icones";
import { campoAds } from "../pecas";

/** Uma linha discreta, para o estado vazio de uma lista ("Nenhum número…"). */
export function Ajuda({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{children}</p>;
}

/** O "?" com a regra (ver o cabeçalho). O balão se posiciona pelo Campo ou Grupo, que são `relative`. */
export function Dica({ texto }: { texto: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-label={`Ajuda: ${texto}`}
        aria-expanded={aberta}
        title={aberta ? undefined : texto}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAberta((a) => !a);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setAberta((a) => !a);
          } else if (e.key === "Escape" && aberta) {
            // Fecha só o balão: o Esc não chega a fechar o painel nem a sair do construtor.
            e.preventDefault();
            setAberta(false);
          }
        }}
        onBlur={() => setAberta(false)}
        className="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-zinc-400 outline-none transition hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:text-zinc-500 dark:hover:text-zinc-200 dark:focus-visible:ring-zinc-100/20"
      >
        <HelpCircle className="size-3.5" aria-hidden="true" />
      </span>
      {aberta && (
        <span
          role="tooltip"
          className="absolute inset-x-0 top-5 z-30 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11.5px] font-normal leading-snug text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
        >
          {texto}
        </span>
      )}
    </>
  );
}

const ROTULO = "flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400";

/** Um controle com rótulo. Para vários controles juntos, Grupo (fieldset com legenda). */
export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="relative block">
      <span className={ROTULO}>
        {rotulo}
        {dica && <Dica texto={dica} />}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export function Grupo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <fieldset className="relative min-w-0">
      <legend className={ROTULO}>
        {rotulo}
        {dica && <Dica texto={dica} />}
      </legend>
      <div className="mt-1">{children}</div>
    </fieldset>
  );
}

/** Uma lista de opções do CRM (tag, segmento, IA…), com a primeira linha vazia pedindo a escolha. */
export function Escolha({
  rotulo,
  dica,
  valor,
  opcoes,
  vazio,
  desabilitado,
  mudar,
}: {
  rotulo: string;
  dica?: string;
  valor: string;
  opcoes: Array<{ id: string; nome: string }>;
  vazio: string;
  desabilitado?: boolean;
  mudar: (id: string) => void;
}) {
  return (
    <Campo rotulo={rotulo} dica={dica}>
      <select className={campoAds} value={valor} disabled={desabilitado} onChange={(e) => mudar(e.target.value)}>
        <option value="">{vazio}</option>
        {opcoes.map((x) => (
          <option key={x.id} value={x.id}>
            {x.nome}
          </option>
        ))}
      </select>
    </Campo>
  );
}

/** Funil e etapa (criar, mover, condição "na etapa"): trocar o funil limpa a etapa. */
export function FunilEEtapa({
  funis,
  etapas,
  funilId,
  etapaId,
  dica,
  mudar,
}: {
  funis: Array<{ id: string; nome: string }>;
  etapas: Array<{ id: string; nome: string; funil_id: string }>;
  funilId: string;
  etapaId: string;
  dica?: string;
  mudar: (funilId: string, etapaId: string) => void;
}) {
  return (
    <>
      <Escolha rotulo="Funil" dica={dica} valor={funilId} opcoes={funis} vazio="Escolha o funil" mudar={(f) => mudar(f, "")} />
      <Escolha
        rotulo="Etapa"
        valor={etapaId}
        opcoes={etapas.filter((x) => x.funil_id === funilId)}
        vazio="Escolha a etapa"
        desabilitado={!funilId}
        mudar={(e) => mudar(funilId, e)}
      />
    </>
  );
}

export function Alternar<T extends string>({
  rotulo,
  valor,
  opcoes,
  mudar,
}: {
  rotulo: string;
  valor: T;
  opcoes: Array<[T, string]>;
  mudar: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
      {opcoes.map(([v, r]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => mudar(v)}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:opacity-60 dark:focus-visible:ring-zinc-100/20 ${
            valor === v
              ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/**
 * Um inteiro positivo digitado à vontade: o texto é estado do campo, e o valor
 * só sobe quando é um inteiro maior que zero (apagar tudo para redigitar não
 * volta o número de antes). O limite de cima é da validação, que aponta.
 * Quem usa remonta o campo por bloco (key).
 */
export function Numero({ rotulo, valor, mudar, className = "" }: { rotulo: string; valor: number; mudar: (n: number) => void; className?: string }) {
  const [texto, setTexto] = useState(String(valor));
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      aria-label={rotulo}
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n > 0) mudar(n);
      }}
      className={`${campoAds} ${className}`}
    />
  );
}

export type Unidade = { fator: number; rotulo: string };

export const UNIDADES_EM_MINUTOS: Unidade[] = [
  { fator: 1, rotulo: "minutos" },
  { fator: 60, rotulo: "horas" },
  { fator: 1440, rotulo: "dias" },
];

export const UNIDADES_EM_SEGUNDOS: Unidade[] = [
  { fator: 1, rotulo: "segundos" },
  { fator: 60, rotulo: "minutos" },
  { fator: 3600, rotulo: "horas" },
  { fator: 86_400, rotulo: "dias" },
];

/** A unidade mais redonda: 2880 min → 2 dias, 120 → 2 horas, 90 → 90 minutos. */
function emUnidade(valor: number, unidades: Unidade[]) {
  const fator = [...unidades].reverse().find((u) => valor >= u.fator && valor % u.fator === 0)?.fator ?? unidades[0].fator;
  return { fator, texto: String(valor / fator) };
}

/**
 * Uma quantidade na unidade que a pessoa escolher, gravada na unidade base
 * (minutos ou segundos). A unidade é estado do campo: derivada do valor,
 * "24 horas" viraria "1 dias" no meio da digitação. Quem usa remonta o campo
 * por bloco (key).
 */
export function QuantidadeComUnidade({
  rotulo,
  valor,
  unidades,
  mudar,
}: {
  rotulo: string;
  valor: number;
  unidades: Unidade[];
  mudar: (v: number) => void;
}) {
  const [{ fator, texto }, setEstado] = useState(() => emUnidade(valor, unidades));
  function aplicar(novoTexto: string, novoFator: number) {
    setEstado({ fator: novoFator, texto: novoTexto });
    const n = Number(novoTexto);
    if (Number.isInteger(n) && n > 0) mudar(n * novoFator);
  }
  return (
    <span className="flex gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        aria-label={`${rotulo}: quantidade`}
        value={texto}
        onChange={(e) => aplicar(e.target.value, fator)}
        className={`${campoAds} w-20`}
      />
      <select aria-label={`${rotulo}: unidade`} value={fator} onChange={(e) => aplicar(texto, Number(e.target.value))} className={campoAds}>
        {unidades.map((u) => (
          <option key={u.fator} value={u.fator}>
            {u.rotulo}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Um prazo em minutos (Aguardar, Esperar). O limite (5 min a 30 dias) a validação aponta, sem frase fixa embaixo. */
export function CampoDuracao({ rotulo, minutos, mudar }: { rotulo: string; minutos: number; mudar: (m: number) => void }) {
  return (
    <Grupo rotulo={rotulo}>
      <QuantidadeComUnidade rotulo={rotulo} valor={minutos} unidades={UNIDADES_EM_MINUTOS} mudar={mudar} />
    </Grupo>
  );
}

const JANELA_DE_24H = "Só sai com a janela de 24 horas aberta: o contato respondeu há menos de 24 horas.";

/** O selo do texto livre e do arquivo (ver PEDE_RESPOSTA, ./aparencia.ts): a janela de 24 h explicada uma vez, no title. */
export function SeloResposta() {
  return (
    <span
      title={JANELA_DE_24H}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-medium leading-3.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
    >
      <Reply className="size-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate">depois de uma resposta</span>
      <span className="sr-only">. {JANELA_DE_24H}</span>
    </span>
  );
}
