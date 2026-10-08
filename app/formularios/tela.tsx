"use client";

// A tela do módulo Formulários Meta. À esquerda, os formulários instantâneos
// das páginas da Meta e o estado do recebimento; à direita, o formulário
// escolhido, no fluxo que ele pediu (2026-10-08): escolher o formulário →
// mapear o que cada pergunta vira no lead → decidir se entra numa etapa e num
// segmento.
//
// Usa o vocabulário das Configurações (app/configuracoes/secoes/pecas.tsx):
// Painel, Interruptor, campos de 36px. É uma tela de configurar, irmã daquelas.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import LogoMeta from "../components/logo-meta";
import type { EstadoIntegracaoMeta, FormularioMeta, PerguntaMeta } from "@/lib/meta-leads";
import type { CampoDoCrm } from "@/lib/webhooks";
import type { ConfigDoFormulario, ResumoDaConfig } from "./dados";
import {
  alternarFormulario,
  buscarLeadsAgora,
  estadoIntegracaoMeta,
  ligarRecebimentoMeta,
  salvarFormulario,
} from "./acoes";
import { botao, botaoSecundario, campoTexto, rotuloCampo, textoAjuda } from "../configuracoes/secoes/ui";
import { Erro, Interruptor, Painel, PainelTopo, Vazio } from "../configuracoes/secoes/pecas";
import { dataCurta, dataHora } from "../formato";

type Alvos = {
  funis: { id: string; nome: string }[];
  etapas: { id: string; nome: string; funil_id: string }[];
  segmentos: { id: string; nome: string }[];
  usuarios: { id: string; nome: string }[];
  camposCrm: CampoDoCrm[];
};

type Selecionado = FormularioMeta & { perguntas: PerguntaMeta[] };

export default function TelaFormularios({
  demo = false,
  formularios,
  erroMeta,
  resumo,
  selecionado,
  config,
  alvos,
  baseUrlPublica,
}: {
  /** ?demo=1 em desenvolvimento: formulários fictícios; os links mantêm o modo. */
  demo?: boolean;
  formularios: FormularioMeta[];
  erroMeta: string | null;
  resumo: Record<string, ResumoDaConfig>;
  selecionado: Selecionado | null;
  config: ConfigDoFormulario | null;
  alvos: Alvos;
  baseUrlPublica: boolean;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <Lista
        demo={demo}
        formularios={formularios}
        erroMeta={erroMeta}
        resumo={resumo}
        selecionadoId={selecionado?.id ?? null}
        baseUrlPublica={baseUrlPublica}
      />
      <main className={`min-w-0 flex-1 overflow-y-auto ${selecionado ? "block" : "hidden lg:block"}`}>
        {selecionado ? (
          // key pelo formulário: trocar de formulário remonta o editor, e o
          // rascunho de um não vaza para o outro.
          <Editor
            key={selecionado.id}
            demo={demo}
            formulario={selecionado}
            config={config}
            alvos={alvos}
            baseUrlPublica={baseUrlPublica}
          />
        ) : (
          <div className="flex min-h-full items-center justify-center p-8">
            {formularios.length === 0 && !erroMeta ? (
              <Vazio
                Icone={ClipboardList}
                titulo="A página ainda não tem formulário instantâneo"
                texto="Crie um no Gerenciador de Anúncios, num anúncio com objetivo de cadastro. Ele aparece aqui sozinho, e você escolhe o que cada pergunta vira e em que etapa o lead entra."
              />
            ) : (
              <Vazio
                Icone={ClipboardList}
                titulo="Escolha um formulário"
                texto="Para cada formulário você diz o que cada pergunta vira no lead e se ele entra numa etapa do funil e num segmento. Formulário sem configuração não traz lead — e não perde: o lead fica na Meta até você buscar."
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Lista ───────────────────────────────────────────────────────────────────

function Lista({
  demo,
  formularios,
  erroMeta,
  resumo,
  selecionadoId,
  baseUrlPublica,
}: {
  demo: boolean;
  formularios: FormularioMeta[];
  erroMeta: string | null;
  resumo: Record<string, ResumoDaConfig>;
  selecionadoId: string | null;
  baseUrlPublica: boolean;
}) {
  const paginas = [...new Set(formularios.map((f) => f.pagina.nome))];
  return (
    <aside
      className={`w-full shrink-0 flex-col border-r border-zinc-200 lg:flex lg:w-[22rem] dark:border-zinc-800 ${
        selecionadoId ? "hidden" : "flex"
      }`}
    >
      <header className="shrink-0 border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#0866FF]/10 text-[#0866FF]">
            <LogoMeta className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Formulários Meta
            </h1>
            <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
              {paginas.length > 0 ? `${paginas.join(", ")} · ` : ""}
              {formularios.length} {formularios.length === 1 ? "formulário" : "formulários"}
            </p>
          </div>
        </div>
        <Recebimento baseUrlPublica={baseUrlPublica} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {erroMeta ? (
          <Erro>{erroMeta}</Erro>
        ) : formularios.length === 0 ? (
          <p className="px-3 py-10 text-center text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">
            Nenhum formulário instantâneo nas páginas da Meta do CRM. Quando você criar um no Gerenciador
            de Anúncios, ele aparece aqui.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {formularios.map((f) => (
              <li key={f.id}>
                <CartaoFormulario
                  formulario={f}
                  resumo={resumo[f.id] ?? null}
                  aberto={f.id === selecionadoId}
                  href={`/formularios?form=${f.id}${demo ? "&demo=1" : ""}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function SeloStatus({ status }: { status: string }) {
  const ativo = status === "ACTIVE";
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${
        ativo
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {ativo ? "Ativo na Meta" : status === "ARCHIVED" ? "Arquivado" : status.toLowerCase()}
    </span>
  );
}

/** Para onde vai o lead deste formulário, numa linha. */
function destinoEmTexto(r: ResumoDaConfig | null): { texto: string; cor: string } {
  if (!r) return { texto: "Não configurado · os leads ficam na Meta", cor: "bg-amber-400" };
  if (!r.ativo) return { texto: "Pausado", cor: "bg-zinc-300 dark:bg-zinc-600" };
  const onde = r.criarOportunidade && r.etapa ? `Entra em ${r.etapa}` : "Vira contato";
  return { texto: r.segmento ? `${onde} · segmento ${r.segmento}` : onde, cor: "bg-emerald-500" };
}

function CartaoFormulario({
  formulario: f,
  resumo,
  aberto,
  href,
}: {
  formulario: FormularioMeta;
  resumo: ResumoDaConfig | null;
  aberto: boolean;
  href: string;
}) {
  const destino = destinoEmTexto(resumo);
  return (
    <Link
      href={href}
      aria-current={aberto ? "page" : undefined}
      className={`block rounded-xl border px-3.5 py-3 transition ${
        aberto
          ? "border-zinc-900 bg-white shadow-sm ring-1 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-900 dark:ring-zinc-100"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
      }`}
    >
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          {f.nome}
        </p>
        <SeloStatus status={f.status} />
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        {f.leads === null ? "—" : `${f.leads} ${f.leads === 1 ? "lead" : "leads"} na Meta`}
        {f.criadoEm && ` · criado em ${dataCurta(f.criadoEm)}`}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
        <span className={`size-1.5 shrink-0 rounded-full ${destino.cor}`} aria-hidden="true" />
        <span className="truncate">{destino.texto}</span>
        {resumo && resumo.recebidos7d > 0 && (
          <span className="ml-auto shrink-0 tabular-nums text-zinc-400">
            {resumo.recebidos7d} em 7 dias
          </span>
        )}
      </p>
    </Link>
  );
}

// ── Recebimento (o aviso da Meta + a varredura) ─────────────────────────────

function Recebimento({ baseUrlPublica }: { baseUrlPublica: boolean }) {
  const [estado, setEstado] = useState<EstadoIntegracaoMeta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, iniciar] = useTransition();

  // São umas cinco leituras na Meta e no n8n: vêm depois de a tela abrir, como o
  // estado das instâncias em Configurações · WhatsApp.
  useEffect(() => {
    let vivo = true;
    estadoIntegracaoMeta()
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado(null))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [versao]);

  function recarregar() {
    setCarregando(true);
    setVersao((v) => v + 1);
  }

  function ligar() {
    setAviso(null);
    iniciar(async () => {
      const r = await ligarRecebimentoMeta();
      setAviso({ ok: r.ok, texto: r.mensagem });
      if (r.ok) recarregar();
    });
  }

  const itens = estado
    ? [
        { rotulo: "Aviso na hora (webhook da Meta)", ok: estado.webhookDoApp.ligado },
        ...estado.paginas.map((p) => ({ rotulo: `Página ${p.nome} inscrita`, ok: p.inscrita })),
        { rotulo: "Varredura de 5 em 5 minutos", ok: estado.varredura === true },
      ]
    : [];
  const tudoLigado = itens.length > 0 && itens.every((i) => i.ok);

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full ${
            carregando ? "bg-zinc-300 dark:bg-zinc-600" : tudoLigado ? "bg-emerald-500" : "bg-amber-400"
          }`}
          aria-hidden="true"
        />
        <span className="flex-1 text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
          {carregando ? "Conferindo o recebimento…" : tudoLigado ? "Recebimento ligado" : "Recebimento desligado"}
        </span>
        <button
          type="button"
          onClick={recarregar}
          disabled={carregando}
          aria-label="Conferir de novo"
          title="Conferir de novo"
          className="flex size-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <RefreshCw className={`size-3 ${carregando ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {!carregando && !tudoLigado && (
        <>
          <ul className="mt-2 flex flex-col gap-1">
            {itens.map((i) => (
              <li key={i.rotulo} className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                {i.ok ? (
                  <Check className="size-3 text-emerald-600" strokeWidth={3} aria-hidden="true" />
                ) : (
                  <X className="size-3 text-zinc-400" aria-hidden="true" />
                )}
                {i.rotulo}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={ligar}
            disabled={ocupado || !baseUrlPublica}
            title={baseUrlPublica ? undefined : "Só pelo endereço de produção"}
            className={`${botao} mt-2.5 h-8 w-full text-[12px]`}
          >
            {ocupado ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <LogoMeta className="size-3.5" aria-hidden="true" />}
            Ligar recebimento
          </button>
          {!baseUrlPublica && (
            <p className="mt-1.5 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
              Liga-se pelo endereço de produção: é para ele que a Meta e a varredura vão apontar.
            </p>
          )}
        </>
      )}
      {aviso && (
        <p className={`mt-2 text-[11px] leading-snug ${aviso.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
          {aviso.texto}
        </p>
      )}
      {estado && estado.erros.length > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">{estado.erros.join(" · ")}</p>
      )}
    </div>
  );
}

// ── Editor de um formulário ─────────────────────────────────────────────────

/** O destino padrão de uma pergunta que ainda não foi configurada. */
function destinoPadrao(p: PerguntaMeta): string {
  // Os tipos que a Meta dá às perguntas-padrão. WHATSAPP_NUMBER é o do campo
  // "Número do WhatsApp" (o formulário da AMAAN de 2026-10-08 usa este, e não
  // PHONE): sem ele no padrão, o lead chegaria sem WhatsApp e a IA não falaria.
  const porTipo: Record<string, string> = {
    FULL_NAME: "contato.nome",
    PHONE: "contato.whatsapp",
    WHATSAPP_NUMBER: "contato.whatsapp",
    EMAIL: "contato.email",
    CITY: "contato.cidade",
    STATE: "contato.estado",
    COUNTRY: "contato.pais",
  };
  const porChave: Record<string, string> = {
    full_name: "contato.nome",
    phone_number: "contato.whatsapp",
    email: "contato.email",
    city: "contato.cidade",
    state: "contato.estado",
  };
  return porChave[p.chave] ?? porTipo[p.tipo] ?? "guardar";
}

const GUARDAR = "guardar";

function Editor({
  demo,
  formulario,
  config,
  alvos,
  baseUrlPublica,
}: {
  demo: boolean;
  formulario: Selecionado;
  config: ConfigDoFormulario | null;
  alvos: Alvos;
  baseUrlPublica: boolean;
}) {
  const router = useRouter();

  // O que cada pergunta vira, codificado num valor de <select>: "guardar",
  // "ignorar", "contato.nome", "contato.campo:<chave do campo>"…
  const [destinos, setDestinos] = useState<Record<string, string>>(() => {
    const salvo = new Map(
      (config?.campos ?? []).map((c) => [c.chave, c.destinoChave ? `${c.destino}:${c.destinoChave}` : c.destino]),
    );
    return Object.fromEntries(
      formulario.perguntas.map((p) => [p.chave, config ? (salvo.get(p.chave) ?? GUARDAR) : destinoPadrao(p)]),
    );
  });
  const [criarOp, setCriarOp] = useState(config ? config.criarOportunidade : true);
  const [funilId, setFunilId] = useState(config?.funilId ?? alvos.funis[0]?.id ?? "");
  const [etapaId, setEtapaId] = useState(
    config?.etapaId ?? alvos.etapas.find((e) => e.funil_id === (config?.funilId ?? alvos.funis[0]?.id))?.id ?? "",
  );
  const [responsavelId, setResponsavelId] = useState(config?.responsavelId ?? "");
  const [alternadoId, setAlternadoId] = useState(config?.responsavelAlternadoId ?? "");
  const [segmentoId, setSegmentoId] = useState(config?.segmentoId ?? "");
  const [ativo, setAtivo] = useState(config?.ativo ?? true);

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const [buscando, iniciarBusca] = useTransition();

  const etapasDoFunil = useMemo(() => alvos.etapas.filter((e) => e.funil_id === funilId), [alvos.etapas, funilId]);
  const camposContato = alvos.camposCrm.filter((c) => c.entidade === "contato");
  const camposOportunidade = alvos.camposCrm.filter((c) => c.entidade === "oportunidade");

  function salvar() {
    setErro(null);
    setAviso(null);
    const campos = formulario.perguntas
      .map((p) => {
        const v = destinos[p.chave] ?? GUARDAR;
        if (v === GUARDAR) return null;
        const [destino, destinoChave = ""] = v.split(":");
        return { chave: p.chave, destino, destinoChave };
      })
      .filter((c): c is { chave: string; destino: string; destinoChave: string } => c !== null);
    iniciar(async () => {
      const r = await salvarFormulario({
        formId: formulario.id,
        campos,
        criarOportunidade: criarOp,
        funilId,
        etapaId,
        responsavelId,
        responsavelAlternadoId: alternadoId,
        segmentoId,
        ativo,
      });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setAviso(config ? "Salvo." : "Salvo. Os próximos leads deste formulário já entram assim.");
      router.refresh();
    });
  }

  function alternar(v: boolean) {
    setAtivo(v);
    if (!config) return; // ainda não salvo: vale no Salvar
    setErro(null);
    iniciar(async () => {
      const r = await alternarFormulario(formulario.id, v);
      if (!r.ok) {
        setAtivo(!v);
        setErro(r.erro);
        return;
      }
      router.refresh();
    });
  }

  function buscar() {
    setErro(null);
    setAviso(null);
    iniciarBusca(async () => {
      const r = await buscarLeadsAgora(formulario.id);
      if (!r.ok) {
        setErro(r.mensagem);
        return;
      }
      const v = r.resultado;
      setAviso(
        `Últimos 7 dias: ${v.novos} ${v.novos === 1 ? "lead novo" : "leads novos"}, ${v.repetidos} já ${
          v.repetidos === 1 ? "estava" : "estavam"
        } no CRM.${v.erros.length ? ` Falhas: ${v.erros.join("; ")}` : ""}`,
      );
      if (v.novos > 0) router.refresh();
    });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 pt-8">
      <Link
        href={demo ? "/formularios?demo=1" : "/formularios"}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-[12px] font-medium text-zinc-500 hover:text-zinc-900 lg:hidden dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Formulários
      </Link>

      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#0866FF]/10 text-[#0866FF]">
            <LogoMeta className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{formulario.nome}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-zinc-500 dark:text-zinc-400">
              <SeloStatus status={formulario.status} />
              <span>{formulario.pagina.nome}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {formulario.leads === null ? "—" : `${formulario.leads} ${formulario.leads === 1 ? "lead" : "leads"} na Meta`}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formulario.perguntas.length} perguntas</span>
            </p>
          </div>
        </div>
        {config && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {ativo ? "Recebendo leads" : "Pausado"}
              <Interruptor ligado={ativo} aoMudar={alternar} rotulo="Receber leads deste formulário" disabled={salvando} />
            </label>
            <button
              type="button"
              onClick={buscar}
              disabled={buscando || !baseUrlPublica || !ativo}
              title={
                !baseUrlPublica
                  ? "Só pelo endereço de produção"
                  : !ativo
                    ? "Ligue o recebimento para buscar"
                    : "Traz os leads dos últimos 7 dias que ainda não entraram"
              }
              className={botaoSecundario}
            >
              {buscando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
              Buscar leads agora
            </button>
          </div>
        )}
      </header>

      {!config && (
        <p className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[13px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
          <Inbox className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
          Este formulário ainda não traz leads para o CRM. Diga abaixo o que cada pergunta vira e para onde o
          lead vai, e salve — os próximos leads já entram assim.
        </p>
      )}

      {/* ── 1 · Perguntas ── */}
      <Painel className="overflow-hidden">
        <PainelTopo
          titulo={<Passo n={1}>O que cada pergunta vira</Passo>}
          descricao="Para onde vai cada resposta no CRM. “Só guardar na ficha” deixa a resposta no contato com o nome da pergunta — a IA enxerga."
        />
        {formulario.perguntas.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-zinc-400">A Meta não devolveu as perguntas deste formulário.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {formulario.perguntas.map((p) => {
              const valor = destinos[p.chave] ?? GUARDAR;
              const multipla = p.opcoes.length > 0;
              return (
                <li key={p.chave} className="grid gap-2.5 px-5 py-3.5 sm:grid-cols-[1fr_260px] sm:items-start">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium leading-snug text-zinc-900 dark:text-zinc-50">{p.rotulo}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{p.chave}</p>
                    {multipla && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.opcoes.slice(0, 6).map((o) => (
                          <span
                            key={o}
                            className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                          >
                            {o}
                          </span>
                        ))}
                        {p.opcoes.length > 6 && <span className="px-1 py-0.5 text-[11px] text-zinc-400">+{p.opcoes.length - 6}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <select
                      value={valor}
                      onChange={(e) => setDestinos((d) => ({ ...d, [p.chave]: e.target.value }))}
                      aria-label={`O que "${p.rotulo}" vira no lead`}
                      className={`${campoTexto} ${valor === GUARDAR ? "text-zinc-500" : valor === "ignorar" ? "text-zinc-400 line-through" : "font-medium"}`}
                    >
                      <option value={GUARDAR}>Só guardar na ficha</option>
                      <optgroup label="Contato">
                        <option value="contato.nome">Nome</option>
                        <option value="contato.whatsapp">WhatsApp</option>
                        <option value="contato.email">E-mail</option>
                        <option value="contato.cidade">Cidade</option>
                        <option value="contato.estado">Estado</option>
                        <option value="contato.pais">País</option>
                        {camposContato.map((c) => (
                          <option key={c.chave} value={`contato.campo:${c.chave}`}>
                            Campo: {c.rotulo}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Oportunidade">
                        <option value="oportunidade.nome">Título do card</option>
                        <option value="oportunidade.valor">Valor</option>
                        {camposOportunidade.map((c) => (
                          <option key={c.chave} value={`oportunidade.campo:${c.chave}`}>
                            Campo: {c.rotulo}
                          </option>
                        ))}
                      </optgroup>
                      <option value="ignorar">Não usar</option>
                    </select>
                    {valor === "oportunidade.valor" && multipla && (
                      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
                        Pergunta de múltipla escolha: o valor sairia errado (os dígitos da faixa juntos). Use um campo
                        personalizado.
                      </p>
                    )}
                    {valor.startsWith("oportunidade.") && !criarOp && (
                      <p className="text-[11px] leading-snug text-zinc-400">Só vale com “Criar oportunidade” ligado.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Painel>

      {/* ── 2 · Para onde o lead vai ── */}
      <Painel className="overflow-hidden">
        <PainelTopo
          titulo={<Passo n={2}>Para onde o lead vai</Passo>}
          descricao="O contato sempre entra — ou é reaproveitado, se já existe pelo telefone ou pelo e-mail."
        />
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Entrar numa etapa do funil</p>
                <p className={`${textoAjuda} mt-0.5`}>
                  O lead vira um card na etapa. Se ela tiver cadência, ele entra nela; se tiver IA, ela conversa.
                </p>
              </div>
              <Interruptor ligado={criarOp} aoMudar={setCriarOp} rotulo="Criar oportunidade numa etapa" />
            </div>
            {criarOp && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className={rotuloCampo}>Funil</span>
                  <select
                    value={funilId}
                    onChange={(e) => {
                      setFunilId(e.target.value);
                      setEtapaId(alvos.etapas.find((et) => et.funil_id === e.target.value)?.id ?? "");
                    }}
                    className={campoTexto}
                  >
                    {alvos.funis.length === 0 && <option value="">Nenhum funil</option>}
                    {alvos.funis.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={rotuloCampo}>Etapa</span>
                  <select value={etapaId} onChange={(e) => setEtapaId(e.target.value)} className={campoTexto}>
                    {etapasDoFunil.length === 0 && <option value="">Este funil não tem etapas</option>}
                    {etapasDoFunil.map((et) => (
                      <option key={et.id} value={et.id}>
                        {et.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={rotuloCampo}>Responsável</span>
                  <select
                    value={responsavelId}
                    onChange={(e) => {
                      setResponsavelId(e.target.value);
                      if (!e.target.value) setAlternadoId("");
                    }}
                    className={campoTexto}
                  >
                    <option value="">Ninguém</option>
                    {alvos.usuarios.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={rotuloCampo}>
                    Alternar com <span className="font-normal text-zinc-400">· rodízio, opcional</span>
                  </span>
                  <select
                    value={alternadoId}
                    onChange={(e) => setAlternadoId(e.target.value)}
                    disabled={!responsavelId}
                    className={campoTexto}
                  >
                    <option value="">Sem rodízio</option>
                    {alvos.usuarios
                      .filter((u) => u.id !== responsavelId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Entrar num segmento</p>
              <p className={`${textoAjuda} mt-0.5`}>Para disparar e automatizar por público. Opcional.</p>
            </div>
            <select
              value={segmentoId}
              onChange={(e) => setSegmentoId(e.target.value)}
              aria-label="Segmento"
              className={`${campoTexto} sm:w-64`}
            >
              <option value="">Nenhum segmento</option>
              {alvos.segmentos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Painel>

      {/* ── Leads que já entraram ── */}
      {config && (
        <Painel className="overflow-hidden">
          <PainelTopo
            titulo="Leads recebidos"
            contagem={config.recebidos.total}
            descricao={
              config.recebidos.ultimo
                ? `O último entrou em ${dataHora(config.recebidos.ultimo)}.${config.recebidos.falhas ? ` ${config.recebidos.falhas} com problema.` : ""}`
                : "Nenhum lead deste formulário entrou ainda."
            }
          />
          {config.recentes.length > 0 && (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {config.recentes.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${r.estado === "ok" ? "bg-emerald-500" : r.estado === "erro" ? "bg-rose-500" : "bg-amber-400"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-900 dark:text-zinc-50">
                    {r.contatoNome ?? "—"}
                    <span className="text-zinc-400"> · {r.erro ?? r.resumo ?? ""}</span>
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-zinc-400">{dataHora(r.quando)}</span>
                </li>
              ))}
            </ul>
          )}
        </Painel>
      )}

      {/* A barra de salvar fica presa ao pé da tela: o formulário é longo, e
          rolar até o fim para salvar seria o passo esquecido. */}
      {/* pr-20: o botão redondo da IA (✳) fica preso ao canto de baixo da tela
          e cobria o Salvar. */}
      <div className="sticky bottom-0 -mx-6 mt-auto border-t border-zinc-200 bg-conteudo/95 py-3 pl-6 pr-20 backdrop-blur dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            {erro ? (
              <Erro>{erro}</Erro>
            ) : aviso ? (
              <p className="flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
                <Check className="size-3.5" aria-hidden="true" />
                {aviso}
              </p>
            ) : (
              <p className={textoAjuda}>
                {config ? "As mudanças valem para os próximos leads." : "Nada entra até você salvar."}
              </p>
            )}
          </div>
          {!config && (
            <label className="flex items-center gap-2 text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
              Já começar a receber
              <Interruptor ligado={ativo} aoMudar={setAtivo} rotulo="Já começar a receber" />
            </label>
          )}
          <button type="button" onClick={salvar} disabled={salvando} className={botao}>
            {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
            {config ? "Salvar" : "Salvar configuração"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Passo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
        {n}
      </span>
      {children}
    </span>
  );
}
