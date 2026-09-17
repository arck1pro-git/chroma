// Roda um arquivo .sql no banco de DATABASE_URL.
//
//   node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs scripts/rodar-sql.ts migration-auth.sql
//
// `.simple()` porque o arquivo tem VÁRIOS comandos e blocos DO $$ — o protocolo
// estendido (o padrão) só aceita um comando por ida ao servidor.
import { readFileSync } from "node:fs";
import { sql } from "../lib/db";

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) throw new Error("uso: rodar-sql.ts <arquivo.sql>");

  const texto = readFileSync(arquivo, "utf8");
  console.log(`rodando ${arquivo} (${texto.length} caracteres)…`);
  await sql.unsafe(texto).simple();
  console.log("ok");
  await sql.end();
}

main().catch(async (e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
