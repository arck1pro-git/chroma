import type { Metadata } from "next";
import { Suspense } from "react";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { documentosEscolhiveis, type Documento } from "@/lib/documentos";
import { carregarTemplates } from "./dados";
import PainelTemplates, { EsqueletoTemplates } from "./painel";

export const metadata: Metadata = { title: "Templates · AmaanOffice" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ conta?: string | string[] }>;
}) {
  const { usuario } = await exigirModulo("templates");
  const { conta } = await searchParams;
  const pedida = typeof conta === "string" ? conta : undefined;
  return (
    // A Meta leva de meio a dois segundos para listar: a casca aparece na hora
    // e a lista chega por streaming. A key por conta mostra o esboço de novo ao
    // trocar de conta, em vez de deixar a lista da outra parada na tela.
    <Suspense key={pedida ?? ""} fallback={<EsqueletoTemplates />}>
      <Templates
        pedida={pedida}
        podeCriar={podeOperar(usuario, "templates", "criar")}
        comBiblioteca={usuario.modulos.has("documentos")}
      />
    </Suspense>
  );
}

async function Templates({ pedida, podeCriar, comBiblioteca }: { pedida: string | undefined; podeCriar: boolean; comBiblioteca: boolean }) {
  // A biblioteca dá o arquivo de exemplo do cabeçalho de imagem, vídeo ou PDF.
  // null = fora do acesso (o editor apaga esses formatos); áudio não vai em cabeçalho.
  const [dados, documentos] = await Promise.all([
    carregarTemplates(pedida),
    podeCriar && comBiblioteca
      ? documentosEscolhiveis().then((lista) => lista.filter((d) => d.tipo !== "audio"))
      : Promise.resolve<Documento[] | null>(null),
  ]);
  return <PainelTemplates {...dados} podeCriar={podeCriar} documentos={documentos} />;
}
