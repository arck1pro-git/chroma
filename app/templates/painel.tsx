"use client";

// A tela de Templates: a lista à esquerda, o template aberto à direita
// (./detalhe.tsx) — o mesmo desenho de /videos e /webhooks — e o editor por
// cima (./editor.tsx). Os dados chegam prontos do servidor (./dados.ts);
// atualizar é pedir a página de novo (router.refresh), sem rota própria.
//
// A lista é de linhas que acendem, não de cartões: o nome em fonte de código
// (é por ele que o chat e as campanhas acham o template), um ponto com a cor da
// situação e o começo do texto. ↑ e ↓ andam pela lista sem o mouse.
import { useMemo, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  IDIOMA_PADRAO,
  RASCUNHO_VAZIO,
  rascunhoDe,
  ROTULO_CATEGORIA,
  type Rascunho,
} from "@/lib/templates-whatsapp";
import { Building2, LayoutTemplate, Plus, RefreshCw, TriangleAlert } from "@/app/components/icones";
import { CampoBusca, Chip, SeletorMenu } from "../components/filtros-ui";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO, BotaoIcone } from "../components/gaveta";
import type { Tom } from "../contatos/pecas";
import type { DadosTemplates } from "./dados";
import Detalhe, { estadoDe, type Grupo } from "./detalhe";
import Editor from "./editor";

type Edicao = { inicial: Rascunho; origem: string | null; deFora: string[] };
const EM_BRANCO: Edicao = { inicial: RASCUNHO_VAZIO, origem: null, deFora: [] };

type Filtro = "todos" | Grupo;

const FILTROS: Array<{ valor: Filtro; rotulo: string }> = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "aprovados", rotulo: "Aprovados" },
  { valor: "analise", rotulo: "Em análise" },
  { valor: "rejeitados", rotulo: "Rejeitados" },
  { valor: "parados", rotulo: "Pausados" },
];

const PONTO: Record<Tom, string> = {
  bom: "bg-emerald-500",
  aviso: "bg-amber-400",
  ruim: "bg-red-500",
  neutro: "bg-zinc-300 dark:bg-zinc-600",
};

/** O texto da linha da lista: sem as marcas de formatação e numa linha só. */
const resumo = (corpo: string) => corpo.replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();

export default function PainelTemplates({
  contas,
  contaId,
  templates,
  erro,
  podeCriar,
}: DadosTemplates & { podeCriar: boolean }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Edicao | null>(null);
  const [atualizando, iniciar] = useTransition();

  const conta = contas.find((c) => c.id === contaId) ?? null;
  // A Meta não deixa repetir nome no mesmo idioma; o editor só cria em pt_BR.
  const nomesUsados = useMemo(
    () => new Set(templates.filter((t) => t.idioma === IDIOMA_PADRAO).map((t) => t.nome)),
    [templates],
  );

  const contagens = useMemo(() => {
    const c: Record<Filtro, number> = { todos: templates.length, aprovados: 0, analise: 0, rejeitados: 0, parados: 0 };
    for (const t of templates) c[estadoDe(t.status).grupo]++;
    return c;
  }, [templates]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return templates.filter(
      (t) =>
        (filtro === "todos" || estadoDe(t.status).grupo === filtro) &&
        (!termo || t.nome.includes(termo) || t.corpo.toLowerCase().includes(termo)),
    );
  }, [templates, filtro, busca]);

  // Sem escolha (ou com a escolhida fora do filtro), abre o primeiro da lista.
  const selecionado = visiveis.find((t) => t.id === selecionadoId) ?? visiveis[0] ?? null;

  const atualizar = () => iniciar(() => router.refresh());

  // O modal fecha na hora; filtro, busca e seleção mudam DENTRO da transição do
  // refresh, junto com a lista nova. Fora dela, o id novo ainda não existiria
  // na lista e o primeiro template apareceria aberto por um ou dois segundos.
  function aoCriar(id: string | null) {
    setEditor(null);
    iniciar(() => {
      setFiltro("todos");
      setBusca("");
      if (id) setSelecionadoId(id);
      router.refresh();
    });
  }

  function navegar(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const atual = visiveis.findIndex((t) => t.id === selecionado?.id);
    const proximo = visiveis[Math.min(visiveis.length - 1, Math.max(0, atual + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!proximo) return;
    setSelecionadoId(proximo.id);
    document.getElementById(`template-${proximo.id}`)?.focus();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200 tela-baixa:w-72 dark:border-zinc-800">
        <div className="shrink-0 space-y-2.5 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                <LayoutTemplate className="size-4" aria-hidden="true" />
                Templates
              </h1>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {erro && !templates.length
                  ? "WhatsApp oficial"
                  : `${templates.length} ${templates.length === 1 ? "template" : "templates"}${conta && contas.length === 1 ? ` · ${conta.nome}` : ""}`}
              </p>
            </div>
            <BotaoIcone
              Icone={RefreshCw}
              rotulo={atualizando ? "Atualizando…" : "Atualizar da Meta"}
              onClick={atualizar}
              disabled={atualizando}
              className={atualizando ? "[&>svg]:animate-spin" : ""}
            />
            {podeCriar && (
              <button
                type="button"
                onClick={() => setEditor(EM_BRANCO)}
                disabled={!contaId}
                className={BOTAO_PRIMARIO}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Novo
              </button>
            )}
          </div>

          {contas.length > 1 && (
            <SeletorMenu
              Icone={Building2}
              rotulo="Conta do WhatsApp"
              valor={contaId ?? ""}
              opcoes={contas.map((c) => ({ valor: c.id, rotulo: c.nome }))}
              aoMudar={(id) => router.push(`/templates?conta=${encodeURIComponent(id)}`)}
              botao="w-full"
            />
          )}

          {templates.length > 0 && (
            <>
              <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome ou texto" />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por situação">
                {/* Situação sem template não vira chip — a não ser a escolhida, que
                    pode ter zerado ao atualizar e precisa continuar à vista. */}
                {FILTROS.filter((f) => f.valor === "todos" || f.valor === filtro || contagens[f.valor] > 0).map((f) => (
                  <Chip
                    key={f.valor}
                    ativo={filtro === f.valor}
                    rotulo={`${f.rotulo} ${contagens[f.valor]}`}
                    aoClicar={() => setFiltro(f.valor)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <ul
          className={`min-h-0 flex-1 overflow-y-auto p-2 transition-opacity ${atualizando ? "opacity-60" : ""}`}
          onKeyDown={navegar}
          aria-label="Templates"
        >
          {visiveis.map((t) => {
            const estado = estadoDe(t.status);
            const ativo = t.id === selecionado?.id;
            return (
              <li key={t.id}>
                <button
                  id={`template-${t.id}`}
                  type="button"
                  onClick={() => setSelecionadoId(t.id)}
                  aria-current={ativo ? "true" : undefined}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:focus-visible:ring-white/20 ${
                    ativo ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  }`}
                >
                  <span
                    className={`mt-[5px] size-2 shrink-0 rounded-full ${PONTO[estado.tom]} ${t.status === "PENDING" ? "respira" : ""}`}
                    title={estado.rotulo}
                    aria-label={estado.rotulo}
                    role="img"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono text-[12px] font-medium text-zinc-900 dark:text-zinc-50">{t.nome}</span>
                      <span className="shrink-0 text-[10.5px] text-zinc-400 dark:text-zinc-500">
                        {ROTULO_CATEGORIA[t.categoria] ?? t.categoria}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                      {resumo(t.corpo) || "Sem texto"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {templates.length > 0 && visiveis.length === 0 && (
            <li className="px-2 py-10 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
              {busca.trim() ? "Nada com esse nome ou texto." : "Nenhum template nessa situação."}
            </li>
          )}
        </ul>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {erro ? (
          <Aviso
            Icone={TriangleAlert}
            titulo="Não deu para ler os templates"
            texto={erro}
            acao={
              <button type="button" onClick={atualizar} disabled={atualizando} className={BOTAO_SECUNDARIO}>
                <RefreshCw className={`size-3.5 ${atualizando ? "animate-spin" : ""}`} aria-hidden="true" />
                Tentar de novo
              </button>
            }
          />
        ) : templates.length === 0 ? (
          <Aviso
            Icone={LayoutTemplate}
            titulo="Nenhum template nesta conta"
            texto="Template é a mensagem que a Meta aprova antes: é o único jeito de falar com alguém pela API oficial fora da janela de 24 horas."
            acao={
              podeCriar && (
                <button type="button" onClick={() => setEditor(EM_BRANCO)} className={BOTAO_PRIMARIO}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Criar o primeiro
                </button>
              )
            }
          />
        ) : selecionado ? (
          <Detalhe
            key={selecionado.id}
            template={selecionado}
            podeCriar={podeCriar}
            aoDuplicar={() => {
              const { rascunho, deFora } = rascunhoDe(selecionado, nomesUsados);
              setEditor({ inicial: rascunho, origem: selecionado.nome, deFora });
            }}
          />
        ) : (
          <p className="flex h-full items-center justify-center p-8 text-[12px] text-zinc-400 dark:text-zinc-500">
            Escolha um template na lista.
          </p>
        )}
      </main>

      {editor && contaId && (
        <Editor
          inicial={editor.inicial}
          origem={editor.origem}
          deFora={editor.deFora}
          contaId={contaId}
          contaNome={conta?.nome ?? null}
          nomesUsados={nomesUsados}
          aoFechar={() => setEditor(null)}
          aoCriar={aoCriar}
        />
      )}
    </div>
  );
}

function Aviso({
  Icone,
  titulo,
  texto,
  acao,
}: {
  Icone: typeof LayoutTemplate;
  titulo: string;
  texto: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
        <Icone className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">{titulo}</h2>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{texto}</p>
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}

/** O que aparece enquanto a Meta responde: a mesma casca, com a lista e o detalhe esboçados. */
export function EsqueletoTemplates() {
  const bloco = "animate-pulse rounded bg-zinc-100 dark:bg-zinc-900";
  return (
    <div className="flex h-screen overflow-hidden bg-conteudo" aria-busy="true" aria-label="Carregando templates">
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200 tela-baixa:w-72 dark:border-zinc-800">
        <div className="shrink-0 space-y-2.5 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex h-8 items-center">
            <p className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              <LayoutTemplate className="size-4" aria-hidden="true" />
              Templates
            </p>
          </div>
          <div className={`${bloco} h-9 rounded-lg`} />
          <div className="flex gap-1.5">
            {[14, 20, 18].map((w) => (
              <span key={w} className={`${bloco} h-6 rounded-full`} style={{ width: `${w * 4}px` }} />
            ))}
          </div>
        </div>
        <ul className="space-y-1 p-2">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex gap-2.5 px-2.5 py-2">
              <span className={`${bloco} mt-1 size-2 rounded-full`} />
              <span className="flex-1 space-y-1.5">
                <span className={`${bloco} block h-3`} style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                <span className={`${bloco} block h-2.5 w-full`} />
              </span>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl space-y-4 px-8 py-7">
          <span className={`${bloco} block h-6 w-64`} />
          <span className={`${bloco} block h-4 w-40`} />
          <span className={`${bloco} block h-10 w-full rounded-xl`} />
          <span className={`${bloco} block h-72 w-full max-w-xl rounded-2xl`} />
        </div>
      </div>
    </div>
  );
}
