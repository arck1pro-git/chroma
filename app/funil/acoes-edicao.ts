"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { sql } from "@/lib/db";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";

const EDICAO = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").max(200, "Use até 200 caracteres no nome"),
  valor: z.number().min(0, "O valor não pode ser negativo").max(999_999_999_999.99, "Valor acima do limite")
    .multipleOf(0.01, "Use no máximo duas casas decimais no valor"),
});

/** O responsável vem do banco, nunca do formulário ou de uma permissão enviada pelo cliente. */
export async function editarOportunidade(
  id: string,
  dados: { nome: string; valor: number },
): Promise<ResultadoAcao<{ nome: string; valor: number }>> {
  const { usuario, escopo } = await exigirModulo("inicio");
  if (!ehUuid(id)) return { ok: false, erro: "Oportunidade inválida" };
  const entrada = EDICAO.safeParse(dados);
  if (!entrada.success) return { ok: false, erro: entrada.error.issues[0].message };
  const { nome, valor } = entrada.data;
  const podeEditarTodas = escopo === "todos" && podeOperar(usuario, "inicio", "editar");

  // A autorização e a escrita usam a mesma linha bloqueada. Se outro usuário
  // trocar o responsável enquanto se salva, o responsável antigo perde o direito.
  const [gravada] = await sql`
    WITH permitida AS MATERIALIZED (
      SELECT id, contato_id, nome, valor FROM oportunidades
       WHERE id = ${id} AND (responsavel_id = ${usuario.id} OR ${podeEditarTodas})
       FOR UPDATE
    ), alterada AS (
      UPDATE oportunidades o SET nome = ${nome}, valor = ${valor}
        FROM permitida p WHERE o.id = p.id
      RETURNING o.id, o.contato_id, o.nome, o.valor,
                p.nome AS nome_anterior, p.valor AS valor_anterior
    ), registro AS (
      INSERT INTO historico (contato_id, oportunidade_id, descricao, autor_id)
      SELECT contato_id, id,
             concat('Oportunidade atualizada: nome "', nome_anterior, '" → "', nome,
                    '"; valor ', valor_anterior, ' → ', valor), ${usuario.id}
        FROM alterada
       WHERE nome IS DISTINCT FROM nome_anterior OR valor IS DISTINCT FROM valor_anterior
      RETURNING id
    )
    SELECT nome, valor::float8 AS valor FROM alterada`;

  if (!gravada) return { ok: false, erro: "Você não pode editar esta oportunidade ou ela não existe mais" };
  revalidatePath("/");
  revalidatePath("/contatos");
  return { ok: true, nome: gravada.nome as string, valor: gravada.valor as number };
}
