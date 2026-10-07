// O MODO COMPLETO da IA: para quem administra o sistema (o TI), a conversa de
// qualquer tela faz tudo o que as IAs de cada tela fazem — analisa os dados,
// monta automação e cadência, campanha e captação.
//
// POR QUE EXISTE: até 2026-10-06 cada tela tinha a sua IA, presa ao assunto
// dela. A do dashboard só lia; a do editor só escrevia no fluxo aberto; a de
// campanhas só montava campanha. Para o TI isso obrigava a trocar de tela para
// trocar de pedido. O pedido foi: "para o usuário TI, ela tem acesso a tudo
// independente da aba".
//
// QUEM: o departamento marcado com `gerencia_acessos` — o mesmo que é dono da
// tela de Acessos (lib/auth/dal.ts, exigirGerenciaAcessos). É uma marca do
// banco, e não o NOME "TI": renomear o departamento não pode desligar isto.
//
// O QUE ENTRA: cada grupo de ferramentas só vai se a pessoa tiver o MÓDULO
// daquele assunto (automacoes, webhooks, campanhas; configuracoes para tags e
// segmentos) — o modo completo junta o
// que ela já pode fazer, não dá o que ela não pode. As ferramentas são as
// mesmas das IAs de cada tela, com as mesmas recusas; o único acréscimo é que,
// em automação, o modelo escolhe o fluxo e pode criar um (ferramentasDeFluxos).
//
// O QUE NÃO MUDA: nada publica, ativa ou dispara. Tudo que escreve grava
// rascunho, como nas IAs de cada tela.
//
// As rotas de IA de todas as telas chamam isto quando `temIaCompleta` — por
// isso nenhuma tela precisou mudar de endpoint.
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { UsuarioLogado } from "@/lib/auth/dal";
import { blocoDeContexto, registrarContextosUsados } from "@/lib/contextos";
import { headers } from "next/headers";
import { enderecoDoCrm } from "@/lib/endereco";
import { blocoDeDocumentos, blocoDeVideos, ferramentasDeFluxos, REGRAS_DE_FLUXO } from "./automacoes";
import { ferramentasDeCampanhas, REGRAS_DE_CAMPANHA } from "./campanhas";
import { conversar, historicoDe, texto } from "./conversa";
import { ferramentas as ferramentasDeLeitura, REGRAS_DE_ANALISE } from "./ferramentas";
import { REGRA_DADO_NAO_CONFIAVEL } from "./sanitizar";
import { ferramentasDeTagsESegmentos, REGRAS_DE_TAGS } from "./tags-segmentos";
import { temIaCompleta } from "./modo-completo";
import { ferramentasDeWebhooks, REGRAS_DE_WEBHOOK } from "./webhooks";

// Quem é o TI mora em ./modo-completo.ts (leve, o layout raiz também pergunta).
export { temIaCompleta };

function abertura(podeFazer: string[]) {
  return `Você é o assistente do Chroma, um CRM, no MODO COMPLETO: o de quem administra o sistema. Responde em português do Brasil.

Em qualquer tela, você pode:
${podeFazer.map((p) => `- ${p}`).join("\n")}

A tela aberta vem no início da pergunta ("[Tela agora: …]"). Ela é o ponto de partida, não o limite: se pedirem algo de outro assunto, resolva com as ferramentas daquele assunto, sem mandar a pessoa trocar de tela.`;
}

// O "COMO TRABALHAR" do editor de fluxo, reescrito para quando o modelo
// ESCOLHE o fluxo. As regras de montagem em si são as mesmas (REGRAS_DE_FLUXO).
const SECAO_FLUXOS = `## AUTOMAÇÕES E CADÊNCIAS

COMO TRABALHAR
- Para achar um fluxo, chame listar_fluxos. Quando a tela é o editor de um fluxo ou a cadência de uma etapa, o id dele vem no início da pergunta ("fluxo aberto: …"): é ele o alvo, salvo se pedirem outro.
- Automação nova: criar_fluxo, e então escrever_fluxo nela.
- Cadência de uma etapa do funil: criar_cadencia com o id da etapa (de listar_funis). Ela devolve o fluxo da cadência, criando se a etapa ainda não tiver um; depois, escrever_fluxo.
- Se o fluxo já tem blocos, chame ler_fluxo ANTES de mexer. escrever_fluxo substitui tudo: sem ler antes, você apaga o que já existia.
- escrever_fluxo exige o fluxo INTEIRO, inclusive os blocos que não mudaram.
- Se escrever_fluxo recusar, leia o motivo, corrija e chame de novo. Não peça ajuda ao usuário para erro que você mesmo pode consertar.
- Depois de gravar, diga em uma ou duas frases o que ficou montado e em qual fluxo. Sem repetir o JSON.
- Fluxo grande é bem-vindo: uma cadência de 18 mensagens é normal aqui. Monte de uma vez, não em pedaços.

${REGRAS_DE_FLUXO}`;

const LIMITES = `## O QUE VOCÊ NUNCA FAZ, EM ASSUNTO NENHUM
- Não publica fluxo, não ativa campanha e não dispara mensagem. Você grava RASCUNHO; publicar, ativar e disparar são cliques da pessoa — é o disparo que manda mensagem para gente real.
- Não move card, não edita contato nem oportunidade e não apaga nada. Se pedirem, diga onde a pessoa faz na tela.`;

type Grupo = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ferramentas: BetaRunnableTool<any>[];
  gravou: () => boolean;
};

/**
 * Responde uma pergunta no modo completo. `fluxoAberto` é o fluxo do editor ou
 * da cadência quando a conversa vem de lá — vira texto no contexto da tela,
 * não trava as ferramentas.
 */
export async function conversaCompleta({
  usuario,
  corpo,
  fluxoAberto = null,
}: {
  usuario: UsuarioLogado;
  corpo: Record<string, unknown>;
  fluxoAberto?: string | null;
}): Promise<Response> {
  const pergunta = texto(corpo.pergunta, 4000).trim();
  if (!pergunta) return Response.json({ erro: "Pergunta vazia." }, { status: 400 });

  const grupos: Grupo[] = [{ ferramentas: ferramentasDeLeitura, gravou: () => false }];
  const podeFazer = ["analisar os dados do CRM: funis, oportunidades, contatos e conversas"];
  const secoes = [`## ANÁLISE DOS DADOS\n\n${REGRAS_DE_ANALISE}`];

  const fluxos = usuario.modulos.has("automacoes");
  if (fluxos) {
    grupos.push(ferramentasDeFluxos());
    podeFazer.push("montar automações e cadências de etapa do funil (em rascunho)");
    secoes.push(SECAO_FLUXOS);
  }
  if (usuario.modulos.has("webhooks")) {
    grupos.push(ferramentasDeWebhooks());
    podeFazer.push("montar captações de lead (webhooks): campos e ações");
    secoes.push(`## CAPTAÇÕES (WEBHOOKS)\n\n${REGRAS_DE_WEBHOOK}`);
  }
  if (usuario.modulos.has("campanhas")) {
    grupos.push(ferramentasDeCampanhas(usuario.id));
    podeFazer.push("montar rascunhos de campanha oficial de WhatsApp");
    secoes.push(`## CAMPANHAS OFICIAIS DE WHATSAPP\n\n${REGRAS_DE_CAMPANHA}`);
  }
  // A tela de tags e segmentos é a de Configurações (lib/ia/tags-segmentos.ts).
  if (usuario.modulos.has("configuracoes")) {
    grupos.push(ferramentasDeTagsESegmentos());
    podeFazer.push("criar tags e segmentos");
    secoes.push(`## TAGS E SEGMENTOS\n\n${REGRAS_DE_TAGS}`);
  }

  // Os contextos escolhidos na tela (módulo Contextos), como em /api/ia.
  const ids = Array.isArray(corpo.contextos)
    ? corpo.contextos.filter((v): v is string => typeof v === "string")
    : [];
  // Documentos e vídeos só para quem monta fluxo: é deles que o modelo copia o
  // anexo e o link rastreável de vídeo (com o domínio deste CRM, do request).
  const [{ texto: blocos, usados }, documentos, videos] = await Promise.all([
    blocoDeContexto(ids),
    fluxos ? blocoDeDocumentos() : Promise.resolve(""),
    fluxos ? headers().then((h) => blocoDeVideos(enderecoDoCrm(h))) : Promise.resolve(""),
  ]);
  const conversaId = texto(corpo.conversa_id, 64);
  if (conversaId && usados.length > 0) void registrarContextosUsados(conversaId, usados);

  // O que muda entre perguntas (biblioteca, contextos) vai DEPOIS do que não
  // muda: prefixo estável = prefixo cacheável (lib/ia/conversa.ts).
  const sistema = [abertura(podeFazer), ...secoes, LIMITES, REGRA_DADO_NAO_CONFIAVEL, documentos, videos, blocos]
    .filter(Boolean)
    .join("\n\n");

  // O fluxo aberto vem da rota do editor ou, no painel fixo do TI, do corpo
  // (a tela de cadência ou do editor o registra como `extra`).
  const fluxo = fluxoAberto ?? (texto(corpo.fluxo_id, 64).trim() || null);
  const tela = texto(corpo.contexto, 500);
  const contexto = fluxo ? [tela, `fluxo aberto: ${fluxo}`].filter(Boolean).join("; ") : tela;

  return conversar({
    sistema,
    ferramentas: grupos.flatMap((g) => g.ferramentas),
    pergunta,
    historico: historicoDe(corpo.historico),
    contexto,
    // Qualquer gravação avisa a tela, que recarrega o que mostra (o canvas do
    // editor, a lista de captações, o quadro com a cadência nova).
    eventosFinais: () => (grupos.some((g) => g.gravou()) ? [{ t: "mudou" }] : []),
  });
}
