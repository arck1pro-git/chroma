import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CATALOGO } from "@/lib/automacoes/catalogo";
import { compilar, ErroCompilacao } from "@/lib/automacoes/compilador";
import { dispor } from "@/lib/automacoes/layout";
import { definicaoDoFluxo, salvarRascunho } from "@/lib/automacoes/repositorio";
import { NO_ENTRADA, type DefinicaoFluxo } from "@/lib/automacoes/tipos";
import { documentosEscolhiveis } from "@/lib/documentos";

// Ferramentas que deixam a IA MONTAR um fluxo de automação.
//
// Três decisões sustentam este arquivo:
//
// 1. SÓ RASCUNHO. Nada aqui publica. `publicar` cria workflow numa instância
//    n8n compartilhada com produção e o app ainda não tem autenticação
//    (docs/automacoes-arquitetura.md §3.1) — modelo escrevendo direto no motor
//    seria um endpoint público disparando WhatsApp pela uazapi. A costura
//    rascunho/publicado já existia; a IA fica de um lado dela.
//
// 2. O ID DO FLUXO NÃO VEM DO MODELO. Ele vem da URL do builder e é fechado
//    numa closure em `ferramentasDoFluxo`. Assim não existe a classe de erro
//    "a IA reescreveu o fluxo errado" — ela não tem como nomear outro.
//
// 3. O COMPILADOR É O REVISOR. `escrever_fluxo` compila antes de gravar e,
//    quando recusa, DEVOLVE A MENSAGEM como resultado da ferramenta em vez de
//    estourar. O modelo lê "X não está ligado à entrada do fluxo" e conserta
//    sozinho, normalmente numa tentativa. É o que separa "às vezes funciona"
//    de "funciona".

// Blocos indisponíveis ficam FORA do que o modelo enxerga: o compilador os
// recusa de qualquer jeito, e mostrá-los só renderia uma ida e volta perdida.
const DISPONIVEIS = CATALOGO.filter((b) => !b.indisponivel);

// O catálogo em texto, gerado do próprio catálogo — some o risco de o prompt
// descrever um bloco que não existe mais.
export const CATALOGO_EM_TEXTO = DISPONIVEIS.map((b) => {
  const saidas = b.saidas.length
    ? b.saidas.map((s) => `${s.id} (${s.rotulo || "seguir"})`).join(", ")
    : "nenhuma (o fluxo termina aqui)";
  return `- ${b.tipo} — ${b.rotulo}. ${b.descricao} Saídas: ${saidas}.`;
}).join("\n");

// ── Ferramentas ────────────────────────────────────────────────────────────

const noEntrado = z.object({
  id: z
    .string()
    .describe('id curto e estável do bloco, ex. "msg1". Não use "__entrada__".'),
  tipo: z.string().describe("tipo do bloco, exatamente como no catálogo"),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("configuração do bloco; veja as regras de config no sistema"),
});

const arestaEntrada = z.object({
  de: z.string().describe('id de origem, ou "__entrada__" para a raiz'),
  para: z.string().describe("id de destino"),
  ramo: z
    .string()
    .optional()
    .describe(
      'id da saída usada. Obrigatório quando o bloco tem mais de uma saída (ex. "nao_respondeu"). Omita em bloco de saída única.',
    ),
});

export function ferramentasDoFluxo(fluxoId: string) {
  // Vira true quando alguma escrita grava de fato. A rota lê isto no fim do
  // stream para mandar o builder recarregar o canvas.
  let gravou = false;

  const ler = betaZodTool({
    name: "ler_fluxo",
    description:
      "Lê o rascunho atual do fluxo aberto: seus blocos, a configuração de cada um e as ligações. Chame SEMPRE antes de alterar um fluxo que já tem blocos.",
    inputSchema: z.object({}),
    run: async () => {
      const d = await definicaoDoFluxo(fluxoId);
      // Sem `layout`: o modelo não posiciona nada (quem posiciona é dispor) e
      // mandar coordenada só gastaria contexto.
      return JSON.stringify({
        nos: Object.entries(d.nos).map(([id, n]) => ({
          id,
          tipo: n.tipo,
          config: n.config,
        })),
        arestas: d.arestas,
        vazio: Object.keys(d.nos).length === 0,
      });
    },
  });

  const escrever = betaZodTool({
    name: "escrever_fluxo",
    description:
      "SUBSTITUI o rascunho do fluxo aberto pelos blocos e ligações informados. Não é edição parcial: o que não vier aqui é apagado, então mande o fluxo inteiro. Salva apenas o rascunho — nunca publica. Se o fluxo for inválido, devolve o motivo em vez de gravar: corrija e chame de novo.",
    inputSchema: z.object({
      nos: z.array(noEntrado),
      arestas: z.array(arestaEntrada),
      resumo: z
        .string()
        .describe("uma frase, em português, do que este fluxo faz"),
    }),
    run: async ({ nos, arestas }) => {
      const mapa: DefinicaoFluxo["nos"] = {};
      for (const n of nos) {
        // A entrada é a raiz do grafo, não um bloco do catálogo: se o modelo a
        // mandar na lista, ela entra só no layout.
        if (n.id === NO_ENTRADA) continue;
        mapa[n.id] = { tipo: n.tipo, config: n.config ?? {} };
      }

      const definicao: DefinicaoFluxo = {
        schema: "chroma.flow/v1",
        nos: mapa,
        arestas: arestas.map((a) => ({
          de: a.de,
          para: a.para,
          // "padrao" não é gravado: é a saída única, e omiti-la mantém o diff
          // entre versões limpo (mesma regra do builder, em canvas.ts).
          ...(a.ramo && a.ramo !== "padrao" ? { ramo: a.ramo } : {}),
        })),
        layout: {},
      };
      definicao.layout = dispor(definicao);

      // ANEXO: o id tem que ser de um documento QUE EXISTE.
      //
      // O modelo escolhe de uma lista real (ela vai no system, ver
      // `blocoDeDocumentos`), mas lista no prompt é orientação, não garantia —
      // um uuid inventado é a falha mais provável aqui. E é uma falha CARA de
      // descobrir tarde: a coluna mostra "documento removido" e o disparo só
      // quebra no primeiro lead da cadência, dias depois.
      //
      // Recusar devolvendo o motivo (em vez de estourar) é o padrão desta
      // ferramenta: o modelo lê e conserta sozinho, como já faz com os erros do
      // compilador.
      const anexados = Object.entries(mapa)
        .map(([id, n]) => [id, n.config?.documento_id] as const)
        .filter(([, doc]) => typeof doc === "string" && doc);

      if (anexados.length > 0) {
        const validos = new Set(
          (await documentosEscolhiveis().catch(() => [])).map((d) => d.id),
        );
        const invalido = anexados.find(([, doc]) => !validos.has(doc as string));
        if (invalido) {
          return `RECUSADO, nada foi gravado: o bloco "${invalido[0]}" aponta para um documento que não está na biblioteca (documento_id "${invalido[1]}"). Use um dos ids da lista BIBLIOTECA DE DOCUMENTOS do sistema, exatamente como está escrito — não invente id. Se o documento que o usuário pediu não estiver na lista, monte a mensagem SEM anexo e diga a ele que precisa subir o arquivo em Documentos primeiro.`;
        }
      }

      try {
        // nome e webhook não participam da validação — o compilador só os
        // carrega para dentro do plano. Placeholders bastam aqui.
        compilar(definicao, { fluxoId, nome: "", webhookCaminho: "" });
      } catch (e) {
        if (e instanceof ErroCompilacao) {
          return `RECUSADO, nada foi gravado: ${e.message}${
            e.noId ? ` (bloco "${e.noId}")` : ""
          } Corrija e chame escrever_fluxo de novo com o fluxo inteiro.`;
        }
        throw e;
      }

      const versao = await salvarRascunho(fluxoId, definicao, null);
      gravou = true;
      return `Rascunho gravado como versão ${versao}, com ${Object.keys(mapa).length} blocos. NÃO está publicado: quem publica é a pessoa, pelo botão Publicar.`;
    },
  });

  return { ferramentas: [ler, escrever], gravou: () => gravou };
}

/**
 * A biblioteca, escrita para o system do modelo.
 *
 * Vai como bloco ANEXADO ao system e não dentro de SISTEMA_AUTOMACOES porque a
 * lista muda a cada upload — uma constante de módulo congelaria o acervo no
 * primeiro import do processo. É o mesmo padrão de app/api/ia/route.ts, que
 * junta os contextos ao system na hora.
 *
 * Só id e nome. A descrição entra quando existir: é ela que ajuda o modelo a
 * escolher entre "Tabela de preços" e "Tabela de preços — corporativo".
 */
export async function blocoDeDocumentos(): Promise<string> {
  const lista = await documentosEscolhiveis().catch(() => []);
  if (lista.length === 0) {
    return `BIBLIOTECA DE DOCUMENTOS
(vazia — não há nenhum arquivo para anexar. Se pedirem anexo, diga que é preciso subir o arquivo no módulo Documentos primeiro.)`;
  }
  const linhas = lista
    .map((d) => `- ${d.id} — ${d.nome}${d.descricao ? `: ${d.descricao}` : ""} (${d.tipo})`)
    .join("\n");
  return `BIBLIOTECA DE DOCUMENTOS
Arquivos que podem ir anexados numa mensagem de WhatsApp. Para anexar, ponha o id na config do bloco: { "documento_id": "<id>" }. Copie o id exatamente; id inventado faz a gravação ser recusada.
${linhas}`;
}

export const SISTEMA_AUTOMACOES = `Você monta automações no Chroma, um CRM. Responde em português do Brasil.

Uma automação é um grafo: a entidade inscrita entra pelo nó de entrada e caminha pelos blocos. O usuário está com UM fluxo aberto no editor, e suas ferramentas agem sobre esse fluxo — não há como escolher outro.

COMO TRABALHAR
- Se o fluxo já tem blocos, chame ler_fluxo ANTES de mexer. escrever_fluxo substitui tudo: sem ler antes, você apaga o que já existia.
- escrever_fluxo exige o fluxo INTEIRO, inclusive os blocos que não mudaram.
- Se escrever_fluxo recusar, leia o motivo, corrija e chame de novo. Não peça ajuda ao usuário para erro que você mesmo pode consertar.
- Depois de gravar, diga em uma ou duas frases o que ficou montado. Sem repetir o JSON.
- Fluxo grande é bem-vindo: uma cadência de 18 mensagens é normal aqui. Monte de uma vez, não em pedaços.

REGRAS DO GRAFO
- A raiz é "__entrada__". Ela não é um bloco, não entre na lista de nós, e precisa de pelo menos uma aresta saindo dela.
- Todo bloco tem que ser alcançável a partir de "__entrada__". Bloco solto faz a gravação ser recusada.
- "ramo" é o id da saída: obrigatório em bloco com mais de uma saída, omitido em bloco de saída única.
- Não crie ciclo.
- Use ids curtos e descritivos ("espera1", "msg1"), estáveis entre chamadas.

BLOCOS DISPONÍVEIS
${CATALOGO_EM_TEXTO}

CONFIGURAÇÃO DOS BLOCOS — leia com atenção, aqui é fácil prometer o que não existe
- "esperar" e "verificar_resposta": use { "minutos": <número> }. Um dia = 1440.
- "se" e "alternador": DEIXE config vazio ({}). O formato de expressão do CRM ainda não foi definido, e inventar sintaxe geraria uma condição que não avalia. Monte a ramificação e AVISE ao usuário, em uma linha, que a condição precisa ser preenchida à mão.
- Blocos de mensagem: { "titulo": "...", "texto": "..." } — e "assunto" no e-mail. O "titulo" é curto (2 a 4 palavras) e é o NOME DA COLUNA no quadro de cadência; o "texto" é a mensagem que sai de verdade.
- No texto, estas variáveis são substituídas no envio: {{nome}}, {{primeiro_nome}}, {{oportunidade}}, {{valor}}. Qualquer outra sai literal — não invente.
- NÃO escreva "instancia_id": de qual número de WhatsApp a cadência sai é escolha da pessoa, no seletor da tela.
- ANEXO, só em "enviar_whatsapp_web": { "documento_id": "<id da biblioteca>" }. Use SOMENTE um id da lista BIBLIOTECA DE DOCUMENTOS abaixo, copiado exatamente. Nunca invente id, e não escreva "documento_id" quando a lista estiver vazia ou quando o usuário não pedir anexo.
- Mensagem com anexo sai como UM envio: o arquivo com o "texto" de legenda. Não monte um bloco para o arquivo e outro para o texto — chegariam duas notificações no celular do lead.
- Com anexo, o "texto" pode ser curto ou vazio. Escreva a legenda pensando em quem recebe o arquivo, não repita o nome do documento.
- Escreva as mensagens em português do Brasil, curtas e no tom de quem está vendendo por WhatsApp.

O QUE O CRM EXECUTA DE VERDADE, HOJE
- "enviar_whatsapp_web": envia mesmo, pela uazapi, e a mensagem aparece no chat do contato.
- "enviar_notificacao": vira uma linha no histórico do contato. É o que usamos quando o passo é uma LIGAÇÃO — o motor não disca.
- "atualizar_oportunidade" e "mudar_tag": mexem no CRM.
- "enviar_email" e "requisicao_http": ainda NÃO saem — o motor pula o bloco e registra o motivo. Pode montar, mas diga isso ao usuário em uma linha.

CADÊNCIA DE ETAPA — o formato que a tela da raiz desenha
Quando o fluxo é a cadência de uma etapa do funil, ele é lido como um QUADRO: uma coluna por mensagem. Para isso a corrente tem que ser RETA:
    __entrada__ → [esperar] → mensagem → esperar → mensagem → …
Sem "se", sem "alternador", sem duas arestas saindo do mesmo bloco. Se o pedido exigir desvio, monte assim mesmo e avise que o quadro vai mostrar só o trecho reto e que a edição passa a ser pelo builder.

O QUE VOCÊ NÃO FAZ
- Não publica e não dispara. Você grava rascunho; publicar e disparar são cliques da pessoa, e é o disparo que manda mensagem para gente real.
- Não promete envio. Nada do que você grava sai enquanto a pessoa não publicar E disparar.
- Não mexe em contatos, oportunidades ou etapas do funil. Se pedirem, diga onde a pessoa faz na tela.`;
