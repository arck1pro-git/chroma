"use server";

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
import { enviarTexto, instanciaPorNumero } from "@/lib/uazapi";
import { soDigitos } from "@/lib/telefone";

export async function enviarMensagem(
  atendimentoId: string,
  autorId: string | null,
  texto: string,
) {
  const corpo = texto.trim();
  if (!corpo) throw new Error("Mensagem vazia");

  // 1. Nasce 'pendente'. Guarda ANTES de falar com a uazapi.
  const [msg] = await sql`
    INSERT INTO mensagens (atendimento_id, origem, autor_id, texto, status)
    VALUES (${atendimentoId}, 'agente', ${autorId}, ${corpo}, 'pendente')
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

// ── Ciclo do atendimento ─────────────────────────────────────────────────────

// Abre uma conversa com o contato: reusa a não-encerrada se houver (não
// duplica), senão cria uma nova já como minha. Devolve o id pra tela selecionar.
export async function iniciarAtendimento(
  contatoId: string,
  usuarioId: string | null,
): Promise<string> {
  const [existente] = await sql`
    SELECT id FROM atendimentos
    WHERE contato_id = ${contatoId} AND status <> 'encerrado'
    ORDER BY data_criacao DESC LIMIT 1`;
  if (existente) return existente.id;

  const [novo] = await sql`
    INSERT INTO atendimentos (contato_id, responsavel_id, status, canal)
    VALUES (${contatoId}, ${usuarioId}, 'aberto', 'whatsapp')
    RETURNING id`;
  revalidatePath("/chat");
  return novo.id;
}

// Assumir um da fila: vira meu e abre. lido_em = agora zera as não lidas.
export async function assumirAtendimento(id: string, usuarioId: string | null) {
  await sql`
    UPDATE atendimentos
    SET responsavel_id = ${usuarioId}, status = 'aberto', lido_em = now()
    WHERE id = ${id}`;
  revalidatePath("/chat");
}

export async function encerrarAtendimento(id: string) {
  await sql`UPDATE atendimentos SET status = 'encerrado' WHERE id = ${id}`;
  revalidatePath("/chat");
}

export async function reabrirAtendimento(id: string, usuarioId: string | null) {
  await sql`
    UPDATE atendimentos
    SET status = 'aberto', responsavel_id = ${usuarioId}
    WHERE id = ${id}`;
  revalidatePath("/chat");
}

// Marca como lido até agora (abriu = leu). É o que zera as não lidas na lista.
export async function marcarLido(id: string) {
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

  revalidatePath("/chat");
  revalidatePath("/");
  return op.id;
}
