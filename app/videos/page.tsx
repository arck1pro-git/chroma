import type { Metadata } from "next";
import { headers } from "next/headers";
import { exigirModulo } from "@/lib/auth/dal";
import { limiteDoBucket } from "@/lib/armazenamento";
import { enderecoDoCrm } from "@/lib/endereco";
import { BUCKET_VIDEOS, listarVideos, pessoasDoVideo } from "@/lib/videos";
import PainelVideos from "./painel";

export const metadata: Metadata = {
  title: "Vídeos · Chroma",
};

export const dynamic = "force-dynamic";

// A seleção mora na URL (?video=<id>), como em /webhooks: o servidor já traz
// quem assistiu o vídeo aberto, e o link da tela leva direto a ele. Sem
// seleção, abre o mais recente — é quase sempre o que se acabou de subir.
//
// O endereço do link sai do domínio deste request (lib/endereco.ts): aberto
// pelo domínio de produção, o link já nasce certo. No localhost ele não serve
// para mandar a ninguém, e a tela diz isso.
export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ video?: string }>;
}) {
  await exigirModulo("videos");
  const { video: escolhido } = await searchParams;

  let videos;
  try {
    videos = await listarVideos();
  } catch (e) {
    // 42P01 = undefined_table: migration-videos.sql ainda não rodou.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01") {
      return <PainelVideos videos={[]} selecionado={null} pessoas={[]} base={null} limite={null} problema="migration" />;
    }
    throw e;
  }

  const [cabecalhos, limite] = await Promise.all([
    headers(),
    // undefined = o bucket não existe (ou o Supabase não respondeu): a tela
    // mostra o vídeo que já existe e explica por que não dá para subir.
    limiteDoBucket(BUCKET_VIDEOS).catch(() => undefined),
  ]);

  const selecionado = videos.find((v) => v.id === escolhido) ?? videos[0] ?? null;
  const pessoas = selecionado ? await pessoasDoVideo(selecionado.id) : [];

  return (
    <PainelVideos
      videos={videos}
      selecionado={selecionado}
      pessoas={pessoas}
      base={enderecoDoCrm(cabecalhos)}
      limite={limite ?? null}
      problema={limite === undefined ? "bucket" : null}
    />
  );
}
