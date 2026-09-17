import { sql } from "../lib/db";
async function main() {
  console.log("=== fluxos de etapa ===");
  const fluxos = await sql`
    SELECT f.id, f.nome, f.estado, f.entidade_alvo, f.etapa_id,
           e.nome AS etapa, fu.nome AS funil,
           (f.versao_publicada_id IS NOT NULL) AS tem_versao,
           (f.motor_webhook_caminho IS NOT NULL) AS tem_webhook,
           f.arquivado_em, f.motor
    FROM fluxos f
    LEFT JOIN etapas e ON e.id = f.etapa_id
    LEFT JOIN funis fu ON fu.id = e.funil_id
    WHERE f.etapa_id IS NOT NULL
    ORDER BY f.data_criacao`;
  for (const f of fluxos)
    console.log(`${f.nome} | etapa=${f.etapa} (${f.funil}) | estado=${f.estado} | versao=${f.tem_versao} | webhook=${f.tem_webhook} | motor=${f.motor} | arquivado=${f.arquivado_em ?? "não"}`);

  console.log("\n=== últimas oportunidades ===");
  const ops = await sql`
    SELECT o.id, o.nome, o.status, e.nome AS etapa, e.id AS etapa_id, o.data_criacao
    FROM oportunidades o LEFT JOIN etapas e ON e.id = o.etapa_id
    ORDER BY o.data_criacao DESC LIMIT 5`;
  for (const o of ops)
    console.log(`${o.nome} | etapa=${o.etapa} | status=${o.status} | ${o.data_criacao}`);

  console.log("\n=== últimas execuções de fluxo ===");
  const ex = await sql`
    SELECT x.id, f.nome AS fluxo, x.entidade_tipo, x.estado, x.origem, x.data_criacao
    FROM fluxo_execucoes x JOIN fluxos f ON f.id = x.fluxo_id
    ORDER BY x.data_criacao DESC LIMIT 5`;
  for (const e of ex)
    console.log(`${e.fluxo} | ${e.entidade_tipo} | estado=${e.estado} | origem=${e.origem} | ${e.data_criacao}`);

  console.log("\n=== webhooks: ação criar_lead ===");
  const acoes = await sql`
    SELECT w.nome, a.criar_oportunidade, e.nome AS etapa, fu.nome AS funil
    FROM webhook_acoes a
    JOIN webhooks w ON w.id = a.webhook_id
    LEFT JOIN etapas e ON e.id = a.etapa_id
    LEFT JOIN funis fu ON fu.id = a.funil_id
    WHERE a.tipo = 'criar_lead'`;
  for (const a of acoes)
    console.log(`${a.nome} | cria oportunidade=${a.criar_oportunidade} | ${a.funil ?? "-"} / ${a.etapa ?? "-"}`);
  await sql.end();
}
main();
