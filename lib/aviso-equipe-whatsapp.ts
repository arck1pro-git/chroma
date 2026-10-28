// O aviso à equipe pelo WhatsApp (uazapi): um texto curto para alguém do time,
// saindo de um número nosso. Duas origens:
//   · a IA de atendimento (lib/ia/atendente.ts, avisarNoWhatsApp): pediu gente,
//     marcou reunião. Sai pelo MESMO número da conversa, com o texto dela;
//     daqui ela usa só o envio (enviarAvisoPelaInstancia).
//   · o bloco "Avisar a equipe" das campanhas (lib/campanhas-fluxo.ts): sai
//     pela instância escolhida no bloco e junta numa mensagem só o que cada
//     pessoa tem para saber naquela rodada (avisarEquipeNoWhatsApp).
//
// Não passa por lib/conversa-envio.ts de propósito: aviso não é mensagem de uma
// conversa do CRM. Sai com o track_id de aviso (RASTREIO_AVISO), que o webhook
// da uazapi descarta no eco, e pela trava de ambiente (WHATSAPP_SO_PARA), que
// enviarTexto aplica antes de ir à rede.
//
// O QUE O AVISO DA CAMPANHA LEVA (revisão de segurança do desenho, 2026-10-27):
// o texto de quem montou o bloco, o nome do contato normalizado e o link da
// conversa. Nunca telefone, e-mail ou o que o contato respondeu: o aviso sai do
// CRM e fica no WhatsApp de quem recebeu.
//
// A INSTÂNCIA COMPARTILHADA COM O SPRINTHUB não manda aviso de campanha. A
// tabela instancias_uazapi não tem marca de "compartilhada" (2026-10-27): por
// ora ela é reconhecida pelo número (NUMEROS_COMPARTILHADOS), até ele decidir
// onde essa marca mora.
import "server-only";
import { listaUuid, sql } from "@/lib/db";
import { enviarTexto, instanciasPorId, type Instancia } from "@/lib/uazapi";
import { soDigitos } from "@/lib/telefone";
import { linkDaConversa } from "@/lib/link-do-crm";
import { nomeParaAviso } from "@/lib/ia/aviso-demanda";
import { ehUuid } from "@/lib/validacao";
// Os limites moram no módulo puro, porque a tela confere o bloco enquanto se monta.
import { LIMITE_AVISO } from "@/lib/campanhas-fluxo-envios";

/**
 * track_id dos avisos à equipe. Com ele o eco volta marcado como nosso
 * (track_source) e o webhook o descarta; sem ele, o aviso virava uma conversa
 * do CRM com quem foi avisado, como se alguém tivesse escrito pelo celular. Não
 * é id de mensagem, então o webhook não casa com linha nenhuma.
 */
export const RASTREIO_AVISO = "aviso-responsavel";

/**
 * Os números das instâncias que não são só do CRM. Hoje um: a arckwpp
 * ("Fernanda | Arck1Pro"), cujo webhook alimenta o SprintHub em produção
 * (conferido por GET /webhook em 2026-09-03). Provisório: se o número dela
 * mudar, ou outra instância passar a ser dividida, isto não percebe sozinho.
 */
const NUMEROS_COMPARTILHADOS = ["554791458708"];


const fim8 = (numero: string) => soDigitos(numero).slice(-8);
const ehCompartilhada = (numero: string) => NUMEROS_COMPARTILHADOS.some((n) => fim8(n) === fim8(numero));

/**
 * As instâncias que podem mandar aviso de campanha: WhatsApp Web (uazapi), com
 * número pareado e fora da lista das compartilhadas. Sem token: é o que a tela
 * do bloco oferece.
 */
export async function instanciasParaAviso(): Promise<Array<{ id: string; nome: string }>> {
  const linhas = (await sql`
    SELECT id, nome, numero FROM instancias_uazapi
     WHERE tipo = 'web' AND nullif(numero, '') IS NOT NULL
     ORDER BY data_criacao`) as unknown as Array<{ id: string; nome: string; numero: string }>;
  return linhas.filter((l) => !ehCompartilhada(l.numero)).map(({ id, nome }) => ({ id, nome }));
}

/**
 * Manda um aviso a alguém da equipe pela instância dada. Lança no erro (trava
 * de ambiente, uazapi fora do ar): quem chama decide o que registrar.
 */
export async function enviarAvisoPelaInstancia(instancia: Instancia, whatsapp: string, texto: string): Promise<void> {
  // enviarTexto confere a trava de ambiente (conferirDestino) antes de ir à rede.
  await enviarTexto(soDigitos(whatsapp), texto, instancia, RASTREIO_AVISO);
}

/** Uma linha do aviso da campanha: o que aconteceu e com quem. */
export type LinhaDoAviso = {
  /** O texto de quem montou o bloco. */
  texto: string;
  /** O nome do contato como está no cadastro; sai normalizado. */
  nome: string | null;
  /** A conversa do contato, para o link; null = sem link. */
  atendimentoId: string | null;
};

/** Uma linha só, sem caractere de controle, com teto. */
function umaLinha(bruto: string, maximo: number): string {
  const linha = bruto.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim();
  return linha.length > maximo ? `${linha.slice(0, maximo - 1)}…` : linha;
}

/**
 * O nome pela mesma normalização do aviso por demanda (uma linha, sem link,
 * com teto). Contato salvo sem nome costuma ter o telefone no lugar: com
 * sequência de dígitos ou @, o nome não vai.
 */
function nomeDoContato(bruto: string | null): string {
  const nome = nomeParaAviso(bruto);
  return /@|\d{4,}/.test(nome) ? "nome omitido (parecia telefone ou e-mail)" : nome;
}

function textoDoAviso(linhas: LinhaDoAviso[]): string {
  const visiveis = linhas.slice(0, LIMITE_AVISO.linhas).map((l) => {
    const texto = umaLinha(l.texto, LIMITE_AVISO.texto) || "Aviso da campanha";
    const link = l.atendimentoId && ehUuid(l.atendimentoId) ? ` ${linkDaConversa(l.atendimentoId)}` : "";
    return `• ${texto}: ${nomeDoContato(l.nome)}${link}`;
  });
  const resto = linhas.length - visiveis.length;
  return [
    linhas.length > 1 ? "🔔 Avisos do AmaanOffice" : "🔔 Aviso do AmaanOffice",
    "",
    ...visiveis,
    ...(resto > 0 ? [`… e mais ${resto}.`] : []),
  ].join("\n");
}

const motivoDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * Avisa no WhatsApp quem está em `usuarioIds` (só ativos e com WhatsApp no
 * cadastro): UMA mensagem por pessoa juntando as `linhas`, pela instância
 * `instanciaId`, que precisa estar em instanciasParaAviso. Nunca lança: devolve
 * quantos receberam e, em `falhas`, uma frase por quem não recebeu, para o
 * registro da campanha.
 */
export async function avisarEquipeNoWhatsApp(aviso: {
  instanciaId: string;
  usuarioIds: string[];
  linhas: LinhaDoAviso[];
}): Promise<{ enviados: number; falhas: string[] }> {
  try {
    if (!aviso.linhas.length) return { enviados: 0, falhas: [] };
    const falhas: string[] = [];
    const todos = [...new Set(aviso.usuarioIds.filter(ehUuid))];
    if (!todos.length) return { enviados: 0, falhas: ["ninguém para avisar"] };
    const ids = todos.slice(0, LIMITE_AVISO.destinatarios);
    if (todos.length > ids.length) falhas.push(`${todos.length - ids.length} pessoa(s) acima do limite de ${LIMITE_AVISO.destinatarios} por aviso`);

    const permitida = ehUuid(aviso.instanciaId) && (await instanciasParaAviso()).some((i) => i.id === aviso.instanciaId);
    const instancia = permitida ? (await instanciasPorId()).get(aviso.instanciaId) : undefined;
    if (!instancia) {
      return { enviados: 0, falhas: ["o número escolhido não manda aviso (removido, sem WhatsApp pareado ou compartilhado com o SprintHub)"] };
    }

    const pessoas = (await sql`
      SELECT id, nome, nullif(whatsapp, '') AS whatsapp FROM usuarios
       WHERE id = ANY(string_to_array(${listaUuid(ids)}, ',')::uuid[]) AND ativo
       ORDER BY nome`) as unknown as Array<{ id: string; nome: string; whatsapp: string | null }>;
    const fora = ids.length - pessoas.length;
    if (fora > 0) falhas.push(`${fora} pessoa(s) inativa(s) ou removida(s)`);

    const texto = textoDoAviso(aviso.linhas);
    const resultados = await Promise.all(
      pessoas.map(async (p) => {
        if (!p.whatsapp) return `${p.nome}: sem WhatsApp no cadastro`;
        try {
          await enviarAvisoPelaInstancia(instancia, p.whatsapp, texto);
          return null;
        } catch (e) {
          console.error("[aviso equipe] não saiu:", p.nome, motivoDe(e));
          return `${p.nome}: ${motivoDe(e)}`;
        }
      }),
    );
    falhas.push(...resultados.filter((r): r is string => r !== null));
    return { enviados: resultados.filter((r) => r === null).length, falhas };
  } catch (e) {
    console.error("[aviso equipe] falhou antes de enviar:", aviso.instanciaId, motivoDe(e));
    return { enviados: 0, falhas: [motivoDe(e)] };
  }
}
