"use client";

// O player do lead e a medição.
//
// O QUE É MEDIDO sai do próprio <video>: `video.played` é a lista de trechos que
// de fato tocaram nesta página — pausa não entra, e voltar para rever um trecho
// não soma duas vezes. A página manda essa lista INTEIRA a cada sinal (não só a
// diferença), então um sinal perdido não perde nada: o seguinte traz tudo.
//
// QUANDO manda: a cada 10 s, ao pausar, ao terminar e ao sair — sair é
// esconder a aba ou fechar a página, e aí vai por sendBeacon, que o navegador
// entrega mesmo com a página indo embora.
//
// "Na página" conta só o tempo com a aba VISÍVEL: aba esquecida atrás de outra
// não é alguém olhando o vídeo.
import { useEffect, useRef } from "react";

type Sessao = { id: string; token: string } | null;

// Uma abertura por carregamento: o StrictMode do dev monta o efeito duas vezes,
// e sem isto cada visita do dev contaria em dobro.
const aberturas = new Map<string, Promise<Sessao>>();

function abrir(slug: string, w: string | null): Promise<Sessao> {
  const chave = `${slug}|${w ?? ""}`;
  let p = aberturas.get(chave);
  if (!p) {
    p = fetch("/api/v/abrir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, w }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<Sessao>) : null))
      .catch(() => null);
    aberturas.set(chave, p);
  }
  return p;
}

export default function Player({
  slug,
  capa,
  largura,
  altura,
  w,
}: {
  slug: string;
  capa: string | null;
  largura: number | null;
  altura: number | null;
  w: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let sessao: Sessao = null;
    let naPagina = 0;
    let ultimoEnviado = "";
    void abrir(slug, w).then((s) => {
      sessao = s;
    });

    function corpo() {
      if (!sessao || !video) return null;
      const trechos: [number, number][] = [];
      for (let i = 0; i < video.played.length; i++) {
        trechos.push([video.played.start(i), video.played.end(i)]);
      }
      return JSON.stringify({
        id: sessao.id,
        token: sessao.token,
        trechos,
        naPagina,
        duracao: Number.isFinite(video.duration) ? video.duration : null,
      });
    }

    function enviar(saindo = false) {
      const c = corpo();
      // Nada mudou desde o último (vídeo parado e aba escondida): não manda.
      if (!c || c === ultimoEnviado) return;
      ultimoEnviado = c;
      if (saindo && navigator.sendBeacon?.("/api/v/sinal", c)) return;
      void fetch("/api/v/sinal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: c,
        keepalive: true,
      }).catch(() => {});
    }

    const relogio = setInterval(() => {
      if (document.visibilityState === "visible") naPagina += 1;
    }, 1000);
    const periodico = setInterval(() => enviar(), 10_000);
    const aoParar = () => enviar();
    const aoEsconder = () => {
      if (document.visibilityState === "hidden") enviar(true);
    };
    const aoSair = () => enviar(true);

    video.addEventListener("pause", aoParar);
    video.addEventListener("ended", aoParar);
    document.addEventListener("visibilitychange", aoEsconder);
    window.addEventListener("pagehide", aoSair);
    return () => {
      clearInterval(relogio);
      clearInterval(periodico);
      video.removeEventListener("pause", aoParar);
      video.removeEventListener("ended", aoParar);
      document.removeEventListener("visibilitychange", aoEsconder);
      window.removeEventListener("pagehide", aoSair);
      enviar(true);
    };
  }, [slug, w]);

  // O formato real do vídeo, guardado ao subir: Reels é 9:16, e reservar o
  // espaço certo evita o quadro pulando quando o vídeo carrega. A largura é a
  // menor entre a tela e o que cabe em 90% da altura.
  //
  // Só o vídeo, sem o título embaixo (pedido de 2026-10-06): o nome continua
  // na aba do navegador e na prévia do link (generateMetadata, ./page.tsx).
  const proporcao = largura && altura ? largura / altura : 16 / 9;

  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-zinc-950 px-4 py-6">
      <div
        className="w-full"
        style={{ maxWidth: `min(100%, calc(90svh * ${proporcao}))`, aspectRatio: String(proporcao) }}
      >
        <video
          ref={ref}
          src={`/v/${slug}/arquivo`}
          poster={capa ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="h-full w-full rounded-xl bg-black object-contain"
        />
      </div>
    </main>
  );
}
