// Diz se um glob do ripgrep (o Grep do Claude Code, ou `rg -g`) alcança um arquivo
// `.env*`. Usado por proteger-arquivos.mjs e guardar-comandos.mjs.
//
// No ripgrep o glob passa por cima do .gitignore e dos arquivos ocultos: com
// `-g "*"`, `".*"`, `"**/*"`, `".env*"` ou `"*env*"` ele devolve o conteúdo do .env
// (conferido em 2026-10-21). Glob sem barra casa com o nome do arquivo, como no
// .gitignore. Glob que não dá para entender conta como perigoso; glob de exclusão
// (`!x`) sozinho não inclui nada.
const NOMES = [".env", ".env.local", ".env.bak-20260925-102452"];

function paraRegex(glob) {
  let r = "";
  let chaves = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const comBarra = glob[i + 2] === "/";
        r += comBarra ? "(?:.*/)?" : ".*";
        i += comBarra ? 2 : 1;
      } else {
        r += "[^/]*";
      }
    } else if (c === "?") {
      r += "[^/]";
    } else if (c === "[") {
      const fim = glob.indexOf("]", i + 2);
      if (fim < 0) throw new Error("classe sem fim");
      r += `[${glob.slice(i + 1, fim).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
      i = fim;
    } else if (c === "{") {
      chaves++;
      r += "(?:";
    } else if (c === "}" && chaves) {
      chaves--;
      r += ")";
    } else if (c === "," && chaves) {
      r += "|";
    } else {
      r += c.replace(/[.+^$()|\\{}[\]]/g, "\\$&");
    }
  }
  if (chaves) throw new Error("chave sem fim");
  return new RegExp(`^${r}$`, "i");
}

export function globAlcancaEnv(glob) {
  const g = String(glob ?? "").trim().replace(/\\/g, "/");
  if (!g || g.startsWith("!")) return false;
  let regex;
  try {
    regex = paraRegex(g);
  } catch {
    return true;
  }
  const alvos = g.includes("/") ? NOMES.flatMap((nome) => [nome, `pasta/${nome}`]) : NOMES;
  return alvos.some((alvo) => regex.test(alvo));
}
