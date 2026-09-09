import Inicio from "./inicio/inicio";
import { carregarFunil } from "./funil/dados";
import { carregarCadencias } from "./inicio/cadencias";
import { fluxosParaInscricao } from "@/lib/automacoes/repositorio";

// A raiz concentra dashboard, funis/kanbans e contatos — /dashboard, /funil e
// /contatos deixaram de existir como rota.
//
// FONTE DOS DADOS: Postgres, via carregarFunil (app/funil/dados.ts). Até
// 2026-09-03 isto lia app/mock/dados.json (removido) porque a base estava
// vazia e a UI nova precisava de volume pra ser avaliada.
export default async function Home({
  searchParams,
}: {
  // ?op=<id>       → abre direto a ficha da oportunidade (link do /chat)
  // ?ia=<id>        → abre o painel de IA naquela conversa (link da sidebar)
  // ?cadencia=<id>  → abre o painel de cadência daquele fluxo; quando vem
  //                   junto de ?ia=, é a conversa DELE que abre, não a do funil
  //
  // Resolvidos aqui, no servidor, e não num efeito do cliente: assim já vêm no
  // HTML em vez de aparecer depois da hidratação.
  searchParams: Promise<{
    op?: string | string[];
    ia?: string | string[];
    cadencia?: string | string[];
  }>;
}) {
  const { op, ia, cadencia } = await searchParams;
  const um = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : null;
  // Em paralelo: as cadências não dependem do funil, e encadear as duas
  // somaria o tempo das duas na primeira pintura.
  const [dados, cadencias, fluxos] = await Promise.all([
    carregarFunil(),
    carregarCadencias(),
    // As automações que a seleção do kanban pode disparar. Consulta pequena e
    // independente das outras duas — entra no mesmo Promise.all.
    fluxosParaInscricao(),
  ]);

  return (
    <Inicio
      dados={dados}
      cadencias={cadencias}
      opInicial={um(op)}
      conversaInicial={um(ia)}
      cadenciaInicial={um(cadencia)}
      fluxosParaInscricao={fluxos}
    />
  );
}
