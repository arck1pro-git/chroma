"use client";

// O /chat: canais → conversas → conversa.
//
// A TELA É GUIADA PELA URL (?canal=&atendimento=). Trocar de canal ou abrir uma
// conversa é navegar, e o servidor devolve só o que aquela combinação precisa
// (app/chat/dados.ts). Ganha-se de graça: F5 volta ao mesmo lugar, o link da
// ficha da oportunidade abre a conversa certa, e o botão "voltar" do celular
// fecha a conversa.
//
// AO VIVO SEM REALTIME: a cada poucos segundos a tela pergunta a
// /api/chat/versao se algo mudou, e só então recarrega os dados. Com a aba
// escondida não pergunta nada — numa hospedagem que cobra por invocação, aba
// esquecida aberta não pode virar custo.
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import type { DadosChat, MensagemChat } from "./tipos";
import {
  assumirAtendimento,
  definirIaDoContatoNoChat,
  encerrarAtendimento,
  enviarDocumento,
  enviarMensagem,
  marcarLido,
  reabrirAtendimento,
} from "./actions";
import { TrilhoCanais } from "./canais";
import { ListaConversas, type Filtro } from "./lista";
import { CabecalhoConversa, Mensagens, SemConversa } from "./conversa";
import { Compositor } from "./compositor";
import { SeletorTemplates } from "./modelos";
import { NovaConversa } from "./nova-conversa";
import { PainelDetalhes } from "./detalhes";
import { NovaOportunidade } from "./nova-oportunidade";
import { canalDaConversa } from "./ui";

/** Lembra o último canal escolhido — page.tsx lê quando a URL não diz. */
const COOKIE_CANAL = "chat_canal";

// Com a janela em foco, a pergunta é frequente; fora de foco (outra janela na
// frente), mais espaçada. Escondida, nenhuma.
const INTERVALO_FOCO = 5_000;
const INTERVALO_FUNDO = 15_000;

export default function Chat({ dados, usuarioId }: { dados: DadosChat; usuarioId: string }) {
  const router = useRouter();
  const [navegando, iniciarNavegacao] = useTransition();
  const [, iniciar] = useTransition();

  const { aberta, canais, canal: canalAtual, demo } = dados;

  // A conversa clicada que ainda está chegando do servidor. Destaca na lista na
  // hora, em vez de esperar a resposta para mostrar que o clique pegou.
  const [alvo, setAlvo] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [detalhes, setDetalhes] = useState(false);
  const [novaConversa, setNovaConversa] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [oportunidade, setOportunidade] = useState(false);

  // ── Navegação ─────────────────────────────────────────────────────────────

  const irPara = useCallback(
    (canal: string, atendimento: string | null) => {
      const sp = new URLSearchParams();
      sp.set("canal", canal || "todos");
      if (atendimento) sp.set("atendimento", atendimento);
      if (demo) sp.set("demo", "1");
      setAlvo(atendimento);
      iniciarNavegacao(() => router.push(`/chat?${sp.toString()}`, { scroll: false }));
    },
    [demo, router],
  );

  function trocarCanal(chave: string) {
    document.cookie = `${COOKIE_CANAL}=${chave || "todos"}; path=/; max-age=31536000; samesite=lax`;
    setDetalhes(false);
    irPara(chave, null);
  }

  const selecionadaId = navegando ? alvo : (aberta?.id ?? null);
  const carregandoConversa = navegando && alvo !== null && alvo !== aberta?.id;
  // No celular a lista cede a tela à conversa — inclusive enquanto ela chega.
  const listaOculta = navegando ? alvo !== null : Boolean(aberta);

  // ── Ao vivo ───────────────────────────────────────────────────────────────

  const abertaId = aberta?.id ?? null;
  useEffect(() => {
    if (demo) return;
    let parado = false;
    let ultima: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const agendar = (ms: number) => {
      clearTimeout(timer);
      if (!parado) timer = setTimeout(perguntar, ms);
    };

    async function perguntar() {
      // Escondida: para. Volta no visibilitychange.
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/chat/versao${abertaId ? `?atendimento=${abertaId}` : ""}`, { cache: "no-store" });
        if (r.ok) {
          const { v } = (await r.json()) as { v: string };
          // A primeira resposta é a referência; recarrega só quando MUDA.
          if (ultima !== null && v !== ultima) iniciar(() => router.refresh());
          ultima = v;
        }
      } catch {
        // Rede caiu: tenta de novo no próximo ciclo.
      }
      agendar(document.hasFocus() ? INTERVALO_FOCO : INTERVALO_FUNDO);
    }

    const voltou = () => {
      if (document.visibilityState === "visible") agendar(0);
    };
    document.addEventListener("visibilitychange", voltou);
    window.addEventListener("focus", voltou);
    agendar(INTERVALO_FOCO);
    return () => {
      parado = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", voltou);
      window.removeEventListener("focus", voltou);
    };
  }, [abertaId, demo, router]);

  // Abriu = leu. Também quando chega mensagem nova com a conversa aberta.
  const naoLidasAberta = aberta?.resumo.nao_lidas ?? 0;
  useEffect(() => {
    if (!abertaId || demo || naoLidasAberta === 0) return;
    iniciar(() => marcarLido(abertaId));
  }, [abertaId, naoLidasAberta, demo]);

  // ── Envio otimista ────────────────────────────────────────────────────────
  //
  // O balão aparece na hora, com o relógio, e sai quando a linha real chega
  // (casada por conversa + texto). A reconciliação é feita DURANTE o render,
  // quando as mensagens mudam — num efeito, por um quadro a mensagem aparecia
  // duas vezes.
  const [otimistas, setOtimistas] = useState<MensagemChat[]>([]);
  const [mensagensVistas, setMensagensVistas] = useState(aberta?.mensagens);
  if (mensagensVistas !== aberta?.mensagens) {
    setMensagensVistas(aberta?.mensagens);
    if (otimistas.length > 0) {
      const reais = aberta?.mensagens ?? [];
      setOtimistas((atuais) =>
        atuais.filter(
          (o) =>
            !reais.some(
              (m) =>
                m.atendimento_id === o.atendimento_id &&
                m.origem === "agente" &&
                m.texto === o.texto &&
                Date.parse(m.data_criacao) >= Date.parse(o.data_criacao) - 60_000,
            ),
        ),
      );
    }
  }

  async function enviar(texto: string) {
    if (!aberta) return { erro: "Nenhuma conversa aberta." };
    const corpo = texto.trim();
    const otimista: MensagemChat = {
      id: `tmp-${Date.now()}`,
      atendimento_id: aberta.id,
      origem: "agente",
      autor_id: usuarioId,
      texto: corpo,
      status: "pendente",
      erro: null,
      enviada_por: "crm",
      id_externo: null,
      data_criacao: new Date().toISOString(),
      tipo: "texto",
      documento_id: null,
      midia_estado: "ausente",
      midia_mime: null,
      midia_nome: null,
      midia_tamanho: null,
      midia_duracao: null,
      midia_erro: null,
    };
    setOtimistas((a) => [...a, otimista]);
    const r = await enviarMensagem(aberta.id, corpo);
    // Recusada ANTES de gravar (janela fechada, sem número): o balão some e o
    // compositor devolve o rascunho. Recusada depois, a linha real com o erro
    // toma o lugar dele pela reconciliação.
    if (r.erro && !r.registrada) setOtimistas((a) => a.filter((o) => o.id !== otimista.id));
    return r;
  }

  async function enviarDoc(documentoId: string, legenda: string) {
    if (!aberta) return { erro: "Nenhuma conversa aberta." };
    return enviarDocumento(aberta.id, documentoId, legenda);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const mensagens = aberta
    ? [...aberta.mensagens, ...otimistas.filter((o) => o.atendimento_id === aberta.id)]
    : [];
  const canalDaAberta = aberta ? canalDaConversa(canais, aberta.resumo) : undefined;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
      {demo && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-[12px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          <FlaskConical className="size-3.5" />
          Demonstração com dados fictícios — nada é gravado nem enviado.
          <Link href="/chat" className="font-semibold underline underline-offset-2">
            Sair
          </Link>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <TrilhoCanais canais={canais} atual={canalAtual} aoEscolher={trocarCanal} />

        <ListaConversas
          canais={canais}
          canalAtual={canalAtual}
          conversas={dados.conversas}
          selecionadaId={selecionadaId}
          usuarioId={usuarioId}
          filtro={filtro}
          aoFiltrar={setFiltro}
          aoAbrir={(id) => irPara(canalAtual, id)}
          aoTrocarCanal={trocarCanal}
          aoNovaConversa={() => setNovaConversa(true)}
          demo={demo}
          oculta={listaOculta}
        />

        <section className={`relative min-w-0 flex-1 flex-col lg:flex ${listaOculta ? "flex" : "hidden"}`}>
          {aberta && !carregandoConversa ? (
            <>
              <CabecalhoConversa
                aberta={aberta}
                canal={canalDaAberta}
                usuarios={dados.usuarios}
                usuarioId={usuarioId}
                demo={demo}
                detalhesAbertos={detalhes}
                aoVoltar={() => irPara(canalAtual, null)}
                aoAssumir={() => iniciar(() => assumirAtendimento(aberta.id))}
                aoEncerrar={() => iniciar(() => encerrarAtendimento(aberta.id))}
                aoReabrir={() => iniciar(() => reabrirAtendimento(aberta.id))}
                aoOportunidade={() => setOportunidade(true)}
                aoDetalhes={() => setDetalhes((v) => !v)}
                ias={dados.ias}
                aoDefinirIa={(v, iaId) => definirIaDoContatoNoChat(aberta.contato.id, v, iaId)}
                // Ligar sem IA na etapa pede a escolha: o painel do contato tem o seletor.
                aoEscolherIa={() => setDetalhes(true)}
              />
              <Mensagens mensagens={mensagens} usuarios={dados.usuarios} conversaId={aberta.id} carregando={false} />
              <Compositor
                conversa={aberta.resumo}
                documentos={dados.documentos}
                demo={demo}
                aoEnviar={enviar}
                aoEnviarDocumento={enviarDoc}
                aoReabrir={() => iniciar(() => reabrirAtendimento(aberta.id))}
                aoTemplates={() => setTemplates(true)}
              />
              {detalhes && (
                <PainelDetalhes
                  aberta={aberta}
                  canais={canais}
                  funis={dados.funis}
                  etapas={dados.etapas}
                  demo={demo}
                  aoFechar={() => setDetalhes(false)}
                  aoIrPara={(id) => {
                    const outra = aberta.outras.find((o) => o.id === id);
                    const chave = outra ? (canalDaConversa(canais, outra)?.chave ?? "") : "";
                    // Mesmo canal da tela, ou "todos" se a outra conversa é de outro número.
                    irPara(chave && chave === canalAtual ? canalAtual : "", id);
                  }}
                  aoNovaOportunidade={() => setOportunidade(true)}
                  ias={dados.ias}
                  aoDefinirIa={(v, iaId) => definirIaDoContatoNoChat(aberta.contato.id, v, iaId)}
                />
              )}
            </>
          ) : carregandoConversa ? (
            <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-900/30">
              <Loader2 className="size-5 animate-spin text-zinc-400" />
            </div>
          ) : (
            <SemConversa canal={canais.find((c) => c.chave === canalAtual)} />
          )}
        </section>
      </div>

      {novaConversa && (
        <NovaConversa
          canais={canais}
          canalAtual={canalAtual}
          aoFechar={() => setNovaConversa(false)}
          aoCriada={(id, canal) => {
            setNovaConversa(false);
            irPara(canalAtual && canalAtual !== canal ? "" : canalAtual, id);
          }}
        />
      )}

      {templates && aberta && (
        <SeletorTemplates
          atendimentoId={aberta.id}
          nomeContato={aberta.contato.nome}
          aoFechar={() => setTemplates(false)}
          aoEnviado={() => setTemplates(false)}
        />
      )}

      {oportunidade && aberta && (
        <NovaOportunidade
          contato={aberta.contato}
          funis={dados.funis}
          etapas={dados.etapas}
          usuarios={dados.usuarios}
          usuarioId={usuarioId}
          aoFechar={() => setOportunidade(false)}
        />
      )}
    </div>
  );
}
