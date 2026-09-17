// As auditorias que podem orientar um blog.
//
// "Auditoria" aqui É UM CONTEXTO (lib/contextos.ts): o bloco de prompt que o
// projeto guarda para orientar a IA. O módulo de Blog fala em "auditoria"
// porque é o vocabulário da tela — quem orienta a linha editorial —, mas a
// tabela por trás é `contextos`, e não uma segunda entidade de prompt.
//
// Devolve TODOS os ligados, sem filtro de categoria: o contexto não declara
// onde se aplica. Quem escolhe é esta interface — o blog aponta para um deles
// no cadastro, e o prompt de geração já traz a seção que manda transpor a
// lógica editorial para formato de artigo mesmo que o bloco tenha sido escrito
// pensando em outro canal.
import { sql } from "@/lib/db";
import { exigirModuloApi } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessao = await exigirModuloApi("blog");
  if (sessao instanceof Response) return sessao;
  const linhas = await sql`
    SELECT id, nome FROM contextos
    WHERE ativo
    ORDER BY ordem, lower(nome)`;

  return Response.json(linhas);
}
