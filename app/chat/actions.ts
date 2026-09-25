"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; esta linha acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
import { exigirModulo } from "@/lib/auth/dal";

// Envio real de mensagem. Fluxo que o schema.sql já previa:
//   1. grava a linha 'pendente' no Neon (não perde a mensagem se a rede cair)
//   2. dispara pela uazapi
//   3. casa o retorno: id_externo + 'enviado', ou 'erro' com o motivo
//
// Roda no servidor — é POST reachable por quem souber o id da action, então
// trata tudo como não confiável. Aqui ainda não há auth (usuarios não é tabela);
// quando entrar, valida sessão e que o autor é dono do atendimento.
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { enviarMidia, enviarTexto, instanciaPorNumero } from "@/lib/uazapi";
import { comCaminho, lerArquivo } from "@/lib/documentos";
import { soDigitos } from "@/lib/telefone";
import { eventoAoEntrarNaEtapa } from "@/lib/meta-eventos";

export async function enviarMensagem(
  atendimentoId: string,
  autorId: string | null,
  texto: string,
) {
  await exigirModulo("chat");
  const corpo = texto.trim();
  if (!corpo) throw new Error("Mensagem vazia");

  // 1. Nasce 'pendente'. Guarda ANTES de falar com a uazapi.
  //
  // `enviada_por = 'crm'`: gente digitando aqui dentro. É o que faz a cadência
  // parar de mandar mensagem para este contato — a guarda do workflow trata
  // 'crm' e 'aparelho' como "o atendente assumiu a conversa"
  // (migration-cadencia-controles.sql).
  const [msg] = await sql`
    INSERT INTO mensagens
      (atendimento_id, origem, autor_id, texto, status, enviada_por)
    VALUES (${atendimentoId}, 'agente', ${autorId}, ${corpo}, 'pendente', 'crm')
    RETURNING id`;

  // 2. Número do contato desta conversa E o nosso número que a recebeu.
  const [dest] = await sql`
    SELECT c.whatsapp, a.numero_instancia
    FROM atendimentos a
    JOIN contatos c ON c.id = a.contato_id
    WHERE a.id = ${atendimentoId}`;

  if (!dest?.whatsapp) {
    await sql`
      UPDATE mensagens SET status = 'erro', erro = 'contato sem whatsapp'
      WHERE id = ${msg.id}`;
    revalidatePath("/chat");
    throw new Error("Contato sem número de WhatsApp");
  }

  // 3. Dispara pela instância que RECEBEU esta conversa e casa o retorno.
  //
  // Responder pelo mesmo número em que o cliente escreveu não é detalhe: pela
  // instância errada, a resposta chega como mensagem de um número desconhecido,
  // fora da conversa que ele tem aberta. Antes isto caía na instância do .env,
  // que podia ser outra — e o CRM nem registrava por qual número saiu.
  //
  // `numero_instancia` é null em atendimento criado pela tela (ninguém escreveu
  // primeiro); aí vale a instância cadastrada (lib/uazapi.ts).
  try {
    const instancia = await instanciaPorNumero(dest.numero_instancia ?? null);
    const r = await enviarTexto(soDigitos(dest.whatsapp), corpo, instancia);
    await sql`
      UPDATE mensagens
      SET id_externo = ${r.messageid}, status = 'enviado'
      WHERE id = ${msg.id}`;
    await sql`
      UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${atendimentoId}`;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await sql`
      UPDATE mensagens SET status = 'erro', erro = ${motivo}
      WHERE id = ${msg.id}`;
    revalidatePath("/chat");
    throw e;
  }

  revalidatePath("/chat");
}

/**
 * Manda um documento da biblioteca para o contato desta conversa.
 *
 * MESMO CICLO DE `enviarMensagem` — grava 'pendente', dispara, casa o retorno —
 * e por isso a mesma garantia: se a uazapi cair no meio, a linha fica em 'erro'
 * com o motivo, em vez de o envio sumir.
 *
 * O ARQUIVO NÃO É COPIADO. A mensagem aponta para a linha em `documentos`
 * (documento_id) e o balão pede o arquivo por /api/midia/<id da mensagem>, que
 * sabe ler dos dois lugares. Mandar a mesma tabela de preços para 300 contatos
 * guarda um arquivo, não 300 — e trocar o documento na biblioteca não reescreve
 * o que já foi entregue, porque excluir é RESTRICT (migration-documentos.sql).
 *
 * `midia_estado = 'salva'`: do ponto de vista do chat o anexo JÁ está no
 * sistema, que é o que aquele campo responde. A fila de download é para o que
 * chega de fora (lib/midia.ts) — isto nunca passa por ela.
 */
export async function enviarDocumento(
  atendimentoId: string,
  autorId: string | null,
  documentoId: string,
  legenda: string,
) {
  await exigirModulo("chat");

  const doc = await comCaminho(documentoId);
  if (!doc) throw new Error("Documento não encontrado na biblioteca");

  const texto = legenda.trim().slice(0, 4000);

  // 1. Nasce 'pendente', antes de falar com a uazapi — igual ao texto.
  const [msg] = await sql`
    INSERT INTO mensagens
      (atendimento_id, origem, autor_id, texto, status, enviada_por,
       tipo, documento_id, midia_estado, midia_mime, midia_nome, midia_tamanho)
    VALUES
      (${atendimentoId}, 'agente', ${autorId}, ${texto}, 'pendente', 'crm',
       ${doc.tipo}, ${doc.id}, 'salva', ${doc.mime}, ${doc.arquivoNome},
       ${doc.tamanho})
    RETURNING id`;

  const [dest] = await sql`
    SELECT c.whatsapp, a.numero_instancia
    FROM atendimentos a
    JOIN contatos c ON c.id = a.contato_id
    WHERE a.id = ${atendimentoId}`;

  if (!dest?.whatsapp) {
    await sql`
      UPDATE mensagens SET status = 'erro', erro = 'contato sem whatsapp'
      WHERE id = ${msg.id}`;
    revalidatePath("/chat");
    throw new Error("Contato sem número de WhatsApp");
  }

  try {
    const instancia = await instanciaPorNumero(dest.numero_instancia ?? null);
    // Os bytes são lidos AQUI e vão em base64 (ver `paraEnvio` em
    // lib/documentos.ts para o porquê de não ser URL).
    const bytes = await lerArquivo(doc.caminho);
    const r = await enviarMidia(
      soDigitos(dest.whatsapp),
      bytes.toString("base64"),
      {
        tipo: doc.tipo,
        texto,
        arquivoNome: doc.arquivoNome,
        mime: doc.mime,
      },
      instancia,
    );
    await sql`
      UPDATE mensagens
      SET id_externo = ${r.messageid}, status = 'enviado'
      WHERE id = ${msg.id}`;
    await sql`
      UPDATE atendimentos SET data_atualizacao = now() WHERE id = ${atendimentoId}`;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await sql`
      UPDATE mensagens SET status = 'erro', erro = ${motivo}
      WHERE id = ${msg.id}`;
    revalidatePath("/chat");
    throw e;
  }

  revalidatePath("/chat");
}

// ── Ciclo do atendimento ─────────────────────────────────────────────────────

/**
 * Abre a conversa com o contato — e conversa aqui é UMA por par de números
 * (migration-atendimento-unico.sql). Reusa sempre que existir, inclusive a
 * encerrada, que volta para a fila.
 *
 * O QUE MUDOU E POR QUÊ: esta função procurava por contato e IGNORAVA o número,
 * e a linha que ela criava nascia sem `numero_instancia`. O resultado era duas
 * conversas com a mesma pessoa — a que a tela abriu, sem número, e a que o
 * WhatsApp criou, com número — cada uma com metade das mensagens.
 *
 * O número da conversa nova é o da instância cadastrada, quando há UMA. Com
 * várias, fica nulo: adivinhar por qual dos nossos números essa conversa vai
 * correr seria inventar. O primeiro evento que chegar do WhatsApp adota a linha
 * e carimba o número certo (ver app/api/uazapi/webhook/route.ts).
 */
export async function iniciarAtendimento(
  contatoId: string,
  usuarioId: string | null,
): Promise<string> {
  await exigirModulo("chat");

  const [existente] = await sql`
    SELECT id, status FROM atendimentos
    WHERE contato_id = ${contatoId}
    ORDER BY (status <> 'encerrado') DESC, data_criacao DESC
    LIMIT 1`;

  if (existente) {
    if (existente.status === "encerrado") {
      await sql`
        UPDATE atendimentos
           SET status = 'aberto', responsavel_id = ${usuarioId},
               data_atualizacao = now()
         WHERE id = ${existente.id}`;
      revalidatePath("/chat");
    }
    return existente.id as string;
  }

  const [instancia] = await sql`
    SELECT numero FROM instancias_uazapi
    WHERE numero IS NOT NULL
    LIMIT 2`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM instancias_uazapi`;
  const numero = n === 1 ? ((instancia?.numero as string | null) ?? null) : null;

  const [novo] = await sql`
    INSERT INTO atendimentos (contato_id, responsavel_id, status, canal, numero_instancia)
    VALUES (${contatoId}, ${usuarioId}, 'aberto', 'whatsapp', ${numero})
    RETURNING id`;
  revalidatePath("/chat");
  return novo.id;
}

// Assumir um da fila: vira meu e abre. lido_em = agora zera as não lidas.
export async function assumirAtendimento(id: string, usuarioId: string | null) {
  await exigirModulo("chat");
  await sql`
    UPDATE atendimentos
    SET responsavel_id = ${usuarioId}, status = 'aberto', lido_em = now()
    WHERE id = ${id}`;
  revalidatePath("/chat");
}

export async function encerrarAtendimento(id: string) {
  await exigirModulo("chat");
  await sql`UPDATE atendimentos SET status = 'encerrado' WHERE id = ${id}`;
  revalidatePath("/chat");
}

export async function reabrirAtendimento(id: string, usuarioId: string | null) {
  await exigirModulo("chat");
  await sql`
    UPDATE atendimentos
    SET status = 'aberto', responsavel_id = ${usuarioId}
    WHERE id = ${id}`;
  revalidatePath("/chat");
}

// Marca como lido até agora (abriu = leu). É o que zera as não lidas na lista.
export async function marcarLido(id: string) {
  await exigirModulo("chat");
  await sql`UPDATE atendimentos SET lido_em = now() WHERE id = ${id}`;
  revalidatePath("/chat");
}

// Cria oportunidade a partir do atendimento (contato já é fixo — o da conversa).
// A FK composta (etapa_id, funil_id) garante que a etapa é do funil escolhido.
export async function criarOportunidade(
  contatoId: string,
  funilId: string,
  etapaId: string,
  nome: string,
  valor: number,
  responsavelId: string | null,
): Promise<string> {
  await exigirModulo("chat");
  const n = nome.trim();
  if (!n) throw new Error("Nome da oportunidade é obrigatório");
  if (!contatoId) throw new Error("Sem contato");
  if (!funilId || !etapaId) throw new Error("Escolha o funil e a etapa");

  const [op] = await sql`
    INSERT INTO oportunidades
      (nome, contato_id, valor, responsavel_id, status, funil_id, etapa_id)
    VALUES
      (${n}, ${contatoId}, ${valor}, ${responsavelId || null}, 'aberta', ${funilId}, ${etapaId})
    RETURNING id`;

  // Nasceu dentro da etapa: conta como entrada (evento da Meta, se configurado).
  eventoAoEntrarNaEtapa(op.id, etapaId);
  revalidatePath("/chat");
  revalidatePath("/");
  return op.id;
}
