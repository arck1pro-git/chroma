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
        autor: d.usuarioPorId.get(h.autor_id)?.nome,
        data: h.data_criacao,
      })),
      atendimentos: (d.atendimentosDoContato.get(c.id) ?? []).map((a) => ({
        id: a.id,
        canal: a.canal,
        numero: a.numero_instancia,
        status: a.status,
        anexado_a_oportunidade: a.oportunidade_id
          ? (d.oportunidadesDoContato.get(c.id) ?? []).find(
              (o) => o.id === a.oportunidade_id,
            )?.nome
          : null,
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
    "Mensagens trocadas num atendimento específico (WhatsApp/Instagram/e-mail), em ordem cronológica. Use o id que veio de detalhe_contato.",
  inputSchema: z.object({
    atendimento_id: z.string().describe("id do atendimento, de detalhe_contato"),
  }),
  run: async ({ atendimento_id }) => {
    const linhas = await sqlIa`
      SELECT origem, texto, tipo, midia_estado, midia_nome, midia_duracao,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM mensagens
      WHERE atendimento_id = ${atendimento_id}
      ORDER BY data_criacao`;

    if (linhas.length === 0) return "Nenhuma mensagem neste atendimento.";
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
