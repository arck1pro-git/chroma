import type { Metadata } from "next";
import Inicio from "./inicio/inicio";
import { carregarFunil } from "./funil/dados";
import { CADENCIAS_VAZIAS, carregarCadencias } from "./inicio/cadencias";
import { fluxosParaInscricao } from "@/lib/automacoes/repositorio";
import { exigirModulo } from "@/lib/auth/dal";

// O título segue a forma dos outros módulos ("X · Chroma"); sem ele a raiz
// herdava só "Chroma" do layout e era a única aba sem nome próprio.
export const metadata: Metadata = {
  title: "Dashboard · Chroma",
};

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
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  const { usuario } = await exigirModulo("inicio");

  // O painel de cadência mora na raiz, mas o que ele faz é AUTOMAÇÃO: cria,
  // publica e DISPARA fluxo de WhatsApp pela instância compartilhada. Por isso
  // ele segue o módulo 'automacoes', e não o 'inicio' que abriu esta tela —
  // as ações em app/inicio/acoes-cadencia.ts exigem o mesmo.
  //
  // Sem o módulo a consulta nem roda: carregar pra depois esconder no React
  // mandaria a cadência inteira no HTML de quem não pode vê-la.
  const podeAutomacoes = usuario.modulos.has("automacoes");

  const { op, ia, cadencia } = await searchParams;
  const um = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : null;
  // Em paralelo: as cadências não dependem do funil, e encadear as duas
  // somaria o tempo das duas na primeira pintura.
  const [dados, cadencias, fluxos] = await Promise.all([
    carregarFunil(),
    podeAutomacoes ? carregarCadencias() : CADENCIAS_VAZIAS,
    // As automações que a seleção do kanban pode disparar. Consulta pequena e
    // independente das outras duas — entra no mesmo Promise.all.
    podeAutomacoes ? fluxosParaInscricao() : [],
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
