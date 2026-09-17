// Hash de senha. scrypt do node:crypto — não bcrypt/argon2.
//
// POR QUE scrypt E NÃO UMA BIBLIOTECA: bcrypt e argon2 são addons nativos.
// Compilam por plataforma, quebram em serverless e trazem uma dependência de
// build só pra isso. O scrypt do Node é a mesma família de KDF com custo de
// memória (o que derruba ataque por GPU), está na biblioteca padrão e é o que a
// RFC 7914 descreve. O que NÃO serve aqui é SHA-256 puro: é rápido de propósito,
// e rapidez é exatamente o que o atacante quer.
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  senha: string | Buffer,
  sal: Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// N=2^15 é o patamar "interativo" da RFC 7914 (~100ms e ~32MB por hash nesta
// máquina). Subir N dobra memória E tempo — e o tempo é pago no SEU servidor a
// cada login, não só no do atacante.
const N = 32768;
const R = 8;
const P = 1;
const TAMANHO = 32;
// 128 * N * r = 32MiB exatos; o default do Node é 32MiB e estoura por overhead.
const MAXMEM = 96 * 1024 * 1024;

/**
 * Formato guardado: `scrypt$N$r$p$<sal b64>$<hash b64>`.
 *
 * Os parâmetros vão JUNTO do hash de propósito. Quando N subir — e ele sobe, é
 * assim que esse tipo de hash envelhece —, as senhas antigas continuam
 * conferíveis, porque cada linha diz com que custo foi gerada. Guardar só o
 * hash obrigaria a resetar a senha de todo mundo a cada ajuste.
 */
export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(senha.normalize("NFKC"), sal, TAMANHO, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Confere a senha contra o hash guardado. Nunca estoura: entrada malformada,
 * hash de formato desconhecido ou linha sem senha devolvem `false`.
 */
export async function conferirSenha(
  senha: string,
  guardado: string | null | undefined,
): Promise<boolean> {
  if (!guardado) return false;

  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;

  const [, nTexto, rTexto, pTexto, salB64, hashB64] = partes;
  const n = Number(nTexto);
  const r = Number(rTexto);
  const p = Number(pTexto);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  // Teto nos parâmetros LIDOS do banco: sem ele, uma linha adulterada com
  // N gigantesco vira negação de serviço — o processo trava tentando alocar.
  if (n > 1 << 20 || r > 32 || p > 16) return false;

  let esperado: Buffer;
  try {
    esperado = Buffer.from(hashB64, "base64");
    const obtido = await scrypt(
      senha.normalize("NFKC"),
      Buffer.from(salB64, "base64"),
      esperado.length,
      { N: n, r, p, maxmem: MAXMEM },
    );
    // Tempo constante: com `===` o tempo de resposta vaza o prefixo certo.
    return (
      obtido.length === esperado.length && timingSafeEqual(obtido, esperado)
    );
  } catch {
    return false;
  }
}
