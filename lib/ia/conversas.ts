// As conversas com a IA, no banco. Só servidor — quem chama é acoes-ia.ts.
//
// Até aqui o histórico morava no localStorage do navegador; ver
// migration-ia-conversas.sql para o porquê da tabela.
//
// TODA CONSULTA AQUI FILTRA PELO DONO, e não é só a listagem: ler, gravar e
// apagar levam `usuarioId` no WHERE. Filtrar apenas na lista deixaria a conversa
// de outra pessoa acessível por id — o mesmo vazamento, com um passo a mais.
// O id do dono vem SEMPRE da sessão (app/components/acoes-ia.ts), nunca do
// navegador: se viesse do cliente, o filtro seria decorativo.
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
 * A ação exige sessão, mas sessão diz QUEM está falando — não que o corpo do
 * POST seja confiável. Então nada entra no jsonb sem passar por aqui: papel fora
 * do par vira 'eu', texto é cortado, e o que não for objeto some. Sem isto, um
 * corpo forjado grava jsonb arbitrário na linha que a próxima pergunta vai
 * mandar de volta ao modelo.
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

export async function listarConversas(
  escopo: string,
  usuarioId: string,
): Promise<ConversaResumo[]> {
  const linhas = await sql`
    SELECT id, titulo,
           to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em,
           jsonb_array_length(falas) AS falas
    FROM ia_conversas
    WHERE escopo = ${escopo} AND usuario_id = ${usuarioId}
    ORDER BY data_atualizacao DESC
    LIMIT 50`;
  return linhas as ConversaResumo[];
}

// A conversa aberta. Escopo E dono entram no WHERE junto do id: sem o escopo, o
// painel da cadência abriria por um id chutado uma conversa do funil; sem o
// dono, abriria a conversa de outra pessoa.
export async function lerConversa(
  id: string,
  escopo: string,
  usuarioId: string,
): Promise<ConversaCompleta | null> {
  const [linha] = await sql`
    SELECT id, titulo, falas,
           to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em
    FROM ia_conversas
    WHERE id = ${id} AND escopo = ${escopo} AND usuario_id = ${usuarioId}`;
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
  usuarioId: string,
): Promise<ConversaResumo> {
  const [linha] = await sql`
    INSERT INTO ia_conversas (escopo, titulo, falas, usuario_id)
    VALUES (${escopo}, ${titulo}, ${sql.json(falas as never)}, ${usuarioId})
    RETURNING id, titulo,
              to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em,
              jsonb_array_length(falas) AS falas`;
  return linha as ConversaResumo;
}

/**
 * Grava a conversa inteira. Devolve a data nova para a lista reordenar sem
 * precisar de outra consulta.
 *
 * Escopo e dono no WHERE têm o mesmo papel do `lerConversa`: um id de outra
 * lista, ou de outra pessoa, não é editável por aqui.
 */
export async function gravarFalas(
  id: string,
  escopo: string,
  falas: Fala[],
  usuarioId: string,
): Promise<string | null> {
  const [linha] = await sql`
    UPDATE ia_conversas
    SET falas = ${sql.json(falas as never)}, data_atualizacao = now()
    WHERE id = ${id} AND escopo = ${escopo} AND usuario_id = ${usuarioId}
    RETURNING to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em`;
  return (linha?.em as string | null) ?? null;
}

export async function apagarConversa(
  id: string,
  escopo: string,
  usuarioId: string,
) {
  await sql`
    DELETE FROM ia_conversas
    WHERE id = ${id} AND escopo = ${escopo} AND usuario_id = ${usuarioId}`;
}


// ── Todas as conversas, de todos os painéis ─────────────────────────────────
//
// É o que a sidebar lista (estilo ChatGPT). Diferente de `listarConversas`, que
// é por escopo: aqui o escopo VEM JUNTO, porque é ele que diz para qual tela o
// clique leva (lib/ia/navegacao.ts).
//
// SÓ AS DA PRÓPRIA PESSOA. A barra aparece em todas as telas e juntava as
// conversas de todo mundo — com as perguntas carregando nome de oportunidade e
// valor, era o funil de um departamento visível ao lado do de outro.
export type ConversaNaBarra = {
  id: string;
  titulo: string;
  escopo: string;
  em: string;
};

export async function listarTodasConversas(
  usuarioId: string,
  limite = 40,
): Promise<ConversaNaBarra[]> {
  const linhas = await sql`
    SELECT id, titulo, escopo,
           to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS em
    FROM ia_conversas
    WHERE usuario_id = ${usuarioId}
    ORDER BY data_atualizacao DESC
    LIMIT ${limite}`;
  return linhas as ConversaNaBarra[];
}
