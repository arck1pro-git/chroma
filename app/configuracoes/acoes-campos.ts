"use server";

// Mutações dos campos personalizados de contato e oportunidade.
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

// ── Campos personalizados ────────────────────────────────────────────────────
// A `chave` é derivada do rótulo e NUNCA muda depois de criada: é ela que
// indexa o valor dentro do jsonb de contatos/oportunidades. Renomear a chave
// órfãnaria todo valor já gravado — por isso só o rótulo é editável.
function chaveDe(rotulo: string) {
  return rotulo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function revalidarCampos() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/");
  revalidatePath("/chat");
}

// "um, dois , três" -> "um,dois,três". O string_to_array do Postgres não apara
// espaço, e sem isso a opção guardada vira " dois", que nunca casa com o que a
// tela mostra.
function listaDeOpcoes(bruto: string) {
  return bruto
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .join(",");
}

// Vem da tela como "a, b, c"; no banco é text[]. string_to_array faz a
// conversão no servidor — passar array JS por parâmetro não é confiável aqui
// (fetch_types:false desliga a inferência de tipo do driver).
export async function criarCampoPersonalizado(
  entidade: "contato" | "oportunidade",
  rotulo: string,
  tipo: string,
  opcoes: string,
): Promise<ResultadoAcao<{ id: string }>> {
  await exigirModulo("configuracoes", "criar");
  const r = rotulo.trim();
  if (!r) return { ok: false, erro: "Rótulo é obrigatório" };
  const chave = chaveDe(r);
  if (!chave) return { ok: false, erro: "Rótulo precisa ter ao menos uma letra ou número" };

  return comoResultado(
    async () => {
      const [c] = await sql`
        INSERT INTO campos_personalizados (entidade, chave, rotulo, tipo, opcoes, ordem)
        VALUES (
          ${entidade}, ${chave}, ${r}, ${tipo},
          ${tipo === "opcao" && listaDeOpcoes(opcoes)
            ? sql`string_to_array(${listaDeOpcoes(opcoes)}, ',')`
            : sql`NULL`},
          (SELECT COALESCE(MAX(ordem), 0) + 1 FROM campos_personalizados WHERE entidade = ${entidade})
        )
        RETURNING id`;
      revalidarCampos();
      return { id: c.id as string };
    },
    { duplicado: "Já existe um campo com esse nome nesta ficha" },
  );
}

export async function editarCampoPersonalizado(
  id: string,
  rotulo: string,
  tipo: string,
  opcoes: string,
): Promise<ResultadoAcao> {
  await exigirModulo("configuracoes", "editar");
  const r = rotulo.trim();
  if (!r) return { ok: false, erro: "Rótulo é obrigatório" };
  await sql`
    UPDATE campos_personalizados
    SET rotulo = ${r},
        tipo = ${tipo},
        opcoes = ${tipo === "opcao" && listaDeOpcoes(opcoes)
          ? sql`string_to_array(${listaDeOpcoes(opcoes)}, ',')`
          : sql`NULL`}
    WHERE id = ${id}`;
  revalidarCampos();
  return { ok: true };
}

// Só apaga a DEFINIÇÃO. Os valores já gravados continuam no jsonb de cada
// contato/oportunidade — somem da tela, mas voltam se o campo for recriado com
// a mesma chave. Apagar 17 mil valores num clique de tela de configuração é
// estrago grande demais pra ser irreversível.
export async function excluirCampoPersonalizado(id: string): Promise<void> {
  await exigirModulo("configuracoes", "excluir");
  await sql`DELETE FROM campos_personalizados WHERE id = ${id}`;
  revalidarCampos();
}
