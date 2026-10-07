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
import "server-only";
import { sql } from "@/lib/db";
import { chaveTelefone } from "@/lib/telefone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (UUID.test(dados.execucaoId)) {
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
       WHERE regexp_replace(whatsapp, '\D', '', 'g') LIKE ${"%" + fim8}
       LIMIT 1`;
    contatoId = (c?.id as string | null) ?? null;
  }
  if (!contatoId) return null;

  const numero = dados.numeroInstancia || null;

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
    ON CONFLICT (contato_id, numero_instancia) DO UPDATE
      SET status = CASE WHEN atendimentos.status = 'encerrado' THEN 'na_fila' ELSE atendimentos.status END,
          data_atualizacao = now()
    RETURNING id`;
  return (at?.id as string | null) ?? null;
}
