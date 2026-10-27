import type { Metadata } from "next";
import { Suspense } from "react";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
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
      <Templates pedida={pedida} podeCriar={podeOperar(usuario, "templates", "criar")} />
    </Suspense>
  );
}

async function Templates({ pedida, podeCriar }: { pedida: string | undefined; podeCriar: boolean }) {
  const dados = await carregarTemplates(pedida);
  return <PainelTemplates {...dados} podeCriar={podeCriar} />;
}
