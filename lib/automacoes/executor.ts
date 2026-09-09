// O CRM executando um bloco. É a Opção B do docs/automacoes-n8n.md §1: o motor
// guarda ordem, desvio e espera; QUEM FAZ é o CRM, aqui.
//
// O que isso compra, e por que vale a ida e volta HTTP:
//   · a mensagem da automação nasce em `mensagens` e aparece no /chat, junto
//     com o que o vendedor digitou — não em um silo à parte;
//   · o token da uazapi não sai do CRM (o motor nunca o vê);
//   · rate limit e modo simulação ficam num ponto só (./servico.ts);
//   · trocar de motor não mexe em integração nenhuma, só em quem chama isto.
//
// Nada aqui conhece o motor. O que chega são três ponteiros — fluxo, nó e
// execução —, tudo vocabulário do CRM. O QUE fazer sai da versão que a execução
// inscreveu, lida aqui do banco: o motor carrega a ordem, não o conteúdo.

import { sql } from "@/lib/db";
import { soDigitos } from "@/lib/telefone";
import { enviarTexto, instanciaPorId } from "@/lib/uazapi";
import { cabeDisparo } from "./servico";
import type { DefinicaoFluxo } from "./tipos";

// O que o motor manda: ponteiros, não conteúdo. O tipo e a config do bloco
// saem da VERSÃO da execução, aqui no CRM — ver `contextoDe` e o comentário do
// jsonBody no adaptador.
export type PedidoAcao = {
  fluxoId: string;
  noId: string;
  execucaoId: string;
};

// O bloco já resolvido a partir da versão publicada.
type Bloco = { tipo: string; config: Record<string, unknown> };

export type ResultadoAcao = {
  estado: "sucesso" | "erro" | "pulado";
  // Mensagem para quem está lendo o log — e, no erro, o que o callback do
  // motor grava em fluxo_execucoes.erro_msg.
  detalhe: string;
  // Só no modo simulação: o que TERIA saído. Não é persistido (ver `saida`
  // abaixo), volta na resposta HTTP para a tela conseguir mostrar.
  previa?: { numero: string; texto: string };
};

// ── Contexto da execução ────────────────────────────────────────────────────

type Contexto = {
  entidadeTipo: "contato" | "oportunidade";
  entidadeId: string;
  contatoId: string | null;
  contatoNome: string | null;
  whatsapp: string | null;
  oportunidadeId: string | null;
  oportunidadeNome: string | null;
  valor: number | null;
};

async function contextoDe(execucaoId: string): Promise<{
  ctx: Contexto;
  fluxoId: string;
  definicao: DefinicaoFluxo;
  estado: string;
} | null> {
  // Um SELECT só: o bloco roda dentro de um request do motor, e cada ida ao
  // banco aqui multiplica pelo número de blocos da cadência. A definição vem
  // junto porque é dela que sai o que executar.
  const [linha] = await sql`
    SELECT e.entidade_tipo, e.entidade_id, e.fluxo_id, e.estado, v.definicao,
           o.id AS oportunidade_id, o.nome AS oportunidade_nome, o.valor::float8 AS valor,
           c.id AS contato_id, c.nome AS contato_nome, c.whatsapp
    FROM fluxo_execucoes e
    JOIN fluxo_versoes v ON v.id = e.versao_id
    LEFT JOIN oportunidades o
      ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
    LEFT JOIN contatos c
      ON c.id = COALESCE(o.contato_id,
                         CASE WHEN e.entidade_tipo = 'contato' THEN e.entidade_id END)
    WHERE e.id = ${execucaoId}`;

  if (!linha) return null;
  return {
    fluxoId: linha.fluxo_id as string,
    definicao: linha.definicao as DefinicaoFluxo,
    estado: linha.estado as string,
    ctx: {
      entidadeTipo: linha.entidade_tipo,
      entidadeId: linha.entidade_id,
      contatoId: linha.contato_id ?? null,
      contatoNome: linha.contato_nome ?? null,
      whatsapp: linha.whatsapp ?? null,
      oportunidadeId: linha.oportunidade_id ?? null,
      oportunidadeNome: linha.oportunidade_nome ?? null,
      valor: linha.valor ?? null,
    },
  };
}

// ── Variáveis do texto ──────────────────────────────────────────────────────

// Lista fechada, de propósito: `{{qualquer_coisa}}` que não esteja aqui sai
// LITERAL, e ver "{{sobrenome}}" chegar no WhatsApp do cliente é o aviso mais
// barato de que a variável não existe. Trocar por vazio esconderia o erro.
function preencher(texto: string, ctx: Contexto) {
  const nome = ctx.contatoNome?.trim() ?? "";
  const valores: Record<string, string> = {
    nome,
    primeiro_nome: nome.split(/\s+/)[0] ?? "",
    oportunidade: ctx.oportunidadeNome ?? "",
    valor:
      ctx.valor === null
        ? ""
        : ctx.valor.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          }),
  };

  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (bruto, chave: string) =>
    chave in valores ? valores[chave] : bruto,
  );
}

function comoTexto(v: unknown) {
  return typeof v === "string" ? v : "";
}

// ── Registro do passo ───────────────────────────────────────────────────────

// PII: o schema pede para truncar e redigir antes de gravar
// (schema-automacoes.sql, fluxo_execucao_passos). O número vai mascarado e o
// texto, cortado — o suficiente para depurar "que mensagem foi essa", sem
// virar uma segunda cópia da conversa numa tabela que ninguém vigia.
function mascarar(numero: string) {
  const d = soDigitos(numero);
  return d.length > 4 ? `••••${d.slice(-4)}` : "••••";
}

async function gravarPasso(
  pedido: PedidoAcao,
  tipo: string,
  resultado: ResultadoAcao,
  saida: Record<string, unknown>,
  duracaoMs: number,
) {
  const [{ ordem }] = await sql`
    SELECT COALESCE(MAX(ordem), 0) + 1 AS ordem
    FROM fluxo_execucao_passos WHERE execucao_id = ${pedido.execucaoId}`;

  await sql`
    INSERT INTO fluxo_execucao_passos
      (execucao_id, no_id, no_tipo, ordem, estado, saida, erro, duracao_ms)
    VALUES (${pedido.execucaoId}, ${pedido.noId}, ${tipo}, ${ordem},
            ${resultado.estado}, ${sql.json(saida as never)},
            ${resultado.estado === "erro" ? resultado.detalhe : null},
            ${duracaoMs})`;
}

// ── Ações ───────────────────────────────────────────────────────────────────

async function enviarWhatsApp(
  bloco: Bloco,
  ctx: Contexto,
): Promise<[ResultadoAcao, Record<string, unknown>]> {
  const bruto = comoTexto(bloco.config.texto).trim();
  if (!bruto) {
    return [
      { estado: "erro", detalhe: "Bloco de WhatsApp sem texto." },
      { motivo: "sem_texto" },
    ];
  }
  if (!ctx.whatsapp) {
    return [
      { estado: "erro", detalhe: "Contato sem número de WhatsApp." },
      { motivo: "sem_numero" },
    ];
  }

  const texto = preencher(bruto, ctx);
  const numero = soDigitos(ctx.whatsapp);

  const limite = await cabeDisparo();
  if (!limite.ok) {
    return [{ estado: "erro", detalhe: limite.erro }, { motivo: "rate_limit" }];
  }

  const instancia = await instanciaPorId(
    comoTexto(bloco.config.instancia_id) || null,
  );

  // Daqui pra baixo é o mesmo caminho do /chat (app/chat/actions.ts): a linha
  // nasce 'pendente' ANTES da rede, então uma falha de conexão deixa registro
  // em vez de sumir com a mensagem.
  const atendimentoId = await atendimentoDe(ctx.contatoId!, instancia.numero);
  const [msg] = await sql`
    INSERT INTO mensagens (atendimento_id, origem, autor_id, texto, status)
    VALUES (${atendimentoId}, 'agente', NULL, ${texto}, 'pendente')
    RETURNING id`;

  try {
    const r = await enviarTexto(numero, texto, instancia);
    await sql`
      UPDATE mensagens SET id_externo = ${r.messageid}, status = 'enviado'
      WHERE id = ${msg.id}`;
    await sql`
      UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${atendimentoId}`;

    return [
      { estado: "sucesso", detalhe: `Enviado por ${instancia.nome}.` },
      {
        instancia: instancia.nome,
        numero: mascarar(numero),
        id_externo: r.messageid,
        trecho: texto.slice(0, 120),
      },
    ];
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await sql`
      UPDATE mensagens SET status = 'erro', erro = ${motivo} WHERE id = ${msg.id}`;
    return [
      { estado: "erro", detalhe: motivo },
      { instancia: instancia.nome, numero: mascarar(numero) },
    ];
  }
}

// Conversa em que a mensagem da automação entra: a mesma que o vendedor vê. Se
// não houver aberta com esta instância, cria uma 'na_fila' — a resposta do
// cliente cai nela (o webhook casa pelo par contato+instância) em vez de abrir
// uma segunda conversa paralela.
async function atendimentoDe(contatoId: string, numeroInstancia: string | null) {
  const [aberto] = await sql`
    SELECT id FROM atendimentos
    WHERE contato_id = ${contatoId}
      AND numero_instancia IS NOT DISTINCT FROM ${numeroInstancia}
      AND status <> 'encerrado'
    ORDER BY data_criacao DESC LIMIT 1`;
  if (aberto) return aberto.id as string;

  const [novo] = await sql`
    INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
    VALUES (${contatoId}, 'na_fila', 'whatsapp', ${numeroInstancia})
    RETURNING id`;
  return novo.id as string;
}

// "Enviar notificação" e o canal "ligação" da cadência caem aqui. Não existe
// caixa de notificação no CRM; o que existe e é lido é o histórico do contato,
// então o aviso entra lá — visível na ficha, junto do resto da conta.
async function avisarTime(
  bloco: Bloco,
  ctx: Contexto,
): Promise<[ResultadoAcao, Record<string, unknown>]> {
  const texto = preencher(comoTexto(bloco.config.texto).trim(), ctx);
  if (!texto) {
    return [
      { estado: "erro", detalhe: "Bloco de notificação sem texto." },
      { motivo: "sem_texto" },
    ];
  }
  if (!ctx.contatoId && !ctx.oportunidadeId) {
    return [
      { estado: "erro", detalhe: "Execução sem contato nem oportunidade." },
      { motivo: "sem_entidade" },
    ];
  }

  await sql`
    INSERT INTO historico (contato_id, oportunidade_id, descricao, autor_id)
    VALUES (${ctx.contatoId}, ${ctx.oportunidadeId},
            ${`Automação: ${texto}`}, NULL)`;

  return [
    { estado: "sucesso", detalhe: "Registrado no histórico do contato." },
    { trecho: texto.slice(0, 120) },
  ];
}

async function atualizarOportunidade(
  bloco: Bloco,
  ctx: Contexto,
): Promise<[ResultadoAcao, Record<string, unknown>]> {
  if (!ctx.oportunidadeId) {
    return [
      { estado: "erro", detalhe: "Este bloco só roda em fluxo de oportunidade." },
      { motivo: "sem_oportunidade" },
    ];
  }

  const etapaId = comoTexto(bloco.config.etapa_id) || null;
  const status = comoTexto(bloco.config.status) || null;
  const responsavelId = comoTexto(bloco.config.responsavel_id) || null;

  if (!etapaId && !status && !responsavelId) {
    return [
      { estado: "pulado", detalhe: "Nada configurado para mudar." },
      { motivo: "config_vazia" },
    ];
  }

  // COALESCE campo a campo: o bloco muda só o que foi configurado, e um
  // UPDATE montado por concatenação seria a porta de SQL injection que o
  // tagged-template existe para fechar.
  //
  // etapa_id vem com funil_id junto porque a FK é COMPOSTA (schema.sql): sem o
  // funil, mudar de etapa aceitaria uma etapa de outro funil.
  await sql`
    UPDATE oportunidades o SET
      etapa_id = COALESCE(${etapaId}, o.etapa_id),
      funil_id = COALESCE((SELECT e.funil_id FROM etapas e WHERE e.id = ${etapaId}), o.funil_id),
      status = COALESCE(${status}, o.status),
      responsavel_id = COALESCE(${responsavelId}, o.responsavel_id)
    WHERE o.id = ${ctx.oportunidadeId}`;

  return [
    { estado: "sucesso", detalhe: "Oportunidade atualizada." },
    { etapa_id: etapaId, status, responsavel_id: responsavelId },
  ];
}

async function mudarTag(
  bloco: Bloco,
  ctx: Contexto,
): Promise<[ResultadoAcao, Record<string, unknown>]> {
  const tagId = comoTexto(bloco.config.tag_id);
  const acao = comoTexto(bloco.config.acao) || "adicionar";
  if (!tagId) {
    return [
      { estado: "erro", detalhe: "Bloco de tag sem tag escolhida." },
      { motivo: "sem_tag" },
    ];
  }
  if (!ctx.contatoId) {
    return [
      { estado: "erro", detalhe: "Execução sem contato." },
      { motivo: "sem_contato" },
    ];
  }

  if (acao === "remover") {
    await sql`
      DELETE FROM contato_tags
      WHERE contato_id = ${ctx.contatoId} AND tag_id = ${tagId}`;
  } else {
    await sql`
      INSERT INTO contato_tags (contato_id, tag_id)
      VALUES (${ctx.contatoId}, ${tagId})
      ON CONFLICT DO NOTHING`;
  }

  return [
    { estado: "sucesso", detalhe: `Tag ${acao === "remover" ? "removida" : "aplicada"}.` },
    { tag_id: tagId, acao },
  ];
}

// Blocos que o catálogo oferece mas o CRM ainda não executa. 'pulado' e não
// 'erro' de propósito: o resto da cadência continua, e o log diz exatamente o
// que faltou — melhor que derrubar 18 mensagens por causa da 4ª.
const NAO_IMPLEMENTADOS: Record<string, string> = {
  enviar_email: "Envio de e-mail ainda não está ligado — nenhum provedor configurado.",
  criar_oportunidade: "Criar oportunidade por automação ainda não foi implementado.",
  atualizar_contato: "Atualizar contato por automação ainda não foi implementado.",
  mudar_segmento: "Mudar segmento por automação ainda não foi implementado.",
  mudar_fluxo: "Encadear fluxos ainda não foi implementado.",
  requisicao_http: "Request HTTP exige a allowlist do §2.3, que ainda não existe.",
};

/**
 * Executa um bloco e devolve o que aconteceu. NUNCA lança: o motor precisa de
 * uma resposta para saber se segue ou para, e uma exceção aqui viraria um 500
 * que o motor interpretaria como falha de rede.
 */
export async function executarAcao(pedido: PedidoAcao): Promise<ResultadoAcao> {
  const inicio = Date.now();

  try {
    const dados = await contextoDe(pedido.execucaoId);
    if (!dados) {
      return { estado: "erro", detalhe: "Execução não encontrada." };
    }
    const { ctx, fluxoId, definicao, estado } = dados;

    // O corpo diz de qual fluxo é a execução; o banco também. Divergiu, é
    // corpo forjado ou motor confuso — nos dois casos, não executar.
    if (fluxoId !== pedido.fluxoId) {
      return {
        estado: "erro",
        detalhe: "A execução não pertence ao fluxo informado.",
      };
    }

    // Execução que não está mais viva não manda mais nada.
    //
    // É o outro lado do arraste de um card entre mensagens: o CRM cancela a
    // inscrição e cria outra, mas do lado do motor a execução antiga continua
    // parada num Wait e um dia acorda — dias depois, no meio da madrugada. Sem
    // esta linha, ela retomaria a cadência velha e o contato receberia as duas
    // ao mesmo tempo.
    //
    // 'pulado' e não 'erro': não houve falha, e um erro aqui marcaria a
    // execução nova como quebrada no callback. E sem gravar passo — passo de
    // execução morta só sujaria a contagem de onde cada oportunidade está.
    if (!["pendente", "rodando", "esperando"].includes(estado)) {
      return {
        estado: "pulado",
        detalhe: `Inscrição ${estado === "cancelada" ? "cancelada" : `em '${estado}'`} — este bloco não roda mais.`,
      };
    }

    // O bloco vem da versão que ESTA execução inscreveu. Republicar a cadência
    // no meio do caminho não muda o que quem já está dentro vai receber — e é
    // o que impede um corpo forjado de mandar texto arbitrário para o contato.
    const no = definicao?.nos?.[pedido.noId];
    if (!no) {
      return {
        estado: "erro",
        detalhe: `Bloco "${pedido.noId}" não existe na versão desta execução.`,
      };
    }
    const bloco: Bloco = { tipo: no.tipo, config: no.config ?? {} };

    let par: [ResultadoAcao, Record<string, unknown>];

    if (bloco.tipo === "enviar_whatsapp_web") {
      par = await enviarWhatsApp(bloco, ctx);
    } else if (bloco.tipo === "enviar_notificacao") {
      par = await avisarTime(bloco, ctx);
    } else if (bloco.tipo === "atualizar_oportunidade") {
      par = await atualizarOportunidade(bloco, ctx);
    } else if (bloco.tipo === "mudar_tag") {
      par = await mudarTag(bloco, ctx);
    } else if (bloco.tipo in NAO_IMPLEMENTADOS) {
      par = [
        { estado: "pulado", detalhe: NAO_IMPLEMENTADOS[bloco.tipo] },
        { motivo: "nao_implementado" },
      ];
    } else {
      par = [
        { estado: "erro", detalhe: `Bloco desconhecido: ${bloco.tipo}` },
        { motivo: "tipo_desconhecido" },
      ];
    }

    const [resultado, saida] = par;
    await gravarPasso(pedido, bloco.tipo, resultado, saida, Date.now() - inicio);
    return resultado;
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    // Grava o passo mesmo na falha inesperada — e se nem isso der (partição
    // faltando, banco fora), engole: a resposta ao motor é o que importa.
    await gravarPasso(
      pedido,
      "desconhecido",
      { estado: "erro", detalhe },
      { motivo: "excecao" },
      Date.now() - inicio,
    ).catch(() => {});
    return { estado: "erro", detalhe };
  }
}
