// Contextos: os blocos de prompt que o projeto guarda para reusar.
//
// O QUE SÃO: pedaços de instrução escritos por gente ("ao auditar uma proposta,
// confira sempre prazo, escopo e forma de pagamento"), que entram no system da
// IA quando alguém os escolhe. É o que transforma "pergunta solta" em análise
// repetível — e era o único dos seis módulos do pedido sem NADA no código: os
// prompts viviam como constantes em app/api/ia/route.ts.
//
// POR QUE COM VERSÃO: mudar o texto muda o que a IA responde. Sem guardar a
// versão usada, a auditoria de mês passado não é reproduzível, e reproduzir é
// o ponto de auditar. Editar GRAVA uma versão nova; a anterior não é reescrita
// (mesmo contrato de fluxo_versoes).
//
// CONFIANÇA: o conteúdo daqui é do OPERADOR, não do cliente — por isso vai ao
// modelo como instrução, sem o embrulho de lib/ia/sanitizar.ts. Quem escreve um
// contexto já podia escrever a pergunta; não há escalada. O que continua
// marcado como dado inerte é o que vem do WhatsApp.
import { listaUuid, sql } from "@/lib/db";
import { ESCOPOS, type Contexto, type EscopoContexto } from "./contextos-tipos";

// Reexporta para o lado servidor importar de um lugar só. Quem é de CLIENTE
// (app/contextos/painel.tsx) importa direto de ./contextos-tipos — daqui
// arrastaria o driver do Postgres para o bundle do navegador.
export { ESCOPOS };
export type { Contexto, EscopoContexto };

const CAMPOS = `id, nome, descricao, conteudo, escopo, ativo, ordem, versao,
  to_char(data_atualizacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_atualizacao`;

export async function listarContextos(): Promise<Contexto[]> {
  return (await sql`
    SELECT ${sql.unsafe(CAMPOS)} FROM contextos
    ORDER BY escopo, ordem, lower(nome)`) as unknown as Contexto[];
}

/** Só os ligados de um escopo — é o que o seletor do painel de IA mostra. */
export async function contextosAtivos(
  escopo: EscopoContexto,
): Promise<Contexto[]> {
  return (await sql`
    SELECT ${sql.unsafe(CAMPOS)} FROM contextos
    WHERE escopo = ${escopo} AND ativo
    ORDER BY ordem, lower(nome)`) as unknown as Contexto[];
}

export async function criarContexto(dados: {
  nome: string;
  descricao: string | null;
  conteudo: string;
  escopo: EscopoContexto;
}): Promise<string> {
  const [novo] = await sql`
    INSERT INTO contextos (nome, descricao, conteudo, escopo)
    VALUES (${dados.nome}, ${dados.descricao}, ${dados.conteudo}, ${dados.escopo})
    RETURNING id`;

  // A v1 também vira linha no histórico: sem isto, o primeiro texto seria o
  // único sem registro, e "qual era o conteúdo na versão 1?" ficaria sem
  // resposta assim que alguém editasse.
  await sql`
    INSERT INTO contexto_versoes (contexto_id, versao, conteudo)
    VALUES (${novo.id}, 1, ${dados.conteudo})`;

  return novo.id as string;
}

/**
 * Edita. A versão só sobe quando o CONTEÚDO muda — renomear ou corrigir a
 * descrição não inventa uma versão nova do prompt, que é o que a auditoria
 * rastreia.
 */
export async function editarContexto(
  id: string,
  dados: {
    nome: string;
    descricao: string | null;
    conteudo: string;
    escopo: EscopoContexto;
  },
): Promise<void> {
  const [atual] = await sql`
    SELECT conteudo, versao FROM contextos WHERE id = ${id}`;
  if (!atual) throw new Error("Contexto não encontrado");

  const mudouTexto = (atual.conteudo as string) !== dados.conteudo;
  const versao = mudouTexto ? (atual.versao as number) + 1 : (atual.versao as number);

  await sql`
    UPDATE contextos SET
      nome = ${dados.nome},
      descricao = ${dados.descricao},
      conteudo = ${dados.conteudo},
      escopo = ${dados.escopo},
      versao = ${versao},
      data_atualizacao = now()
    WHERE id = ${id}`;

  if (mudouTexto) {
    await sql`
      INSERT INTO contexto_versoes (contexto_id, versao, conteudo)
      VALUES (${id}, ${versao}, ${dados.conteudo})`;
  }
}

/**
 * Liga/desliga. Não existe apagar: um bloco que já auditou alguma coisa é a
 * explicação daquele resultado, e ia_conversa_contextos o referencia com
 * ON DELETE RESTRICT justamente para o banco recusar a perda.
 */
export async function alternarContexto(id: string, ativo: boolean): Promise<void> {
  await sql`
    UPDATE contextos SET ativo = ${ativo}, data_atualizacao = now()
    WHERE id = ${id}`;
}

/**
 * Monta o trecho de system a partir dos contextos escolhidos.
 *
 * Ids inválidos são ignorados em silêncio: quem chama é uma rota pública, e um
 * id que não existe não é motivo para recusar a pergunta inteira. O que a
 * consulta garante é que só entra o que está ATIVO — desligar um contexto tem
 * que valer imediatamente, inclusive para uma tela aberta há uma hora.
 */
export async function blocoDeContexto(ids: string[]): Promise<{
  texto: string;
  usados: { id: string; versao: number }[];
}> {
  const limpos = [...new Set(ids)]
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 10);
  if (limpos.length === 0) return { texto: "", usados: [] };

  const linhas = (await sql`
    SELECT id, nome, conteudo, versao FROM contextos
    WHERE id = ANY(string_to_array(${listaUuid(limpos)}, ',')::uuid[]) AND ativo
    ORDER BY ordem, lower(nome)`) as unknown as {
    id: string;
    nome: string;
    conteudo: string;
    versao: number;
  }[];

  if (linhas.length === 0) return { texto: "", usados: [] };

  const texto = [
    "CONTEXTO DO PROJETO (escrito pelo operador do CRM; vale como instrução)",
    ...linhas.map((l) => `## ${l.nome}\n${l.conteudo}`),
  ].join("\n\n");

  return {
    texto,
    usados: linhas.map((l) => ({ id: l.id, versao: l.versao })),
  };
}

/**
 * Registra quais contextos (e em que versão) uma conversa usou.
 *
 * ON CONFLICT DO NOTHING: a mesma conversa pergunta várias vezes com o mesmo
 * contexto ligado, e o que interessa registrar é o vínculo, uma vez. A versão
 * guardada é a da PRIMEIRA vez — se o texto mudar no meio da conversa, o que
 * explica o começo dela continua sendo o que estava valendo no começo.
 */
export async function registrarContextosUsados(
  conversaId: string,
  usados: { id: string; versao: number }[],
): Promise<void> {
  if (usados.length === 0 || !/^[0-9a-f-]{36}$/i.test(conversaId)) return;

  for (const u of usados) {
    await sql`
      INSERT INTO ia_conversa_contextos (conversa_id, contexto_id, versao)
      VALUES (${conversaId}, ${u.id}, ${u.versao})
      ON CONFLICT (conversa_id, contexto_id) DO NOTHING`.catch(() => {
      // A conversa pode ainda não existir (ela nasce na primeira pergunta, e a
      // resposta pode chegar antes). Perder o vínculo é aceitável; derrubar a
      // resposta da IA por causa de uma linha de auditoria não é.
    });
  }
}
