// Hook Stop: antes de encerrar a vez, confere tipos e lint do código alterado.
//
// Só roda quando há arquivo .ts/.tsx/.js/.mjs/.cjs alterado, ou tsconfig.json e
// package.json (git diff HEAD + não rastreados), e esse conjunto ainda não foi
// conferido. A impressão digital do conteúdo fica, com o resultado, num arquivo no
// temp do sistema: o mesmo conjunto não roda de novo, tenha passado ou falhado.
//
// Falhou → bloqueia a parada UMA vez por conjunto, com a saída real, para o Claude
// corrigir ou explicar. O mesmo conjunto falhando de novo (trabalho do usuário ou
// de outra sessão no checkout) só avisa. A segunda tentativa dentro da mesma vez
// (stop_hook_active) também só avisa. Sem laço de correção.
//
// Roda o tsc e o eslint de node_modules direto pelo node, sem npx e sem cmd.exe:
// numa worktree sem node_modules o npx baixaria pacotes do registro, e o cmd.exe
// corta linha de comando acima de 8191 caracteres. Sem node_modules, avisa e sai.
// Os tempos (90 s + 60 s) cabem no timeout de 180 s do settings; se estourar,
// avisa sem bloquear. O git lista com core.quotePath=false e -z, para não perder
// arquivo com acento.
//
// Não roda testes nem build: isso é do /verify.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let entrada = {};
try {
  entrada = JSON.parse(readFileSync(0, "utf8") || "{}") ?? {};
} catch {
  entrada = {};
}

const raiz = process.env.CLAUDE_PROJECT_DIR || entrada.cwd || process.cwd();
const BUFFER = 32 * 1024 * 1024;

function sair(saida) {
  if (saida) process.stdout.write(JSON.stringify(saida));
  process.exit(0);
}
const avisar = (texto) => sair({ systemMessage: texto });

function listar(args) {
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: raiz,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: BUFFER,
  });
  return r.status === 0 ? r.stdout.split("\0").filter(Boolean) : null;
}

const rastreados = listar(["diff", "--name-only", "-z", "HEAD"]);
if (rastreados === null) sair(); // fora de um repositório, ou sem nenhum commit
const novos = listar(["ls-files", "--others", "--exclude-standard", "-z"]) ?? [];
const alterados = [...new Set([...rastreados, ...novos])]
  .filter((f) => !f.startsWith(".claude/") && existsSync(join(raiz, f)))
  .sort();
const codigo = alterados.filter((f) => /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(f));
const configuracao = alterados.filter((f) => f === "tsconfig.json" || f === "package.json");
if (!codigo.length && !configuracao.length) sair();

const tsc = join(raiz, "node_modules", "typescript", "bin", "tsc");
const eslint = join(raiz, "node_modules", "eslint", "bin", "eslint.js");
if (!existsSync(tsc) || !existsSync(eslint)) {
  avisar(
    "Verificação automática pulada: esta pasta não tem node_modules (worktree nova?). " +
      "Rode a skill /verify onde as dependências estiverem instaladas.",
  );
}

const hash = createHash("sha256");
for (const f of [...codigo, ...configuracao]) {
  hash.update(f);
  hash.update(readFileSync(join(raiz, f)));
}
const digital = hash.digest("hex");
const cache = join(
  tmpdir(),
  `chroma-verificacao-${createHash("sha1").update(raiz).digest("hex").slice(0, 12)}.json`,
);
const quantos = codigo.length + configuracao.length;

let anterior = null;
try {
  anterior = JSON.parse(readFileSync(cache, "utf8"));
} catch {
  // sem cache: primeira verificação deste conjunto
}
if (anterior?.digital === digital) {
  if (anterior.ok) sair();
  avisar(
    `Verificação automática: o mesmo conjunto de ${quantos} arquivo(s) continua com erro de tipos ou lint ` +
      "(já reportado). Detalhes com a skill /verify.",
  );
}

const rodar = (script, args, timeout) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: raiz,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    maxBuffer: BUFFER,
  });
const resultadoTsc = rodar(tsc, ["--noEmit", "-p", "."], 90_000);
// Lista muito grande vai como "." (o projeto inteiro), longe do limite do Windows.
const alvosLint = codigo.join(" ").length > 25_000 ? ["."] : codigo;
const resultadoLint = codigo.length
  ? rodar(eslint, ["--no-warn-ignored", "--max-warnings=0", ...alvosLint], 60_000)
  : null;

const naoTerminou = (r) => r && (r.error || r.signal || r.status === null);
if (naoTerminou(resultadoTsc) || naoTerminou(resultadoLint)) {
  const motivo = (r) => r?.error?.code ?? r?.signal ?? "sem código de saída";
  avisar(
    `Verificação automática não terminou (tsc: ${resultadoTsc.status ?? motivo(resultadoTsc)}, ` +
      `eslint: ${resultadoLint ? resultadoLint.status ?? motivo(resultadoLint) : "não rodou"}). ` +
      "Nada foi bloqueado; rode a skill /verify.",
  );
}

const ok = resultadoTsc.status === 0 && (!resultadoLint || resultadoLint.status === 0);
try {
  writeFileSync(cache, JSON.stringify({ digital, ok, quando: new Date().toISOString() }));
} catch {
  // sem cache, a próxima parada só verifica de novo
}
if (ok) avisar(`Verificação automática: tipos e lint ok em ${quantos} arquivo(s) alterado(s).`);

const cortar = (t, max = 4000) => (t.length > max ? `${t.slice(0, max)}\n… (saída cortada)` : t);
const falhas = [
  resultadoTsc.status !== 0
    ? `tsc --noEmit -p . (saída ${resultadoTsc.status}):\n${cortar(`${resultadoTsc.stdout}${resultadoTsc.stderr}`)}`
    : "",
  resultadoLint && resultadoLint.status !== 0
    ? `eslint nos alterados (saída ${resultadoLint.status}):\n${cortar(`${resultadoLint.stdout}${resultadoLint.stderr}`)}`
    : "",
]
  .filter(Boolean)
  .join("\n\n");

if (entrada.stop_hook_active) {
  avisar(`Verificação automática ainda falha depois de uma tentativa de correção. Conferir:\n\n${falhas}`);
}

sair({
  decision: "block",
  reason:
    "A verificação automática (tipos e lint dos arquivos alterados) falhou. Se um subagente seu ainda está " +
    "editando em segundo plano, não corrija nada agora: espere a notificação dele. Se a falha não é desta " +
    "tarefa (trabalho do usuário ou de outra sessão no mesmo checkout), não mexa nesses arquivos: diga isso ao " +
    "usuário com a saída abaixo. Se é desta tarefa, corrija. Este conjunto não volta a bloquear.\n\n" +
    falhas,
});
