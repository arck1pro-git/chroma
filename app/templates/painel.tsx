"use client";

// Templates oficiais do WhatsApp (Cloud API da Meta): a lista da conta e a
// criação de um novo, que vai para análise da Meta.
//
// Tudo em português na tela: status, categoria e idioma chegam da Meta como
// código ("APPROVED", "UTILITY", "pt_BR") e o código cru não diz nada a quem
// usa o CRM. A prévia é um balão de WhatsApp porque é assim que o cliente vai
// ler — ver o texto no formato final pega erro que o campo de texto esconde.
import { useEffect, useId, useMemo, useState } from "react";
import { FileText, LoaderCircle, Plus, RefreshCw, Search, Send, X } from "lucide-react";
import { consultar } from "../campanhas/use-consulta";
import { Aviso, Vazio, botaoAds, botaoIconeAds, botaoPrincipalAds, campoAds } from "../campanhas/pecas";

type Status = { wabas: Array<{ id: string; name: string }>; erroWhatsApp?: string | null };
type Componente = { type?: string; text?: string };
type Template = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: Componente[];
};

// ── Os códigos da Meta, em português ─────────────────────────────────────────

type Grupo = "aprovados" | "analise" | "reprovados" | "outros";

const STATUS: Record<string, { rotulo: string; grupo: Grupo; classe: string }> = {
  APPROVED: { rotulo: "Aprovado", grupo: "aprovados", classe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  PENDING: { rotulo: "Em análise", grupo: "analise", classe: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  IN_APPEAL: { rotulo: "Em recurso", grupo: "analise", classe: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  REJECTED: { rotulo: "Reprovado", grupo: "reprovados", classe: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  PAUSED: { rotulo: "Pausado", grupo: "outros", classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  DISABLED: { rotulo: "Desativado", grupo: "outros", classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};
const statusDe = (s: string) =>
  STATUS[s] ?? { rotulo: s, grupo: "outros" as Grupo, classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };

const CATEGORIA: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação" };
const IDIOMA: Record<string, string> = { pt_BR: "Português (BR)", en_US: "Inglês (EUA)", en: "Inglês", es: "Espanhol", es_ES: "Espanhol (Espanha)" };

const FILTROS: Array<{ id: "todos" | Grupo; rotulo: string }> = [
  { id: "todos", rotulo: "Todos" },
  { id: "aprovados", rotulo: "Aprovados" },
  { id: "analise", rotulo: "Em análise" },
  { id: "reprovados", rotulo: "Reprovados" },
  { id: "outros", rotulo: "Outros" },
];

const texto = (t: Template, tipo: string) => t.components.find((c) => c.type === tipo)?.text ?? "";

// ── Tela ─────────────────────────────────────────────────────────────────────

export default function PainelTemplates() {
  const [status, setStatus] = useState<Status | null>(null);
  const [lista, setLista] = useState<Template[]>([]);
  const [erro, setErro] = useState("");
  const [semConta, setSemConta] = useState(false);
  const [ocupado, setOcupado] = useState(true);
  const [criando, setCriando] = useState(false);
  const [enviado, setEnviado] = useState("");
  const [filtro, setFiltro] = useState<"todos" | Grupo>("todos");
  const [busca, setBusca] = useState("");

  async function carregar() {
    setOcupado(true);
    setErro("");
    setSemConta(false);
    try {
      const s = await consultar<Status>("/api/meta/status");
      setStatus(s);
      if (!s.wabas?.length) {
        setSemConta(true);
        setErro(s.erroWhatsApp ?? "Nenhuma conta do WhatsApp Business foi atribuída ao usuário de sistema chroma-crm.");
        return;
      }
      const t = await consultar<{ templates: Template[] }>(`/api/meta/templates?waba=${encodeURIComponent(s.wabas[0].id)}`);
      setLista(t.templates);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível consultar a Meta.");
    } finally {
      setOcupado(false);
    }
  }

  // A busca inicial sincroniza esta tela com a API externa.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => void carregar(), []);

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: lista.length };
    for (const t of lista) c[statusDe(t.status).grupo] = (c[statusDe(t.status).grupo] ?? 0) + 1;
    return c;
  }, [lista]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lista.filter(
      (t) =>
        (filtro === "todos" || statusDe(t.status).grupo === filtro) &&
        (!termo || t.name.toLowerCase().includes(termo) || texto(t, "BODY").toLowerCase().includes(termo)),
    );
  }, [lista, filtro, busca]);

  return (
    <div className="min-h-screen bg-conteudo">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Templates</h1>
            <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
              Mensagens oficiais do WhatsApp. Só as aprovadas pela Meta podem iniciar conversa.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void carregar()}
              disabled={ocupado}
              aria-label="Atualizar lista"
              title="Atualizar lista"
              className={botaoIconeAds}
            >
              <RefreshCw className={`size-4 ${ocupado ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!status?.wabas?.length}
              onClick={() => {
                setEnviado("");
                setCriando(true);
              }}
              className={botaoPrincipalAds}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Novo template
            </button>
          </div>
        </header>

        {enviado && (
          <p role="status" className="surge mt-5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            “{enviado}” foi enviado para análise. A Meta costuma responder em minutos, mas pode levar até 24 horas.
          </p>
        )}

        {erro && (
          <div className="mt-5">
            <Aviso
              erro={!semConta}
              texto={erro}
              detalhe={semConta ? "As permissões já foram concedidas; falta atribuir a conta (WABA) e o número como ativos do usuário de sistema no Business Manager." : undefined}
            />
          </div>
        )}

        {!erro && lista.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filtrar por status">
              {FILTROS.filter((f) => f.id === "todos" || contagem[f.id]).map((f) => {
                const ativo = filtro === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={ativo}
                    onClick={() => setFiltro(f.id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                      ativo
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    }`}
                  >
                    {f.rotulo}
                    <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${ativo ? "bg-white/20 dark:bg-zinc-900/15" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                      {contagem[f.id] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou texto"
                aria-label="Buscar template"
                className={campoAds.replace("px-2.5", "pl-8 pr-2.5")}
              />
            </div>
          </div>
        )}

        <div className="mt-5">
          {ocupado && lista.length === 0 ? (
            <Vazio Icone={LoaderCircle} texto="Consultando templates…" girando />
          ) : erro ? null : lista.length === 0 ? (
            <Vazio Icone={FileText} texto="Nenhum template nesta conta ainda. Crie o primeiro para poder iniciar conversas pela API oficial." />
          ) : visiveis.length === 0 ? (
            <Vazio Icone={Search} texto="Nenhum template com esse filtro." />
          ) : (
            <div className={`grid gap-3 md:grid-cols-2 ${ocupado ? "esmaecendo" : ""}`}>
              {visiveis.map((t) => (
                <CartaoTemplate key={t.id} t={t} />
              ))}
            </div>
          )}
        </div>

        {criando && status?.wabas?.[0] && (
          <FormTemplate
            waba={status.wabas[0].id}
            aoFechar={() => setCriando(false)}
            aoSalvar={(nome) => {
              setCriando(false);
              setEnviado(nome);
              void carregar();
            }}
          />
        )}
      </div>
    </div>
  );
}

function CartaoTemplate({ t }: { t: Template }) {
  const s = statusDe(t.status);
  return (
    <article className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-[12.5px] font-semibold text-zinc-900 dark:text-zinc-50" title={t.name}>
            {t.name}
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {CATEGORIA[t.category] ?? t.category} · {IDIOMA[t.language] ?? t.language}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.classe}`}>{s.rotulo}</span>
      </div>
      <Balao
        className="mt-3"
        cabecalho={texto(t, "HEADER")}
        corpo={texto(t, "BODY") || "Sem corpo"}
        rodape={texto(t, "FOOTER")}
      />
    </article>
  );
}

/** O texto como o cliente vai ver: balão do WhatsApp, variáveis em destaque. */
function Balao({ cabecalho, corpo, rodape, className = "" }: { cabecalho?: string; corpo: string; rodape?: string; className?: string }) {
  const partes = corpo.split(/(\{\{\d+\}\})/g);
  return (
    <div className={`rounded-xl bg-[#efeae2] p-3 dark:bg-zinc-900 ${className}`}>
      <div className="max-w-[92%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-[12.5px] leading-relaxed text-zinc-800 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
        {cabecalho && <p className="mb-1 font-semibold">{cabecalho}</p>}
        <p className="whitespace-pre-wrap break-words">
          {partes.map((p, i) =>
            /^\{\{\d+\}\}$/.test(p) ? (
              <span key={i} className="rounded bg-sky-100 px-1 font-mono text-[11px] text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                {p}
              </span>
            ) : (
              p
            ),
          )}
        </p>
        {rodape && <p className="mt-1 text-[11px] text-zinc-400">{rodape}</p>}
      </div>
    </div>
  );
}

// ── Criar ────────────────────────────────────────────────────────────────────

const CATEGORIAS = [
  { id: "MARKETING", rotulo: "Marketing", ajuda: "Promoções, lançamentos, convites e reengajamento." },
  { id: "UTILITY", rotulo: "Utilidade", ajuda: "Avisos sobre algo que o cliente já pediu: agendamento, documento, andamento. A Meta reclassifica como Marketing se o texto for promocional." },
] as const;

function FormTemplate({ waba, aoFechar, aoSalvar }: { waba: string; aoFechar: () => void; aoSalvar: (nome: string) => void }) {
  const idTitulo = useId();
  const [nome, setNome] = useState("");
  const [corpo, setCorpo] = useState("");
  const [rodape, setRodape] = useState("");
  const [categoria, setCategoria] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // As variáveis na ordem em que aparecem. A Meta exige {{1}}, {{2}}… em
  // sequência, sem pular número.
  const variaveis = useMemo(() => [...new Set(corpo.match(/\{\{\d+\}\}/g) ?? [])], [corpo]);
  const foraDeOrdem = variaveis.some((v, i) => v !== `{{${i + 1}}}`);
  const faltaExemplo = variaveis.some((_, i) => !exemplos[i]?.trim());

  function inserirVariavel() {
    const proxima = `{{${variaveis.length + 1}}}`;
    setCorpo((c) => (c && !/\s$/.test(c) ? `${c} ${proxima}` : `${c}${proxima}`));
  }

  async function enviar() {
    setOcupado(true);
    setErro("");
    try {
      await consultar("/api/meta/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waba, nome, corpo, rodape, categoria, idioma: "pt_BR", exemplos: exemplos.slice(0, variaveis.length) }),
      });
      aoSalvar(nome);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar o template.");
      setOcupado(false);
    }
  }

  const podeEnviar = nome && corpo.trim() && !foraDeOrdem && !faltaExemplo && !ocupado;
  const previa = variaveis.reduce((t, v, i) => (exemplos[i]?.trim() ? t.split(v).join(exemplos[i].trim()) : t), corpo);

  return (
    <div className="veu-surge fixed inset-0 z-[105] bg-zinc-900/30 dark:bg-black/50" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !ocupado && aoFechar()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={(e) => e.key === "Escape" && !ocupado && aoFechar()}
        className="ficha-entra fixed bottom-4 right-4 top-4 z-[110] flex w-[32rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 id={idTitulo} className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Novo template
            </h2>
            <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Vai para análise da Meta antes de poder ser usado.</p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={ocupado}
            aria-label="Fechar"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (podeEnviar) void enviar();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <Campo id={`${idTitulo}-nome`} rotulo="Nome" ajuda="Só letras minúsculas, números e _. É como a Meta identifica o template; o cliente não vê.">
              <input
                id={`${idTitulo}-nome`}
                autoFocus
                required
                className={`${campoAds} font-mono`}
                value={nome}
                onChange={(e) => setNome(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                placeholder="boas_vindas_lancamento"
              />
            </Campo>

            <fieldset>
              <legend className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">Categoria</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {CATEGORIAS.map((c) => (
                  <label
                    key={c.id}
                    className={`cursor-pointer rounded-lg border p-3 transition ${
                      categoria === c.id
                        ? "border-zinc-900 bg-zinc-50 dark:border-zinc-300 dark:bg-zinc-900"
                        : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                      <input type="radio" name="categoria" checked={categoria === c.id} onChange={() => setCategoria(c.id)} className="accent-zinc-900 dark:accent-zinc-100" />
                      {c.rotulo}
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{c.ajuda}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Campo
              id={`${idTitulo}-corpo`}
              rotulo="Mensagem"
              extra={
                <button type="button" onClick={inserirVariavel} className="text-[11px] font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300">
                  + Inserir variável
                </button>
              }
            >
              <textarea
                id={`${idTitulo}-corpo`}
                required
                className={`${campoAds} min-h-36 resize-y leading-relaxed`}
                maxLength={1024}
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                placeholder="Olá {{1}}, temos uma novidade para você."
              />
              <span className="mt-1 flex justify-between text-[11px] text-zinc-400">
                <span>Variáveis viram o que você preencher no envio, como o nome do contato.</span>
                <span className="tabular-nums">{corpo.length}/1024</span>
              </span>
            </Campo>

            {foraDeOrdem && <Aviso texto={`Numere as variáveis em sequência, começando em {{1}}. Encontradas: ${variaveis.join(", ")}.`} />}

            {variaveis.length > 0 && !foraDeOrdem && (
              <fieldset className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <legend className="px-1 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">Exemplos das variáveis</legend>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">A Meta usa estes exemplos para analisar o template. Não são enviados ao cliente.</p>
                {variaveis.map((v, i) => (
                  <label key={v} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 font-mono text-[11px] text-sky-700 dark:text-sky-300">{v}</span>
                    <input
                      className={campoAds}
                      value={exemplos[i] ?? ""}
                      onChange={(e) => setExemplos((a) => Object.assign([...a], { [i]: e.target.value }))}
                      placeholder={i === 0 ? "Maria" : "exemplo"}
                    />
                  </label>
                ))}
              </fieldset>
            )}

            <Campo id={`${idTitulo}-rodape`} rotulo="Rodapé" ajuda="Opcional. Aparece menor, embaixo da mensagem.">
              <input id={`${idTitulo}-rodape`} className={campoAds} maxLength={60} value={rodape} onChange={(e) => setRodape(e.target.value)} placeholder="Responda SAIR para não receber mais" />
            </Campo>

            {corpo.trim() && (
              <div>
                <p className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">Como o cliente vai ver</p>
                <Balao className="mt-1.5" corpo={previa} rodape={rodape} />
              </div>
            )}

            {erro && <Aviso erro texto={erro} />}
          </div>

          <footer className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <button type="button" className={botaoAds} disabled={ocupado} onClick={aoFechar}>
              Cancelar
            </button>
            <button type="submit" disabled={!podeEnviar} className={botaoPrincipalAds}>
              {ocupado ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
              Enviar para análise
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Campo({ id, rotulo, ajuda, extra, children }: { id: string; rotulo: string; ajuda?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">{rotulo}</label>
        {extra}
      </div>
      <div className="mt-1.5">{children}</div>
      {ajuda && <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{ajuda}</p>}
    </div>
  );
}
