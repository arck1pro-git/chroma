// Cria (ou atualiza) uma conta com senha, num departamento.
//
//   node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs \
//     scripts/criar-usuario.ts <email> "<nome>" <arquivo-com-a-senha> [departamento]
//
// `departamento` é o SLUG (comercial, admin, ti — ou o de um que você tenha
// criado na tela de Acessos). Omitido, assume `ti`: era `criar-admin.ts`, e a
// razão do padrão continua a mesma — esta é a porta de entrada do sistema, e a
// primeira conta precisa alcançar /configuracoes/acessos pra classificar as
// outras. O TI é o único departamento que nasce administrando.
//
// A senha vem de ARQUIVO e não de argumento: argumento de linha de comando
// aparece no histórico do shell e na lista de processos da máquina.
//
// Idempotente por email: rodar de novo troca a senha e reativa a conta, em vez
// de estourar por índice único. É isso que faz dele também o "esqueci a senha"
// enquanto não existir um fluxo de redefinição na tela.
//
// O QUE ELE NÃO FAZ: mover alguém de departamento. Ver o COALESCE lá embaixo —
// trocar a senha de uma pessoa não pode reclassificá-la em silêncio. Mudança de
// departamento é decisão da tela de Acessos.
import { readFileSync } from "node:fs";
import { sql } from "../lib/db";
import { gerarHash } from "../lib/auth/senha";

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const letras = (partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "");
  return letras.toUpperCase() || "??";
}

async function main() {
  const [email, nome, arquivoSenha, departamento = "ti"] = process.argv.slice(2);
  if (!email || !nome || !arquivoSenha) {
    throw new Error(
      'uso: criar-usuario.ts <email> "<nome>" <arquivo-com-a-senha> [departamento]',
    );
  }

  const senha = readFileSync(arquivoSenha, "utf8").trim();
  if (senha.length < 12) throw new Error("senha curta demais (mínimo 12).");

  const hash = await gerarHash(senha);
  const emailNormal = email.trim().toLowerCase();

  // Sem o departamento no banco não há o que criar: seria uma conta que entra e
  // não vê nada. Falhar aqui, listando os que existem, é melhor que gravar a
  // linha e deixar a pessoa descobrir na tela de "sem acesso".
  const [d] = (await sql`
    SELECT id, nome FROM departamentos WHERE slug = ${departamento}
  `) as { id: string; nome: string }[];
  if (!d) {
    const todos = (await sql`
      SELECT slug FROM departamentos ORDER BY nivel DESC
    `) as { slug: string }[];
    throw new Error(
      `departamento '${departamento}' não existe. Há: ${todos.map((t) => t.slug).join(", ")}` +
        " (se a lista veio vazia, rode migration-departamentos.sql antes).",
    );
  }

  const linhas = (await sql`
    INSERT INTO usuarios (nome, iniciais, email, senha_hash, ativo, departamento_id)
    VALUES (${nome}, ${iniciaisDe(nome)}, ${emailNormal}, ${hash}, true, ${d.id})
    ON CONFLICT (lower(email)) WHERE email IS NOT NULL
    DO UPDATE SET senha_hash      = EXCLUDED.senha_hash,
                  ativo           = true,
                  -- COALESCE e não EXCLUDED: este script também é o "esqueci a
                  -- senha" de qualquer pessoa, e com EXCLUDED trocar a senha de
                  -- um comercial o promoveria sem ninguém perceber.
                  -- Departamento só é definido aqui quando ainda não havia um;
                  -- mudar o de alguém é decisão da tela de Acessos.
                  departamento_id = COALESCE(usuarios.departamento_id,
                                             EXCLUDED.departamento_id)
    RETURNING id, nome, iniciais, email,
              (SELECT nome FROM departamentos dd
                WHERE dd.id = usuarios.departamento_id) AS departamento
  `) as {
    id: string;
    nome: string;
    iniciais: string;
    email: string;
    departamento: string | null;
  }[];

  const u = linhas[0];
  console.log("usuário:", u.id);
  console.log("nome:   ", u.nome, `(${u.iniciais})`);
  console.log("email:  ", u.email);
  // Imprime o departamento REAL, não o pedido: numa troca de senha a conta
  // mantém o que já tinha, e o log tem que dizer a verdade.
  console.log("depto:  ", u.departamento ?? "(nenhum)");
  if (u.departamento !== d.nome) {
    console.log(
      `        ⚠ a conta já existia em "${u.departamento}" e NÃO foi movida para "${d.nome}".`,
    );
    console.log("          Para mover, use Configurações · Acessos.");
  }
  await sql.end();
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
