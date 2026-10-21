// Hook PreToolUse (Read, Grep, Edit, Write, NotebookEdit): protege arquivos sensíveis.
//
// · `.env`, `.env.local`, `.env.bak-*`... (qualquer `.env*` menos `.env.example`):
//   nem ler nem editar. Segredo não entra no contexto do modelo. Para saber se
//   uma variável existe, o caminho é um script que imprime só "definida/ausente".
// · Arquivos gerados ou gerenciados por ferramenta: ler pode, editar não.
//   O lockfile muda por `npm`, o AGENTS.md é reescrito pelo `next dev`, e
//   `.git/`, `node_modules/` e `.next/` não se editam à mão.
// · Grep com `glob`: o ripgrep deixa o glob passar por cima do .gitignore, então
//   `.env*`, `*` ou `**/*` devolvem o .env. Glob que alcança um `.env*` é negado
//   (glob-env.mjs).
//
// O caminho é canonizado antes da comparação (realpathSync.native): no NTFS,
// `ENV~1` (nome curto 8.3), `.env::$DATA` (stream), `.env.` e `AGENTS.MD` são o
// mesmo arquivo que `.env` e `AGENTS.md` (conferido em 2026-10-21). Leitura pelo
// Bash ou pelo PowerShell (`cat .env`) não passa por aqui: é do guardar-comandos.mjs.
//
// Falha aberta de propósito: entrada que não dá para ler sai sem decidir, e a
// permissão normal do Claude Code segue valendo. Bloqueio vira "deny" com o
// motivo, que o modelo lê.
import { readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { globAlcancaEnv } from "./glob-env.mjs";

let entrada;
try {
  entrada = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const ferramenta = entrada?.tool_name ?? "";
const parametros = entrada?.tool_input ?? {};
const raiz = process.env.CLAUDE_PROJECT_DIR || entrada?.cwd || process.cwd();

function negar(motivo) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: motivo,
      },
    }),
  );
  process.exit(0);
}

const motivoEnv = (nome) =>
  `${nome} guarda segredos e não é lido nem editado pelo Claude (CLAUDE.md, seção 6). ` +
  "Para conferir uma variável, rode um script que imprima só se ela está definida, nunca o valor. " +
  "Mudança no .env é com o usuário.";

const ehEnv = (nome) => /^\.env(\..*)?$/i.test(nome) && !/^\.env\.example$/i.test(nome);

// Caminho real no disco. Arquivo que ainda não existe (Write novo) fica como veio,
// sem o sufixo de stream (":$DATA") e sem ponto ou espaço no fim, que o Windows
// descarta.
function canonico(caminho) {
  try {
    return realpathSync.native(caminho);
  } catch {
    return caminho.replace(/(?<=[^\\/:]):[^\\/]*$/, "").replace(/[. ]+$/, "");
  }
}

if (ferramenta === "Grep" && typeof parametros.glob === "string" && globAlcancaEnv(parametros.glob)) {
  negar(
    `O glob "${parametros.glob}" alcança o .env: no ripgrep o glob passa por cima do .gitignore. ` +
      "Busque sem glob ou com um glob de extensão (por exemplo *.ts).",
  );
}

const alvo =
  parametros.file_path ?? parametros.notebook_path ?? (ferramenta === "Grep" ? parametros.path : undefined);
if (!alvo || typeof alvo !== "string") process.exit(0);

const real = canonico(resolve(raiz, alvo));
const nome = basename(real);

// Segredos: vale dentro e fora do projeto.
if (ehEnv(nome)) negar(motivoEnv(nome));

const edita = ferramenta !== "Read" && ferramenta !== "Grep";
if (edita) {
  const rel = relative(canonico(resolve(raiz)), real).split(sep).join("/");
  const dentro = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  const gerenciados = [
    [/^\.git\//i, "o Git"],
    [/(^|\/)node_modules\//i, "o npm"],
    [/^\.next\//i, "o build do Next"],
    [/^package-lock\.json$/i, "o npm (use npm install/uninstall, com aprovação)"],
    [/^tsconfig\.tsbuildinfo$/i, "o tsc"],
    [/^next-env\.d\.ts$/i, "o Next"],
    [/^AGENTS\.md$/i, "o `next dev` (bloco gerenciado; instruções do projeto vão no CLAUDE.md)"],
  ];
  if (dentro) {
    for (const [padrao, dono] of gerenciados) {
      if (padrao.test(rel)) negar(`${rel} é gerado ou gerenciado por ${dono}; não se edita à mão.`);
    }
  }
}

process.exit(0);
