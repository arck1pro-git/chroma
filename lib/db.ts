// Cliente Postgres (Supabase) via postgres.js. `sql` é tagged-template com
// parâmetros escapados — nunca interpole string na query.
//
//   const linhas = await sql`SELECT * FROM contatos WHERE id = ${id}`;
//
// Init PREGUIÇOSO de propósito: o cliente só nasce na primeira query, não no
// import — assim `next build` não quebra por falta de DATABASE_URL.
//
// prepare:false porque a DATABASE_URL aponta pro pooler de TRANSAÇÃO do Supabase
// (porta 6543), que é pgbouncer e não suporta prepared statements.
import postgres from "postgres";

type Cliente = ReturnType<typeof postgres>;

// Tipo permissivo do `sql` exportado: como tagged-template resolve pra any[]
// (igual o driver anterior fazia), então os `as Tipo[]` nos dados.ts seguem
// válidos. Os utilitários (unsafe/end/array…) ficam disponíveis pelo index.
type SqlPermissivo = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<any[]>) & { [k: string]: any };

let cliente: Cliente | null = null;

function conectar(): Cliente {
  if (!cliente) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não definida no ambiente");
    cliente = postgres(url, {
      ssl: "require",
      // Config canônica pro POOLER DE TRANSAÇÃO do Supabase (6543):
      //  · prepare:false     → pgbouncer transaction mode não guarda prepared stmts
      //  · fetch_types:false → sem a query extra de tipos que, com várias queries
      //    concorrentes (Promise.all), deadlockava o pool e pendurava a rota
      prepare: false,
      fetch_types: false,
      // ≥ maior lote concorrente (as páginas fazem Promise.all de ~11 queries).
      // Com poucas conexões o postgres.js empilha queries na mesma conexão e o
      // pooler de transação deadlockava. Uma conexão por query concorrente evita.
      max: 12,
      idle_timeout: 20, // fecha ociosa rápido
      connect_timeout: 15, // não pendura pra sempre se a conexão falhar
    });
  }
  return cliente;
}

// Fachada que encaminha tanto o uso como tagged-template (sql`...`) quanto os
// utilitários (sql.unsafe, sql.end, ...) pro cliente real, criado sob demanda.
export const sql = new Proxy((() => {}) as unknown as SqlPermissivo, {
  apply(_alvo, _this, args: unknown[]) {
    return (conectar() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_alvo, prop) {
    const real = conectar() as unknown as Record<PropertyKey, unknown>;
    const valor = real[prop];
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
}) as SqlPermissivo;


/**
 * Passa uma lista de uuids para o SQL. Use assim:
 *
 *   WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[])
 *
 * POR QUE NÃO `= ANY(${ids}::uuid[])`, que é o jeito natural: não funciona com
 * esta conexão. Com `prepare:false` + `fetch_types:false` (obrigatórios no
 * pooler de transação, ver acima) o postgres.js não tem o OID do elemento e
 * manda o array como texto solto — o Postgres responde "malformed array
 * literal". `sql.array()` falha do mesmo jeito, por outro caminho
 * ("op ANY/ALL requires array on right side").
 *
 * Aqui o parâmetro é UMA string, que é o que o driver sabe mandar, e quem monta
 * o array é o Postgres. Continua sendo parâmetro — nada é interpolado no SQL —,
 * então não abre espaço para injeção, e o índice do uuid segue sendo usado.
 *
 * A lista vazia devolve '' e string_to_array('', ',') é um array vazio: o ANY
 * não casa com nada, que é a resposta certa para "nenhum id".
 */
export function listaUuid(ids: string[]): string {
  return ids.join(",");
}
