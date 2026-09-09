"use client";

// Peças da barra de filtros, usadas pelo funil e por contatos. O que muda entre
// as duas é quais filtros existem, não como eles se parecem.

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

// Mesmo estilo dos botões de menu (Segmentos/Tags/Localização): hover no fundo e
// anel de foco focus-visible, para os selects baterem com eles.
export const campo =
  "appearance-none rounded-lg border border-zinc-300 bg-white py-2 pl-2.5 pr-8 text-[13px] text-zinc-900 outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100/10";

export function Seta() {
  return (
    <ChevronDown
      className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
      aria-hidden="true"
    />
  );
}

export function CampoBusca({
  valor,
  aoMudar,
  placeholder,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative min-w-52 flex-1">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
        aria-hidden="true"
      />
      <input
        type="search"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        aria-label="Buscar por termo"
        className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-2.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-100/10"
      />
    </div>
  );
}

export function Seletor({
  valor,
  aoMudar,
  opcoes,
  vazio,
  rotulo,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  opcoes: string[];
  vazio: string;
  rotulo: string;
}) {
  return (
    <div className="relative">
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-label={rotulo}
        className={`w-full ${campo}`}
      >
        <option value="">{vazio}</option>
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <Seta />
    </div>
  );
}

// Fecha ao clicar fora ou apertar Esc — comum ao menu de chips e ao seletor.
function useFechaFora() {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return { aberto, setAberto, ref };
}

// Botão do menu/seletor: mesmo visual dos campos. `ativo` acende a borda quando
// há filtro aplicado, como nos segmentos.
function classeBotaoFiltro(ativo: boolean, botao: string) {
  return `flex ${botao} items-center gap-1.5 rounded-lg border bg-white py-2 pl-2.5 pr-2 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:bg-zinc-900 dark:focus-visible:ring-zinc-100/10 ${
    ativo
      ? "border-zinc-900 text-zinc-900 dark:border-zinc-400 dark:text-zinc-50"
      : "border-zinc-300 text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
  }`;
}

const painelMenu =
  "absolute left-0 top-full z-20 mt-1.5 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950";

// Na barra não cabe uma lista de chips aberta: o que seria uma seção vira um
// menu que só ocupa espaço quando o usuário abre.
export function Menu({
  Icone,
  rotulo,
  contagem,
  botao,
  largura = "w-64",
  children,
}: {
  Icone: LucideIcon;
  rotulo: string;
  contagem: number;
  botao: string;
  largura?: string;
  children: React.ReactNode;
}) {
  const { aberto, setAberto, ref } = useFechaFora();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className={classeBotaoFiltro(contagem > 0, botao)}
      >
        <Icone className="size-3.5 shrink-0" aria-hidden="true" />
        {rotulo}
        {contagem > 0 && (
          <span className="rounded-full bg-zinc-900 px-1.5 text-[10px] font-semibold tabular-nums text-white dark:bg-zinc-50 dark:text-zinc-900">
            {contagem}
          </span>
        )}
        <ChevronDown
          className="ml-auto size-3.5 shrink-0 text-zinc-400"
          aria-hidden="true"
        />
      </button>

      {aberto && <div className={`${painelMenu} ${largura} p-3`}>{children}</div>}
    </div>
  );
}

// Dropdown de seleção única estilizado — substitui o <select> nativo, cuja lista
// aberta o navegador desenha e não dá pra estilizar. Fecha ao escolher.
export function SeletorMenu({
  Icone,
  rotulo,
  valor,
  opcoes,
  aoMudar,
  botao,
  ativo = false,
}: {
  Icone: LucideIcon;
  rotulo: string; // aria-label do controle
  valor: string;
  opcoes: { valor: string; rotulo: string }[];
  aoMudar: (v: string) => void;
  botao: string;
  ativo?: boolean;
}) {
  const { aberto, setAberto, ref } = useFechaFora();
  const escolhida = opcoes.find((o) => o.valor === valor);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={rotulo}
        className={classeBotaoFiltro(ativo, botao)}
      >
        <Icone className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="truncate">{escolhida?.rotulo ?? rotulo}</span>
        <ChevronDown
          className="ml-auto size-3.5 shrink-0 text-zinc-400"
          aria-hidden="true"
        />
      </button>

      {aberto && (
        <ul
          role="listbox"
          className={`${painelMenu} ${botao} max-h-72 overflow-y-auto p-1`}
        >
          {opcoes.map((o) => {
            const marcada = o.valor === valor;
            return (
              <li key={o.valor || "vazio"}>
                <button
                  type="button"
                  role="option"
                  aria-selected={marcada}
                  onClick={() => {
                    aoMudar(o.valor);
                    setAberto(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                    marcada
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  <Check
                    className={`size-3.5 shrink-0 ${marcada ? "" : "invisible"}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{o.rotulo}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Chip({
  ativo,
  rotulo,
  aoClicar,
}: {
  ativo: boolean;
  rotulo: string;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativo}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition ${
        ativo
          ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:ring-zinc-50"
          : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {rotulo}
    </button>
  );
}

// Tamanho da página + navegação, lado a lado. As setas ficam do tamanho dos
// campos (py-2 ≈ size-9) para a linha não desalinhar.
export function Paginacao({
  tamanho,
  aoMudarTamanho,
  pagina,
  totalPaginas,
  aoMudarPagina,
  opcoes = [10, 30, 50, 100],
  unidade = "/ página",
}: {
  tamanho: number;
  aoMudarTamanho: (n: number) => void;
  pagina: number;
  totalPaginas: number;
  aoMudarPagina: (p: number) => void;
  opcoes?: number[];
  unidade?: string;
}) {
  const seta =
    "flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <select
          value={tamanho}
          onChange={(e) => aoMudarTamanho(Number(e.target.value))}
          aria-label="Itens por página"
          className={`w-36 ${campo}`}
        >
          {opcoes.map((n) => (
            <option key={n} value={n}>
              {n} {unidade}
            </option>
          ))}
        </select>
        <Seta />
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => aoMudarPagina(pagina - 1)}
          disabled={pagina <= 1}
          aria-label="Página anterior"
          className={seta}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="w-24 whitespace-nowrap text-center text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          Página{" "}
          <strong className="font-semibold text-zinc-900 dark:text-zinc-50">
            {pagina}
          </strong>{" "}
          de {totalPaginas}
        </span>
        <button
          type="button"
          onClick={() => aoMudarPagina(pagina + 1)}
          disabled={pagina >= totalPaginas}
          aria-label="Próxima página"
          className={seta}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export type Localizacao = { pais: string; estado: string; cidade: string };

export function MenuLocalizacao({
  valor,
  aoMudar,
  contatos,
}: {
  valor: Localizacao;
  aoMudar: (loc: Localizacao) => void;
  contatos: { pais: string; estado: string; cidade: string }[];
}) {
  // Cascata: os estados listados são só os do país escolhido, e as cidades só as
  // do estado escolhido. Sem isso o select de cidade vira uma lista de 200 itens
  // com uma só selecionável de verdade.
  const daRegiao = contatos.filter(
    (c) =>
      (!valor.pais || c.pais === valor.pais) &&
      (!valor.estado || c.estado === valor.estado),
  );
  const paises = [...new Set(contatos.map((c) => c.pais))].sort();
  const estados = [
    ...new Set(
      contatos.filter((c) => !valor.pais || c.pais === valor.pais).map((c) => c.estado),
    ),
  ].sort();
  const cidades = [...new Set(daRegiao.map((c) => c.cidade))].sort();

  const ativos =
    (valor.pais ? 1 : 0) + (valor.estado ? 1 : 0) + (valor.cidade ? 1 : 0);

  return (
    <Menu Icone={Globe} rotulo="Localização" contagem={ativos} botao="w-40">
      <div className="flex flex-col gap-2">
        <Seletor
          rotulo="País"
          valor={valor.pais}
          // trocar o país invalida estado e cidade: manter "SP" com país
          // "Portugal" zera a tela sem o usuário entender por quê
          aoMudar={(v) => aoMudar({ pais: v, estado: "", cidade: "" })}
          opcoes={paises}
          vazio="Qualquer país"
        />
        <Seletor
          rotulo="Estado"
          valor={valor.estado}
          aoMudar={(v) => aoMudar({ ...valor, estado: v, cidade: "" })}
          opcoes={estados}
          vazio="Qualquer estado"
        />
        <Seletor
          rotulo="Cidade"
          valor={valor.cidade}
          aoMudar={(v) => aoMudar({ ...valor, cidade: v })}
          opcoes={cidades}
          vazio="Qualquer cidade"
        />
      </div>
    </Menu>
  );
}

// Largura fixa e botão sempre presente: sem isso, o texto mudando de "28
// contatos" para "5 de 28" reflui a barra inteira a cada clique no filtro.
export function ResumoFiltros({
  visiveis,
  total,
  ativos,
  aoLimpar,
  singular,
  plural,
  semLimpar = false,
}: {
  visiveis: number;
  total: number;
  ativos: number;
  aoLimpar: () => void;
  singular: string;
  plural: string;
  // Quando outro botão já limpa os filtros (funil), some com o daqui e deixa só
  // a contagem, para não ter dois "Limpar".
  semLimpar?: boolean;
}) {
  return (
    <div
      className={`ml-auto flex shrink-0 items-center justify-end gap-3 ${
        semLimpar ? "" : "w-72"
      }`}
    >
      <p className="whitespace-nowrap text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        {visiveis === total ? (
          <>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-50">
              {total}
            </strong>{" "}
            {total === 1 ? singular : plural}
          </>
        ) : (
          <>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-50">
              {visiveis}
            </strong>{" "}
            de {total} após os filtros
          </>
        )}
      </p>

      {!semLimpar && (
        <button
          type="button"
          onClick={aoLimpar}
          disabled={ativos === 0}
          className={`flex w-32 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 ${
            ativos === 0 ? "invisible" : ""
          }`}
        >
          <X className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Limpar {ativos} {ativos === 1 ? "filtro" : "filtros"}
          </span>
        </button>
      )}
    </div>
  );
}
