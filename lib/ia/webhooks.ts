import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { carregarAlvos, detalheDoWebhook, listarWebhooks } from "@/app/webhooks/dados";
import {
  adicionarAcao,
  configurarCriarLead,
  criarCampo,
  criarWebhook,
  editarCampo,
  editarWebhook,
} from "@/app/webhooks/acoes";
import { DESTINOS, rotuloDoDestino, type DestinoCampo, type TipoCampo } from "@/lib/webhooks";

// Ferramentas que deixam a IA MONTAR uma captação: a webhook, os campos que ela
// recebe e as ações que rodam quando um lead chega.
//
// Irmã de ./automacoes.ts, e com as mesmas três decisões por trás:
//
// 1. ESCREVE PELAS AÇÕES DA TELA, não por SQL. `app/webhooks/acoes.ts` já tem a
//    validação (chave com formato válido, campo personalizado sem destino,
//    funil e etapa quando nasce oportunidade), as mensagens em português e o
//    revalidatePath. Uma segunda porta para o mesmo banco divergiria da
//    primeira no dia em que uma regra mudasse.
//
//    É também por isso que estas ferramentas NÃO usam `sqlIa` (./db.ts): aquela
//    conexão é do role sem privilégio de escrita, e existe justamente para a IA
//    não escrever por fora do caminho revisado.
//
// 2. A IA NÃO APAGA NADA. Não há ferramenta de excluir webhook, campo ou ação —
//    e `definir_campos` só acrescenta e atualiza. A razão é do domínio, não de
//    pudor: a `chave` de um campo é o CONTRATO com quem envia. Some a chave,
//    o outro lado continua mandando e o CRM descarta em silêncio. Quem derruba
//    um campo tem que ser a pessoa, olhando para a tela e sabendo quem envia.
//
//    Consequência aceita: pedir "tire o campo telefone" faz a IA explicar onde
//    se faz, em vez de fazer. É o mesmo desenho de ./db.ts — a promessa de "não
//    apaga" não pode depender do system prompt.
//
// 3. O SEGREDO E A URL NÃO SAEM DAQUI. `listar_webhooks` devolve o slug, nunca
//    o segredo: quem copia o endereço é a pessoa, no painel. Não é que o modelo
//    fosse vazá-lo de propósito — é que a resposta dele vira texto no chat, e
//    chat é o lugar errado para uma credencial que abre um endpoint de escrita.

const DESTINOS_EM_TEXTO = DESTINOS.map(
  (d) => `- ${d.valor} — ${d.grupo} · ${d.rotulo}`,
).join("\n");

const TIPOS: TipoCampo[] = ["texto", "numero", "data", "booleano"];

const campoEntrada = z.object({
  chave: z
    .string()
    .describe(
      'a chave EXATA do JSON que o outro lado envia, ex. "email" ou "utm_source". Só letras, números, ponto, hífen e _.',
    ),
  rotulo: z.string().describe("como o campo aparece na tela do CRM"),
  tipo: z
    .enum(["texto", "numero", "data", "booleano"])
    .describe("tipo do valor que chega"),
  obrigatorio: z
    .boolean()
    .describe("sem este campo o lead é recusado com 422"),
  destino: z
    .string()
    .describe("para onde o valor vai no CRM; use um dos destinos da lista do sistema"),
  destino_chave: z
    .string()
    .optional()
    .describe(
      'obrigatório quando o destino é "contato.campo" ou "oportunidade.campo": a chave do campo personalizado que recebe o valor',
    ),
});

/** O erro de uma action, virado texto para o modelo se corrigir sozinho. */
function motivo(e: unknown) {
  return e instanceof Error ? e.message : "erro desconhecido";
}

export function ferramentasDeWebhooks() {
  // Vira true quando alguma escrita grava de fato. A rota lê isto no fim do
  // stream para a tela recarregar — a lista e o painel são renderizados no
  // servidor e não sabem sozinhos que a IA mexeu.
  let gravou = false;

  const listar = betaZodTool({
    name: "listar_webhooks",
    description:
      "Lista as captações já existentes: id, nome, se está ativa, quantos campos e ações tem e quantos leads chegaram nos últimos 7 dias. Use para achar o id antes de qualquer outra ferramenta.",
    inputSchema: z.object({}),
    run: async () => {
      const lista = await listarWebhooks();
      return JSON.stringify(
        lista.map((w) => ({
          id: w.id,
          nome: w.nome,
          descricao: w.descricao,
          // slug sim, segredo não: o slug identifica a captação num log, o
          // segredo é a credencial.
          slug: w.slug,
          ativo: w.ativo,
          campos: w.total_campos,
          acoes: w.total_acoes,
          recebidos_7d: w.recebidos_7d,
          erros_7d: w.erros_7d,
        })),
      );
    },
  });

  const ler = betaZodTool({
    name: "ler_webhook",
    description:
      "Lê uma captação inteira: os campos declarados (com a chave que o outro lado manda e para onde cada valor vai) e as ações que rodam a cada lead. Chame SEMPRE antes de mexer numa captação que já existe.",
    inputSchema: z.object({
      webhook_id: z.string().describe("id da captação, de listar_webhooks"),
    }),
    run: async ({ webhook_id }) => {
      const d = await detalheDoWebhook(webhook_id);
      return JSON.stringify({
        campos: d.campos.map((c) => ({
          chave: c.chave,
          rotulo: c.rotulo,
          tipo: c.tipo,
          obrigatorio: c.obrigatorio,
          destino: c.destino,
          destino_chave: c.destino_chave,
          resumo: rotuloDoDestino(c),
        })),
        acoes: d.acoes.map((a) => ({
          tipo: a.tipo,
          alvo: a.alvo_nome,
          criar_oportunidade: a.criar_oportunidade,
          funil: a.funil_nome,
          etapa: a.etapa_nome,
        })),
        // O log entra como CONTAGEM, não como payload: os recebimentos trazem
        // o que o site mandou — nome, telefone, e-mail de gente real —, e nada
        // disso é preciso para montar campo ou ação.
        recebimentos: d.metricas.total,
        recusados: d.metricas.recusado,
      });
    },
  });

  const alvos = betaZodTool({
    name: "listar_alvos",
    description:
      "Lista o que a captação pode escolher: funis e etapas (onde o card nasce), tags, segmentos, fluxos publicados e os campos personalizados do CRM. Chame antes de definir_acoes (os ids saem daqui) e antes de definir_campos quando for usar campo personalizado (a chave sai de camposCrm).",
    inputSchema: z.object({}),
    run: async () => JSON.stringify(await carregarAlvos()),
  });

  const criar = betaZodTool({
    name: "criar_webhook",
    description:
      "Cria uma captação nova, já com a ação 'criar lead' (que é obrigatória). Devolve o id. Depois use definir_campos e definir_acoes. A URL e o segredo de envio ficam no painel da tela — não peça nem repita o segredo.",
    inputSchema: z.object({
      nome: z
        .string()
        .describe('de onde vem o lead, ex. "Formulário do site" ou "Landing Black Friday"'),
      descricao: z
        .string()
        .optional()
        .describe("uma linha sobre o que essa captação recebe"),
    }),
    run: async ({ nome, descricao }) => {
      try {
        const id = await criarWebhook(nome);
        if (descricao) await editarWebhook(id, nome, descricao);
        gravou = true;
        return `Captação "${nome}" criada com o id ${id}. Ela já nasce ATIVA e com a ação "criar lead". Chame definir_campos para declarar o que ela recebe.`;
      } catch (e) {
        return `RECUSADO, nada foi criado: ${motivo(e)}`;
      }
    },
  });

  const editar = betaZodTool({
    name: "editar_webhook",
    description:
      "Troca o nome e a descrição de uma captação. Não mexe na URL, no segredo nem nos campos.",
    inputSchema: z.object({
      webhook_id: z.string(),
      nome: z.string(),
      descricao: z.string().optional(),
    }),
    run: async ({ webhook_id, nome, descricao }) => {
      try {
        await editarWebhook(webhook_id, nome, descricao ?? "");
        gravou = true;
        return `Captação renomeada para "${nome}".`;
      } catch (e) {
        return `RECUSADO, nada mudou: ${motivo(e)}`;
      }
    },
  });

  const campos = betaZodTool({
    name: "definir_campos",
    description:
      "Declara os campos que a captação recebe. ACRESCENTA os que não existem e ATUALIZA os que já existem (casados pela chave). NÃO apaga: campo que você não mandar continua lá, e quem tira campo é a pessoa, na tela — a chave é o contrato com quem envia.",
    inputSchema: z.object({
      webhook_id: z.string().describe("id da captação, de listar_webhooks"),
      campos: z.array(campoEntrada),
    }),
    run: async ({ webhook_id, campos: entrada }) => {
      const atuais = (await detalheDoWebhook(webhook_id)).campos;
      const porChave = new Map(atuais.map((c) => [c.chave, c]));

      const criados: string[] = [];
      const atualizados: string[] = [];
      const recusados: string[] = [];

      for (const c of entrada) {
        const destino = c.destino as DestinoCampo;
        const tipo: TipoCampo = TIPOS.includes(c.tipo) ? c.tipo : "texto";
        const existente = porChave.get(c.chave.trim());

        try {
          if (existente) {
            await editarCampo(
              existente.id,
              c.rotulo,
              tipo,
              c.obrigatorio,
              destino,
              c.destino_chave ?? "",
            );
            atualizados.push(c.chave);
          } else {
            await criarCampo(
              webhook_id,
              c.chave,
              c.rotulo,
              tipo,
              c.obrigatorio,
              destino,
              c.destino_chave ?? "",
            );
            criados.push(c.chave);
          }
          gravou = true;
        } catch (e) {
          // Campo a campo, e não tudo ou nada: uma chave inválida no meio da
          // lista não pode derrubar as outras nove que estavam certas.
          recusados.push(`${c.chave} (${motivo(e)})`);
        }
      }

      const sobraram = atuais
        .filter((c) => !entrada.some((e) => e.chave.trim() === c.chave))
        .map((c) => c.chave);

      return [
        criados.length ? `Criados: ${criados.join(", ")}.` : "",
        atualizados.length ? `Atualizados: ${atualizados.join(", ")}.` : "",
        recusados.length ? `RECUSADOS: ${recusados.join("; ")}.` : "",
        sobraram.length
          ? `Continuam declarados e não foram tocados: ${sobraram.join(", ")}. Se algum não deve mais existir, diga à pessoa para removê-lo na aba Campos — você não apaga campo.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
  });

  const acoes = betaZodTool({
    name: "definir_acoes",
    description:
      "Configura o que acontece quando um lead chega: se nasce oportunidade (e em qual funil e etapa) e quais ações extras rodam — inscrever num fluxo, adicionar a um segmento, marcar com uma tag. ACRESCENTA as extras; não remove nenhuma. Os ids vêm de listar_alvos.",
    inputSchema: z.object({
      webhook_id: z.string(),
      criar_oportunidade: z
        .boolean()
        .describe("o lead vira card no funil? Se true, mande funil_id e etapa_id."),
      funil_id: z.string().optional(),
      etapa_id: z.string().optional(),
      acoes: z
        .array(
          z.object({
            tipo: z.enum(["inscrever_fluxo", "adicionar_segmento", "adicionar_tag"]),
            alvo_id: z
              .string()
              .describe("id do fluxo, do segmento ou da tag, conforme o tipo"),
          }),
        )
        .optional(),
    }),
    run: async ({ webhook_id, criar_oportunidade, funil_id, etapa_id, acoes: extras }) => {
      const partes: string[] = [];

      try {
        await configurarCriarLead(
          webhook_id,
          criar_oportunidade,
          funil_id ?? "",
          etapa_id ?? "",
        );
        gravou = true;
        partes.push(
          criar_oportunidade
            ? "Cada lead passa a abrir uma oportunidade no funil e etapa escolhidos."
            : "O lead vira contato, sem abrir oportunidade.",
        );
      } catch (e) {
        partes.push(`RECUSADO em criar_lead: ${motivo(e)}`);
      }

      for (const a of extras ?? []) {
        try {
          await adicionarAcao(webhook_id, a.tipo, a.alvo_id);
          gravou = true;
          partes.push(`Ação ${a.tipo} adicionada.`);
        } catch (e) {
          // Duplicada é o caso comum aqui: o índice único recusa a mesma tag
          // duas vezes, e isso é o estado desejado, não uma falha.
          partes.push(`${a.tipo}: ${motivo(e)}`);
        }
      }

      return partes.join(" ");
    },
  });

  return {
    ferramentas: [listar, ler, alvos, criar, editar, campos, acoes],
    gravou: () => gravou,
  };
}

export const SISTEMA_WEBHOOKS = `Você monta CAPTAÇÕES no Chroma, um CRM. Responde em português do Brasil.

Uma captação (webhook) é um endereço que recebe lead de fora — formulário de site, landing page, n8n, Zapier. Ela tem duas partes:
- CAMPOS: as chaves do JSON que chegam e para onde cada valor vai no CRM.
- AÇÕES: o que roda a cada lead — criar o contato (sempre), abrir oportunidade, inscrever num fluxo, marcar tag, pôr em segmento.

COMO TRABALHAR
- Antes de mexer numa captação que já existe, chame ler_webhook. Antes de definir ações, chame listar_alvos: os ids saem de lá, você não os inventa.
- Ao criar uma captação nova, faça o caminho inteiro na mesma resposta: criar_webhook, definir_campos e definir_acoes. Entregar só a casca obriga a pessoa a pedir o resto.
- Se uma ferramenta recusar, leia o motivo, corrija e chame de novo. Não devolva o erro cru para a pessoa resolver.
- No fim, diga em duas ou três linhas o que ficou montado e o que falta a pessoa fazer na tela. Sem repetir JSON.

CAMPOS — onde é fácil errar
- A "chave" é o nome exato que o outro lado envia, e é o CONTRATO: acento, hífen e maiúscula contam. "email" não é "e-mail".
- Todo campo tem um destino. Os que existem:
${DESTINOS_EM_TEXTO}
- "contato.campo" e "oportunidade.campo" exigem destino_chave, e essa chave tem que ser a de um campo personalizado QUE JÁ EXISTE: pegue em listar_alvos (camposCrm), nunca invente. Chave que não existe grava um valor que nenhuma tela do CRM mostra.
- Você não cria campo personalizado. Se o que a pessoa quer guardar não tem campo, diga que ela precisa criá-lo em Configurações › Campos antes.
- "ignorar" serve para o que chega e não interessa (utm, id do formulário). Declarar e ignorar é melhor que não declarar: fica registrado que aquilo chega.
- Marque obrigatório só o que, faltando, torna o lead inútil. Campo obrigatório ausente faz o CRM responder 422 e RECUSAR o lead inteiro.
- Sempre inclua nome e uma forma de contato (whatsapp ou e-mail). Lead sem como responder não serve para nada.
- WhatsApp chega como dígitos, com DDI e DDD: 5547999346074.

AÇÕES
- "criar lead" é obrigatória e já vem com a captação: ela resolve o contato de que as outras dependem. Se ligar a oportunidade, escolha funil E etapa.
- "inscrever_fluxo" só aceita fluxo PUBLICADO. Se o que a pessoa quer ainda é rascunho, diga isso e siga sem essa ação.

O QUE VOCÊ NÃO FAZ
- Não apaga captação, campo nem ação. definir_campos só acrescenta e atualiza. Se a pessoa quiser remover, diga onde se faz na tela — tirar uma chave quebra em silêncio quem já está enviando.
- Não ativa, não desativa e não troca o segredo.
- Não mostra nem pede o segredo, e não monta a URL de envio: ela está no painel da captação, com o botão de copiar. Se pedirem o endereço, mande a pessoa abrir a captação e copiar de lá.
- Não dispara nada e não cria lead de teste: quem envia é o sistema do outro lado.`;
