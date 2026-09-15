// A única parte do módulo de Blog que precisa do banco para decidir um campo.
//
// POR QUE NÃO ESTÁ EM lib/artigo.ts: aquele arquivo é importado pelo painel do
// artigo, que é componente de cliente. Uma linha de `import { sql }` lá dentro
// arrastaria o driver do Postgres (net/tls) para o bundle do navegador e o
// build quebraria em "module not found: net" — a mesma armadilha que separa
// lib/contextos-tipos.ts de lib/contextos.ts.
import { sql } from "@/lib/db";
import { slugify } from "@/lib/artigo";

/**
 * Devolve um slug livre DENTRO do blog: "titulo", senão "titulo-2", "titulo-3"…
 *
 * O índice único é (blog_id, slug), então dois blogs podem ter o mesmo slug —
 * o mesmo blog não. Sem isto, salvar o segundo artigo com o mesmo título
 * estouraria violação de unicidade na cara do usuário.
 *
 * `ignorarId` é o que faz o critério de aceite 3 valer: ao salvar um artigo sem
 * mudar o título, ele não colide consigo mesmo e o slug NÃO ganha sufixo.
 */
export async function slugLivre(
  blogId: number,
  desejado: string,
  ignorarId?: number,
): Promise<string> {
  const base = slugify(desejado) || "artigo";
  const padrao = `${base}-%`;

  // Uma consulta só, com os candidatos que podem colidir. `base` é slugificado
  // (só a-z, 0-9 e hífen), então não carrega curinga de LIKE.
  const linhas = ignorarId
    ? await sql`
        SELECT slug FROM artigo
        WHERE blog_id = ${blogId} AND id <> ${ignorarId}
          AND (slug = ${base} OR slug LIKE ${padrao})`
    : await sql`
        SELECT slug FROM artigo
        WHERE blog_id = ${blogId}
          AND (slug = ${base} OR slug LIKE ${padrao})`;

  const usados = new Set(linhas.map((l) => l.slug as string));
  if (!usados.has(base)) return base;

  // Limite = quantos slugs existem + 2: com N ocupados, algum entre 2 e N+2
  // está necessariamente livre. É o que impede laço infinito se algo escapar.
  for (let n = 2; n <= usados.size + 2; n++) {
    const tentativa = `${base}-${n}`;
    if (!usados.has(tentativa)) return tentativa;
  }
  return `${base}-${Date.now()}`;
}
