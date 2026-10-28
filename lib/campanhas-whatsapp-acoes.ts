// Os blocos de AÇÃO do motor (lib/campanhas-whatsapp.ts explica o motor
// inteiro): tag, segmento, criar e mover oportunidade, registrar conversão,
// passar para a IA e avisar a equipe. Imediatos: a ação que falha fica
// registrada no evento do bloco e o contato segue (quem registra é a rodada).
// Dividido do motor em 2026-10-28.
import "server-only";
import { sql } from "@/lib/db";
import { eventoAoEntrarNaEtapa } from "@/lib/meta-eventos";
import { moverOportunidadeDeEtapa } from "@/lib/mover-etapa";
import { gravarIaDoContato } from "@/lib/ia/contato-ia";
import { registrarSegmento, registrarTag } from "@/lib/historico";
import type { BlocoCampanha } from "@/lib/campanhas-fluxo";
import { conversaOficial, evento, temGente, type Efeitos, type Execucao } from "@/lib/campanhas-whatsapp-base";

export type Acao = Extract<
  BlocoCampanha,
  { tipo: "mudar_tag" | "mudar_segmento" | "criar_oportunidade" | "mover_oportunidade" | "registrar_conversao" | "avisar_equipe" | "ligar_ia" }
>;
export type Resultado = { ok: boolean; erro?: string };
const OK: Resultado = { ok: true };

export async function executarAcao(e: Execucao, b: Acao, efeitos: Efeitos): Promise<Resultado> {
  switch (b.tipo) {
    case "mudar_tag": {
      if (b.acao === "adicionar") {
        const r = await sql`INSERT INTO contato_tags (contato_id, tag_id) VALUES (${e.contato_id}::uuid, ${b.tagId}::uuid)
                            ON CONFLICT DO NOTHING RETURNING tag_id`;
        if (r.length) await registrarTag(e.contato_id, b.tagId, "adicionada");
      } else {
        const r = await sql`DELETE FROM contato_tags WHERE contato_id = ${e.contato_id}::uuid AND tag_id = ${b.tagId}::uuid RETURNING tag_id`;
        if (r.length) await registrarTag(e.contato_id, b.tagId, "removida");
      }
      return OK;
    }
    case "mudar_segmento": {
      // Entrar num segmento pode inscrever o contato em OUTRA campanha ativa
      // dele (gatilho de migration-campanhas-whatsapp-segmentos-n8n.sql).
      if (b.acao === "adicionar") {
        const r = await sql`INSERT INTO contato_segmentos (contato_id, segmento_id) VALUES (${e.contato_id}::uuid, ${b.segmentoId}::uuid)
                            ON CONFLICT DO NOTHING RETURNING segmento_id`;
        if (r.length) await registrarSegmento([e.contato_id], b.segmentoId);
      } else {
        await sql`DELETE FROM contato_segmentos WHERE contato_id = ${e.contato_id}::uuid AND segmento_id = ${b.segmentoId}::uuid`;
      }
      return OK;
    }
    case "criar_oportunidade": {
      const nome = b.nome.replaceAll("{{nome}}", e.contato_nome);
      const [op] = await sql`INSERT INTO oportunidades (nome, contato_id, valor, status, funil_id, etapa_id)
                             VALUES (${nome}, ${e.contato_id}::uuid, 0, 'aberta', ${b.funilId}::uuid, ${b.etapaId}::uuid)
                             RETURNING id`;
      // Nasceu dentro da etapa: evento da Meta dela, se configurado.
      eventoAoEntrarNaEtapa(op.id, b.etapaId);
      return OK;
    }
    case "mover_oportunidade": {
      const [op] = await sql`
        SELECT id FROM oportunidades
         WHERE contato_id = ${e.contato_id}::uuid AND funil_id = ${b.funilId}::uuid AND status = 'aberta'
         ORDER BY data_criacao DESC LIMIT 1`;
      if (!op) return { ok: false, erro: "Sem oportunidade aberta neste funil." };
      await moverOportunidadeDeEtapa(op.id as string, b.etapaId, b.funilId, ` pela campanha "${e.campanha_nome}"`);
      return OK;
    }
    case "registrar_conversao":
      await sql`UPDATE campanha_whatsapp_execucoes SET conversao = true WHERE id = ${e.id}::uuid`;
      return OK;
    case "ligar_ia": {
      const conversa = await conversaOficial(e);
      if (conversa && temGente(conversa)) return { ok: false, erro: "A conversa está com alguém da equipe: IA não ligada." };
      // Quem desligou à mão, ou escolheu outra IA, decidiu: a campanha não passa
      // por cima. A condição vai no próprio UPDATE (lib/ia/contato-ia.ts).
      const r = await gravarIaDoContato(e.contato_id, true, b.iaId, null, `pela campanha "${e.campanha_nome}"`, { respeitarEscolhaManual: true });
      if (r.erro) return { ok: false, erro: r.erro };
      efeitos.ligouIa = true;
      return OK;
    }
    case "avisar_equipe": {
      // Só ENFILEIRA: a rodada do /processar junta os avisos de cada pessoa numa
      // mensagem (enviarAvisosPendentes). Um por contato, uma campanha grande
      // viraria centenas de mensagens no celular de alguém.
      const ids = new Set(b.usuarioIds);
      if (b.responsavelDoFunil) {
        const [op] = await sql`
          SELECT responsavel_id FROM oportunidades
           WHERE contato_id = ${e.contato_id}::uuid AND funil_id = ${b.responsavelDoFunil}::uuid
             AND status = 'aberta' AND responsavel_id IS NOT NULL
           ORDER BY data_criacao DESC LIMIT 1`;
        if (op) ids.add(op.responsavel_id as string);
      }
      if (!ids.size) return { ok: false, erro: "Ninguém para avisar: sem responsável no funil." };
      const conversa = await conversaOficial(e);
      await evento(e.campanha_id, e.id, "aviso_pendente", {
        instanciaId: b.instanciaId,
        usuarioIds: [...ids],
        texto: b.texto,
        atendimentoId: conversa?.id ?? null,
      });
      return OK;
    }
  }
}
