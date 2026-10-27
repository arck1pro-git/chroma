"use server";

// Mutações de tags e segmentos (Configurações › Tags e Segmentos). A IA cria
// tag e segmento por aqui também (lib/ia/tags-segmentos.ts).
//
// Toda ação aqui é ponto de entrada de rede: o navegador posta direto nela, sem
// passar pela tela. Por isso cada uma começa pela guarda. Erro esperado volta
// como `ResultadoAcao` (lib/resultado-acao.ts), nunca como exceção: em produção
// a mensagem de um erro lançado não chega à tela.
//
// Era um trecho de ./actions.ts, que passou de 1.200 linhas e foi dividido por
// assunto em 2026-10-21 (o mesmo desenho de ./acoes-acessos.ts). O "layout" no
// revalidatePath("/configuracoes") vale para todas: cada seção é uma rota.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { comoResultado, type ResultadoAcao } from "@/lib/resultado-acao";

// ── Tags ─────────────────────────────────────────────────────────────────────
// nome é UNIQUE no schema — nome repetido vira erro amigável (não 500 cru).
function revalidarTags() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

export async function criarTag(nome: string): Promise<ResultadoAcao<{ id: string }>> {
  await exigirModulo("configuracoes", "criar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome da tag é obrigatório" };
  return comoResultado(
    async () => {
      const [t] = await sql`INSERT INTO tags (nome) VALUES (${n}) RETURNING id`;
      revalidarTags();
      return { id: t.id as string };
    },
    { duplicado: "Já existe uma tag com esse nome" },
  );
}

export async function editarTag(id: string, nome: string): Promise<ResultadoAcao> {
  await exigirModulo("configuracoes", "editar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome da tag é obrigatório" };
  return comoResultado(
    async () => {
      await sql`UPDATE tags SET nome = ${n} WHERE id = ${id}`;
      revalidarTags();
    },
    { duplicado: "Já existe uma tag com esse nome" },
  );
}

// CASCADE em contato_tags: apagar a tag tira ela de todos os contatos.
export async function deletarTag(id: string): Promise<void> {
  await exigirModulo("configuracoes", "excluir");
  await sql`DELETE FROM tags WHERE id = ${id}`;
  revalidarTags();
}

// ── Segmentos ────────────────────────────────────────────────────────────────
// Mesma modelagem de tags: nome UNIQUE, CASCADE em contato_segmentos.
function revalidarSegmentos() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
}

export async function criarSegmento(nome: string): Promise<ResultadoAcao<{ id: string }>> {
  await exigirModulo("configuracoes", "criar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome do segmento é obrigatório" };
  return comoResultado(
    async () => {
      const [s] = await sql`INSERT INTO segmentos (nome) VALUES (${n}) RETURNING id`;
      revalidarSegmentos();
      return { id: s.id as string };
    },
    { duplicado: "Já existe um segmento com esse nome" },
  );
}

export async function editarSegmento(id: string, nome: string): Promise<ResultadoAcao> {
  await exigirModulo("configuracoes", "editar");
  const n = nome.trim();
  if (!n) return { ok: false, erro: "Nome do segmento é obrigatório" };
  return comoResultado(
    async () => {
      await sql`UPDATE segmentos SET nome = ${n} WHERE id = ${id}`;
      revalidarSegmentos();
    },
    { duplicado: "Já existe um segmento com esse nome" },
  );
}

export async function deletarSegmento(id: string): Promise<void> {
  await exigirModulo("configuracoes", "excluir");
  await sql`DELETE FROM segmentos WHERE id = ${id}`;
  revalidarSegmentos();
}
