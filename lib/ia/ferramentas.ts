import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
// sqlIa, e não o `sql` de lib/db.ts: a conexão da IA é a do role sem
// privilégio de escrita (ver ./db.ts e migration-revisao-modulos.sql §5).
import { sqlIa } from "./db";
import { carregarFunil } from "@/app/funil/dados";
import { metricasDoFunil } from "@/app/inicio/metricas";
import { brl } from "@/app/formato";
import { comoDado, comoDadoOuNulo } from "./sanitizar";

// Ferramentas que a IA usa para ler o CRM.
//
// POR QUE FERRAMENTA E NÃO DESPEJO DE JSON: mandar a base inteira no prompt
// funciona com poucas dezenas de oportunidades e morre numa base grande —
// estoura contexto e cobra tudo em toda pergunta. Aqui o modelo pede só o
// recorte de que precisa, e a conta fica proporcional à pergunta.
//
// FONTE: Postgres, a mesma consulta que alimenta a tela (carregarFunil) — a
// IA nunca vê um número diferente do que está no quadro.

// Dados do contato (whatsapp/e-mail) só saem daqui com IA_ENVIAR_CONTATO_PII=true.
// Mandar PII para um provedor de modelo é decisão consciente, não default.
const enviarPii = process.env.IA_ENVIAR_CONTATO_PII === "true";

function dados() {
  return carregarFunil();
}

const listarFunis = betaZodTool({
  name: "listar_funis",
  description:
    "Lista os funis do CRM com suas etapas na ordem do fluxo. Use para descobrir os ids antes das outras ferramentas.",
  inputSchema: z.object({}),
  run: async () => {
    const d = await dados();
    return JSON.stringify(
      d.funis.map((f) => ({
        id: f.id,
        nome: f.nome,
        descricao: f.descricao,
        etapas: d.etapas
          .filter((e) => e.funil_id === f.id)
          .map((e) => ({ id: e.id, nome: e.nome, ordem: e.ordem })),
      })),
    );
  },
});

// Reaproveita metricasDoFunil, o MESMO cálculo que o quadro desenha — assim a
// IA nunca diverge do que está na tela.
const metricasFunil = betaZodTool({
  name: "metricas_do_funil",
  description:
    "Métricas por etapa de um funil: quantos leads há em cada uma, quantos chegaram até ela, conversão para a etapa seguinte, ticket médio e tempo médio na etapa.",
  inputSchema: z.object({
    funil_id: z.string().describe("id do funil, de listar_funis"),
  }),
  run: async ({ funil_id }) => {
    const d = await dados();
    const etapas = d.etapas.filter((e) => e.funil_id === funil_id);
    if (etapas.length === 0) return "Funil não encontrado ou sem etapas.";

    const m = metricasDoFunil(etapas, d.oportunidades);
    return JSON.stringify({
      leads_no_funil: m.leads,
      valor_total: brl(m.valorTotal),
      ticket_medio: brl(m.ticketMedio),
      conversao_ponta_a_ponta_pct: m.conversaoTotal,
      etapas: m.etapas.map((e) => ({
        etapa: e.nome,
        leads: e.leads,
        chegaram_ate_aqui: e.acumulado,
        ticket_medio: brl(e.ticketMedio),
        dias_medio_na_etapa: e.diasMedio,
      })),
      conversoes: m.conversoes.map((c) => ({
        de: c.origem,
        para: c.destino,
        taxa_pct: c.taxa,
        seguiram: c.seguiram,
        de_um_total_de: c.entraram,
      })),
    });
  },
});

const listarOportunidades = betaZodTool({
  name: "listar_oportunidades",
  description:
    "Lista oportunidades com filtro e ordenação. Devolve nome do negócio, valor, etapa, dias parados e o nome do contato. Use limite para não puxar mais do que precisa.",
  inputSchema: z.object({
    funil_id: z.string().optional(),
    etapa_id: z.string().optional(),
    ordenar_por: z
      .enum(["valor", "dias_na_etapa", "data_criacao"])
      .optional()
      .describe("padrão: valor"),
    ordem: z.enum(["desc", "asc"]).optional().describe("padrão: desc"),
    limite: z.number().int().min(1).max(50).optional().describe("padrão: 10"),
  }),
  run: async ({ funil_id, etapa_id, ordenar_por, ordem, limite }) => {
    const d = await dados();
    const chave = ordenar_por ?? "valor";
    const sinal = (ordem ?? "desc") === "desc" ? -1 : 1;

    const lista = d.oportunidades
      .filter((o) => (!funil_id || o.funil_id === funil_id) && (!etapa_id || o.etapa_id === etapa_id))
      .sort((a, b) => {
        if (chave === "data_criacao") return sinal * a.data_criacao.localeCompare(b.data_criacao);
        return sinal * (a[chave] - b[chave]);
      })
      .slice(0, limite ?? 10);

    return JSON.stringify(
      lista.map((o) => {
        const c = d.contatoPorId.get(o.contato_id);
        return {
          id: o.id,
          nome: o.nome,
          valor: brl(o.valor),
          status: o.status,
          funil: d.funilPorId.get(o.funil_id)?.nome,
          etapa: d.etapaPorId.get(o.etapa_id)?.nome,
          dias_na_etapa: o.dias_na_etapa,
          contato: c
            ? { id: c.id, nome: comoDado(c.nome), cidade: `${c.cidade}/${c.estado}` }
            : null,
          responsavel: o.responsavel_id ? d.usuarioPorId.get(o.responsavel_id)?.nome : null,
        };
      }),
    );
  },
});

const detalheContato = betaZodTool({
  name: "detalhe_contato",
  description:
    "Ficha de um contato: cadastro, segmentos, tags, oportunidades, anotações, histórico de movimentações e atendimentos (WhatsApp/Instagram/e-mail). Cada atendimento traz um id — use mensagens_do_atendimento para ler a conversa.",
  inputSchema: z.object({
    contato_id: z.string().describe("id do contato, de listar_oportunidades"),
  }),
  run: async ({ contato_id }) => {
    const d = await dados();
    const c = d.contatoPorId.get(contato_id);
    if (!c) return "Contato não encontrado.";

    return JSON.stringify({
      // pushName: quem escolhe é o dono do número, não nós (o webhook cria o
      // contato com ele). Texto de terceiro como qualquer outro.
      nome: comoDado(c.nome),
      cidade: `${c.cidade}/${c.estado}`,
      pais: c.pais,
      criado_em: c.data_criacao,
      ...(enviarPii
        ? { whatsapp: comoDadoOuNulo(c.whatsapp), email: comoDadoOuNulo(c.email) }
        : {}),
      segmentos: (d.segmentosDoContato.get(c.id) ?? []).map((s) => s.nome),
      tags: (d.tagsDoContato.get(c.id) ?? []).map((t) => t.nome),
      oportunidades: (d.oportunidadesDoContato.get(c.id) ?? []).map((o) => ({
        // id e data de criação: é por elas que se recorta a conversa deste
        // negócio (mensagens_do_atendimento com oportunidade_id).
        id: o.id,
        criada_em: o.data_criacao,
        nome: o.nome,
        valor: brl(o.valor),
        status: o.status,
        etapa: d.etapaPorId.get(o.etapa_id)?.nome,
        dias_na_etapa: o.dias_na_etapa,
      })),
      anotacoes: (d.anotacoesDoContato.get(c.id) ?? []).map((a) => ({
        texto: comoDado(a.texto),
        autor: d.usuarioPorId.get(a.autor_id)?.nome,
        data: a.data_criacao,
      })),
      historico: (d.historicoDoContato.get(c.id) ?? []).map((h) => ({
        descricao: h.descricao,
        // Sem autor = registrado pelo sistema (mudança de etapa, entrada e
        // saída de automação). "Sistema" é o que a ficha mostra, e a IA lê o
        // mesmo rótulo para não inventar um responsável que não existe.
        autor: (h.autor_id && d.usuarioPorId.get(h.autor_id)?.nome) || "Sistema",
        data: h.data_criacao,
      })),
      // A conversa é do CONTATO, não de uma oportunidade (o "anexar" saiu em
      // 2026-10-06). Qual trecho é de qual negócio sai da data — ver
      // mensagens_do_atendimento.
      atendimentos: (d.atendimentosDoContato.get(c.id) ?? []).map((a) => ({
        id: a.id,
        canal: a.canal,
        numero: a.numero_instancia,
        status: a.status,
        aberto_em: a.data_criacao,
      })),
    });
  },
});

// Drill-down do atendimento — só chamada quando a pergunta pedir o teor da
// conversa, não junto de detalhe_contato: mensagem é o dado mais numeroso do
// CRM, despejar isso sem pedido estoura contexto rápido.
const mensagensDoAtendimento = betaZodTool({
  name: "mensagens_do_atendimento",
  description:
    "Mensagens trocadas num atendimento específico (WhatsApp/Instagram/e-mail), em ordem cronológica. Use o id que veio de detalhe_contato. Para analisar UMA OPORTUNIDADE, passe também oportunidade_id: vêm só as mensagens do dia em que ela foi criada em diante — a conversa é do contato, e o que veio antes é de outro momento (ou de outro negócio).",
  inputSchema: z.object({
    atendimento_id: z.string().describe("id do atendimento, de detalhe_contato"),
    oportunidade_id: z
      .string()
      .optional()
      .describe("id da oportunidade em análise, de detalhe_contato — recorta a conversa a partir do dia em que ela foi criada"),
  }),
  run: async ({ atendimento_id, oportunidade_id }) => {
    // O RECORTE POR DATA substitui o "anexar atendimento à oportunidade" (saiu
    // em 2026-10-06): o trecho da conversa que é deste negócio é o que veio
    // no dia em que ele foi criado ou depois. "No dia" e não "depois do
    // instante": a conversa que gerou a oportunidade costuma começar minutos
    // antes de ela ser criada. O dia é o de Brasília.
    const oportunidade = oportunidade_id && /^[0-9a-f-]{36}$/i.test(oportunidade_id) ? oportunidade_id : null;
    const linhas = await sqlIa`
      SELECT m.origem, m.texto, m.tipo, m.midia_estado, m.midia_nome, m.midia_duracao,
             to_char(m.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM mensagens m
      WHERE m.atendimento_id = ${atendimento_id}
        AND (${oportunidade}::uuid IS NULL OR m.data_criacao >= (
              SELECT ((o.data_criacao AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
                FROM oportunidades o WHERE o.id = ${oportunidade}::uuid))
      ORDER BY m.data_criacao`;

    if (linhas.length === 0) {
      return oportunidade
        ? "Nenhuma mensagem neste atendimento desde o dia em que esta oportunidade foi criada."
        : "Nenhuma mensagem neste atendimento.";
    }
    return JSON.stringify(
      linhas.map((m) => ({
        de: m.origem === "contato" ? "cliente" : "nós",
        // Escrito pelo cliente, do outro lado do WhatsApp: é O vetor de injeção
        // indireta deste CRM. Vai marcado como dado inerte (./sanitizar.ts).
        texto: comoDado(m.texto),
        // O anexo em si não vai para o modelo (é binário), mas a EXISTÊNCIA
        // dele vai: sem isto, "o cliente mandou o comprovante?" é respondido
        // com "não vejo nada" quando o comprovante está lá, em PDF.
        ...(m.tipo !== "texto"
          ? {
              anexo: {
                tipo: m.tipo,
                nome: comoDadoOuNulo(m.midia_nome),
                duracao_seg: m.midia_duracao,
                disponivel: m.midia_estado === "salva",
              },
            }
          : {}),
        quando: m.data_criacao,
      })),
    );
  },
});

export const ferramentas = [
  listarFunis,
  metricasFunil,
  listarOportunidades,
  detalheContato,
  mensagensDoAtendimento,
];

/**
 * Como a IA responde ao ANALISAR: formato, rigor, o que cada número significa.
 * Mora aqui, junto das ferramentas de leitura, porque o system de /api/ia e o
 * do modo completo (lib/ia/completa.ts) usam o mesmo texto — duas cópias
 * divergiriam na primeira correção.
 */
export const REGRAS_DE_ANALISE = `COMO RESPONDER
- Comece pela RESPOSTA, em uma frase. O detalhe vem depois; nunca antes.
- Números sempre com o nome da etapa/oportunidade a que pertencem, e com a
  unidade ("R$ 12.400", "8 leads", "23 dias"). Número solto não diz nada.
- Ao afirmar um número, deixe claro de onde ele sai (qual etapa, qual recorte,
  quantos leads entraram na conta). Uma taxa sem o denominador é inútil.
- Compare quando houver com o que comparar: uma etapa contra as outras, um
  valor contra a média. "37%" isolado não informa; "37%, a menor do funil",
  sim.
- Termine com o que fazer a respeito, quando os dados sustentarem — uma linha,
  concreta. Se não sustentarem, não invente recomendação.

RIGOR (isto vale mais que ser agradável)
- Nunca invente número: tudo que você afirmar tem que ter vindo de uma
  ferramenta, nesta conversa.
- Se os dados não respondem à pergunta, diga isso e diga QUAL dado faltou.
  Não estime, não arredonde para um palpite, não preencha buraco com o provável.
- Amostra pequena muda a conclusão: com poucos leads numa etapa, diga que o
  número é frágil em vez de tratá-lo como tendência.
- Se a pergunta parte de uma premissa errada sobre o CRM, corrija primeiro.
- Não repita a pergunta de volta, não abra com "claro" ou "ótima pergunta", não
  feche oferecendo ajuda. Nada disso é resposta.

FORMATO (o painel renderiza estas marcas — use, com parcimônia)
- **negrito** no que a pessoa precisa levar embora: o número que importa, o
  nome da etapa em questão. Duas ou três marcas por resposta, não mais — tudo
  em negrito é o mesmo que nada em negrito.
- "## Título" para separar seções, só quando a resposta tiver mesmo mais de um
  assunto. Resposta curta não leva título.
- Listas com "- " para enumerar itens soltos; "1. " quando a ordem importa.
- \`crase\` para nome de campo, etapa ou valor cru do sistema.
- Não existe tabela nem link aqui: o painel não renderiza. Use lista.

O QUE OS NÚMEROS SIGNIFICAM (importante, não repasse errado)
- "Conversão" é DEDUZIDA do retrato atual, não medida no histórico: não existe
  registro de quando um lead mudou de etapa. Conversão de X para Y = quantos
  estão em Y ou além, dividido por quantos estão em X ou além. Serve pra achar
  gargalo; NÃO é taxa histórica. Se o usuário tratar como histórico, corrija.
- "Dias na etapa" é aproximado pela idade do card (agora menos a data de
  criação da oportunidade), pelo mesmo motivo. É um limite superior.
- A conversa (atendimento) é do CONTATO, não de uma oportunidade. Ao analisar
  uma oportunidade, o que conta da conversa é o que veio no dia em que ela foi
  criada ou depois: chame mensagens_do_atendimento com o oportunidade_id. O
  que veio antes é de outro momento do contato — não atribua a este negócio.
- Valores em reais.`;
