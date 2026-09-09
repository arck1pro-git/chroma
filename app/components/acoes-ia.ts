"use server";

// O painel de IA falando com o banco. É a única porta: o componente é de
// cliente e não importa lib/db.ts.
//
// ⚠ SEM AUTENTICAÇÃO, como o resto do app (docs/automacoes-arquitetura.md
// §3.1): toda server action é um POST público. Aqui isso significa que quem
// souber a URL lê e apaga conversa — e é por isso que nada do que chega passa
// direto ao banco sem peneira (`limparFalas`, os cortes de texto abaixo).
//
// Nenhuma destas ações chama revalidatePath: a lista vive no estado do painel,
// que é client-side. Revalidar a raiz aqui recarregaria o funil inteiro a cada
// mensagem digitada.

// SEM_TABELA e semTabela vivem em lib/ia/conversas.ts, e não aqui, porque um
// arquivo "use server" só pode exportar função async — constante exportada
// daqui quebra o build. O painel continua funcionando sem a tabela (ver
// chat-ia.tsx): a conversa só não fica salva, e a tela diz isso.
import {
  apagarConversa,
  criarConversa,
  gravarFalas,
  lerConversa,
  limparFalas,
  listarConversas,
  SEM_TABELA,
  semTabela,
  listarTodasConversas,
  type ConversaCompleta,
  type ConversaNaBarra,
  type ConversaResumo,
} from "@/lib/ia/conversas";

import { contextosAtivos, ESCOPOS } from "@/lib/contextos";

function texto(v: unknown, max: number) {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

// Escopo é o que separa a lista de um painel da do outro ('funil',
// 'automacoes', 'cadencia:<uuid>'). Vem do componente, não do usuário — cortar
// é só para não gravar lixo se alguém chamar a action na mão.
function escopoDe(v: unknown) {
  return texto(v, 120) || "funil";
}

export type Resposta<T> =
  | { ok: true; dados: T }
  | { ok: false; erro: string };

export async function listarConversasIa(
  escopo: string,
): Promise<Resposta<ConversaResumo[]>> {
  try {
    return { ok: true, dados: await listarConversas(escopoDe(escopo)) };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui carregar as conversas salvas." };
  }
}

export async function lerConversaIa(
  id: string,
  escopo: string,
): Promise<Resposta<ConversaCompleta | null>> {
  try {
    return { ok: true, dados: await lerConversa(texto(id, 64), escopoDe(escopo)) };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui abrir esta conversa." };
  }
}

/**
 * Cria a conversa na PRIMEIRA pergunta, com o título já derivado dela.
 *
 * Nasce aqui e não ao abrir o painel porque, do contrário, a lista encheria de
 * conversas vazias cada vez que alguém abre e desiste.
 */
export async function criarConversaIa(
  escopo: string,
  titulo: string,
  falas: unknown,
): Promise<Resposta<ConversaResumo>> {
  const limpas = limparFalas(falas);
  if (limpas.length === 0) {
    return { ok: false, erro: "Conversa sem nenhuma fala." };
  }
  try {
    const dados = await criarConversa(
      escopoDe(escopo),
      texto(titulo, 120) || "Conversa",
      limpas,
    );
    return { ok: true, dados };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui salvar a conversa." };
  }
}

// Grava a conversa inteira depois de cada resposta. Devolve a data nova, que é
// o que reordena a lista sem uma segunda consulta.
export async function gravarConversaIa(
  id: string,
  escopo: string,
  falas: unknown,
): Promise<Resposta<{ em: string | null }>> {
  try {
    const em = await gravarFalas(
      texto(id, 64),
      escopoDe(escopo),
      limparFalas(falas),
    );
    return { ok: true, dados: { em } };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui salvar esta resposta." };
  }
}

export async function apagarConversaIa(
  id: string,
  escopo: string,
): Promise<Resposta<null>> {
  try {
    await apagarConversa(texto(id, 64), escopoDe(escopo));
    return { ok: true, dados: null };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui apagar a conversa." };
  }
}


// ── Contextos disponíveis para o painel ─────────────────────────────────────
//
// Leitura, mas mora aqui pelo mesmo motivo do resto do arquivo: o painel é
// componente de cliente e não importa lib/db.ts.
//
// Só devolve o que a tela precisa mostrar (id, nome, descrição). O CONTEÚDO do
// bloco fica no servidor: mandá-lo ao navegador não serviria para nada — quem
// monta o system é app/api/ia/route.ts — e só engordaria o payload.
export type ContextoDisponivel = {
  id: string;
  nome: string;
  descricao: string | null;
};

export async function contextosDisponiveis(
  escopo: string,
): Promise<ContextoDisponivel[]> {
  const valido = ESCOPOS.find((e) => e.id === escopo)?.id;
  if (!valido) return [];
  try {
    const lista = await contextosAtivos(valido);
    return lista.map((c) => ({ id: c.id, nome: c.nome, descricao: c.descricao }));
  } catch {
    // Tabela ausente (migration não rodada) ou banco fora: o painel funciona
    // sem contexto nenhum, e é melhor isso que uma tela quebrada.
    return [];
  }
}


/**
 * As conversas que a sidebar lista, de todos os painéis juntos.
 *
 * Falha em silêncio (lista vazia) em vez de propagar: a sidebar aparece em
 * TODAS as telas, e um banco fora do ar não pode derrubar a navegação do app
 * inteiro por causa de uma lista acessória.
 */
export async function conversasDaBarra(): Promise<ConversaNaBarra[]> {
  try {
    return await listarTodasConversas();
  } catch {
    return [];
  }
}
