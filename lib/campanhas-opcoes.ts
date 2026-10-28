// As OPÇÕES dos blocos da campanha (OpcoesDaCampanha, lib/campanhas-fluxo.ts),
// lidas de um lugar só (revisões de 2026-10-28): a página entrega à tela
// (app/campanhas/page.tsx) e a IA do construtor lê o mesmo
// (lib/ia/campanhas-construtor.ts). Antes eram duas consultas, e a da tela
// punha as etapas em ordem alfabética.
//
// Só id e nome (e a contagem de contatos do segmento, o tipo do arquivo da
// biblioteca e a chave do campo personalizado): nunca contato, WhatsApp, token,
// prompt ou o caminho do arquivo. As CONSEQUÊNCIAS (cadência e evento da etapa, segmento que
// alimenta outra campanha) saem do banco nas mesmas regras que o motor segue.
import "server-only";
import { sql } from "@/lib/db";
import { instanciasParaAviso } from "@/lib/aviso-equipe-whatsapp";
import type { OpcaoDaCampanha, OpcoesDaCampanha } from "@/lib/campanhas-fluxo";
import { problemaDoArquivoDaCampanha, tipoDoArquivoDaCampanha } from "@/lib/campanhas-fluxo-envios";
import { ehUuid } from "@/lib/validacao";

/**
 * `campanhaId`: a campanha aberta não conta como "outra campanha" que um
 * segmento alimenta. Só a ATIVA conta (é a que o gatilho de inscrição usa), e
 * campanha em edição nunca está ativa; o id é para quem pergunta de dentro dela.
 */
export async function lerOpcoesDaCampanha(campanhaId?: string): Promise<OpcoesDaCampanha> {
  const propria = campanhaId && ehUuid(campanhaId) ? campanhaId : null;
  // Os números de aviso falham à parte: o bloco fica sem opção e o resto abre.
  const instancias = instanciasParaAviso().catch((e: unknown) => {
    console.error("[campanhas] não li as instâncias de aviso:", e);
    return [] as OpcaoDaCampanha[];
  });
  const [segmentos, tags, funis, etapas, usuarios, ias, numeros, emCampanha, documentos, campos] = await Promise.all([
    sql`SELECT s.id, s.nome, count(c.id)::int AS contatos
          FROM segmentos s
          LEFT JOIN contato_segmentos cs ON cs.segmento_id = s.id
          LEFT JOIN contatos c ON c.id = cs.contato_id AND c.whatsapp IS NOT NULL
         GROUP BY s.id, s.nome ORDER BY s.nome`,
    sql`SELECT id, nome FROM tags ORDER BY nome`,
    sql`SELECT id, nome FROM funis ORDER BY nome`,
    // A cadência é a que lib/mover-etapa.ts inscreve (cadenciaRodandoDaEtapa,
    // lib/automacoes/repositorio.ts): publicada, não arquivada, no motor.
    sql`SELECT e.id, e.nome, e.funil_id, e.meta_evento IS NOT NULL AS com_evento,
               EXISTS (SELECT 1 FROM fluxos f
                        WHERE f.etapa_id = e.id AND f.estado = 'publicado' AND f.arquivado_em IS NULL
                          AND f.versao_publicada_id IS NOT NULL AND f.motor_webhook_caminho IS NOT NULL) AS com_cadencia
          FROM etapas e ORDER BY e.funil_id, e.ordem, e.nome`,
    // Quem pode receber o aviso: só usuários ativos (os blocos com inativo são recusados ao salvar).
    sql`SELECT id, nome FROM usuarios WHERE ativo ORDER BY nome`,
    sql`SELECT id, nome FROM ias ORDER BY nome`,
    instancias,
    sql`SELECT cs.segmento_id, c.nome
          FROM campanha_whatsapp_segmentos cs
          JOIN campanhas_whatsapp c ON c.id = cs.campanha_id
         WHERE c.status = 'ativa' AND c.id IS DISTINCT FROM ${propria}::uuid
         ORDER BY c.nome`,
    // O "Enviar arquivo": os ativos da biblioteca que a campanha manda (imagem,
    // PDF ou vídeo no formato e tamanho da Cloud API), filtrados por
    // problemaDoArquivoDaCampanha, a mesma regra da conferência e do motor. A
    // biblioteca tem dezenas de arquivos.
    sql`SELECT id, nome, tipo, mime, tamanho::float8 AS tamanho FROM documentos WHERE arquivado = false ORDER BY nome`,
    sql`SELECT chave, rotulo FROM campos_personalizados WHERE entidade = 'contato' ORDER BY ordem, rotulo`,
  ]);
  const lista = (x: unknown) => (x as OpcaoDaCampanha[]).map(({ id, nome }) => ({ id, nome }));
  const linhasDeEtapa = etapas as unknown as Array<OpcaoDaCampanha & { funil_id: string; com_evento: boolean; com_cadencia: boolean }>;
  return {
    tags: lista(tags),
    segmentos: (segmentos as unknown as Array<OpcaoDaCampanha & { contatos: number }>).map(({ id, nome, contatos }) => ({ id, nome, contatos })),
    funis: lista(funis),
    etapas: linhasDeEtapa.map(({ id, nome, funil_id }) => ({ id, nome, funil_id })),
    usuarios: lista(usuarios),
    ias: lista(ias),
    instancias: lista(numeros),
    documentos: (documentos as unknown as Array<{ id: string; nome: string; tipo: string; mime: string; tamanho: number }>).flatMap((d) => {
      const tipo = tipoDoArquivoDaCampanha(d);
      return tipo && !problemaDoArquivoDaCampanha(d) ? [{ id: d.id, nome: d.nome, tipo }] : [];
    }),
    camposContato: (campos as unknown as Array<{ chave: string; rotulo: string }>).map(({ chave, rotulo }) => ({ chave, rotulo })),
    consequencias: {
      etapasComCadencia: linhasDeEtapa.filter((e) => e.com_cadencia).map(({ id, nome }) => ({ id, nome })),
      etapasComEventoMeta: linhasDeEtapa.filter((e) => e.com_evento).map(({ id, nome }) => ({ id, nome })),
      segmentosEmCampanha: (emCampanha as unknown as Array<{ segmento_id: string; nome: string }>).map((l) => ({
        segmentoId: l.segmento_id,
        campanha: l.nome,
      })),
    },
  };
}
