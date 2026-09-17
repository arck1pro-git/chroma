// Confere, contra o banco de verdade, que a senha do arquivo abre a conta —
// e que uma senha errada não abre. Sem navegador: o que se testa aqui é a
// checagem de credencial, que é código puro.
import { readFileSync } from "node:fs";
import { sql } from "../lib/db";
import { conferirSenha } from "../lib/auth/senha";

async function main() {
  const [email, arquivoSenha] = process.argv.slice(2);
  const senha = readFileSync(arquivoSenha, "utf8").trim();

  const linhas = (await sql`
    SELECT id, senha_hash, papel, ativo FROM usuarios
     WHERE lower(email) = ${email.toLowerCase()} LIMIT 1
  `) as { id: string; senha_hash: string; papel: string; ativo: boolean }[];

  if (!linhas[0]) throw new Error("usuário não encontrado");
  const u = linhas[0];

  const certa = await conferirSenha(senha, u.senha_hash);
  const errada = await conferirSenha(senha + "x", u.senha_hash);
  const vazia = await conferirSenha("", u.senha_hash);

  console.log("ativo:          ", u.ativo);
  console.log("papel:          ", u.papel);
  console.log("senha certa:    ", certa, certa ? "(esperado true)" : "← FALHOU");
  console.log("senha errada:   ", errada, !errada ? "(esperado false)" : "← FALHOU");
  console.log("senha vazia:    ", vazia, !vazia ? "(esperado false)" : "← FALHOU");
  console.log("hash começa com:", u.senha_hash.slice(0, 16) + "…");

  await sql.end();
  if (!certa || errada || vazia) process.exit(1);
}
main().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
