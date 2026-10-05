// Grava `campaign_id` nos leads que entraram antes de a captação fazer isso
// sozinha (lib/campanha-do-lead.ts). Usa a MESMA função da captação.
//
//   node --env-file=.env scripts/jiti.mjs scripts/carimbar-campanhas.ts [--gravar] [--renomeada "nome antigo=id"]…
//
// Sem --gravar só mostra o que faria. O banco é o do DATABASE_URL — para outro,
// defina-o na linha de comando (o --env-file não sobrescreve variável que já
// existe). --renomeada cobre o lead cujo utm_campaign é um nome que a Meta já
// não tem, porque a campanha foi renomeada: só quem renomeou sabe qual era.
import { sql } from "@/lib/db";
import { carimbarCampanha, type Carimbo } from "@/lib/campanha-do-lead";

const args = process.argv.slice(2);
const gravar = args.includes("--gravar");
const renomeadas = new Map<string, string>();
args.forEach((a, i) => {
  if (a !== "--renomeada") return;
  const [nome, id] = (args[i + 1] ?? "").split(/=(?=\d+$)/);
  if (!nome || !id) throw new Error(`--renomeada espera "nome antigo=id", veio ${JSON.stringify(args[i + 1])}`);
  renomeadas.set(nome.trim(), id);
});

try {
  console.log(`banco: ${new URL(process.env.DATABASE_URL!).hostname} · ${gravar ? "GRAVANDO" : "simulação (use --gravar)"}`);
  // Candidatos: origem sem ID. Quem decide se dá para resolver é a função.
  const [contatos, oportunidades] = await Promise.all([
    sql`SELECT id FROM contatos WHERE jsonb_typeof(campos) = 'object' AND NOT (campos ?| array['campaign_id', 'campanha_id', 'utm_id'])`,
    sql`SELECT id FROM oportunidades WHERE jsonb_typeof(campos) = 'object' AND NOT (campos ?| array['campaign_id', 'campanha_id', 'utm_id'])`,
  ]);
  const feitos: Carimbo[] = [];
  for (const c of contatos) feitos.push(...await carimbarCampanha({ contatoId: c.id, oportunidadeId: null }, { renomeadas, gravar }));
  for (const o of oportunidades) feitos.push(...await carimbarCampanha({ contatoId: null, oportunidadeId: o.id }, { renomeadas, gravar }));

  const grupos = new Map<string, number>();
  for (const f of feitos) {
    const chave = `${f.tabela.padEnd(13)} ${JSON.stringify(f.nome)} → ${f.campanhaId ?? "sem campanha"}`;
    grupos.set(chave, (grupos.get(chave) ?? 0) + 1);
  }
  for (const [chave, n] of [...grupos].sort()) console.log(`${String(n).padStart(4)}  ${chave}`);
  console.log(`${feitos.filter((f) => f.campanhaId).length} de ${feitos.length} com campanha${gravar ? " gravada" : ""}.`);
} finally {
  await sql.end();
}
