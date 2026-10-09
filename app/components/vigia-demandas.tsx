"use client";

// A vigia de Demandas (pedido dele de 2026-10-09: "notificação de windows +
// atualizar na tela, sem pesar o plano da vercel"). Mantém o número do item
// Demandas da barra lateral em dia, avisa no Windows quando chega demanda nova
// e recarrega o quadro de Demandas aberto quando alguma coisa muda.
//
// NENHUMA CONSULTA NOVA: é a mesma /api/demandas/contagem de minuto em minuto
// que o número da barra já fazia — ela só passou a trazer junto as novas e a
// versão do quadro (conferirDemandas, em lib/demandas.ts). O quadro só vai ao
// servidor quando a versão muda, e com a aba escondida espera a pessoa voltar.
//
// UMA ABA POR NAVEGADOR: a que segura a trava (Web Locks) é a vigia. Ela
// confere de minuto em minuto mesmo escondida — é o que deixa o aviso chegar
// com o CRM em segundo plano — e repassa a resposta às outras abas
// (BroadcastChannel). As outras só conferem quando a pessoa faz algo: volta
// para a aba, troca de tela, mexe em Demandas. Fechou a vigia, a próxima aba
// assume a trava. Sem os avisos ligados, conferir escondido não serve a
// ninguém: aí a vigia só confere com a aba à vista, como antes.
//
// O QUE NÃO COBRE: CRM fechado, computador dormindo ou aba descartada pelo
// navegador para poupar memória — não há quem confira. Isso pediria push de
// verdade (service worker + uma tabela de aparelhos), que ficou de fora.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, X } from "lucide-react";
import {
  EVENTO_ABRIR_DEMANDA,
  EVENTO_DEMANDAS,
  type ContagemDemandas,
  type DemandaNova,
  type SituacaoDemandas,
} from "@/lib/demandas-tipos";
import { criarPreferencia } from "./preferencia-local";

const INTERVALO = 60_000;
/**
 * Mais que isso sem conferir (o computador dormiu), o que chegou nesse
 * meio-tempo não vira aviso — seria uma rajada ao acordar; o número da barra
 * já mostra.
 */
const VALIDADE_DO_DESDE = 30 * 60_000;
/** Voltar para a aba dispara `focus` e `visibilitychange` juntos: uma ida só. */
const FOLGA = 5_000;
const TRAVA = "chroma:demandas-vigia";
const CANAL = "chroma:demandas";
/** Mais que isso de uma vez vira um aviso só, com a soma. */
const AVISOS_SEPARADOS = 3;

type Motivo = "vigia" | "acao" | "pessoa";
type Mensagem = { situacao: SituacaoDemandas; daVigia: boolean };

function avisosLigados() {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

function primeiroNome(nome: string | null) {
  return (nome ?? "").trim().split(/\s+/)[0] || "Alguém";
}

/** O número do item Demandas, em dia — e, por baixo, os avisos e o quadro. */
export function useVigiaDemandas(inicial: SituacaoDemandas | null): ContagemDemandas | null {
  const [contagem, setContagem] = useState<ContagemDemandas | null>(inicial);
  const ativa = inicial !== null;
  const pathname = usePathname();
  const router = useRouter();

  const tela = useRef(pathname);
  const versao = useRef(inicial?.versao ?? "");
  const desde = useRef(inicial?.agora ?? null);
  const avisadas = useRef(new Set<string>());
  const recarregarAoVoltar = useRef(false);
  const ultimaIda = useRef(0);
  const buscarRef = useRef<((motivo: Motivo) => Promise<void>) | null>(null);
  const primeiraTela = useRef(true);

  // Trocar de tela confere — é quando a pessoa acaba de fazer algo. A primeira
  // pintura não: o número acabou de vir do servidor.
  useEffect(() => {
    tela.current = pathname;
    recarregarAoVoltar.current = false;
    if (primeiraTela.current) {
      primeiraTela.current = false;
      return;
    }
    void buscarRef.current?.("pessoa");
  }, [pathname]);

  useEffect(() => {
    if (!ativa) return;
    let viva = true;
    // As outras abas recebem o que esta conferiu, e esta o que elas conferiram.
    const canal = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CANAL);

    const naTelaDeDemandas = () => tela.current.startsWith("/demandas");

    function recarregarQuadro() {
      if (!naTelaDeDemandas()) return;
      if (document.visibilityState === "visible") router.refresh();
      else recarregarAoVoltar.current = true;
    }

    // `propria`: a mudança foi feita NESTA aba, e a ação já devolveu o quadro
    // novo (revalidatePath) — recarregar de novo seria uma ida à toa.
    function aplicar(s: SituacaoDemandas, propria: boolean) {
      setContagem({ pendentes: s.pendentes, atrasadas: s.atrasadas });
      if (s.versao === versao.current) return;
      versao.current = s.versao;
      if (!propria) recarregarQuadro();
    }

    function abrir(id: string | null) {
      window.focus();
      if (id && naTelaDeDemandas()) window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_DEMANDA, { detail: id }));
      else router.push(id ? `/demandas?abrir=${id}` : "/demandas");
    }

    function mostrar(titulo: string, corpo: string, tag: string, id: string | null) {
      try {
        // `tag`: a mesma demanda avisada por duas abas vira um aviso só.
        const aviso = new Notification(titulo, { body: corpo, tag, icon: "/favicon.ico" });
        aviso.onclick = () => {
          aviso.close();
          abrir(id);
        };
      } catch {
        // Android: lá só service worker mostra notificação. Fica sem aviso.
      }
    }

    function avisar(novas: DemandaNova[]) {
      const ineditas = novas.filter((n) => !avisadas.current.has(n.id));
      for (const n of ineditas) avisadas.current.add(n.id);
      if (!ineditas.length || !avisosLigados()) return;
      if (ineditas.length > AVISOS_SEPARADOS) {
        const titulos = ineditas.slice(0, AVISOS_SEPARADOS).map((n) => n.titulo).join(" · ");
        mostrar(`${ineditas.length} demandas novas`, `${titulos}…`, "demandas-novas", null);
        return;
      }
      for (const n of ineditas) {
        mostrar(
          n.chamado ? "Novo chamado para o TI" : "Nova demanda",
          `${primeiroNome(n.autor)}: ${n.titulo}`,
          `demanda-${n.id}`,
          n.id,
        );
      }
    }

    async function buscar(motivo: Motivo) {
      if (motivo === "pessoa" && Date.now() - ultimaIda.current < FOLGA) return;
      ultimaIda.current = Date.now();
      const vigiando = motivo === "vigia";
      // Só a vigia pede as novas: é ela que avisa.
      const d =
        vigiando && desde.current && Date.now() - Date.parse(desde.current) < VALIDADE_DO_DESDE ? desde.current : null;
      try {
        const r = await fetch(`/api/demandas/contagem${d ? `?desde=${encodeURIComponent(d)}` : ""}`, {
          cache: "no-store",
        });
        if (!r.ok || !viva) return;
        const s = (await r.json()) as SituacaoDemandas;
        if (vigiando) desde.current = s.agora;
        aplicar(s, motivo === "acao");
        if (vigiando) avisar(s.novas);
        canal?.postMessage({ situacao: s, daVigia: vigiando } satisfies Mensagem);
      } catch {
        // Sem rede: a próxima conferência tenta de novo.
      }
    }
    buscarRef.current = buscar;

    // A resposta da vigia leva junto o `desde` e as já avisadas: se esta aba
    // assumir a trava, continua de onde a outra parou, sem repetir aviso.
    if (canal) {
      canal.onmessage = (e: MessageEvent<Mensagem>) => {
        const { situacao: s, daVigia } = e.data;
        if (daVigia) {
          desde.current = s.agora;
          for (const n of s.novas) avisadas.current.add(n.id);
        }
        aplicar(s, false);
      };
    }

    // A trava fica com esta aba até ela fechar (ou o efeito sair): a promessa
    // só se resolve no abort.
    let relogio: ReturnType<typeof setInterval> | undefined;
    const soltar = new AbortController();
    const vigiar = () => {
      relogio = setInterval(() => {
        if (document.visibilityState !== "visible" && !avisosLigados()) return;
        void buscar("vigia");
      }, INTERVALO);
    };
    if (navigator.locks) {
      navigator.locks
        .request(TRAVA, { signal: soltar.signal }, () =>
          new Promise<void>((liberar) => {
            vigiar();
            soltar.signal.addEventListener("abort", () => liberar());
          }),
        )
        // AbortError: o efeito saiu enquanto esperava a vez.
        .catch(() => {});
    } else {
      vigiar();
    }

    const aoMexer = () => void buscar("acao");
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if (recarregarAoVoltar.current) {
        recarregarAoVoltar.current = false;
        if (naTelaDeDemandas()) router.refresh();
      }
      void buscar("pessoa");
    };
    window.addEventListener(EVENTO_DEMANDAS, aoMexer);
    window.addEventListener("focus", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      viva = false;
      buscarRef.current = null;
      soltar.abort();
      clearInterval(relogio);
      canal?.close();
      window.removeEventListener(EVENTO_DEMANDAS, aoMexer);
      window.removeEventListener("focus", aoVoltar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [ativa, router]);

  return contagem;
}

// ── O convite para ligar os avisos ──────────────────────────────────────────
//
// O navegador só mostra notificação de quem a pessoa autorizou, e só pergunta
// uma vez: por isso o convite é um clique dela, e não um pedido na hora em que
// a tela abre (o Chrome esconde esse pedido como "intrusivo"). Some quando a
// pessoa responde — sim ou não — ou fecha no ×. Quem negou só religa pelo
// cadeado da barra de endereço.

type Permissao = NotificationPermission | "indisponivel";

const ouvintesDaPermissao = new Set<() => void>();

function assinarPermissao(ouvinte: () => void) {
  ouvintesDaPermissao.add(ouvinte);
  return () => {
    ouvintesDaPermissao.delete(ouvinte);
  };
}

function lerPermissao(): Permissao {
  return "Notification" in window ? Notification.permission : "indisponivel";
}

const conviteDispensado = criarPreferencia("chroma:avisos-demandas-dispensado");

export function LigarAvisos({ recolhida, classe }: { recolhida: boolean; classe: string }) {
  // No servidor, "indisponivel": o convite só aparece depois da hidratação.
  const permissao = useSyncExternalStore(assinarPermissao, lerPermissao, () => "indisponivel" as Permissao);
  const dispensado = conviteDispensado.useValor();
  if (permissao !== "default" || dispensado) return null;

  async function ligar() {
    const resposta = await Notification.requestPermission().catch(() => "denied" as const);
    for (const ouvinte of ouvintesDaPermissao) ouvinte();
    if (resposta === "granted") {
      try {
        new Notification("Avisos ligados", {
          body: "Quando chegar demanda para você, ela aparece aqui.",
          tag: "avisos-ligados",
          icon: "/favicon.ico",
        });
      } catch {}
    }
  }

  const texto = "Ligar avisos de demanda";
  const dica = "Avisa no Windows quando chegar demanda para você — com o CRM aberto em alguma aba.";
  return (
    <div className={`${classe} group/aviso ${recolhida ? "" : "!pr-1"}`}>
      <button
        type="button"
        onClick={ligar}
        title={recolhida ? `${texto}. ${dica}` : dica}
        className={`flex min-w-0 flex-1 items-center gap-2.5 text-left ${recolhida ? "justify-center" : ""}`}
      >
        <BellRing className="size-4 shrink-0" aria-hidden="true" />
        {!recolhida && <span className="truncate">{texto}</span>}
        {recolhida && <span className="sr-only">{texto}</span>}
      </button>
      {!recolhida && (
        <button
          type="button"
          onClick={() => conviteDispensado.definir(true)}
          aria-label="Agora não"
          title="Agora não"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:opacity-100 group-hover/aviso:opacity-100 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-50 [@media(hover:none)]:opacity-100"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
