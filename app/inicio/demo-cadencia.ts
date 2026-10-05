// A cadência com dados fictícios (app/mock/cadencia.json), para olhar o painel
// com volume sem gravar nada no banco. Só em desenvolvimento e só com
// ?demo=cadencia — page.tsx recusa em produção. Mesmo espírito do ?demo=1 do
// chat (app/chat/demo.ts).
//
// Entra na PRIMEIRA etapa do primeiro funil, com as oportunidades REAIS dela
// espalhadas pelas mensagens e por uma espera, e devolve o mesmo tipo da
// leitura real (DadosCadencias). O painel vê `demonstracao` e não chama o
// servidor: não há fluxo nenhum por trás.
import mock from "../mock/cadencia.json";
import { duracaoEmTexto, type AcaoCadencia, type Subetapa } from "@/lib/automacoes/cadencia";
import type { DadosFunil } from "../funil/dados";
import type { DadosCadencias } from "./cadencias";

export const FLUXO_DEMO = "demo";

export function comCadenciaDeDemonstracao(dados: DadosFunil, base: DadosCadencias): DadosCadencias {
  const funil = dados.funis[0];
  const etapa = dados.etapas.find((e) => e.funil_id === funil?.id);
  if (!etapa) return base;

  let anterior = 0;
  const subetapas: Subetapa[] = mock.mensagens.map((m, i) => {
    const espera = (m.dia - anterior) * 1440;
    anterior = m.dia;
    const acoes: AcaoCadencia[] =
      espera > 0
        ? [{ id: `espera_${m.id}`, tipo: "esperar", rotulo: "Esperar", detalhe: duracaoEmTexto(espera), config: { minutos: espera } }]
        : [];
    return {
      id: m.id,
      ordem: i + 1,
      nome: m.nome,
      canal: m.canal,
      mensagem: m.mensagem,
      dia: m.dia,
      minutos: m.dia * 1440,
      acoes,
      instanciaId: base.instancias[0]?.id ?? null,
      documentoId: null,
      usuarioId: m.canal === "ligacao" ? (base.avisaveis[0]?.id ?? null) : null,
    };
  });

  // As oportunidades da etapa, uma na 2ª mensagem e a seguinte parada na
  // espera antes da 3ª, alternando: é o desenho que mais aparece de verdade.
  const daEtapa = dados.oportunidades.filter((o) => o.etapa_id === etapa.id);
  const posicao = new Map(
    daEtapa.map((o, i) => [o.id, i % 2 === 0 ? "msg2" : "espera_msg3"] as [string, string]),
  );

  return {
    ...base,
    porEtapa: new Map(base.porEtapa).set(etapa.id, {
      fluxoId: FLUXO_DEMO,
      nome: `Cadência · ${etapa.nome}`,
      estado: "publicado",
      numeroVersao: 3,
      subetapas,
      acoesFinais: [],
      linear: true,
      rascunhoPendente: false,
      publicadoAlgumaVez: true,
      inscreverAtuais: true,
      noFluxo: daEtapa.length,
      erros14d: 1,
      posicao,
      demonstracao: true,
    }),
    emCadencia: new Set([...base.emCadencia, ...daEtapa.map((o) => o.id)]),
  };
}
