"use client";

// Campanhas: Meta Ads e campanhas de WhatsApp pela API oficial.
//
// A barra da esquerda escolhe o canal; em WhatsApp, uma segunda coluna lista as
// campanhas e o centro mostra a escolhida (números + fluxo) ou o formulário da
// nova. Status, falhas e datas aparecem em português e por extenso — o código
// cru ("parcial", "processando") não diz a quem lê o que aconteceu.
import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Send,
} from "lucide-react";
import { consultar, useConsulta } from "./use-consulta";
import PainelAds from "./painel-ads";
import FluxoCampanha from "./fluxo-campanha";
import IaCampanhas from "./ia-campanhas";
import { Aviso, Vazio, botaoAds, botaoIconeAds, botaoIconePrincipalAds, botaoPrincipalAds, campoAds } from "./pecas";
import { confirmar } from "../components/confirmar";

type Segmento = { id: string; nome: string; contatos: number };
type Opcao = { id: string; nome: string };
type EtapaOpcao = Opcao & { funil_id: string };
type AcaoFluxo =
  | { tipo: "registrar_lead" }
  | { tipo: "adicionar_tag"; tagId: string }
  | { tipo: "adicionar_segmento"; segmentoId: string }
  | { tipo: "criar_oportunidade"; funilId: string; etapaId: string; nome: string };
type StatusMeta = {
  permissoes: string[];
  contasAds: Array<{ id: string; name: string; currency: string }>;
  wabas: Array<{ id: string; name: string }>;
  telefones: Array<{ id: string; display_phone_number: string; verified_name: string }>;
  templates: Array<{ id: string; name: string; language: string; status: string; category: string }>;
  erroWhatsApp: string | null;
};
type CampanhaWpp = {
  id: string;
  nome: string;
  segmento_nome: string;
  template_nome: string;
  template_idioma: string;
  telefone_exibicao: string;
  status: string;
  total: number;
  enviados: number;
  aguardando: number;
  responderam: number;
  expiraram: number;
  falharam: number;
  conversoes: number;
  definicao: {
    template_nome?: string;
    template_idioma?: string;
    espera_minutos: number;
    ao_responder: AcaoFluxo[];
    ao_expirar: AcaoFluxo[];
  };
  falhas: Array<{ contato: string; erro: string }>;
  data_criacao: string;
  data_conclusao: string | null;
};

// Os status de campanhas_whatsapp (migration-campanhas-whatsapp-fluxo.sql).
const STATUS: Record<string, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "Rascunho", classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  ativa: { rotulo: "Ativa", classe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  processando: { rotulo: "Enviando", classe: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  concluida: { rotulo: "Concluída", classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  parcial: { rotulo: "Concluída com falhas", classe: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  falhou: { rotulo: "Falhou", classe: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  pausada: { rotulo: "Pausada", classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};
const statusDe = (s: string) => STATUS[s] ?? { rotulo: s, classe: STATUS.rascunho.classe };

const numero = (v: number) => v.toLocaleString("pt-BR");
const porcento = (parte: number, todo: number) => (todo > 0 ? `${Math.round((parte / todo) * 100)}%` : "—");
const data = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function PainelCampanhasMeta({
  segmentos,
  tags,
  funis,
  etapas,
}: {
  segmentos: Segmento[];
  tags: Opcao[];
  funis: Opcao[];
  etapas: EtapaOpcao[];
}) {
  const [aba, setAba] = useState<"ads" | "whatsapp">("ads");
  const [canaisRecolhidos, setCanaisRecolhidos] = useState(false);
  const { dados: status, erro, carregando, atualizar: carregar } = useConsulta<StatusMeta>("/api/meta/status");

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <aside
        className={`flex h-screen shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 p-2 transition-[width] dark:border-zinc-800 ${
          canaisRecolhidos ? "w-[60px]" : "w-[200px]"
        }`}
      >
        <div className={`mb-1 flex items-center py-1.5 ${canaisRecolhidos ? "justify-center" : "px-2.5"}`}>
          {!canaisRecolhidos && (
            <h1 className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Campanhas</h1>
          )}
          <BotaoRecolher recolhida={canaisRecolhidos} alternar={() => setCanaisRecolhidos((v) => !v)} />
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Canais de campanha">
          {!canaisRecolhidos && <h2 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Canais</h2>}
          <ItemNav ativo={aba === "ads"} onClick={() => setAba("ads")} Icone={BarChart3} recolhida={canaisRecolhidos}>
            Meta Ads
          </ItemNav>
          <ItemNav ativo={aba === "whatsapp"} onClick={() => setAba("whatsapp")} Icone={MessageCircle} recolhida={canaisRecolhidos}>
            WhatsApp
          </ItemNav>
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {carregando ? (
          <div className="px-6 py-6">
            <Vazio Icone={LoaderCircle} texto="Consultando a Meta…" girando />
          </div>
        ) : erro ? (
          <div className="max-w-2xl space-y-3 px-6 py-6">
            <Aviso erro texto={erro} />
            <button type="button" onClick={() => void carregar()} className={botaoAds}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        ) : (
          status &&
          (aba === "ads" ? (
            <PainelAds contas={status.contasAds} />
          ) : (
            <WhatsApp status={status} segmentos={segmentos} tags={tags} funis={funis} etapas={etapas} atualizar={carregar} />
          ))
        )}
      </main>
    </div>
  );
}

function ItemNav({
  ativo,
  onClick,
  Icone,
  children,
  recolhida = false,
}: {
  ativo: boolean;
  onClick: () => void;
  Icone: typeof BarChart3;
  children: string;
  recolhida?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "page" : undefined}
      aria-label={recolhida ? children : undefined}
      title={recolhida ? children : undefined}
      className={`flex items-center rounded-lg py-2 text-left text-[13px] transition-colors ${recolhida ? "justify-center px-0" : "gap-2.5 px-2.5"} ${
        ativo
          ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"
      }`}
    >
      <Icone className="size-4 shrink-0" aria-hidden="true" />
      {!recolhida && <span className="truncate">{children}</span>}
    </button>
  );
}

function BotaoRecolher({ recolhida, alternar }: { recolhida: boolean; alternar: () => void }) {
  const Icone = recolhida ? PanelLeft : PanelLeftClose;
  const rotulo = recolhida ? "Expandir barra" : "Recolher barra";
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={rotulo}
      title={rotulo}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      <Icone className="size-4" aria-hidden="true" />
    </button>
  );
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

type Retorno = { ok: boolean; texto: string } | null;

function WhatsApp({
  status,
  segmentos,
  tags,
  funis,
  etapas,
  atualizar,
}: {
  status: StatusMeta;
  segmentos: Segmento[];
  tags: Opcao[];
  funis: Opcao[];
  etapas: EtapaOpcao[];
  atualizar: () => Promise<void>;
}) {
  const [listaRecolhida, setListaRecolhida] = useState(false);
  const { dados: lista, erro: erroLista, carregando, atualizar: listar } = useConsulta<{ campanhas: CampanhaWpp[] }>(
    "/api/meta/whatsapp/campanhas",
  );
  const campanhas = lista?.campanhas ?? [];
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const aprovados = status.templates.filter((t) => t.status === "APPROVED");
  const [nome, setNome] = useState("");
  const [segmentoIds, setSegmentoIds] = useState<string[]>(segmentos[0] ? [segmentos[0].id] : []);
  const [template, setTemplate] = useState(aprovados[0]?.name ?? "");
  const [idioma, setIdioma] = useState(aprovados[0]?.language ?? "pt_BR");
  const [espera, setEspera] = useState(1440);
  const [aoResponder, setAoResponder] = useState<AcaoFluxo[]>([{ tipo: "registrar_lead" }]);
  const [aoExpirar, setAoExpirar] = useState<AcaoFluxo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [retorno, setRetorno] = useState<Retorno>(null);

  if (!status.wabas.length || !status.telefones.length) {
    return (
      <div className="max-w-2xl px-6 py-6">
        <Aviso texto={status.erroWhatsApp ?? "A conexão do WhatsApp Business ainda não tem conta e número acessíveis."} />
      </div>
    );
  }

  const telefone = status.telefones[0];
  const campanha = nova ? null : (campanhas.find((c) => c.id === selecionada) ?? campanhas[0] ?? null);
  // Soma por segmento: quem está em dois segmentos conta duas vezes aqui, e o
  // envio manda uma vez só — por isso "até".
  const alcance = segmentos.filter((s) => segmentoIds.includes(s.id)).reduce((n, s) => n + s.contatos, 0);

  async function disparar() {
    const ok = await confirmar({
      titulo: `Ativar “${nome.trim()}”?`,
      mensagem: `O template começa a sair agora, pelo número ${telefone.display_phone_number}, para até ${numero(alcance)} contatos dos segmentos escolhidos. Depois de ativada, a campanha não pode ser desfeita.`,
      acao: "Ativar e enviar",
    });
    if (!ok) return;
    setEnviando(true);
    setRetorno(null);
    try {
      const resultado = await consultar<{ id: string; total: number }>("/api/meta/whatsapp/campanhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmar: true,
          nome,
          segmentoIds,
          waba: status.wabas[0].id,
          telefoneId: telefone.id,
          telefoneExibicao: telefone.display_phone_number,
          definicao: {
            template_nome: template,
            template_idioma: idioma,
            espera_minutos: espera,
            ao_responder: aoResponder,
            ao_expirar: aoExpirar,
          },
        }),
      });
      setSelecionada(resultado.id);
      setNova(false);
      setRetorno({ ok: true, texto: `Campanha ativada para ${numero(resultado.total)} contatos.` });
      await listar();
    } catch (e) {
      setRetorno({ ok: false, texto: e instanceof Error ? e.message : "Falha ao ativar a campanha." });
    } finally {
      setEnviando(false);
    }
  }

  async function ativarRascunho() {
    if (!campanha) return;
    const ok = await confirmar({
      titulo: `Ativar “${campanha.nome}”?`,
      mensagem: `Os contatos de “${campanha.segmento_nome}” são inscritos e o template começa a sair agora. Depois de ativada, a campanha não pode ser desfeita.`,
      acao: "Ativar e enviar",
    });
    if (!ok) return;
    setEnviando(true);
    setRetorno(null);
    try {
      const j = await consultar<{ total: number }>(`/api/meta/whatsapp/campanhas/${campanha.id}/ativar`, { method: "POST" });
      setRetorno({ ok: true, texto: `Campanha ativada para ${numero(j.total)} contatos.` });
      await listar();
    } catch (e) {
      setRetorno({ ok: false, texto: e instanceof Error ? e.message : "Falha ao ativar a campanha." });
    } finally {
      setEnviando(false);
    }
  }

  function abrir(id: string | null, criar = false) {
    setSelecionada(id);
    setNova(criar);
    setRetorno(null);
  }

  return (
    <section className="flex h-screen overflow-hidden">
      {/* Lista de campanhas */}
      <aside
        className={`flex h-screen shrink-0 flex-col border-r border-zinc-200 transition-[width] dark:border-zinc-800 ${
          listaRecolhida ? "w-[60px]" : "w-[250px]"
        }`}
      >
        <div
          className={`flex border-b border-zinc-200 p-3 dark:border-zinc-800 ${
            listaRecolhida ? "flex-col items-center gap-1" : "items-center gap-2"
          }`}
        >
          <button
            type="button"
            title="Nova campanha"
            aria-label={listaRecolhida ? "Nova campanha" : undefined}
            onClick={() => abrir(null, true)}
            className={listaRecolhida ? botaoIconePrincipalAds : `${botaoPrincipalAds} min-w-0 flex-1`}
          >
            <Send className="size-3.5" aria-hidden="true" />
            {!listaRecolhida && "Nova campanha"}
          </button>
          <BotaoRecolher recolhida={listaRecolhida} alternar={() => setListaRecolhida((v) => !v)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!listaRecolhida && <p className="px-2.5 pb-2 pt-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Campanhas</p>}
          {campanhas.map((c) => {
            const ativa = !nova && c.id === campanha?.id;
            const s = statusDe(c.status);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => abrir(c.id)}
                aria-current={ativa ? "true" : undefined}
                aria-label={listaRecolhida ? c.nome : undefined}
                title={listaRecolhida ? c.nome : undefined}
                className={`mb-0.5 w-full rounded-lg px-2.5 py-2 text-left transition ${
                  ativa ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                }`}
              >
                {listaRecolhida ? (
                  <MessageCircle className="mx-auto size-4 text-zinc-500" aria-hidden="true" />
                ) : (
                  <>
                    <span className="block truncate text-[12.5px] font-medium text-zinc-900 dark:text-zinc-50">{c.nome}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold ${s.classe}`}>{s.rotulo}</span>
                      <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{c.segmento_nome}</span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
          {!listaRecolhida && carregando && campanhas.length === 0 && (
            <p className="flex items-center gap-2 px-2.5 py-4 text-[12px] text-zinc-400">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Carregando…
            </p>
          )}
          {!listaRecolhida && !carregando && campanhas.length === 0 && (
            <p className="px-2.5 py-4 text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">Nenhuma campanha ainda.</p>
          )}
        </div>
      </aside>

      {/* Centro */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6 xl:px-10">
        <div className="mx-auto max-w-5xl">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {nova ? "Nova campanha" : (campanha?.nome ?? "Campanhas de WhatsApp")}
                </h2>
                {campanha && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusDe(campanha.status).classe}`}>
                    {statusDe(campanha.status).rotulo}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                {nova
                  ? "Escolha o público, o template aprovado e o que fazer com quem responder ou não."
                  : campanha
                    ? `${campanha.segmento_nome} · ${campanha.template_nome} · criada em ${data(campanha.data_criacao)}${
                        campanha.data_conclusao ? ` · concluída em ${data(campanha.data_conclusao)}` : ""
                      }`
                    : "Selecione uma campanha para ver os números."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void atualizar();
                void listar();
              }}
              aria-label="Atualizar"
              title="Atualizar"
              className={botaoIconeAds}
            >
              <RefreshCw className={`size-4 ${carregando ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
          </header>

          {retorno && (
            <p
              role={retorno.ok ? "status" : "alert"}
              className={`surge mt-4 rounded-lg border px-3 py-2 text-[12px] ${
                retorno.ok
                  ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border-red-300 bg-red-50/60 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
              }`}
            >
              {retorno.texto}
            </p>
          )}

          {erroLista ? (
            <div className="mt-5">
              <Aviso erro texto={erroLista} />
            </div>
          ) : nova ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">Público e envio</h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome da campanha" htmlFor="campanha-nome">
                    <input
                      id="campanha-nome"
                      className={campoAds}
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Lançamento de setembro"
                    />
                  </Campo>
                  <Campo rotulo="Número que envia">
                    <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[13px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                      {telefone.verified_name} · {telefone.display_phone_number}
                    </p>
                  </Campo>
                  <fieldset className="sm:col-span-2">
                    <legend className="flex w-full items-baseline justify-between text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
                      Segmentos
                      <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                        {segmentoIds.length ? `até ${numero(alcance)} contatos com WhatsApp` : "nenhum escolhido"}
                      </span>
                    </legend>
                    {segmentos.length === 0 ? (
                      <p className="mt-1.5 text-[12px] text-zinc-500">
                        Nenhum segmento criado.{" "}
                        <Link href="/configuracoes/segmentos" className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100">
                          Criar em Configurações
                        </Link>
                      </p>
                    ) : (
                      <div className="mt-1.5 grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-zinc-200 p-1.5 sm:grid-cols-2 dark:border-zinc-800">
                        {segmentos.map((s) => (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                          >
                            <input
                              type="checkbox"
                              className="accent-zinc-900 dark:accent-zinc-100"
                              checked={segmentoIds.includes(s.id)}
                              onChange={(e) =>
                                setSegmentoIds((atuais) => (e.target.checked ? [...atuais, s.id] : atuais.filter((id) => id !== s.id)))
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                            <span className="tabular-nums text-zinc-400">{numero(s.contatos)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                </div>
              </div>

              {aprovados.length === 0 && (
                <Aviso
                  texto="Nenhum template aprovado nesta conta. Campanha pela API oficial só pode começar com template aprovado pela Meta."
                  detalhe="Crie um em Templates e volte quando ele for aprovado."
                />
              )}

              <FluxoCampanha
                template={template}
                idioma={idioma}
                espera={espera}
                templates={status.templates}
                mudarTemplate={(n, lingua) => {
                  setTemplate(n);
                  setIdioma(lingua);
                }}
                mudarEspera={setEspera}
                aoResponder={aoResponder}
                aoExpirar={aoExpirar}
                editavel
                tags={tags}
                segmentos={segmentos}
                funis={funis}
                etapas={etapas}
                mudarResponder={setAoResponder}
                mudarExpirar={setAoExpirar}
              />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={enviando || !nome.trim() || !segmentoIds.length || !template}
                  onClick={() => void disparar()}
                  className={botaoPrincipalAds}
                >
                  {enviando ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
                  Ativar campanha
                </button>
                {(!nome.trim() || !segmentoIds.length || !template) && (
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Falta:{" "}
                    {[!nome.trim() && "nome", !segmentoIds.length && "segmento", !template && "template"].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </div>
          ) : campanha ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metrica titulo="Contatos" valor={numero(campanha.total)} />
                <Metrica titulo="Aguardando resposta" valor={numero(campanha.aguardando)} />
                <Metrica titulo="Responderam" valor={numero(campanha.responderam)} detalhe={porcento(campanha.responderam, campanha.total)} />
                <Metrica titulo="Sem resposta" valor={numero(campanha.expiraram)} />
                <Metrica titulo="Conversões" valor={numero(campanha.conversoes)} detalhe={porcento(campanha.conversoes, campanha.total)} />
                <Metrica titulo="Falhas" valor={numero(campanha.falharam)} alerta={campanha.falharam > 0} />
              </div>

              {campanha.falhas.length > 0 && (
                <details className="mt-4 rounded-2xl border border-red-200 bg-red-50/40 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                  <summary className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-red-700 dark:text-red-300">
                    <CircleAlert className="size-3.5" aria-hidden="true" />
                    Ver por que {campanha.falhas.length === 1 ? "1 envio falhou" : `${numero(campanha.falhas.length)} envios falharam`}
                  </summary>
                  <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto text-[12px]">
                    {campanha.falhas.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-40 shrink-0 truncate font-medium text-zinc-800 dark:text-zinc-200">{f.contato}</span>
                        <span className="min-w-0 text-zinc-600 dark:text-zinc-400">{f.erro}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="mt-4">
                <FluxoCampanha
                  template={campanha.definicao.template_nome || campanha.template_nome}
                  idioma={campanha.definicao.template_idioma || campanha.template_idioma}
                  espera={campanha.definicao.espera_minutos}
                  aoResponder={campanha.definicao.ao_responder}
                  aoExpirar={campanha.definicao.ao_expirar}
                />
              </div>

              {campanha.status === "rascunho" && (
                <button type="button" disabled={enviando} onClick={() => void ativarRascunho()} className={`${botaoPrincipalAds} mt-4`}>
                  {enviando ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
                  Ativar campanha
                </button>
              )}
            </>
          ) : carregando ? (
            <div className="mt-5">
              <Vazio Icone={LoaderCircle} texto="Carregando campanhas…" girando />
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
              <MessageCircle className="size-5 text-zinc-400" aria-hidden="true" />
              <p className="mt-2 text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Nenhuma campanha de WhatsApp ainda</p>
              <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                Envie um template aprovado para um segmento e decida o que acontece com quem responder.
              </p>
              <button type="button" onClick={() => abrir(null, true)} className={`${botaoPrincipalAds} mt-4`}>
                <Send className="size-3.5" aria-hidden="true" />
                Criar a primeira
              </button>
            </div>
          )}
        </div>
      </div>
      <IaCampanhas aoAplicar={() => void listar()} />
    </section>
  );
}

function Campo({ rotulo, htmlFor, children }: { rotulo: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
        {rotulo}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Metrica({ titulo, valor, detalhe, alerta }: { titulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        alerta ? "border-red-200 dark:border-red-900/60" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{titulo}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className={`text-lg font-semibold tabular-nums ${alerta ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}`}>
          {valor}
        </span>
        {detalhe && <span className="text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">{detalhe}</span>}
      </p>
    </div>
  );
}
