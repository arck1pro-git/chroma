// Hook PreToolUse (Bash, PowerShell): pede aprovação do usuário antes de
// comandos que publicam, descartam alterações, apagam, leem segredo ou mexem no
// banco de produção.
//
// Não bloqueia: devolve "ask", e quem decide é a pessoa. É uma rede de segurança
// por padrão de texto, não uma garantia. Escapam, por exemplo: um script que lê
// process.env.DATABASE_URL_PROD por dentro, um comando montado numa variável e
// executado depois, `git checkout <arquivo>` sem `--`, e `rm` de um arquivo avulso.
// Decisão de 2026-10-21: apagar arquivo avulso é rotina no scratchpad, então só
// `rm` recursivo, `git rm`, `find -delete` e os equivalentes do Windows pedem
// aprovação. As regras que valem de verdade estão no CLAUDE.md, seção 6.
//
// As regras valem igual para o Bash e o PowerShell. No Bash, git push, commit,
// reset --hard, clean, npm install e vercel também estão em permissions.ask
// (.claude/settings.json); aparecem de novo aqui porque a regra de prefixo não
// pega `git -C <pasta> push`, `bash -c '...'` nem comando encadeado.
//
// Regra de SQL só vale quando o comando executa SQL (psql, API do Neon,
// Invoke-WebRequest, curl, node -e, rodar-sql, corpo com "query"): `grep 'DROP
// TABLE'` não pede nada. O host ep-noisy-pond é o banco de produção; ele já é
// público em scripts/testar-meta-eventos.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globAlcancaEnv } from "./glob-env.mjs";

let entrada;
try {
  entrada = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const comando = String(entrada?.tool_input?.command ?? "");
if (!comando.trim()) process.exit(0);
const pasta = entrada?.cwd || process.cwd();
const raiz = process.env.CLAUDE_PROJECT_DIR || pasta;

// `--env-file=.env` carrega as variáveis sem imprimir (é o jeito certo de rodar
// script com o .env), e `--exclude=.env*` tira o arquivo da busca: nenhum dos dois
// conta como menção ao .env.
const semEnvFile = comando.replace(/--env-file=\S+|--exclude=\S+|-Exclude\s+\S+/gi, "");

// git com opções globais antes do subcomando: -C <pasta>, -c chave=valor, --no-pager.
const GIT = String.raw`\bgit(?:\.exe)?(?:\s+(?:-C|-c)\s+\S+|\s+--[\w-]+(?:=\S+)?|\s+-P)*\s+`;
const git = (subcomando, flags = "i") => new RegExp(GIT + subcomando, flags);

const REGRAS = [
  [git("push\\b"), "git push publica no GitHub e dispara o deploy da Vercel"],
  [git("commit\\b"), "commit só com pedido explícito do usuário"],
  [
    git("reset\\b[^;&|]*(?:--hard|--merge|--keep|\\s(?:HEAD|@)[~^]|\\s[0-9a-f]{7,40}\\b|\\sorigin\\/)"),
    "git reset descarta alterações ou move a branch",
  ],
  [git("clean\\b[^;&|]*(?:\\s-[a-zA-Z]*f|--force)"), "git clean apaga arquivos não rastreados"],
  [
    git("restore\\b(?:(?![^;&|]*(?:--staged|\\s-S\\b))|(?=[^;&|]*(?:--worktree|\\s-W\\b)))", ""),
    "git restore descarta alterações locais",
  ],
  [
    git("checkout\\b[^;&|]*(?:\\s--(?:\\s|$)|\\s(?:-f|--force)\\b|\\s\\.(?:\\s|$|[;&|]))"),
    "git checkout com --, -f ou . descarta alterações locais",
  ],
  [git("switch\\b[^;&|]*\\s(?:-f|--force|--discard-changes)\\b"), "git switch forçado descarta alterações locais"],
  [
    git("branch\\b[^;&|]*(?:\\s-D\\b|\\s--delete\\b[^;&|]*\\s(?:--force|-f)\\b|\\s(?:--force|-f)\\b[^;&|]*\\s--delete\\b)", ""),
    "apagar branch à força perde commits que não foram para outra branch",
  ],
  [git("stash\\s+(?:drop|clear)\\b"), "git stash drop/clear apaga alterações guardadas"],
  [git("rm\\b(?![^;&|]*--cached)"), "git rm apaga arquivos do disco"],
  [/(?<!\bgit(?:\.exe)?\s+)\brm\b(?=[^;&|]*\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?:\s|$))/, "rm recursivo apaga pastas"],
  [/\bfind\b[^;&|]*\s(?:-delete\b|-exec\s+rm\b)/, "find -delete apaga arquivos"],
  [/\b(?:Remove-Item|ri|del|erase|rd|rmdir)\b[^;|]*(?:\s-r(?:ec(?:urse)?)?\b|\s\/s\b)/i, "remoção recursiva apaga pastas"],
  [/\bnpm(?:\.cmd)?\s+(?:install|i|uninstall|un|remove|rm|update|up|ci|add|link)\b/i, "npm muda dependências e o lockfile"],
  [/\bnpx(?:\.cmd)?\s+(?:--yes|-y)\b/i, "npx --yes baixa pacote do registro"],
  [/\b(?:playwright|puppeteer)\b[^;&|]*\binstall\b/i, "baixa browser headless"],
  [/(?:^|[;&|(]\s*|\bnpx(?:\.cmd)?\s+(?:(?:--yes|-y)\s+)?)vercel(?:\.cmd)?(?=\s|$)/i, "vercel mexe em deploy ou configuração da produção"],
  [/\b(?:node|jiti|npx)\b[^;&|]*rodar-sql/i, "rodar-sql aplica SQL no banco"],
  [/--env-file=\S+[^;&|]*\s(?:-e|--eval|-p|--print)\b|\s(?:-e|--eval|-p|--print)\b[^;&|]*--env-file=/i, "node -e com --env-file pode imprimir variáveis do .env"],
];

const EXECUTA_SQL =
  /\bpsql\b|neon\.tech|\bInvoke-(?:WebRequest|RestMethod)\b|\b(?:iwr|irm|curl|wget)\b|\bnode(?:\.exe)?\s+(?:[^;&|]*\s)?(?:-e|--eval|-p|--print)\b|rodar-sql|["']query["']\s*:/i;
const SQL_QUE_ESCREVE =
  /\bDELETE\s+FROM\b|\bUPDATE\s+[\w."]+\s+SET\b|\bINSERT\s+INTO\b|\bDROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN|INDEX|VIEW|FUNCTION|TRIGGER|TYPE|CONSTRAINT|ROLE)\b|\bTRUNCATE\b|\bALTER\s+(?:TABLE|SCHEMA|ROLE|DATABASE)\b|\bCREATE\s+(?:TABLE|SCHEMA|INDEX|ROLE|DATABASE)\b/i;
const PRODUCAO = /DATABASE_URL_PROD|ep-noisy-pond/i;
const SO_BUSCA = /^\s*(?:grep|egrep|rg|git\s+(?:log|grep|show|diff|blame)|Select-String|sls|findstr)\b/i;
const ENCADEIA = /[;&]|\|\s*(?:sh|bash|node|psql|iex|Invoke-Expression)\b/i;
const MENCIONA_ENV = /(?:^|[\s"'=:\/\\(<>])\.env(?!\.example\b)(?:\.[\w.-]+)?(?=$|[\s"';|&)<>*?])|\bENV~\d/i;

// Tokens de cada trecho separado por ; & |, sem as aspas.
const trechos = (texto) =>
  texto.split(/[;&|]+/).map((t) => (t.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^(["'])(.*)\1$/, "$2")));

const naRaiz = (caminho) =>
  [".", "./", "*", ".*", "..", "../", "~"].includes(caminho) ||
  resolve(pasta, caminho).toLowerCase() === resolve(raiz).toLowerCase();

// grep -r sem --include que restrinja nem --exclude do .env, numa pasta que contém
// o .env (a raiz: ".", "./", "*", nenhum caminho). `grep -rn x lib` não pede nada.
function grepRecursivoNaRaiz() {
  for (const tokens of trechos(comando)) {
    const i = tokens.findIndex((t) => /^[ef]?grep$/i.test(t));
    if (i < 0 || tokens.slice(0, i).some((t) => /^git(?:\.exe)?$/i.test(t))) continue;
    let recursivo = false;
    let protegido = false;
    let padraoPorOpcao = false;
    const posicionais = [];
    const resto = tokens.slice(i + 1);
    for (let j = 0; j < resto.length; j++) {
      const t = resto[j];
      if (t === "--") {
        posicionais.push(...resto.slice(j + 1));
        break;
      }
      if (!t.startsWith("-") || t === "-") {
        if (!/^\d+$/.test(t)) posicionais.push(t);
        continue;
      }
      if (/^-[a-zA-Z]*[rR]/.test(t) || /^--(?:dereference-)?recursive$/.test(t)) recursivo = true;
      if (/^--include=/.test(t) && !globAlcancaEnv(t.slice("--include=".length))) protegido = true;
      if (/^--exclude=/.test(t) && /\.env/i.test(t)) protegido = true;
      if (/^--(?:regexp|file)=/.test(t)) padraoPorOpcao = true;
      if (/^-[a-zA-Z]*[ef]$/.test(t) || /^--(?:regexp|file)$/.test(t)) {
        padraoPorOpcao = true;
        j++;
      } else if (/^-[ABCm]$|^--(?:max-count|context|after-context|before-context)$/.test(t)) {
        j++;
      }
    }
    if (!recursivo || protegido) continue;
    const caminhos = padraoPorOpcao ? posicionais : posicionais.slice(1);
    if (!caminhos.length || caminhos.some(naRaiz)) return true;
  }
  return false;
}

// rg ignora o .env por padrão (oculto e no .gitignore), mas não com --hidden,
// --no-ignore, -u ou um glob que alcance o .env.
function rgVeEnv() {
  for (const tokens of trechos(comando)) {
    const i = tokens.findIndex((t) => /^rg(?:\.exe)?$/i.test(t));
    if (i < 0) continue;
    const resto = tokens.slice(i + 1);
    for (let j = 0; j < resto.length; j++) {
      const t = resto[j];
      if (/^(?:--hidden|--no-ignore\S*|--unrestricted|-[a-zA-Z]*u[a-zA-Z]*)$/.test(t)) return true;
      const glob = t.match(/^(?:--i?glob(?:=(.*))?|-g(.*))$/);
      if (glob) {
        const valor = glob[1] ?? (glob[2] || resto[++j]);
        if (valor !== undefined && globAlcancaEnv(valor)) return true;
      }
    }
  }
  return false;
}

// Busca recursiva do PowerShell: Get-ChildItem -Recurse não pula arquivo com ponto
// no começo, então Select-String lê o .env.
const buscaRecursivaPowerShell =
  /\b(?:Select-String|sls|findstr)\b/i.test(comando) &&
  /\s-Recurse\b|\s\/s\b/i.test(comando) &&
  !/-Exclude\s+['"]?[^\s'"]*\.env/i.test(comando) &&
  !/-(?:Include|Filter)\s+['"]?\*\.\w/i.test(comando);

const motivos = REGRAS.filter(([padrao]) => padrao.test(comando)).map(([, motivo]) => motivo);
if (SQL_QUE_ESCREVE.test(comando) && EXECUTA_SQL.test(comando)) {
  motivos.push("o comando executa SQL que grava, apaga ou muda o schema");
}
if (PRODUCAO.test(comando) && !(SO_BUSCA.test(comando) && !ENCADEIA.test(comando))) {
  motivos.push("o comando cita o banco de PRODUÇÃO");
}
if (MENCIONA_ENV.test(semEnvFile)) motivos.push("o comando lê ou cita o .env, que guarda segredos");
if (grepRecursivoNaRaiz()) motivos.push("grep recursivo na raiz lê o .env; use --exclude='.env*' ou busque numa subpasta");
if (rgVeEnv()) motivos.push("rg com --hidden, --no-ignore ou glob amplo lê o .env");
if (buscaRecursivaPowerShell) motivos.push("busca recursiva no PowerShell lê o .env; use -Exclude .env* ou -Include *.ts");
if (!motivos.length) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `Precisa da sua aprovação: ${[...new Set(motivos)].join("; ")}.`,
    },
  }),
);
process.exit(0);
