import type { Metadata } from "next";
import ListaFluxos from "./lista";
import PainelLateral from "./painel-lateral";
import {
  buscarFluxo,
  detalheDoFluxo,
  listarFluxos,
  segmentosParaDisparo,
} from "./dados";

export const metadata: Metadata = {
  title: "Automações · Chroma",
};

export const dynamic = "force-dynamic";

// A seleção mora na URL (?fluxo=<id>), não em estado do cliente. Assim o
// servidor carrega o detalhe de UM fluxo — em vez de buscar métricas dos N da
// lista — e o link fica compartilhável. Trocar searchParam não remonta o
// template, então a seleção não re-anima a página inteira (app/template.tsx).
export default async function AutomacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ fluxo?: string }>;
}) {
  const { fluxo: selecionadoId } = await searchParams;
  const fluxos = await listarFluxos();

  const selecionado = selecionadoId ? await buscarFluxo(selecionadoId) : null;
  // Em paralelo: o detalhe é a consulta cara e os segmentos não dependem dele.
  const [detalhe, segmentos] = selecionado
    ? await Promise.all([detalheDoFluxo(selecionado.id), segmentosParaDisparo()])
    : [null, []];

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <ListaFluxos fluxos={fluxos} selecionadoId={selecionado?.id ?? null} />
      {selecionado && detalhe ? (
        <PainelLateral fluxo={selecionado} detalhe={detalhe} segmentos={segmentos} />
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center p-8 lg:flex">
          <p className="max-w-xs text-center text-xs text-zinc-400 dark:text-zinc-500">
            Selecione uma automação à esquerda para ver desempenho, execuções e
            editar o fluxo.
          </p>
        </div>
      )}
    </div>
  );
}
