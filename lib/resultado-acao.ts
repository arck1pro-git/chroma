// O contrato de retorno das server actions que podem recusar o pedido.
//
// POR QUE NÃO `throw`: em produção o Next troca a mensagem de um erro lançado
// numa Server Function por uma genérica. Conferido em 2026-10-21 com o build
// local: criar uma tag repetida mostrava "Minified React error #441…" em vez de
// "Já existe uma tag com esse nome" (docs/organizacao-do-codigo.md, item 3.1).
// O guia do Next diz o mesmo: erro esperado é valor de retorno
// (node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md).
//
// A DIVISÃO É ESTA:
//   · erro ESPERADO (validação, regra de negócio, nome repetido, serviço externo
//     que recusou) → `{ ok: false, erro }`, com a frase que a pessoa vai ler;
//   · erro INESPERADO (banco fora, bug) → continua sendo lançado: vai para o log
//     do servidor com o digest, e a tela mostra a mensagem genérica dela.
//
// Sem `server-only`: aqui não há segredo nem banco, só o tipo e o conversor.

/**
 * `ResultadoAcao` puro para ação sem retorno; `ResultadoAcao<{ id: string }>`
 * para a que devolve dados — eles vêm ao lado do `ok`, como `r.id`.
 */
export type ResultadoAcao<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; erro: string };

/**
 * Erro esperado, com a mensagem para a pessoa LER. Lance de qualquer função
 * auxiliar dentro de `comoResultado` e ele vira `{ ok: false, erro }` na saída
 * da ação — sem cada auxiliar precisar devolver resultado.
 */
export class Recusa extends Error {}

/** 23505 = violação de índice único (nome repetido, e-mail repetido…). */
export function ehDuplicado(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

type OpcoesResultado = { duplicado?: string };

/**
 * Roda o corpo da ação e converte o erro esperado em valor de retorno.
 *
 * `duplicado` é a frase para quando o banco recusar por índice único — o caso
 * mais comum de recusa que só o banco consegue detectar sem corrida.
 *
 * Qualquer outro erro sobe intacto, inclusive o `redirect()` do Next, que é um
 * erro de controle de fluxo e não pode ser engolido aqui.
 *
 * Duas assinaturas, e não `Promise<T | void>`: com uma só, um corpo que esquece
 * o `return` passaria no typecheck e devolveria `{ ok: true }` sem os dados.
 */
export function comoResultado(
  fazer: () => Promise<void>,
  opcoes?: OpcoesResultado,
): Promise<ResultadoAcao>;
export function comoResultado<T extends object>(
  fazer: () => Promise<T>,
  opcoes?: OpcoesResultado,
): Promise<ResultadoAcao<T>>;
export async function comoResultado(
  fazer: () => Promise<object | void>,
  opcoes: OpcoesResultado = {},
): Promise<ResultadoAcao<object>> {
  try {
    const valor = await fazer();
    return { ok: true, ...(valor ?? {}) };
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.message };
    if (opcoes.duplicado && ehDuplicado(e)) return { ok: false, erro: opcoes.duplicado };
    throw e;
  }
}
