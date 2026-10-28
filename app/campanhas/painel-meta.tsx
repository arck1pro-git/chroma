"use client";

// A tela de Campanhas: os canais à esquerda (Meta Ads e Campanhas de WPP) e o
// painel do canal escolhido. Nas Campanhas de WPP, a lista das campanhas e, ao
// lado, a campanha aberta (fluxo/ver-campanha.tsx) ou o construtor de blocos
// (fluxo/editor-campanha.tsx, sobre fluxo-campanha.tsx).
//
// As duas colunas da esquerda nascem recolhidas abaixo de 1280px de largura,
// como a barra do CRM: abertas, o construtor ficaria com metade de um tablet
// deitado. Clicou uma vez, a escolha fica no aparelho (preferencia-local.ts).
//
// Montando ou editando uma campanha, a lista fica recolhida sem mexer nessa
// preferência: o construtor precisa da largura (a 1366px com ela aberta
// sobrava ~150px de canvas).
//
// "Montar com IA" (o botão ao lado de "Nova campanha") abre a campanha nova já
// com o chat do construtor aberto (ia-campanhas.tsx, dentro do editor). Até
// 2026-10-28 a lista tinha um chat próprio, que gravava rascunho no banco. O
// editor tem `key` por campanha: trocar de campanha o remonta, e o chat, a
// conversa e uma resposta atrasada vão junto, sem cair na campanha seguinte.
//
// Sair do construtor com mudança não salva (Cancelar, outra campanha da lista,
// "Nova campanha" ou "Montar com IA" estando numa campanha salva) pergunta
// antes, numa faixa no alto (Confirmacao, ./pecas.tsx). Depois de salvar ou
// ativar, a campanha só é selecionada quando a lista recarrega com ela: antes,
// o aviso de sucesso aparecia por um instante sobre a primeira da lista.
//
// As opções dos blocos chegam prontas do servidor numa prop só (page.tsx;
// OpcoesDaCampanha, lib/campanhas-fluxo.ts), as mesmas que a IA lê.
import { useMemo, useState } from "react";
import type { OpcoesDaCampanha } from "@/lib/campanhas-fluxo";
import type { TemplateMeta } from "@/lib/meta";
import { lerTemplate } from "@/lib/templates-whatsapp";
import { BarChart3, LoaderCircle, MessageCircle, PanelLeft, PanelLeftClose, Send, Sparkles, type TipoIcone } from "@/app/components/icones";
import { criarPreferencia } from "@/app/components/preferencia-local";
import EditorCampanha, { type ContaWhatsApp } from "./fluxo/editor-campanha";
import { quantosContatos } from "./fluxo/grafo";
import VerCampanha, { rotuloDoStatus, type CampanhaWpp } from "./fluxo/ver-campanha";
import PainelAds from "./painel-ads";
import { Aviso, botaoAds, Confirmacao, Vazio } from "./pecas";
import { useConsulta } from "./use-consulta";

type StatusMeta = {
  permissoes: string[];
  contasAds: Array<{ id: string; name: string; currency: string }>;
  wabas: Array<{ id: string; name: string }>;
  telefones: Array<{ id: string; display_phone_number: string; verified_name: string }>;
  templates: TemplateMeta[];
  erroWhatsApp: string | null;
};

type ContaAds = { id: string; name: string; currency: string; timezone_name?: string };

const estreita = () => window.innerWidth < 1280;
const preferenciaCanais = criarPreferencia("chroma:campanhas-canais-recolhidos", estreita);
const preferenciaLista = criarPreferencia("chroma:campanhas-lista-recolhida", estreita);

export default function PainelCampanhasMeta({
  opcoes,
  contasAds,
  erroContas,
}: {
  opcoes: OpcoesDaCampanha;
  contasAds: ContaAds[];
  erroContas: string | null;
}) {
  const [aba, setAba] = useState<"ads" | "whatsapp">("ads");
  const canaisRecolhidos = preferenciaCanais.useValor();
  // O status (WABA, números, templates) é só do WhatsApp: pedido quando a aba
  // abre. O Meta Ads já tem as contas, que vêm do servidor (ver page.tsx).
  const { dados: status, erro, carregando, atualizar: carregar } = useConsulta<StatusMeta>(aba === "whatsapp" ? "/api/meta/status" : null);
  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <aside
        className={`flex h-screen shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 p-2 transition-[width] dark:border-zinc-800 ${canaisRecolhidos ? "w-[60px]" : "w-[200px]"}`}
      >
        <div className={`mb-1 flex items-center py-1.5 ${canaisRecolhidos ? "justify-center" : "px-2.5"}`}>
          {!canaisRecolhidos && <h1 className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Campanhas</h1>}
          <BotaoRecolher recolhida={canaisRecolhidos} alternar={() => preferenciaCanais.definir(!canaisRecolhidos)} />
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Canais de campanha">
          {!canaisRecolhidos && <h2 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Canais</h2>}
          <ItemNav ativo={aba === "ads"} onClick={() => setAba("ads")} Icone={BarChart3} recolhida={canaisRecolhidos}>
            Meta Ads
          </ItemNav>
          <ItemNav ativo={aba === "whatsapp"} onClick={() => setAba("whatsapp")} Icone={MessageCircle} recolhida={canaisRecolhidos}>
            Campanhas de WPP
          </ItemNav>
        </nav>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {aba === "ads" ? (
          <PainelAds contas={contasAds} erro={erroContas} />
        ) : carregando ? (
          <div className="px-6 py-6">
            <Vazio Icone={LoaderCircle} texto="Consultando o WhatsApp na Meta…" girando />
          </div>
        ) : erro ? (
          <div className="px-6 py-6">
            <Aviso texto={erro} erro />
            <button type="button" onClick={() => void carregar()} className={`${botaoAds} mt-3`}>
              Tentar novamente
            </button>
          </div>
        ) : (
          status && <WhatsApp status={status} opcoes={opcoes} />
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
  Icone: TipoIcone;
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

function WhatsApp({ status, opcoes }: { status: StatusMeta; opcoes: OpcoesDaCampanha }) {
  const listaRecolhida = preferenciaLista.useValor();
  // Montando ou editando, a lista fica recolhida, sem mexer na preferência
  // guardada: a 1366px com ela aberta o construtor ficava com ~150px de canvas
  // (2026-10-28). Abrir à mão vale até sair do editor.
  const [listaNoEditor, setListaNoEditor] = useState(false);
  const { dados: lista, erro: erroLista, carregando, atualizar: listar } = useConsulta<{ campanhas: CampanhaWpp[] }>("/api/meta/whatsapp/campanhas");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [modo, setModo] = useState<"ver" | "nova" | "editar">("ver");
  const [aviso, setAviso] = useState("");
  // O chat do construtor: guardado aqui para o "Montar com IA" abrir a
  // campanha nova já com ele. Toda troca de modo o fecha.
  const [iaAberta, setIaAberta] = useState(false);
  // O editor conta se há mudança não salva; a saída com mudança fica em
  // `saida` até a pessoa confirmar ou voltar.
  const [sujo, setSujo] = useState(false);
  const [saida, setSaida] = useState<{ acao: () => void } | null>(null);
  // Salvou ou ativou: a campanha e o aviso esperam a lista recarregar com ela.
  const [aguardando, setAguardando] = useState<{ id: string; mensagem: string } | null>(null);
  const templates = useMemo(() => status.templates.map(lerTemplate), [status.templates]);
  const editando = modo !== "ver";
  const recolhida = editando ? !listaNoEditor : listaRecolhida;

  if (!status.wabas.length || !status.telefones.length)
    return (
      <div className="px-6 py-6">
        <Aviso texto={status.erroWhatsApp ?? "A conexão do WhatsApp Business ainda não possui conta e número acessíveis."} />
      </div>
    );

  const campanhas = lista?.campanhas ?? [];
  // A lista voltou (com a campanha, ou com erro): agora sim seleciona e avisa.
  // Ajuste no render, e não em efeito, para não pintar um quadro com a
  // seleção velha.
  if (aguardando && !carregando) {
    if (campanhas.some((c) => c.id === aguardando.id)) setSelecionada(aguardando.id);
    setAviso(aguardando.mensagem);
    setAguardando(null);
  }
  const campanha = campanhas.find((c) => c.id === selecionada) ?? campanhas[0] ?? null;
  const telefone = status.telefones[0];
  const conta: ContaWhatsApp = {
    waba: status.wabas[0].id,
    telefoneId: telefone.id,
    telefone: `${telefone.verified_name} · ${telefone.display_phone_number}`,
  };

  function irPara(novo: "ver" | "nova" | "editar", comIa = false) {
    if (novo !== modo) setListaNoEditor(false);
    setModo(novo);
    setIaAberta(comIa);
    setAviso("");
  }

  /** Sai do editor; com mudança não salva, só depois de confirmar. */
  function sairDoEditor(acao: () => void) {
    if (modo !== "ver" && sujo) setSaida({ acao });
    else acao();
  }

  function concluir(id: string, mensagem: string) {
    setSujo(false);
    irPara("ver");
    setAguardando({ id, mensagem });
    void listar();
  }

  function abrir(id: string) {
    sairDoEditor(() => {
      setSelecionada(id);
      irPara("ver");
    });
  }

  let conteudo: React.ReactNode;
  if (modo === "nova") {
    conteudo = (
      <EditorCampanha
        key="nova"
        conta={conta}
        templates={templates}
        opcoes={opcoes}
        iaAberta={iaAberta}
        mudarIa={setIaAberta}
        aoConcluir={concluir}
        aoMudarSujo={setSujo}
        aoCancelar={() => sairDoEditor(() => irPara("ver"))}
      />
    );
  } else if (aguardando) {
    conteudo = (
      <div className="px-6 py-6">
        <Vazio Icone={LoaderCircle} texto="Atualizando a lista…" girando />
      </div>
    );
  } else if (erroLista) {
    conteudo = (
      <div className="px-6 py-6">
        <Aviso texto={erroLista} erro />
        <button type="button" onClick={() => void listar()} className={`${botaoAds} mt-3`}>
          Tentar novamente
        </button>
      </div>
    );
  } else if (campanha && modo === "editar") {
    conteudo = (
      <EditorCampanha
        key={campanha.id}
        conta={conta}
        templates={templates}
        opcoes={opcoes}
        existente={{
          id: campanha.id,
          nome: campanha.nome,
          publico: `${campanha.segmento_nome} · ${quantosContatos(campanha.total ?? 0)}`,
          fluxo: campanha.definicao,
          metricas: campanha.metricas ?? null,
        }}
        iaAberta={iaAberta}
        mudarIa={setIaAberta}
        aoConcluir={concluir}
        aoMudarSujo={setSujo}
        aoCancelar={() => sairDoEditor(() => irPara("ver"))}
      />
    );
  } else if (campanha) {
    conteudo = (
      <VerCampanha
        key={campanha.id}
        campanha={campanha}
        templates={templates}
        opcoes={opcoes}
        aviso={aviso}
        aoEditar={() => irPara("editar")}
        aoMudar={(mensagem) => {
          setAviso(mensagem);
          void listar();
        }}
        // Só a lista: sem recarregar o status, a tela não desmonta e a seleção fica.
        atualizar={() => void listar()}
      />
    );
  } else {
    conteudo = (
      <div className="px-6 py-6">
        {carregando ? (
          <Vazio Icone={LoaderCircle} texto="Carregando campanhas…" girando />
        ) : (
          <Vazio Icone={MessageCircle} texto="Nenhuma campanha ainda. Comece por “Nova campanha”." />
        )}
      </div>
    );
  }

  return (
    <section className="flex h-screen overflow-hidden">
      <aside className={`flex h-screen shrink-0 flex-col border-r border-zinc-200 transition-[width] dark:border-zinc-800 ${recolhida ? "w-[60px]" : "w-[240px]"}`}>
        <div className={`flex border-b border-zinc-200 p-3 dark:border-zinc-800 ${recolhida ? "flex-col items-center gap-1" : "items-center gap-2"}`}>
          <button
            type="button"
            title="Nova campanha"
            aria-label={recolhida ? "Nova campanha" : undefined}
            onClick={() => (modo === "nova" ? irPara("nova", iaAberta) : sairDoEditor(() => irPara("nova")))}
            className={`flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 py-2 text-[12px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 ${recolhida ? "size-8 px-0" : "min-w-0 flex-1 px-3"}`}
          >
            <Send className="size-3.5" aria-hidden="true" />
            {!recolhida && "Nova campanha"}
          </button>
          <button
            type="button"
            title="Montar com IA"
            aria-label="Montar com IA"
            onClick={() => (modo === "nova" ? irPara("nova", true) : sairDoEditor(() => irPara("nova", true)))}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 outline-none transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:focus-visible:ring-zinc-100/20"
          >
            <Sparkles className="size-4" aria-hidden="true" />
          </button>
          <BotaoRecolher
            recolhida={recolhida}
            alternar={() => (editando ? setListaNoEditor(recolhida) : preferenciaLista.definir(!recolhida))}
          />
        </div>
        <nav aria-label="Campanhas de WhatsApp" className="min-h-0 flex-1 overflow-y-auto p-2">
          {!recolhida && <p className="px-2.5 pb-2 pt-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Campanhas</p>}
          {campanhas.map((c) => {
            const aberta = modo !== "nova" && c.id === campanha?.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => abrir(c.id)}
                aria-current={aberta ? "page" : undefined}
                aria-label={recolhida ? c.nome : undefined}
                title={recolhida ? c.nome : undefined}
                className={`mb-0.5 w-full rounded-lg px-2.5 py-2 text-left transition ${aberta ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"}`}
              >
                {recolhida ? (
                  <MessageCircle className="mx-auto size-4 text-zinc-500" aria-hidden="true" />
                ) : (
                  <>
                    <p className="truncate text-[12px] font-medium text-zinc-900 dark:text-zinc-50">{c.nome}</p>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                      {c.segmento_nome} · {rotuloDoStatus(c.status)}
                    </p>
                  </>
                )}
              </button>
            );
          })}
          {!recolhida && !carregando && !campanhas.length && <p className="px-2.5 py-4 text-[11px] text-zinc-400 dark:text-zinc-500">Nenhuma campanha.</p>}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {saida && (
          <Confirmacao
            texto="Sair sem salvar? As mudanças desta campanha se perdem."
            rotuloConfirmar="Descartar mudanças"
            rotuloVoltar="Continuar editando"
            aoConfirmar={() => {
              const { acao } = saida;
              setSaida(null);
              setSujo(false);
              acao();
            }}
            aoVoltar={() => setSaida(null)}
          />
        )}
        {conteudo}
      </div>
    </section>
  );
}
