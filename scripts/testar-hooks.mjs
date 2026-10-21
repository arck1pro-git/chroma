// node scripts/testar-hooks.mjs
//
// Testa os hooks do Claude Code (.claude/hooks/) com entradas sintéticas, do jeito
// que o Claude Code manda: JSON no stdin, decisão em JSON no stdout. Não lê o .env
// de verdade: os casos de arquivo usam uma pasta temporária com um .env falso, e o
// hook de parada roda num repositório temporário com tsc e eslint falsos.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hooks = join(raiz, ".claude", "hooks");
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "testar-hooks-")));

function rodar(hook, entrada, env = {}) {
  const r = spawnSync(process.execPath, [join(hooks, hook)], {
    input: typeof entrada === "string" ? entrada : JSON.stringify(entrada),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, ...env },
  });
  assert.equal(r.status, 0, `${hook} saiu com ${r.status}: ${r.stderr}`);
  if (!r.stdout.trim()) return { decisao: "nenhuma", texto: "" };
  const j = JSON.parse(r.stdout);
  return {
    decisao: j.hookSpecificOutput?.permissionDecision ?? j.decision ?? (j.systemMessage ? "aviso" : "?"),
    texto: j.systemMessage ?? j.reason ?? j.hookSpecificOutput?.permissionDecisionReason ?? "",
  };
}

let casos = 0;
const falhas = [];
function espera(rotulo, obtido, esperado) {
  casos++;
  if (obtido !== esperado) falhas.push(`${rotulo}: esperado ${esperado}, veio ${obtido}`);
}

try {
  // ── proteger-arquivos ────────────────────────────────────────────────────
  writeFileSync(join(temp, ".env"), "FALSO=1\n");
  writeFileSync(join(temp, ".env.bak-1"), "FALSO=1\n");
  const arquivo = [
    ["Read", { file_path: join(temp, ".env") }, "deny"],
    ["Read", { file_path: join(temp, ".ENV") }, "deny"],
    ["Read", { file_path: join(temp, ".env::$DATA") }, "deny"],
    ["Read", { file_path: join(temp, ".env.") }, "deny"],
    ["Read", { file_path: join(temp, ".env.bak-1") }, "deny"],
    ["Write", { file_path: join(temp, "nao-existe", ".env.local") }, "deny"],
    ["Read", { file_path: ".env" }, "deny"],
    ["Read", { file_path: join(raiz, ".env.example") }, "nenhuma"],
    ["Edit", { file_path: join(raiz, ".env.example") }, "nenhuma"],
    ["Read", { file_path: join(raiz, "package-lock.json") }, "nenhuma"],
    ["Edit", { file_path: join(raiz, "package-lock.json") }, "deny"],
    ["Edit", { file_path: join(raiz, "Package-Lock.json") }, "deny"],
    ["Edit", { file_path: join(raiz, "agents.md") }, "deny"],
    ["Write", { file_path: join(raiz, ".GIT", "config") }, "deny"],
    ["Write", { file_path: join(raiz, "node_modules", "x", "index.js") }, "deny"],
    ["Write", { file_path: join(raiz, ".next", "x.js") }, "deny"],
    ["Edit", { file_path: join(raiz, "lib", "db.ts") }, "nenhuma"],
    ["NotebookEdit", { notebook_path: join(temp, ".env") }, "deny"],
    ["Grep", { pattern: "X", path: join(temp, ".env") }, "deny"],
    ["Grep", { pattern: "X", path: raiz }, "nenhuma"],
    ["Grep", { pattern: "X", path: raiz, glob: "*.ts" }, "nenhuma"],
    ["Grep", { pattern: "X", path: raiz, glob: "*.{ts,tsx}" }, "nenhuma"],
    ["Grep", { pattern: "X", path: raiz, glob: "lib/**/*.ts" }, "nenhuma"],
    ["Grep", { pattern: "X", path: raiz, glob: ".env.example" }, "nenhuma"],
    ["Grep", { pattern: "X", path: raiz, glob: ".env*" }, "deny"],
    ["Grep", { pattern: "X", path: raiz, glob: "*env*" }, "deny"],
    ["Grep", { pattern: "X", path: raiz, glob: "*" }, "deny"],
    ["Grep", { pattern: "X", path: raiz, glob: "**/*" }, "deny"],
    ["Grep", { pattern: "X", path: raiz, glob: ".*" }, "deny"],
  ];
  // Nome curto 8.3 só existe se o volume gera nomes curtos.
  if (existsSync(join(temp, "ENV~1"))) arquivo.push(["Read", { file_path: join(temp, "ENV~1") }, "deny"]);
  for (const [tool_name, tool_input, esperado] of arquivo) {
    const r = rodar("proteger-arquivos.mjs", { tool_name, tool_input, cwd: raiz });
    espera(`${tool_name} ${JSON.stringify(tool_input)}`, r.decisao, esperado);
  }

  // ── guardar-comandos ─────────────────────────────────────────────────────
  const comandos = [
    ["Bash", "git status --short", "nenhuma"],
    ["Bash", "git diff HEAD -- lib/db.ts", "nenhuma"],
    ["Bash", "git log --oneline --grep push", "nenhuma"],
    ["Bash", "git stash push -m x", "nenhuma"],
    ["Bash", "git push origin master", "ask"],
    ["Bash", "git -C C:/Users/x/chroma push origin master", "ask"],
    ["Bash", "git -C . commit -m x", "ask"],
    ["Bash", "bash -c 'git push'", "ask"],
    ["PowerShell", "git.exe push", "ask"],
    ["Bash", "echo ok && git push --force", "ask"],
    ["Bash", "git reset --hard HEAD~1", "ask"],
    ["Bash", "git reset HEAD~2", "ask"],
    ["Bash", "git reset -- lib/db.ts", "nenhuma"],
    ["Bash", "git clean -fd", "ask"],
    ["Bash", "git restore lib/db.ts", "ask"],
    ["Bash", "git restore --staged lib/db.ts", "nenhuma"],
    ["Bash", "git restore --staged --worktree lib/db.ts", "ask"],
    ["Bash", "git checkout -- lib/db.ts", "ask"],
    ["Bash", "git checkout HEAD -- lib/db.ts", "ask"],
    ["Bash", "git checkout -f master", "ask"],
    ["Bash", "git checkout .", "ask"],
    ["Bash", "git checkout master", "nenhuma"],
    ["Bash", "git checkout -b nova", "nenhuma"],
    ["Bash", "git switch --discard-changes master", "ask"],
    ["Bash", "git branch -D teste", "ask"],
    ["Bash", "git branch --delete --force teste", "ask"],
    ["Bash", "git branch -d teste", "nenhuma"],
    ["Bash", "git stash drop", "ask"],
    ["Bash", "git rm lib/x.ts", "ask"],
    ["Bash", "git rm -r --cached .next", "nenhuma"],
    ["Bash", "rm -rf node_modules", "ask"],
    ["Bash", "rm -f -r app", "ask"],
    ["Bash", "rm --force --recursive app", "ask"],
    ["Bash", "rm -f /tmp/x.txt", "nenhuma"],
    ["Bash", "find . -name '*.log' -delete", "ask"],
    ["PowerShell", "Remove-Item -Recurse -Force .next", "ask"],
    ["PowerShell", "Remove-Item app -r", "ask"],
    ["PowerShell", "cmd /c rmdir /s /q app", "ask"],
    ["PowerShell", "Get-ChildItem", "nenhuma"],
    ["Bash", "npm run lint", "nenhuma"],
    ["Bash", "npm install zod", "ask"],
    ["PowerShell", "npm i zod", "ask"],
    ["Bash", "npx tsc --noEmit -p .", "nenhuma"],
    ["Bash", "npx --yes playwright install chromium", "ask"],
    ["Bash", "grep -rn vercel.app lib", "nenhuma"],
    ["Bash", "npx vercel --prod", "ask"],
    ["PowerShell", "cd x; npx --yes vercel deploy --prod", "ask"],
    ["Bash", "node --env-file=.env scripts/jiti.mjs scripts/testar-filtro-campanhas.ts", "nenhuma"],
    ["Bash", "node --env-file=.env scripts/jiti.mjs scripts/rodar-sql.ts migration-x.sql", "ask"],
    ["Bash", "git log --oneline -- scripts/rodar-sql.ts", "nenhuma"],
    ["Bash", 'node -e "process.env.DATABASE_URL_PROD"', "ask"],
    ["Bash", "grep -rn DATABASE_URL_PROD lib scripts", "nenhuma"],
    ["Bash", "DATABASE_URL=postgres://u@ep-noisy-pond-x.neon.tech/db node scripts/x.mjs", "ask"],
    ["Bash", "grep -rn 'DROP TABLE' migration-x.sql", "nenhuma"],
    ["Bash", "git log --oneline --grep 'truncate long names'", "nenhuma"],
    ["Bash", "psql \"$DB\" -c 'ALTER TABLE x DROP CONSTRAINT y'", "ask"],
    ["PowerShell", "Invoke-WebRequest -Method Post -Uri https://api.exemplo.neon.tech/sql -Body '{\"query\":\"DELETE FROM contatos\"}'", "ask"],
    ["PowerShell", "$b = '{\"query\":\"UPDATE oportunidades SET etapa_id = null\"}'", "ask"],
    ["PowerShell", "Invoke-WebRequest -Method Post -Uri https://api.exemplo.neon.tech/sql -Body '{\"query\":\"SELECT 1\"}'", "nenhuma"],
    ["Bash", "cat .env", "ask"],
    ["PowerShell", "Get-Content .env", "ask"],
    ["PowerShell", "type C:\\x\\.env.local", "ask"],
    ["Bash", "node -e \"console.log(require('fs').readFileSync('.env','utf8'))\"", "ask"],
    ["Bash", "ls -la .env*", "ask"],
    ["Bash", "cat ENV~1", "ask"],
    ["Bash", "cat .env.example", "nenhuma"],
    ["Bash", "echo $NODE_ENV && grep -n process.env lib/db.ts", "nenhuma"],
    ["Bash", 'node --env-file=.env -e "console.log(process.env.DATABASE_URL)"', "ask"],
    ["Bash", "grep -rn DATABASE_URL --exclude-dir=node_modules .", "ask"],
    ["Bash", "grep -rn DATABASE_URL", "ask"],
    ["Bash", "grep -rn DATABASE_URL --exclude='.env*' .", "nenhuma"],
    ["Bash", "grep -rn DATABASE_URL --include='*.ts' .", "nenhuma"],
    ["Bash", "grep -rn DATABASE_URL lib app", "nenhuma"],
    ["Bash", "git log | grep -i fix", "nenhuma"],
    ["Bash", "rg -n DATABASE_URL", "nenhuma"],
    ["Bash", "rg -n --hidden DATABASE_URL", "ask"],
    ["Bash", "rg -n -g '*' DATABASE_URL", "ask"],
    ["Bash", "rg -n -g '*.ts' DATABASE_URL", "nenhuma"],
    ["PowerShell", "Get-ChildItem -Recurse | Select-String DATABASE_URL", "ask"],
    ["PowerShell", "Get-ChildItem -Recurse -Include *.ts | Select-String DATABASE_URL", "nenhuma"],
  ];
  for (const [tool_name, command, esperado] of comandos) {
    const r = rodar("guardar-comandos.mjs", { tool_name, tool_input: { command }, cwd: raiz });
    espera(`${tool_name} ${command}`, r.decisao, esperado);
  }

  // ── entradas quebradas: os três hooks saem 0 sem decidir ─────────────────
  for (const hook of ["proteger-arquivos.mjs", "guardar-comandos.mjs"]) {
    for (const bruto of ["", "nao-json", '{"tool_input":null}', '{"tool_name":"Read","tool_input":{"file_path":123}}']) {
      espera(`${hook} com ${JSON.stringify(bruto)}`, rodar(hook, bruto).decisao, "nenhuma");
    }
  }

  // ── verificar-ao-parar, num repositório temporário ───────────────────────
  const repo = join(temp, "repo");
  mkdirSync(repo);
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  git("config", "user.email", "teste@exemplo.invalid");
  git("config", "user.name", "teste");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(join(repo, "base.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  // tsc e eslint falsos: a saída vem das variáveis FALSO_TSC e FALSO_LINT.
  mkdirSync(join(repo, "node_modules", "typescript", "bin"), { recursive: true });
  mkdirSync(join(repo, "node_modules", "eslint", "bin"), { recursive: true });
  writeFileSync(
    join(repo, "node_modules", "typescript", "bin", "tsc"),
    'const s = Number(process.env.FALSO_TSC || 0); if (s) console.log("erro de tipo falso"); process.exit(s);\n',
  );
  writeFileSync(
    join(repo, "node_modules", "eslint", "bin", "eslint.js"),
    'require("node:fs").writeFileSync(process.env.FALSO_LINT_ARGS, JSON.stringify(process.argv.slice(2)));\n' +
      "process.exit(Number(process.env.FALSO_LINT || 0));\n",
  );
  const cacheDir = join(temp, "cache");
  mkdirSync(cacheDir);
  const argsLint = join(temp, "args-lint.json");
  const parar = (env = {}, extra = {}) =>
    rodar(
      "verificar-ao-parar.mjs",
      { cwd: repo, ...extra },
      { CLAUDE_PROJECT_DIR: repo, TEMP: cacheDir, TMP: cacheDir, TMPDIR: cacheDir, FALSO_LINT_ARGS: argsLint, ...env },
    );

  espera("parada sem alteração", parar().decisao, "nenhuma");
  writeFileSync(join(repo, "ação teste.ts"), "export const b = 2;\n");
  espera("falha nova bloqueia", parar({ FALSO_TSC: "1" }).decisao, "block");
  espera("arquivo com acento chega ao eslint", JSON.parse(readFileSync(argsLint, "utf8")).includes("ação teste.ts"), true);
  const repetida = parar({ FALSO_TSC: "1" });
  espera("mesma falha não bloqueia de novo", repetida.decisao, "aviso");
  espera("mesma falha avisa que já foi reportada", repetida.texto.includes("já reportado"), true);
  appendFileSync(join(repo, "ação teste.ts"), "export const c = 3;\n");
  espera("segunda tentativa na mesma vez só avisa", parar({ FALSO_LINT: "1" }, { stop_hook_active: true }).decisao, "aviso");
  appendFileSync(join(repo, "base.ts"), "export const d = 4;\n");
  const aprovada = parar();
  espera("conjunto novo passando avisa", aprovada.decisao, "aviso");
  espera("conjunto novo passando diz ok", aprovada.texto.includes("ok"), true);
  espera("mesmo conjunto aprovado fica quieto", parar().decisao, "nenhuma");
  git("add", ".");
  git("commit", "-qm", "tudo");
  writeFileSync(join(repo, "tsconfig.json"), "{}\n");
  espera("mudança só no tsconfig.json também verifica", parar({ FALSO_TSC: "1" }).decisao, "block");
  rmSync(join(repo, "node_modules"), { recursive: true, force: true });
  appendFileSync(join(repo, "base.ts"), "export const e = 5;\n");
  const semModulos = parar();
  espera("sem node_modules só avisa", semModulos.decisao, "aviso");
  espera("sem node_modules diz que pulou", semModulos.texto.includes("pulada"), true);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (falhas.length) {
  console.error(`${falhas.length} de ${casos} casos falharam:\n- ${falhas.join("\n- ")}`);
  process.exit(1);
}
console.log(`Hooks: ${casos} casos passaram (arquivos sensíveis, comandos perigosos, entradas quebradas e verificação ao parar).`);
