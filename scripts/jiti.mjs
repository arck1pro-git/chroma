// Roda um .ts do projeto por fora do Next, resolvendo o que o Next resolveria.
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-gsc.ts [args…]
//
// Os scripts antigos chamam o jiti-cli direto e funcionam porque só importam
// arquivos que não usam nada do Next. Quem toca lib/ de verdade esbarra em
// dois muros, e este runner derruba os dois:
//
//   · "@/lib/x"    — o alias do tsconfig, que o jiti não lê sozinho
//   · "server-only" — fora do runtime de servidor do React, o pacote estoura de
//     propósito ("cannot be imported from a Client Component"). O Next resolve
//     pelo arquivo vazio através da condição "react-server"; aqui o apelido faz
//     o mesmo. Passar --conditions=react-server ao node NÃO resolve: o jiti tem
//     resolução própria e ignora a flag.
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const alvo = process.argv[2];
if (!alvo) throw new Error("uso: jiti.mjs <arquivo.ts> [args…]");

// O script alvo lê os próprios argumentos de process.argv[2] em diante, como
// se tivesse sido chamado direto — tirar o nosso daqui é o que permite isso.
process.argv.splice(1, 2, resolve(raiz, alvo));

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": raiz,
    "server-only": resolve(raiz, "node_modules/server-only/empty.js"),
  },
});

await jiti.import(resolve(raiz, alvo));
