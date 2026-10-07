// A página que o LEAD abre: /v/<slug>?w=<whatsapp>.
//
// Pública (proxy.ts, prefixo "/v/") e sem nada do CRM: nem barra lateral
// (app/components/sidebar.tsx esconde em /v/ mesmo para quem está logado), nem
// nome do sistema na prévia do link. Na tela, só o vídeo; o título dele fica
// na aba do navegador e na prévia do link.
//
// O ?w= vai para o player, que o manda junto ao abrir — é por ele que a
// visualização cai no contato (lib/videos.ts, abrirVisualizacao).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { enderecoDoCrm } from "@/lib/endereco";
import { buscarVideoPorSlug } from "@/lib/videos";
import Player from "./player";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ w?: string | string[] }>;
};

// A prévia do link no WhatsApp sai daqui: título, a capa e uma descrição
// própria — sem ela valeria a do layout raiz, que fala do CRM para o lead.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const video = await buscarVideoPorSlug(slug);
  if (!video) return { title: "Vídeo", robots: { index: false, follow: false } };
  const base = enderecoDoCrm(await headers());
  const descricao = "Toque para assistir.";
  return {
    title: video.nome,
    description: descricao,
    robots: { index: false, follow: false },
    metadataBase: new URL(base.url),
    openGraph: {
      title: video.nome,
      description: descricao,
      type: "video.other",
      images: video.capa ? [`/v/${video.slug}/capa`] : undefined,
    },
  };
}

export default async function PaginaDoVideo({ params, searchParams }: Props) {
  const { slug } = await params;
  const video = await buscarVideoPorSlug(slug);
  if (!video) notFound();
  const { w } = await searchParams;

  return (
    <Player
      slug={video.slug}
      capa={video.capa ? `/v/${video.slug}/capa` : null}
      largura={video.largura}
      altura={video.altura}
      w={typeof w === "string" ? w : null}
    />
  );
}
