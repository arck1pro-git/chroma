// A base do app de ponto: outro sistema, num projeto à parte do Neon, que o
// módulo Financeiro só LÊ (pedido dele, 2026-11-03). É a única conexão
// postgres() fora de lib/db.ts e lib/ia/db.ts, porque a base não é do CRM.
//
// SÓ LEITURA PELA TRANSAÇÃO: a credencial passada é a dona da base, que pode
// gravar. Toda consulta roda dentro de `lerPonto`, numa transação READ ONLY, e o
// Postgres recusa qualquer escrita lá dentro. Com um papel só de leitura no
// lugar da dona, a trava fica dupla.
//
// O que a base guarda: users (cadastro, com a senha em texto puro: NUNCA ler),
// registros (as batidas in/out com data e hora) e modalidade (presencial ou
// home office por pessoa e dia).
import "server-only";
import postgres from "postgres";

type Conexao = ReturnType<typeof postgres>;
let conexao: Conexao | null = null;

/** A base está configurada neste ambiente? Sem ela, a tela explica em vez de quebrar. */
export function temBasePonto(): boolean {
  return Boolean(process.env.PONTO_DATABASE_URL);
}

function base(): Conexao {
  if (conexao) return conexao;
  const url = process.env.PONTO_DATABASE_URL;
  if (!url) throw new Error("PONTO_DATABASE_URL não definida no ambiente");
  // Pooler do Neon: sem prepared statement e com poucas conexões, como em lib/db.ts.
  conexao = postgres(url, { prepare: false, fetch_types: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  return conexao;
}

/** Roda as consultas numa transação READ ONLY: escrita lá dentro é recusada pelo Postgres. */
export function lerPonto<T>(consultas: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return base().begin("read only", consultas) as Promise<T>;
}
