// O NÚMERO SECUNDÁRIO (pedido dele em 2026-10-30; a coluna é
// instancias_uazapi.secundaria_de, em migration-instancia-secundaria.sql):
// quando a principal cai, a secundária assume os envios, e a principal retoma
// quando volta. Decisões dele:
//   · "caiu" é SÓ vermelha, desconectada na uazapi. Amarela (conectando,
//     hibernada) segue pela principal, e a uazapi sem resposta também: trocar
//     no escuro mandaria por outro número sem motivo.
//   · a secundária só assume se ela mesma está verde; senão o envio tenta a
//     principal e falha com o motivo de sempre.
//   · volta sozinha: a escolha é feita a cada envio, então a principal verde de
//     novo volta a enviar. A conversa em que o lead respondeu pela secundária
//     segue nela (é o par secundária + lead, ver lib/conversa-envio.ts).
//
// UM LUGAR SÓ DECIDE, e quem envia pergunta aqui: o envio das conversas (chat,
// IA, retomada, agendadas e campanhas, em lib/conversa-envio.ts), a rota das
// cadências e automações (app/api/automacoes/enviar) e os avisos à equipe.
// Grupo do WhatsApp não troca: a secundária não está no grupo.
//
// O estado vem da mesma lista do chat (lib/uazapi-estado.ts), guardado 30 s em
// memória: uma campanha não pergunta à uazapi a cada mensagem, e o vermelho do
// chat e a troca daqui divergem no máximo o tempo dos dois caches.
import "server-only";
import { sql } from "@/lib/db";
import type { Instancia } from "@/lib/uazapi";
import { buscarInstanciasRemotas, estadoDa, type InstanciaRemota } from "@/lib/uazapi-estado";
import { ehUuid } from "@/lib/validacao";

const VALIDADE_MS = 30_000;
let guardado: { em: number; remotas: InstanciaRemota[] | null } | null = null;

async function remotas(): Promise<InstanciaRemota[] | null> {
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.remotas;
  // Lista vazia é a uazapi sem token de admin no ambiente: vale como "não sei",
  // não como "todas caíram".
  const lista = await buscarInstanciasRemotas().then(
    (l) => (l.length ? l : null),
    () => null,
  );
  guardado = { em: Date.now(), remotas: lista };
  return lista;
}

/** Esquece o estado guardado: o teste troca o estado da uazapi falsa entre um envio e outro. */
export function esquecerEstado() {
  guardado = null;
}

export type Escolha = {
  /** A instância por onde o envio sai: a pedida, ou a secundária dela. */
  instancia: Instancia;
  /** A principal que caiu, quando a secundária assumiu; null quando sai pela pedida. */
  principal: Instancia | null;
};

/**
 * Por qual instância o envio sai agora: a pedida ou, com ela vermelha, a
 * secundária verde dela. A troca é um extra: se a escolha falhar (banco, coluna
 * que ainda não existe), o envio segue pela pedida, como antes dela.
 */
export async function instanciaQueEnvia(pedida: Instancia): Promise<Escolha> {
  return escolher(pedida).catch((e) => {
    console.error("[reserva] não consegui conferir a secundária; o envio segue pela instância pedida:", e);
    return { instancia: pedida, principal: null };
  });
}

async function escolher(pedida: Instancia): Promise<Escolha> {
  const fica: Escolha = { instancia: pedida, principal: null };
  if (!pedida.id || !ehUuid(pedida.id)) return fica;
  const linhas = await sql`
    SELECT id, nome, base_url, token, numero, instancia_uazapi_id, secundaria_de
      FROM instancias_uazapi
     WHERE id = ${pedida.id}
        OR (secundaria_de = ${pedida.id} AND numero IS NOT NULL AND numero <> '')`;
  const propria = linhas.find((l) => l.id === pedida.id);
  const reserva = linhas.find((l) => l.secundaria_de === pedida.id);
  if (!propria || !reserva) return fica;
  const lista = await remotas();
  if (estadoDa(lista, propria) !== "desconectado" || estadoDa(lista, reserva) !== "conectado") return fica;
  console.info(`[reserva] ${propria.nome} está desconectada: o envio sai pela secundária ${reserva.nome}`);
  return {
    instancia: {
      id: reserva.id as string,
      nome: reserva.nome as string,
      baseUrl: reserva.base_url as string,
      token: reserva.token as string,
      numero: (reserva.numero as string | null) ?? null,
    },
    principal: pedida,
  };
}

/**
 * As conversas do mesmo lead nos dois números do par (a principal e a
 * secundária dela), a começar pela pedida. A IA lê o histórico de todas: o que
 * o lead disse pela principal antes da queda e pela secundária depois. Número
 * sem par, grupo ou conversa de outro canal devolve só a pedida, e a consulta
 * que falhar também: a IA responde com a conversa dela, como antes do par.
 */
export async function conversasDoPar(atendimentoId: string): Promise<string[]> {
  if (!ehUuid(atendimentoId)) return [atendimentoId];
  return outrasDoPar(atendimentoId).then(
    (outras) => [atendimentoId, ...outras],
    (e) => {
      console.error("[reserva] não consegui ler as conversas do par; a IA lê só esta:", e);
      return [atendimentoId];
    },
  );
}

async function outrasDoPar(atendimentoId: string): Promise<string[]> {
  const linhas = await sql`
    WITH a AS (
      SELECT contato_id, right(regexp_replace(coalesce(numero_instancia, ''), '\\D', '', 'g'), 8) AS fim8
        FROM atendimentos
       WHERE id = ${atendimentoId} AND contato_id IS NOT NULL AND canal = 'whatsapp'
    ), eu AS (
      SELECT i.id, i.secundaria_de
        FROM instancias_uazapi i, a
       WHERE length(a.fim8) = 8 AND right(regexp_replace(coalesce(i.numero, ''), '\\D', '', 'g'), 8) = a.fim8
       LIMIT 1
    ), par AS (
      SELECT right(regexp_replace(coalesce(i.numero, ''), '\\D', '', 'g'), 8) AS fim8
        FROM instancias_uazapi i, eu
       WHERE i.id = eu.secundaria_de OR i.secundaria_de = eu.id
    )
    SELECT b.id
      FROM atendimentos b, a
     WHERE b.contato_id = a.contato_id
       AND b.canal = 'whatsapp'
       AND b.id <> ${atendimentoId}
       AND right(regexp_replace(coalesce(b.numero_instancia, ''), '\\D', '', 'g'), 8) IN (SELECT fim8 FROM par WHERE length(fim8) = 8)`;
  return linhas.map((l) => l.id as string);
}
