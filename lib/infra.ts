// O módulo Infra (app/infra, pedido dele em 2026-11-03): o estado de cada
// serviço de que o CRM depende, com o uso contra o limite quando o serviço deixa
// ler, e o que pede ação. Lido na hora, a cada abertura da tela; as sondas que
// gastam pedido (Anthropic, Groq) ficam guardadas alguns minutos
// (lib/infra-ia.ts).
//
// Cada leitor devolve um cartão. O que falhar ou passar de TETO_MS vira cartão
// "sem leitura" com o motivo, sem derrubar os outros. Os cartões com problema
// vêm primeiro.
import "server-only";
import { cartaoArmazenamento, cartaoBanco } from "@/lib/infra-banco";
import { cartaoAnthropic, cartaoGroq } from "@/lib/infra-ia";
import { cartaoGoogle, cartaoN8n } from "@/lib/infra-integracoes";
import { cartaoWhatsappOficial, cartaoWhatsappWeb } from "@/lib/infra-whatsapp";
import type { CartaoInfra, EstadoInfra } from "@/lib/infra-tipos";

const TETO_MS = 20_000;

const LEITORES: Array<{ chave: string; titulo: string; subtitulo: string; ler: () => Promise<CartaoInfra> }> = [
  { chave: "whatsapp-oficial", titulo: "WhatsApp oficial", subtitulo: "Meta · Cloud API, campanhas e templates", ler: cartaoWhatsappOficial },
  { chave: "whatsapp-web", titulo: "WhatsApp Web", subtitulo: "uazapi · chat do comercial, IA e cadências", ler: cartaoWhatsappWeb },
  { chave: "anthropic", titulo: "IA", subtitulo: "Anthropic · atendimento, copiloto e IAs das telas", ler: cartaoAnthropic },
  { chave: "groq", titulo: "Transcrição de áudio", subtitulo: "Groq · áudio do chat e das reuniões", ler: cartaoGroq },
  { chave: "armazenamento", titulo: "Arquivos", subtitulo: "Neon · Object Storage, documentos, mídias e vídeos", ler: cartaoArmazenamento },
  { chave: "banco", titulo: "Banco de dados", subtitulo: "Neon · Postgres", ler: cartaoBanco },
  { chave: "n8n", titulo: "Automações", subtitulo: "n8n · cadências e agendadores", ler: cartaoN8n },
  { chave: "google", titulo: "Google", subtitulo: "Agenda das reuniões e gravações do Meet", ler: cartaoGoogle },
];

/** O que o módulo não lê sem outra chave: fica no pé da tela, para quem quiser ligar. */
export const SEM_LEITURA = [
  "Vercel (uso das funções e do tráfego): precisa de um token da Vercel.",
  "Gasto da Anthropic em dólar: precisa da chave de admin da Anthropic.",
  "Saldo da Magnific (a voz da IA): a API não tem consulta de saldo.",
  "Cobrança e cotas do plano do Neon (banco e arquivos): precisam do token de gestão do Neon.",
];

const ORDEM: Record<EstadoInfra, number> = { critico: 0, atencao: 1, desconhecido: 2, ok: 3 };

function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<never>((_, falha) => setTimeout(() => falha(new Error(`passou de ${ms / 1000} s sem resposta`)), ms)),
  ]);
}

export async function carregarInfra(): Promise<{ cartoes: CartaoInfra[]; lidoEm: string }> {
  const cartoes = await Promise.all(
    LEITORES.map(async ({ ler, ...base }) => {
      try {
        return await comPrazo(ler(), TETO_MS);
      } catch (e) {
        console.error(`[infra] ${base.chave} sem leitura:`, e);
        // O tempo esgotado do fetch chega em inglês ("TimeoutError").
        const motivo =
          e instanceof Error && e.name === "TimeoutError"
            ? "o serviço não respondeu a tempo"
            : (e instanceof Error ? e.message : String(e)).slice(0, 200);
        return { ...base, estado: "desconhecido" as const, medidas: [], avisos: [`Não consegui ler agora: ${motivo}`], lidoEm: new Date().toISOString() };
      }
    }),
  );
  // sort é estável: dentro do mesmo estado, fica a ordem de LEITORES.
  cartoes.sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado]);
  return { cartoes, lidoEm: new Date().toISOString() };
}
