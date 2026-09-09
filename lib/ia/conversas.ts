// As conversas com a IA, no banco. Só servidor — quem chama é acoes-ia.ts.
//
// Até aqui o histórico morava no localStorage do navegador; ver
// migration-ia-conversas.sql para o porquê da tabela e do que ela não tem
// (dono: o CRM não tem sessão ainda, então a lista é de todo mundo).
//
// A conversa é gravada INTEIRA a cada troca, porque é inteira que ela é lida:
// o painel manda o histórico junto de cada pergunta. Uma tabela de falas só
// acrescentaria um join sem consumidor.

import { sql } from "@/lib/db";

export type Fala = { papel: "eu" | "ia"; texto: string };

// 42P01 = undefined_table: a migration-ia-conversas.sql ainda não foi rodada.
// Mora aqui e não em acoes-ia.ts porque um arquivo "use server" só pode
// exportar função async — uma constante lá quebra o build do Next.
export const SEM_TABELA =
  "Falta rodar migration-ia-conversas.sql no banco — é ela que cria a tabela ia_conversas. Até lá a conversa funciona, mas não fica salva.";

export function semTabela(e: unknown) {
  return (
    typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01"
  );
}

// A conversa como a LISTA a vê: sem as falas. Carregar o texto de 30 conversas
// para desenhar 30 títulos seria pagar a conversa inteira por linha.
export type ConversaResumo = {
  id: string;
  titulo: string;
  em: string;
  falas: number;
};

export type ConversaCompleta = {
  id: string;
  titulo: string;
  em: string;
  falas: Fala[];
};

// Teto por conversa. Uma conversa de 400 falas não é uso, é laço — e cada
// gravação reescreve a linha toda.
const MAX_FALAS = 200;
const MAX_TEXTO = 8000;

/**
 * Peneira das falas que chegam do navegador.
 *
 * A server action é um POST público (não há sessão), então nada entra no jsonb
 * sem passar por aqui: papel fora do par vira 'eu', texto é cortado, e o que
 * não for objeto some. Sem isto, um corpo forjado grava jsonb arbitrário na
 * linha que a próxima pergunta vai mandar de volta ao modelo.
 */
export function limparFalas(bruto: unknown): Fala[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.slice(-MAX_FALAS).flatMap((f) => {
    const item = f as { papel?: unknown; texto?: unknown };
    const texto = typeof item?.texto === "string" ? item.texto.slice(0, MAX_TEXTO) : "";
    if (!texto) return [];
    return [{ papel: item.papel === "ia" ? ("ia" as const) : ("eu" as const), texto }];
  });
}

export async function listarConversas(escopo: string): Promise<ConversaResumo[]> {
  const linhas = await sql`
    SELECT id, titulo,
           to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em,
           jsonb_array_length(falas) AS falas
    FROM ia_conversas
    WHERE escopo = ${escopo}
    ORDER BY data_atualizacao DESC
    LIMIT 50`;
  return linhas as ConversaResumo[];
}

// A conversa aberta. O escopo entra no WHERE junto do id: sem ele, o painel da
// cadência abriria, por um id chutado, uma conversa do funil.
export async function lerConversa(
  id: string,
  escopo: string,
): Promise<ConversaCompleta | null> {
  const [linha] = await sql`
    SELECT id, titulo, falas,
           to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em
    FROM ia_conversas
    WHERE id = ${id} AND escopo = ${escopo}`;
  if (!linha) return null;
  return {
    id: linha.id as string,
    titulo: linha.titulo as string,
    em: linha.em as string,
    falas: limparFalas(linha.falas),
  };
}

export async function criarConversa(
  escopo: string,
  titulo: string,
  falas: Fala[],
): Promise<ConversaResumo> {
  const [linha] = await sql`
    INSERT INTO ia_conversas (escopo, titulo, falas)
    VALUES (${escopo}, ${titulo}, ${sql.json(falas as never)})
    RETURNING id, titulo,
              to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em,
              jsonb_array_length(falas) AS falas`;
  return linha as ConversaResumo;
}

/**
 * Grava a conversa inteira. Devolve a data nova para a lista reordenar sem
 * precisar de outra consulta.
 *
 * O escopo no WHERE tem o mesmo papel do `lerConversa`: um id de outra lista
 * não é editável por aqui.
 */
export async function gravarFalas(
  id: string,
  escopo: string,
  falas: Fala[],
): Promise<string | null> {
  const [linha] = await sql`
    UPDATE ia_conversas
    SET falas = ${sql.json(falas as never)}, data_atualizacao = now()
    WHERE id = ${id} AND escopo = ${escopo}
    RETURNING to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em`;
  return (linha?.em as string | null) ?? null;
}

export async function apagarConversa(id: string, escopo: string) {
  await sql`DELETE FROM ia_conversas WHERE id = ${id} AND escopo = ${escopo}`;
}


// ── Todas as conversas, de todos os painéis ─────────────────────────────────
//
// É o que a sidebar lista (estilo ChatGPT). Diferente de `listarConversas`, que
// é por escopo: aqui o escopo VEM JUNTO, porque é ele que diz para qual tela o
// clique leva (lib/ia/navegacao.ts).
export type ConversaNaBarra = {
  id: string;
  titulo: string;
  escopo: string;
  em: string;
};

export async function listarTodasConversas(
  limite = 40,
): Promise<ConversaNaBarra[]> {
  const linhas = await sql`
    SELECT id, titulo, escopo,
           to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em
    FROM ia_conversas
    ORDER BY data_atualizacao DESC
    LIMIT ${limite}`;
  return linhas as ConversaNaBarra[];
}
