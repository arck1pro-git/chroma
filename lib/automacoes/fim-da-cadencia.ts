// O FIM DA CADÊNCIA TAMBÉM PARA QUEM RESPONDEU (pedido dele, 2026-11-06): "se
// chegar ao final da cadência e o atendimento dele não ter rendido atendimento
// humano ou reunião agendada, move pra sem contato".
//
// POR QUE EXISTE: o lead que responde fica na etapa da IA ("Atendimento IA",
// lib/ia/atendente.ts) e a cadência para de mandar mensagem. Ela para porque a
// guarda de cada envio (GUARDA_INSCRITO, adaptador do n8n) não devolve linha, e
// "sem linha, o ramo morre": a execução no n8n acaba ali e NUNCA chega ao bloco
// final "Atualizar oportunidade". Sem isto, quem respondeu uma vez e sumiu
// ficaria na etapa da IA para sempre.
//
// O QUE FAZ: passado o fim da cadência (a hora em que o motor rodaria o bloco
// final, contada da entrada), aplica esse bloco final pelo mesmo caminho do
// motor (moverPelaCadencia). O fim é o MAIS TARDIO entre a versão que a
// execução segue e a publicada agora: entre 30/10 e 03/11 houve versões que
// "terminavam" 2 horas depois da saudação, e o lead preso numa delas não
// recebeu a cadência — não pode ir para o fim por isso. O destino é o da
// versão publicada AGORA, e só move quem continua aberto e na etapa em que
// entrou. Quem rendeu reunião ou atendimento humano já saiu da etapa e não é
// tocado. Depois fecha a execução, que ficou pendurada desde a guarda.
//
// SÓ NAS ETAPAS "ATENDIMENTO IA" (com IA), dos dois funis: é a regra pedida, e
// as cadências de outras etapas (lembretes da reunião, por exemplo) têm fim
// próprio. Inscrição sem etapa conhecida (origem_etapa_id nulo e fluxo sem
// etapa) fica de fora: não há como saber se o card ainda está onde entrou.
//
// NÃO MEXE em quem não está parado (revisão de 2026-11-06):
//   · alguém da equipe falou com o lead depois da entrada (CRM ou celular), ou
//     a IA foi desligada no contato: é atendimento de gente, como a guarda do
//     motor entende;
//   · o card saiu da etapa e voltou depois da entrada: a execução é velha;
//   · execução 'pendente': o motor nunca a rodou, o lead não recebeu nada;
//   · conversa viva: o lead ou a IA falaram nas últimas CONVERSA_VIVA;
//   · retorno combinado ou remarcação de reunião em aberto: a IA tem hora
//     marcada para voltar (lib/ia/retorno.ts, lib/ia/remarcacao.ts);
//   · reunião marcada que ainda não acabou, mesmo com o card parado na etapa
//     (marcada pela Agenda sem arrastar, ou o avanço da IA não andou).
// Espera ainda FOLGA depois do fim, para o motor mover primeiro quem não
// respondeu (o caminho normal). E nunca leva para o atendimento humano: esta
// é a saída de quem NÃO rendeu atendimento humano.
//
// QUEM CHAMA: a rodada das retomadas da IA (/api/ia/retomar), de 5 em 5
// minutos, pelo agendador "[Chroma] IA · retomar conversas" do n8n. Sem ele
// ligado, nada aqui roda.
import "server-only";
import { sql } from "@/lib/db";
import { ETAPA_ATENDIMENTO_HUMANO } from "@/lib/atendimento-humano";
import { lerCadencia } from "@/lib/automacoes/cadencia";
import { moverPelaCadencia } from "@/lib/automacoes/mover-pela-cadencia";
import type { DefinicaoFluxo } from "@/lib/automacoes/tipos";
import { registrarSaidaDeFluxo } from "@/lib/historico";
import { remarcacaoAberta } from "@/lib/ia/remarcacao";
import { retornoMarcado } from "@/lib/ia/retorno";

const ETAPA_DA_IA = "atendimento ia";
/** Depois do fim da cadência, quanto esperar o motor agir antes de agir aqui. */
const FOLGA_MS = 2 * 60 * 60 * 1000;
const CONVERSA_VIVA = "24 hours";
const POR_RODADA = 20;
/** A rodada divide os 300 s da rota com as retomadas: passou disto, o resto fica para a próxima. */
const ORCAMENTO_MS = 60_000;
export const MOTIVO_FIM = "fim da cadência sem reunião nem atendimento humano";

type Candidata = {
  execucao_id: string;
  fluxo_id: string;
  op_id: string;
  contato_id: string;
  iniciado_em: Date;
  versao_id: string;
  versao_publicada_id: string;
};

/** Quanto dura a cadência até o bloco final, em ms; null se não dá para ler. */
function duracao(definicao: DefinicaoFluxo): number | null {
  const c = lerCadencia(definicao);
  const ultima = c.subetapas.at(-1);
  // Contada da reunião, a mensagem não tem dia fixo desde a entrada.
  if (!c.linear || !ultima || c.subetapas.some((s) => s.ancora === "reuniao")) return null;
  const esperaFinal = c.acoesFinais
    .filter((a) => a.tipo === "esperar")
    .reduce((total, a) => total + (Number(a.config.minutos) || 0), 0);
  return (ultima.minutos + esperaFinal) * 60_000;
}

/** O bloco final que muda a etapa, na versão publicada; null se a cadência não tem. */
function blocoFinal(definicao: DefinicaoFluxo): { noId: string; etapaId: string } | null {
  const c = lerCadencia(definicao);
  if (!c.linear) return null;
  const final = c.acoesFinais.filter((a) => a.tipo === "atualizar_oportunidade").at(-1);
  const etapaId = final?.config.etapa_id;
  return final && typeof etapaId === "string" && etapaId ? { noId: final.id, etapaId } : null;
}

/** O lead ou a IA falaram há pouco: a conversa está acontecendo. */
async function conversaViva(contatoId: string): Promise<boolean> {
  const [m] = await sql`
    SELECT 1 FROM mensagens m JOIN atendimentos a ON a.id = m.atendimento_id
     WHERE a.contato_id = ${contatoId}
       AND (m.origem = 'contato' OR m.enviada_por = 'ia')
       AND m.data_criacao > now() - ${CONVERSA_VIVA}::interval
     LIMIT 1`;
  return Boolean(m);
}

export type ResumoFim = { ocupado?: boolean; movidas: number; puladas: number; falhas: number };

/** Uma rodada. Nunca lança por causa de uma execução: o erro dela vai para o log. */
export async function encerrarCadenciasVencidas(): Promise<ResumoFim> {
  // A trava vive na transação (como a das retomadas): duas rodadas ao mesmo
  // tempo moveriam o mesmo card e gravariam a saída duas vezes.
  return sql.begin(async (tx: typeof sql) => {
    const [trava] = await tx`SELECT pg_try_advisory_xact_lock(hashtext('chroma:fim-cadencia')) AS ok`;
    if (!trava.ok) return { ocupado: true, movidas: 0, puladas: 0, falhas: 0 };
    return rodada();
  });
}

async function rodada(): Promise<ResumoFim> {
  const resumo: ResumoFim = { movidas: 0, puladas: 0, falhas: 0 };
  const candidatas = (await sql`
    SELECT e.id AS execucao_id, e.fluxo_id, o.id AS op_id, o.contato_id, e.iniciado_em, e.versao_id,
           f.versao_publicada_id
      FROM fluxo_execucoes e
      JOIN fluxos f ON f.id = e.fluxo_id
      JOIN oportunidades o ON e.entidade_tipo = 'oportunidade' AND o.id = e.entidade_id
      JOIN contatos c ON c.id = o.contato_id
      JOIN etapas et ON et.id = o.etapa_id
     WHERE e.estado IN ('rodando','esperando')
       AND f.estado = 'publicado' AND f.arquivado_em IS NULL AND f.versao_publicada_id IS NOT NULL
       AND o.status = 'aberta'
       AND COALESCE(e.origem_etapa_id, f.etapa_id) = o.etapa_id
       AND et.ia_id IS NOT NULL AND lower(btrim(et.nome)) = ${ETAPA_DA_IA}
       AND c.ia IS DISTINCT FROM false
       -- Gente da equipe falou com ele depois da entrada.
       AND NOT EXISTS (
         SELECT 1 FROM mensagens m JOIN atendimentos a ON a.id = m.atendimento_id
          WHERE a.contato_id = o.contato_id AND m.enviada_por IN ('crm','aparelho')
            AND m.data_criacao > e.iniciado_em)
       -- O card saiu e voltou depois da entrada: a execução é de antes.
       AND NOT EXISTS (
         SELECT 1 FROM historico h
          WHERE h.oportunidade_id = o.id AND h.descricao LIKE 'Movida de %'
            AND h.data_criacao > e.iniciado_em)
       -- Reunião marcada que ainda não acabou (a mesma relação do motor).
       AND NOT EXISTS (
         SELECT 1 FROM agenda_reunioes r
          WHERE (r.oportunidade_id = o.id OR (r.oportunidade_id IS NULL AND r.contato_id = o.contato_id))
            AND r.fim > now())
     ORDER BY e.iniciado_em`) as unknown as Candidata[];
  if (candidatas.length === 0) return resumo;

  const versoes = new Map<string, DefinicaoFluxo>();
  const definicao = async (versaoId: string) => {
    if (!versoes.has(versaoId)) {
      const [v] = await sql`SELECT definicao FROM fluxo_versoes WHERE id = ${versaoId}`;
      versoes.set(versaoId, v?.definicao as DefinicaoFluxo);
    }
    return versoes.get(versaoId);
  };
  const nomeDaEtapa = new Map<string, string>();

  const agora = Date.now();
  for (const c of candidatas) {
    if (resumo.movidas >= POR_RODADA || Date.now() - agora > ORCAMENTO_MS) break;
    try {
      // O tempo é o mais longo entre a versão seguida e a publicada; o
      // destino, o da publicada.
      const seguida = await definicao(c.versao_id);
      const publicada = await definicao(c.versao_publicada_id);
      const duracoes = [seguida, publicada].map((d) => (d ? duracao(d) : null)).filter((d): d is number => d !== null);
      const fim = publicada ? blocoFinal(publicada) : null;
      if (duracoes.length === 0 || !fim) continue;
      if (agora < new Date(c.iniciado_em).getTime() + Math.max(...duracoes) + FOLGA_MS) continue;

      if (!nomeDaEtapa.has(fim.etapaId)) {
        const [e] = await sql`SELECT nome FROM etapas WHERE id = ${fim.etapaId}`;
        nomeDaEtapa.set(fim.etapaId, String(e?.nome ?? ""));
      }
      if (ETAPA_ATENDIMENTO_HUMANO.test(nomeDaEtapa.get(fim.etapaId)!.trim())) {
        resumo.falhas += 1;
        console.error(`[fim da cadência] o bloco final de ${c.fluxo_id} leva ao atendimento humano: não movo ${c.op_id}`);
        continue;
      }

      // Conferido agora, e não na consulta: a rodada pode levar minutos.
      if ((await conversaViva(c.contato_id)) || (await retornoMarcado(c.contato_id)) || (await remarcacaoAberta(c.contato_id))) {
        resumo.puladas += 1;
        continue;
      }

      const r = await moverPelaCadencia(c.execucao_id, fim.etapaId, fim.noId);
      if ("erro" in r) {
        resumo.falhas += 1;
        console.error(`[fim da cadência] ${c.op_id}:`, r.erro);
        continue;
      }
      if ("pulado" in r) {
        resumo.puladas += 1;
        console.info(`[fim da cadência] ${c.op_id} não movida:`, r.pulado);
        continue;
      }
      const fechada = await sql`
        UPDATE fluxo_execucoes
           SET estado = 'sucesso', finalizado_em = now(),
               duracao_ms = LEAST(extract(epoch FROM now() - iniciado_em) * 1000, 2147483647)::int
         WHERE id = ${c.execucao_id} AND estado IN ('pendente','rodando','esperando')
        RETURNING id`;
      if (fechada.length) await registrarSaidaDeFluxo(c.fluxo_id, "oportunidade", [c.op_id], MOTIVO_FIM);
      resumo.movidas += 1;
      console.info(`[fim da cadência] ${c.op_id} → ${r.movido}`);
    } catch (e) {
      resumo.falhas += 1;
      console.error("[fim da cadência] falhou:", c.execucao_id, e);
    }
  }
  return resumo;
}
