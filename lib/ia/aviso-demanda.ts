// O aviso à equipe quando a conversa é do direct do Instagram (2026-10-26,
// revisão de código e de segurança).
//
// Os avisos da IA de atendimento (lib/ia/atendente.ts: reunião marcada e
// pedido de atendimento humano) saem pelo WhatsApp da equipe PELO NÚMERO DA
// CONVERSA. Conversa do Instagram não tem número nosso de WhatsApp, e
// avisarNoWhatsApp recusa de propósito (casaria o id da conta com o fim do
// número de uma instância). Sem isto, a reunião marcada ou o pedido de gente
// no Instagram ficavam sem ninguém saber. Aqui o aviso vira DEMANDA, pela mesma
// criação do conector MCP (lib/demandas.ts), com prazo hoje: aparece na barra
// e na notificação do Windows (app/components/vigia-demandas.tsx).
//
// O texto é fixo e curto: o título, o nome do perfil NORMALIZADO (uma linha,
// sem link, com teto: quem escolheu esse nome foi a própria pessoa no
// Instagram), a data e a hora e o link da conversa. Nada que o modelo escreveu
// entra. Efeito colateral: nunca lança; devolve como ficou, para o histórico.
import "server-only";
import { inserirDemandasParaPessoas } from "@/lib/demandas";
import { linkDaConversa } from "@/lib/link-do-crm";
import { motivoDoErro, NOME_PROVISORIO, temLink } from "@/lib/instagram";
import { ehUuid } from "@/lib/validacao";

const TETO_NOME = 80;

/** O nome do perfil para o aviso: uma linha, sem controle invisível, sem link, até TETO_NOME. */
export function nomeParaAviso(bruto: string | null | undefined): string {
  const linha = (bruto ?? "").replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!linha || linha === NOME_PROVISORIO) return "nome não informado";
  if (temLink(linha)) return "nome omitido (tinha um link)";
  return linha.length > TETO_NOME ? `${linha.slice(0, TETO_NOME - 1)}…` : linha;
}

/** Hoje em Brasília, AAAA-MM-DD (o prazo é data, sem hora). */
function hojeEmBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Uma demanda por pessoa (as que podem receber: ativas, com login e com o
 * módulo Demandas), criada pelo sistema (sem autor). Devolve como ficou.
 */
export async function avisarPorDemanda(e: {
  titulo: string;
  nome: string | null;
  /** A data e a hora que importam: a da reunião, ou a do pedido. */
  quando: string;
  atendimentoId: string;
  pessoaIds: string[];
  prioridade: "normal" | "alta";
}): Promise<string> {
  try {
    const pessoas = [...new Set(e.pessoaIds.filter(ehUuid))];
    if (!pessoas.length) return "ninguém avisado: sem quem receba o aviso";
    const descricao = [
      `Nome no Instagram: ${nomeParaAviso(e.nome)}`,
      `Quando: ${e.quando}`,
      `Conversa: ${linkDaConversa(e.atendimentoId)}`,
    ].join("\n");
    const criadas = await inserirDemandasParaPessoas(
      { titulo: e.titulo, descricao, prazo: hojeEmBrasilia(), prioridade: e.prioridade },
      pessoas,
      null,
    );
    if (!criadas.length) return "ninguém avisado: nenhuma das pessoas pode receber demanda (ativa, com login e com o módulo Demandas)";
    return `demanda criada para ${criadas.map((c) => c.responsavel).join(", ")}`;
  } catch (erro) {
    console.error("[ia aviso] demanda não criada:", e.atendimentoId, motivoDoErro(erro));
    return `demanda não criada: ${motivoDoErro(erro)}`;
  }
}
