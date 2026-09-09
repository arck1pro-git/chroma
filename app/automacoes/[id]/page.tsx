import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { definicaoDoFluxo } from "@/lib/automacoes/repositorio";
import { buscarFluxo } from "../dados";
import EditorFluxo from "./painel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const fluxo = await buscarFluxo(id);
  return { title: `Editar ${fluxo?.nome ?? "automação"} · Chroma` };
}

// Só o editor: carrega a definição, não as métricas. Trocar de aba não deve
// pagar por consulta que a tela nem mostra.
export default async function EditarFluxoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // ?ia=<id>: a sidebar linkou uma conversa feita neste editor.
  searchParams: Promise<{ ia?: string | string[] }>;
}) {
  const [{ id }, { ia }] = await Promise.all([params, searchParams]);
  const [fluxo, definicao] = await Promise.all([
    buscarFluxo(id),
    definicaoDoFluxo(id),
  ]);
  if (!fluxo) notFound();

  return (
    <EditorFluxo
      fluxo={fluxo}
      definicao={definicao}
      conversaInicial={typeof ia === "string" ? ia : null}
    />
  );
}
