// O que acontece quando um lead chega pela webhook.
//
// Fica separado da rota (app/api/webhooks/[slug]/route.ts) porque a rota é só
// envelope HTTP — ler o corpo, devolver status. Tudo que decide o que vira
// contato, o que vira card e o que dispara mensagem é aqui, num lugar só,
// testável sem subir servidor.
//
// A ORDEM IMPORTA e é esta:
//   1. autenticar e validar  → nada gravado se recusar
//   2. resolver o contato    → reaproveita o existente, preenche o que faltava
//   3. oportunidade, se a ação pedir
//   4. tag e segmento        → baratos, locais, não falham na rede
//   5. automação             → POR ÚLTIMO, porque é a única irreversível:
//                              daqui sai WhatsApp de verdade, pela arckwpp,
//                              que é compartilhada com o SprintHub. Se algo ia
//                              dar errado, que dê errado ANTES de mandar
//                              mensagem para o lead.
//   6. gravar o recebimento  → sempre, inclusive no caminho de erro
import { sql } from "@/lib/db";
import { chaveTelefone, soDigitos } from "@/lib/telefone";
import { dispararInscritos } from "@/lib/automacoes/disparo";
import type { DestinoCampo, TipoAcao, WebhookCampo } from "@/lib/webhooks";
import {
  registrarContatoCriado,
  registrarEntradaEmFluxo,
  registrarOportunidadeCriada,
} from "@/lib/historico";
import { abertaNoFunil } from "@/lib/oportunidades";
import { inscreverNaCadenciaDaEtapa } from "@/lib/automacoes/repositorio";

export type ResultadoRecepcao = {
  status: number;
  corpo: Record<string, unknown>;
};

type LinhaAcao = {
  id: string;
  tipo: TipoAcao;
  ordem: number;
  fluxo_id: string | null;
  segmento_id: string | null;
  tag_id: string | null;
  criar_oportunidade: boolean;
  funil_id: string | null;
  etapa_id: string | null;
  /** Dono do lead; com `responsavel_alternado_id`, o primeiro do rodízio. */
  responsavel_id: string | null;
  responsavel_alternado_id: string | null;
};

// ── Conversão de valor ──────────────────────────────────────────────────────
// O payload é JSON de terceiro: o campo declarado como número pode chegar como
// "1.500,00", como 1500 ou como null. Converter aqui, uma vez, evita cada
// destino ter a sua própria interpretação.
function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  // Objeto/array aninhado: guarda o JSON em vez de "[object Object]".
  return JSON.stringify(valor);
}

function numero(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const t = texto(valor);
  if (!t) return 0;
  // "R$ 1.500,00" → 1500.00. Tira tudo que não é dígito, vírgula ou ponto,
  // depois assume o padrão brasileiro (ponto = milhar, vírgula = decimal)
  // quando a vírgula aparece.
  const limpo = t.replace(/[^\d.,-]/g, "");
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

// ── Distribuição do payload pelos destinos ──────────────────────────────────
type Distribuido = {
  contato: Record<string, string>;
  contatoCampos: Record<string, unknown>;
  oportunidadeNome: string;
  oportunidadeValor: number;
  oportunidadeCampos: Record<string, unknown>;
};

const COLUNAS_CONTATO: Partial<Record<DestinoCampo, string>> = {
  "contato.nome": "nome",
  "contato.whatsapp": "whatsapp",
  "contato.email": "email",
  "contato.cidade": "cidade",
  "contato.estado": "estado",
  "contato.pais": "pais",
};

function distribuir(
  campos: WebhookCampo[],
  payload: Record<string, unknown>,
): Distribuido {
  const out: Distribuido = {
    contato: {},
    contatoCampos: {},
    oportunidadeNome: "",
    oportunidadeValor: 0,
    oportunidadeCampos: {},
  };

  for (const campo of campos) {
    if (campo.destino === "ignorar") continue;
    const bruto = payload[campo.chave];
    // Campo não enviado não vira string vazia: sobrescrever com "" é
    // exatamente o que a regra de "preenche o que faltava" quer evitar.
    if (bruto === undefined || bruto === null || bruto === "") continue;

    const coluna = COLUNAS_CONTATO[campo.destino];
    if (coluna) {
      out.contato[coluna] =
        coluna === "whatsapp" ? soDigitos(texto(bruto)) : texto(bruto);
      continue;
    }

    if (campo.destino === "oportunidade.nome") out.oportunidadeNome = texto(bruto);
    else if (campo.destino === "oportunidade.valor") out.oportunidadeValor = numero(bruto);
    else if (campo.destino === "contato.campo" && campo.destino_chave) {
      out.contatoCampos[campo.destino_chave] =
        campo.tipo === "numero" ? numero(bruto) : texto(bruto);
    } else if (campo.destino === "oportunidade.campo" && campo.destino_chave) {
      out.oportunidadeCampos[campo.destino_chave] =
        campo.tipo === "numero" ? numero(bruto) : texto(bruto);
    }
  }

  return out;
}

// ── Contato: acha o existente ou cria ───────────────────────────────────────
/**
 * Casa pelo whatsapp (últimos 8 dígitos) e, não achando, pelo e-mail.
 *
 * O whatsapp vem primeiro porque é a identidade mais forte que temos: é por
 * ele que o chat casa a conversa. Os 8 dígitos finais são a mesma tolerância
 * do webhook da uazapi — o nono dígito brasileiro aparece e some conforme a
 * origem (lib/telefone.ts).
 *
 * O e-mail casa exato, sem case: "Maria@X.com" e "maria@x.com" são a mesma
 * pessoa, e tratá-los como duas duplica a base do mesmo jeito.
 */
async function acharContato(
  whatsapp: string,
  email: string,
): Promise<string | null> {
  if (whatsapp) {
    const fim8 = chaveTelefone(whatsapp).slice(-8);
    if (fim8.length === 8) {
      const [c] = await sql`
        SELECT id FROM contatos
        WHERE regexp_replace(whatsapp, '\D', '', 'g') LIKE ${"%" + fim8}
        LIMIT 1`;
      if (c) return c.id as string;
    }
  }

  if (email) {
    const [c] = await sql`
      SELECT id FROM contatos
      WHERE lower(email) = lower(${email}) LIMIT 1`;
    if (c) return c.id as string;
  }

  return null;
}

/**
 * Resolve o contato e devolve se ele é novo.
 *
 * No contato JÁ EXISTENTE nenhum dado bom é sobrescrito: cada coluna só é
 * preenchida se estiver vazia hoje (o CASE de cada linha), e o jsonb usa
 * `novos || campos` — em `||` o operando da DIREITA vence, então o que já
 * estava gravado permanece e só as chaves inéditas entram.
 */
async function resolverContato(
  dados: Record<string, string>,
  camposJson: Record<string, unknown>,
): Promise<{ id: string; novo: boolean }> {
  const nome = dados.nome ?? "";
  const whatsapp = dados.whatsapp ?? "";
  const email = dados.email ?? "";

  const existente = await acharContato(whatsapp, email);
  const json = JSON.stringify(camposJson);

  if (existente) {
    await sql`
      UPDATE contatos SET
        nome     = CASE WHEN coalesce(nome, '')     = '' THEN ${nome || "Sem nome"} ELSE nome END,
        whatsapp = CASE WHEN coalesce(whatsapp, '') = '' THEN ${whatsapp || null} ELSE whatsapp END,
        email    = CASE WHEN coalesce(email, '')    = '' THEN ${email || null} ELSE email END,
        cidade   = CASE WHEN coalesce(cidade, '')   = '' THEN ${dados.cidade || null} ELSE cidade END,
        estado   = CASE WHEN coalesce(estado, '')   = '' THEN ${dados.estado || null} ELSE estado END,
        pais     = CASE WHEN coalesce(pais, '')     = '' THEN ${dados.pais || null} ELSE pais END,
        campos   = ${json}::jsonb || campos
      WHERE id = ${existente}`;
    return { id: existente, novo: false };
  }

  // Nome é NOT NULL. Sem nenhum campo mapeado para ele, o melhor rótulo
  // disponível é o contato em si — e um lead chamado "Sem nome" na tela é o
  // sintoma visível de uma webhook mal configurada, que é o que queremos.
  const [novo] = await sql`
    INSERT INTO contatos (nome, whatsapp, email, cidade, estado, pais, campos)
    VALUES (
      ${nome || whatsapp || email || "Sem nome"},
      ${whatsapp || null}, ${email || null},
      ${dados.cidade || null}, ${dados.estado || null}, ${dados.pais || "Brasil"},
      ${json}::jsonb)
    RETURNING id`;

  // "pela captação" e não só "Contato criado": quem abrir a ficha depois quer
  // saber de onde a pessoa veio, e é a primeira linha da trilha dela.
  await registrarContatoCriado(novo.id as string, "pela captação");

  return { id: novo.id as string, novo: true };
}

// ── Automação ───────────────────────────────────────────────────────────────
/**
 * Inscreve o lead num fluxo publicado e manda o motor começar.
 *
 * Reusa a mecânica que já existe (fluxo_execucoes + dispararInscritos), com as
 * mesmas checagens do disparo manual: fluxo publicado, versão publicada e
 * entidade compatível. `entidade_alvo` é o que decide se inscrevemos o contato
 * ou a oportunidade — um fluxo de oportunidade não sabe o que fazer com um
 * contato solto, e falharia lá dentro, no primeiro bloco que pede o negócio.
 *
 * Devolve o texto para o resumo, ou lança com a razão de não ter inscrito.
 */
async function inscreverNoFluxo(
  fluxoId: string,
  webhookId: string,
  contatoId: string,
  oportunidadeId: string | null,
): Promise<string> {
  const [f] = await sql`
    SELECT id, nome, estado, entidade_alvo, versao_publicada_id,
           motor_webhook_caminho, motor_webhook_segredo
    FROM fluxos WHERE id = ${fluxoId}`;
  if (!f) throw new Error("fluxo não existe mais");
  if (f.estado !== "publicado" || !f.versao_publicada_id) {
    throw new Error(`fluxo "${f.nome}" não está publicado`);
  }

  const alvo = f.entidade_alvo as "contato" | "oportunidade";
  if (alvo === "oportunidade" && !oportunidadeId) {
    throw new Error(
      `fluxo "${f.nome}" é de oportunidade, mas esta webhook não cria oportunidade`,
    );
  }
  const entidadeId = alvo === "oportunidade" ? oportunidadeId! : contatoId;

  // Mesmo predicado do índice parcial ux_execucao_ativa_por_entidade — sem ele
  // idêntico, o Postgres não infere o índice do ON CONFLICT. Reenvio do mesmo
  // formulário não reinscreve quem já está no fluxo, que é o que impede o lead
  // de receber a cadência duas vezes.
  const inscritos = (await sql`
    INSERT INTO fluxo_execucoes (
      fluxo_id, versao_id, entidade_tipo, entidade_id,
      origem, origem_webhook_id, motor)
    SELECT f.id, f.versao_publicada_id, ${alvo}, ${entidadeId},
           'api', ${webhookId}, f.motor
    FROM fluxos f WHERE f.id = ${fluxoId}
    ON CONFLICT (fluxo_id, entidade_tipo, entidade_id)
      WHERE estado IN ('pendente','rodando','esperando','pausada')
      DO NOTHING
    RETURNING id, entidade_id`) as unknown as {
    id: string;
    entidade_id: string;
  }[];

  if (inscritos.length === 0) return `fluxo ${f.nome} (já estava dentro)`;

  await registrarEntradaEmFluxo(fluxoId, alvo, [entidadeId], "api");

  const { entraram } = await dispararInscritos(
    {
      id: f.id as string,
      motor_webhook_caminho: f.motor_webhook_caminho as string | null,
      motor_webhook_segredo: f.motor_webhook_segredo as string | null,
    },
    alvo,
    inscritos,
  );
  if (entraram === 0) throw new Error(`o motor não aceitou a inscrição em "${f.nome}"`);
  return `fluxo ${f.nome}`;
}

// ── Entrada ─────────────────────────────────────────────────────────────────
export async function receberLead(
  slug: string,
  segredoRecebido: string,
  payload: unknown,
): Promise<ResultadoRecepcao> {
  const [webhook] = await sql`
    SELECT id, nome, segredo, ativo FROM webhooks WHERE slug = ${slug}`;

  // Desativada e inexistente respondem igual, de propósito: para quem sonda,
  // 404 nos dois casos não revela que o slug existe.
  if (!webhook || !webhook.ativo) {
    return { status: 404, corpo: { erro: "webhook não encontrada" } };
  }
  if (segredoRecebido !== webhook.segredo) {
    // Sem gravar recebimento: um endpoint sob varredura encheria a tabela.
    return { status: 401, corpo: { erro: "segredo inválido" } };
  }

  const webhookId = webhook.id as string;

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    await registrar(webhookId, {}, "recusado", "corpo não é um objeto JSON", null, null, null);
    return { status: 422, corpo: { erro: "o corpo precisa ser um objeto JSON" } };
  }
  const dados = payload as Record<string, unknown>;

  const campos = (await sql`
    SELECT id, chave, rotulo, tipo, obrigatorio, destino, destino_chave, ordem
    FROM webhook_campos WHERE webhook_id = ${webhookId} ORDER BY ordem, chave`) as unknown as WebhookCampo[];

  // Obrigatórios antes de qualquer escrita: recusa sem deixar contato pela
  // metade. O erro lista TODOS os que faltaram, não só o primeiro — quem está
  // implementando do outro lado corrige de uma vez.
  const faltando = campos
    .filter((c) => c.obrigatorio && c.destino !== "ignorar")
    .filter((c) => {
      const v = dados[c.chave];
      return v === undefined || v === null || (typeof v === "string" && !v.trim());
    })
    .map((c) => c.chave);

  if (faltando.length > 0) {
    const msg = `campos obrigatórios ausentes: ${faltando.join(", ")}`;
    await registrar(webhookId, dados, "recusado", msg, null, null, null);
    return { status: 422, corpo: { erro: msg } };
  }

  const acoes = (await sql`
    SELECT id, tipo, ordem, fluxo_id, segmento_id, tag_id,
           criar_oportunidade, funil_id, etapa_id,
           responsavel_id, responsavel_alternado_id
    FROM webhook_acoes WHERE webhook_id = ${webhookId}
    ORDER BY ordem, data_criacao`) as unknown as LinhaAcao[];

  const criarLead = acoes.find((a) => a.tipo === "criar_lead");
  if (!criarLead) {
    const msg = 'esta webhook não tem a ação "criar lead" configurada';
    await registrar(webhookId, dados, "erro", msg, null, null, null);
    return { status: 200, corpo: { ok: true, aviso: msg } };
  }

  const dist = distribuir(campos, dados);
  const resumo: string[] = [];
  let contatoId: string | null = null;
  let oportunidadeId: string | null = null;

  try {
    const contato = await resolverContato(dist.contato, dist.contatoCampos);
    contatoId = contato.id;
    resumo.push(contato.novo ? "contato criado" : "contato reaproveitado");

    if (criarLead.criar_oportunidade && criarLead.funil_id && criarLead.etapa_id) {
      // UMA ABERTA POR CONTATO EM CADA FUNIL (migration-oportunidade-unica.sql).
      // Aqui a duplicata não é erro, é reenvio: o mesmo formulário enviado duas
      // vezes, ou o lead que voltou a pedir orçamento. Recusar deixaria a
      // captação sem oportunidade para pendurar a automação; criar encheria o
      // funil de cards repetidos. Reaproveitar é o que descreve o que houve.
      //
      // O ON CONFLICT faz isso SEM JANELA: dois envios simultâneos, um cria e o
      // outro não vê linha nenhuma voltar — e cai no SELECT abaixo. O alvo
      // repete o predicado do índice parcial, senão o Postgres não infere qual
      // usar.
      // DE QUEM É ESTE LEAD. Uma instrução só decide e registra: o CASE escolhe
      // quem não recebeu o anterior e grava a escolha em `ultimo_responsavel_id`
      // na mesma linha. Dois leads no mesmo instante não recebem o mesmo dono —
      // o segundo UPDATE espera o primeiro e lê o valor já atualizado.
      //
      // Sem rodízio, o CASE devolve sempre o mesmo responsável, e a coluna de
      // estado acompanha sem fazer diferença.
      const [vez] = criarLead.responsavel_id
        ? await sql`
            UPDATE webhook_acoes
               SET ultimo_responsavel_id = CASE
                     WHEN responsavel_alternado_id IS NULL THEN responsavel_id
                     WHEN ultimo_responsavel_id IS DISTINCT FROM responsavel_id
                       THEN responsavel_id
                     ELSE responsavel_alternado_id
                   END
             WHERE id = ${criarLead.id}
             RETURNING ultimo_responsavel_id AS responsavel`
        : [];
      const responsavelId = (vez?.responsavel as string | null) ?? null;

      const [op] = await sql`
        INSERT INTO oportunidades
          (nome, contato_id, valor, status, funil_id, etapa_id, campos, responsavel_id)
        VALUES (
          ${dist.oportunidadeNome || dist.contato.nome || "Lead"},
          ${contatoId}, ${dist.oportunidadeValor}, 'aberta',
          ${criarLead.funil_id}, ${criarLead.etapa_id},
          ${JSON.stringify(dist.oportunidadeCampos)}::jsonb,
          ${responsavelId})
        ON CONFLICT (contato_id, funil_id) WHERE status = 'aberta'
          DO NOTHING
        RETURNING id`;

      if (op) {
        oportunidadeId = op.id as string;
        // A mesma linha de histórico que a criação pela tela grava: para o
        // lead, ter nascido de um formulário ou de um clique não muda o que
        // aconteceu.
        await registrarOportunidadeCriada(oportunidadeId);
        resumo.push("oportunidade criada");

        // O lead nasceu DENTRO de uma etapa: se ela tem cadência rodando, ele
        // entra nela agora. Falhar aqui não derruba a captação — o lead já está
        // no CRM, e a inscrição é consequência.
        try {
          const c = await inscreverNaCadenciaDaEtapa(
            oportunidadeId,
            criarLead.etapa_id,
          );
          if (c) {
            await dispararInscritos(c.fluxo, "oportunidade", c.inscritos);
            resumo.push("entrou na cadência da etapa");
          }
        } catch (e) {
          resumo.push(
            `cadência da etapa falhou (${e instanceof Error ? e.message : String(e)})`,
          );
        }
      } else {
        const ja = await abertaNoFunil(contatoId, criarLead.funil_id);
        oportunidadeId = ja?.id ?? null;
        resumo.push(
          ja ? "oportunidade reaproveitada" : "oportunidade não criada",
        );
      }
    }

    // Tag e segmento primeiro (locais e idempotentes), automação por último
    // (irreversível — manda WhatsApp). Ver o cabeçalho do arquivo.
    for (const acao of acoes) {
      if (acao.tipo === "adicionar_tag" && acao.tag_id) {
        const [t] = await sql`
          INSERT INTO contato_tags (contato_id, tag_id)
          VALUES (${contatoId}, ${acao.tag_id})
          ON CONFLICT DO NOTHING
          RETURNING (SELECT nome FROM tags WHERE id = ${acao.tag_id}) AS nome`;
        if (t) resumo.push(`tag ${t.nome}`);
      } else if (acao.tipo === "adicionar_segmento" && acao.segmento_id) {
        const [s] = await sql`
          INSERT INTO contato_segmentos (contato_id, segmento_id)
          VALUES (${contatoId}, ${acao.segmento_id})
          ON CONFLICT DO NOTHING
          RETURNING (SELECT nome FROM segmentos WHERE id = ${acao.segmento_id}) AS nome`;
        if (s) resumo.push(`segmento ${s.nome}`);
      }
    }

    for (const acao of acoes) {
      if (acao.tipo !== "inscrever_fluxo" || !acao.fluxo_id) continue;
      resumo.push(
        await inscreverNoFluxo(acao.fluxo_id, webhookId, contatoId, oportunidadeId),
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 'erro' e NÃO recusado: o contato pode já ter entrado. Gravar o que deu
    // certo até aqui é o que permite terminar à mão em vez de reenviar e
    // duplicar.
    await registrar(
      webhookId, dados, "erro", msg, contatoId, oportunidadeId, resumo.join(" · ") || null,
    );
    // 200 mesmo com erro parcial: quem enviou não deve reenviar — o lead já
    // está no CRM, o que falhou foi um passo depois dele.
    return {
      status: contatoId ? 200 : 500,
      corpo: contatoId
        ? { ok: true, contato_id: contatoId, aviso: msg }
        : { erro: msg },
    };
  }

  await registrar(
    webhookId, dados, "ok", null, contatoId, oportunidadeId, resumo.join(" · "),
  );

  return {
    status: 200,
    corpo: {
      ok: true,
      contato_id: contatoId,
      ...(oportunidadeId ? { oportunidade_id: oportunidadeId } : {}),
    },
  };
}

// O log nunca derruba a requisição: falhar em gravar a prova de que o lead
// chegou é ruim, mas responder 500 a um lead que JÁ entrou é pior — o outro
// lado reenviaria.
async function registrar(
  webhookId: string,
  payload: Record<string, unknown>,
  estado: "ok" | "recusado" | "erro",
  erro: string | null,
  contatoId: string | null,
  oportunidadeId: string | null,
  resumo: string | null,
) {
  try {
    await sql`
      INSERT INTO webhook_recebimentos
        (webhook_id, payload, estado, erro, contato_id, oportunidade_id, resumo)
      VALUES (${webhookId}, ${JSON.stringify(payload)}::jsonb, ${estado},
              ${erro}, ${contatoId}, ${oportunidadeId}, ${resumo})`;
  } catch (e) {
    console.error("[webhook] falhou ao gravar recebimento", e);
  }
}
