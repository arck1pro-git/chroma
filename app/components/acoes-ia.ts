"use server";

// Toda ação daqui é ponto de entrada de rede: o cliente posta direto nela.
// O proxy já barra quem não tem cookie; esta linha acrescenta o que ele não
// pode conferir sem ir ao banco — se a pessoa ainda existe e ainda está ativa.
import { exigirLogin, usuarioAtual } from "@/lib/auth/dal";

// `exigirLogin` e não `exigirModulo`: estas ações servem a lista de conversas da
// barra lateral, que aparece em TODAS as telas e junta análises feitas em
// módulos diferentes. Prender a um módulo esvaziaria a lista de quem está noutro.
//
// O DONO VEM DAQUI, do retorno de `exigirLogin`, e NUNCA de um parâmetro. É a
// única forma de o filtro valer alguma coisa: server action é POST alcançável
// por quem souber o id da action, então um `usuarioId` vindo do cliente seria
// "me diga de quem você quer ler as conversas". Quem põe o dono no WHERE é
// lib/ia/conversas.ts, em toda consulta — ler, gravar e apagar, não só listar.

// O painel de IA falando com o banco. É a única porta: o componente é de
// cliente e não importa lib/db.ts.
//
// Toda server action continua sendo um POST alcançável por quem souber o id da
// action — o que mudou é que agora ela exige sessão E dono. Nada do que chega
// passa direto ao banco mesmo assim (`limparFalas`, os cortes de texto abaixo):
// sessão diz QUEM é, não diz que o corpo do POST é confiável.
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
  lerConversaPorId,
  limparFalas,
  listarConversas,
  SEM_TABELA,
  semTabela,
  listarTodasConversas,
  type ConversaCompleta,
  type ConversaNaBarra,
  type ConversaResumo,
} from "@/lib/ia/conversas";


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
  const usuario = await exigirLogin();
  try {
    return {
      ok: true,
      dados: await listarConversas(escopoDe(escopo), usuario.id),
    };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui carregar as conversas salvas." };
  }
}

export async function lerConversaIa(
  id: string,
  escopo: string,
): Promise<Resposta<ConversaCompleta | null>> {
  const usuario = await exigirLogin();
  try {
    return {
      ok: true,
      dados: await lerConversa(texto(id, 64), escopoDe(escopo), usuario.id),
    };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui abrir esta conversa." };
  }
}

/** A conversa pelo id, de qualquer escopo do próprio usuário (painel fixo do TI). */
export async function lerConversaIaPorId(
  id: string,
): Promise<Resposta<(ConversaCompleta & { escopo: string }) | null>> {
  const usuario = await exigirLogin();
  try {
    return { ok: true, dados: await lerConversaPorId(texto(id, 64), usuario.id) };
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
  const usuario = await exigirLogin();
  const limpas = limparFalas(falas);
  if (limpas.length === 0) {
    return { ok: false, erro: "Conversa sem nenhuma fala." };
  }
  try {
    const dados = await criarConversa(
      escopoDe(escopo),
      texto(titulo, 120) || "Conversa",
      limpas,
      usuario.id,
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
  const usuario = await exigirLogin();
  try {
    const em = await gravarFalas(
      texto(id, 64),
      escopoDe(escopo),
      limparFalas(falas),
      usuario.id,
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
  const usuario = await exigirLogin();
  try {
    await apagarConversa(texto(id, 64), escopoDe(escopo), usuario.id);
    return { ok: true, dados: null };
  } catch (e) {
    if (semTabela(e)) return { ok: false, erro: SEM_TABELA };
    return { ok: false, erro: "Não consegui apagar a conversa." };
  }
}


/**
 * As conversas que a sidebar lista, de todos os painéis juntos — e SÓ as de
 * quem está logado.
 *
 * Falha em silêncio (lista vazia) em vez de propagar: a sidebar aparece em
 * TODAS as telas, e um banco fora do ar não pode derrubar a navegação do app
 * inteiro por causa de uma lista acessória.
 *
 * SEM SESSÃO, LISTA VAZIA — e não o redirect de `exigirLogin`: o Next segue o
 * redirect da action no cliente, e numa tela pública (o vídeo do lead, a
 * página de envio do conector) isso jogava o visitante na tela de login.
 */
export async function conversasDaBarra(): Promise<ConversaNaBarra[]> {
  const usuario = await usuarioAtual();
  if (!usuario) return [];
  try {
    return await listarTodasConversas(usuario.id);
  } catch {
    return [];
  }
}
