// Grava no lead o ID da campanha da Meta, para a atribuição sobreviver à troca
// de nome.
//
// O PROBLEMA: o painel de campanhas e o filtro do quadro casam o lead pelo ID
// (campaign_id, campanha_id, utm_id) e, só na falta dele, pelo NOME
// (utm_campaign). A landing page manda o nome, e quando a campanha é renomeada
// na Meta os leads que já entraram deixam de casar com ela. Foi o que houve com
// "SCP - TOPO DE FUNIL [LEADS][CBO][LP]", renomeada para
// "SCP - TOPO CHECKLIST [LEADS][CBO][LP1]": 33 leads ficaram sem campanha.
//
// A SAÍDA: logo que o lead entra, enquanto o nome ainda é o atual, perguntar à
// Meta qual campanha é e gravar `campaign_id` ao lado do utm_campaign. O ID tem
// prioridade (lib/meta-ads-calculos.ts), então renomear depois não desfaz nada.
//
// Ordem de resolução: anúncio ou conjunto com ID numérico nos campos (a
// campanha deles não muda nunca) → nome exato entre as campanhas das contas de
// anúncio da integração → (desde 2026-10-07) nome do conjunto e do anúncio,
// quando o nome da campanha não é mais o atual: renomeada entre o clique e o
// formulário, ou UTM guardada pela página de uma visita antiga. Foram os dois
// leads que escaparam do carimbo depois que ele entrou no ar. Nome ambíguo ou
// desconhecido não grava nada: chutar uma campanha é pior que deixar sem.
import "server-only";
import { after } from "next/server";
import { sql } from "./db";
import { contasDeAnuncios, listarMeta, requisicao } from "./meta";
import { campanhaPelosNomes, pedidoDeCampanha, resolverOrigem } from "./meta-ads-calculos";
import type { ObjetoAds } from "./meta-ads-tipos";

type Pedido = NonNullable<ReturnType<typeof pedidoDeCampanha>>;

// Campanhas, conjuntos e anúncios das contas, guardados por 10 minutos: não
// vira uma chamada à Meta por lead. Nome que não está na lista força uma
// releitura (campanha criada agora), mas no máximo uma por minuto — lixo de
// UTM não pode martelar a Meta a cada formulário.
const DEZ_MINUTOS = 10 * 60_000, UM_MINUTO = 60_000;
type Peca = { id: string; name: string; campaign_id: string };
type Catalogo = { campanhas: ObjetoAds[]; conjuntos: Peca[]; anuncios: Peca[] };
let cache: { em: number; catalogo: Catalogo } | null = null;

async function catalogo(releitura: boolean): Promise<Catalogo> {
  const idade = cache ? Date.now() - cache.em : Infinity;
  if (cache && idade < (releitura ? UM_MINUTO : DEZ_MINUTOS)) return cache.catalogo;
  const contas = await contasDeAnuncios();
  const porConta = await Promise.all(contas.map((c) => Promise.all([
    listarMeta<ObjetoAds>(`${c.id}/campaigns`, { fields: "id,name", limit: "100" }),
    listarMeta<Peca>(`${c.id}/adsets`, { fields: "id,name,campaign_id", limit: "100" }),
    listarMeta<Peca>(`${c.id}/ads`, { fields: "id,name,campaign_id", limit: "100" }),
  ])));
  cache = {
    em: Date.now(),
    catalogo: {
      campanhas: porConta.flatMap(([c]) => c),
      conjuntos: porConta.flatMap(([, j]) => j),
      anuncios: porConta.flatMap(([, , a]) => a),
    },
  };
  return cache.catalogo;
}

/** Pelo nome da campanha e, na falta, pelos nomes de conjunto e anúncio. "ambiguo" = o nome bate em duas campanhas. */
function resolverNoCatalogo(pedido: Pedido, cat: Catalogo): string | "ambiguo" | null {
  if (pedido.nome) {
    const r = resolverOrigem({ utm_campaign: pedido.nome }, cat.campanhas, "campaign");
    if (r.id) return r.id;
    if (r.motivo === "ambiguas") return "ambiguo";
  }
  return campanhaPelosNomes(pedido, cat.conjuntos, cat.anuncios);
}

/**
 * O ID da campanha deste pedido, ou null. `renomeadas` (nome antigo → ID) é
 * para os leads que entraram antes desta gravação existir, com um nome que a
 * Meta já não tem — ver scripts/carimbar-campanhas.ts.
 */
export async function idDaCampanha(pedido: Pedido, renomeadas?: Map<string, string>): Promise<string | null> {
  for (const id of [pedido.anuncio, pedido.conjunto]) {
    if (!id) continue;
    // Anúncio ou conjunto fora das contas da integração volta erro: segue para
    // o próximo critério em vez de desistir.
    const r = await requisicao<{ campaign_id?: string }>(id, { params: { fields: "campaign_id" } }).catch(() => null);
    if (r?.campaign_id) return r.campaign_id;
  }
  const antigo = pedido.nome ? renomeadas?.get(pedido.nome) : undefined;
  if (antigo) return antigo;
  if (!pedido.nome && !pedido.nomeDoConjunto && !pedido.nomeDoAnuncio) return null;
  let r = resolverNoCatalogo(pedido, await catalogo(false));
  if (r === null) r = resolverNoCatalogo(pedido, await catalogo(true));
  return r === "ambiguo" ? null : r;
}

export type Carimbo = { tabela: "contatos" | "oportunidades"; id: string; nome: string | null; campanhaId: string | null };

/**
 * Resolve e grava `campaign_id` no contato e na oportunidade que têm origem sem
 * ID. Cada um é tratado com os PRÓPRIOS campos, que são os que a atribuição lê
 * (a oportunidade primeiro, o contato na falta dela).
 *
 * O UPDATE repete a condição "sem ID" para não sobrescrever um ID que chegou
 * no meio do caminho, e só ACRESCENTA a chave: utm_campaign fica como veio.
 * Com `gravar: false` só devolve o que faria.
 */
export async function carimbarCampanha(
  alvo: { contatoId: string | null; oportunidadeId: string | null },
  opcoes: { renomeadas?: Map<string, string>; gravar?: boolean } = {},
): Promise<Carimbo[]> {
  const linhas = await sql`
    SELECT 'contatos' AS tabela, id, campos FROM contatos
     WHERE id = ${alvo.contatoId}::uuid AND jsonb_typeof(campos) = 'object'
    UNION ALL
    SELECT 'oportunidades', id, campos FROM oportunidades
     WHERE id = ${alvo.oportunidadeId}::uuid AND jsonb_typeof(campos) = 'object'`;
  const feitos: Carimbo[] = [];
  for (const l of linhas) {
    const pedido = pedidoDeCampanha(l.campos);
    if (!pedido) continue;
    const campanhaId = await idDaCampanha(pedido, opcoes.renomeadas);
    feitos.push({ tabela: l.tabela, id: l.id, nome: pedido.nome, campanhaId });
    if (!campanhaId || opcoes.gravar === false) continue;
    const novo = sql.json({ campaign_id: campanhaId } as never);
    if (l.tabela === "contatos") {
      await sql`UPDATE contatos SET campos = campos || ${novo}
                 WHERE id = ${l.id} AND NOT (campos ?| array['campaign_id', 'campanha_id', 'utm_id'])`;
    } else {
      await sql`UPDATE oportunidades SET campos = campos || ${novo}
                 WHERE id = ${l.id} AND NOT (campos ?| array['campaign_id', 'campanha_id', 'utm_id'])`;
    }
  }
  return feitos;
}

/**
 * O que a captação chama depois de gravar o lead. NÃO ATRASA E NÃO DERRUBA a
 * captação: roda depois da resposta, pelo after() do Next — o formulário não
 * espera a Meta. Fora de uma requisição (script, teste) roda na hora.
 */
export function carimbarCampanhaDoLead(contatoId: string, oportunidadeId: string | null): void {
  const tarefa = async () => {
    try {
      await carimbarCampanha({ contatoId, oportunidadeId });
    } catch (e) {
      console.error(`[campanha-do-lead] contato ${contatoId}:`, e);
    }
  };
  try {
    after(tarefa);
  } catch {
    void tarefa();
  }
}
