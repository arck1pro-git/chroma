// A conversa onde a mensagem da cadência fica guardada.
//
// O BURACO QUE ISTO FECHA (2026-10-06): a cadência mandava a mensagem e o CRM
// não a guardava. Duas metades, cada uma contando com a outra:
//
//   · o webhook da uazapi ignora o "eco" do que saiu por API (sem track_id
//     nosso) — app/api/uazapi/webhook — porque "a cadência registra a própria
//     linha";
//   · e o registro da cadência, no workflow do n8n, só gravava se o contato JÁ
//     tivesse uma conversa aberta (o INSERT … SELECT … FROM atendimentos não
//     achava nenhuma e não inseria nada).
//
// Lead novo — o caso de toda cadência de "novo contato" — não tem conversa. A
// mensagem saía pelo WhatsApp e sumia do CRM, e o atendimento nunca abria.
//
// A SAÍDA: quem envia (o CRM, em /api/automacoes/enviar) garante a conversa no
// instante do envio, do mesmo jeito que o webhook faz com mensagem recebida —
// uma por par (contato, número), reabrindo a encerrada em vez de criar outra.
// O registro do n8n, que já existe nos workflows publicados, passa a achá-la e
// grava a mensagem nela. Por isso o conserto vale sem republicar nenhuma
// cadência. (O usuário do banco do n8n não pode mudar `status`, então reabrir
// conversa encerrada só é possível daqui.)
//
// E O REGISTRO TAMBÉM MUDOU DE LADO (2026-10-15): mesmo com a conversa aberta,
// o nó do n8n não gravava nada — recebia o texto numa lista separada por
// vírgula, e a vírgula da mensagem deslocava os parâmetros. Agora quem grava a
// mensagem é o CRM, antes do envio (registrarMensagemDaCadencia, abaixo).
import "server-only";
import { sql } from "@/lib/db";
import { chaveTelefone } from "@/lib/telefone";
import { ehUuid } from "@/lib/validacao";

/**
 * Abre (ou reabre) a conversa do lead com o número que enviou e devolve o id.
 *
 * O contato sai da EXECUÇÃO (a entidade inscrita na cadência), não do número:
 * dois contatos podem dividir os 8 últimos dígitos. Só sem execução válida cai
 * no número, como o webhook.
 */
export async function abrirConversaDaCadencia(dados: {
  execucaoId: string;
  numeroLead: string;
  numeroInstancia: string | null;
}): Promise<string | null> {
  let contatoId: string | null = null;

  if (ehUuid(dados.execucaoId)) {
    const [e] = await sql`
      SELECT CASE WHEN e.entidade_tipo = 'contato' THEN e.entidade_id ELSE o.contato_id END AS contato_id
        FROM fluxo_execucoes e
        LEFT JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
       WHERE e.id = ${dados.execucaoId}`;
    contatoId = (e?.contato_id as string | null) ?? null;
  }

  if (!contatoId) {
    const fim8 = chaveTelefone(dados.numeroLead).slice(-8);
    if (fim8.length !== 8) return null;
    const [c] = await sql`
      SELECT id FROM contatos
       WHERE regexp_replace(whatsapp, '\\D', '', 'g') LIKE ${"%" + fim8}
       LIMIT 1`;
    contatoId = (c?.id as string | null) ?? null;
  }
  if (!contatoId) return null;
  return abrirConversaDoContato(contatoId, dados.numeroInstancia);
}

/**
 * Abre (ou reabre) a conversa do contato com aquele número nosso e devolve o
 * id. A cadência e a troca para a secundária (lib/conversa-envio.ts, quando a
 * principal cai) passam por aqui, do mesmo jeito que o webhook.
 */
export async function abrirConversaDoContato(contatoId: string, numeroInstancia: string | null): Promise<string | null> {
  const numero = numeroInstancia || null;

  // Conversa daquele contato que ficou SEM número (a tela do chat criava assim)
  // é adotada pelo par, em vez de virar uma segunda linha ao lado — a mesma
  // adoção do webhook.
  if (numero) {
    await sql`
      UPDATE atendimentos a
         SET numero_instancia = ${numero}, data_atualizacao = now()
       WHERE a.contato_id = ${contatoId}
         AND a.numero_instancia IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM atendimentos b
            WHERE b.contato_id = ${contatoId} AND b.numero_instancia = ${numero})`;
  }

  // Uma conversa por par (ux_atendimento_contato_numero): acha a que existe,
  // REABRE a encerrada ('na_fila', que é o que o Chat lista sem dono) e cria
  // quando não há. A conversa é do CONTATO — não se prende a oportunidade
  // nenhuma; qual trecho é de qual negócio a IA decide pela data.
  const [at] = await sql`
    INSERT INTO atendimentos (contato_id, status, canal, numero_instancia)
    VALUES (${contatoId}, 'na_fila', 'whatsapp', ${numero})
    ON CONFLICT (contato_id, numero_instancia) WHERE contato_id IS NOT NULL DO UPDATE
      SET status = CASE WHEN atendimentos.status = 'encerrado' THEN 'na_fila' ELSE atendimentos.status END,
          data_atualizacao = now()
    RETURNING id`;
  return (at?.id as string | null) ?? null;
}

/**
 * A linha da mensagem da cadência, gravada ANTES do envio como 'pendente'.
 * Quem envia passa o id como track_id (o eco do webhook casa com ela) e depois
 * confirma com confirmarEnvio / marcarErro (lib/conversa-envio.ts), como o chat.
 *
 * `enviada_por = 'automacao'`: é o que a separa de mensagem do celular — que
 * para a IA é gente da equipe assumindo a conversa — e é o que a guarda da
 * cadência lê. O anexo vai na linha: o balão desenha anexo quando tipo <>
 * 'texto'; sem documento, o LEFT JOIN não casa e fica mensagem de texto.
 */
export async function registrarMensagemDaCadencia(dados: {
  atendimentoId: string;
  texto: string;
  documentoId: string;
}): Promise<string | null> {
  const [m] = await sql`
    INSERT INTO mensagens
      (atendimento_id, origem, autor_id, texto, status, enviada_por,
       documento_id, tipo, midia_estado, midia_mime, midia_nome, midia_tamanho)
    SELECT ${dados.atendimentoId}::uuid, 'agente', NULL, ${dados.texto}, 'pendente', 'automacao',
           d.id, COALESCE(d.tipo, 'texto'),
           CASE WHEN d.id IS NULL THEN 'ausente' ELSE 'salva' END,
           d.mime, d.arquivo_nome, d.tamanho
      FROM (SELECT 1) AS um
      -- NULLIF: sem anexo o id chega '', e ''::uuid é erro no Postgres.
      LEFT JOIN documentos d ON d.id = NULLIF(${dados.documentoId}, '')::uuid
    RETURNING id`;
  return (m?.id as string | null) ?? null;
}
