// A PORTA DAS ROTAS DO ASSISTENTE DE REUNIÕES (app/api/reunioes/assistente/*),
// que só a extensão do Chrome em extensao-reunioes/ chama. Desenho revisto pela
// auditoria de segurança em 2026-10-28. Quatro conferências, nesta ordem:
//
//   1. ORIGIN EXATO DA EXTENSÃO, e ausente é recusado. O cookie de sessão é
//      SameSite=Lax, e para ele qualquer *.amaan.com.br é "o mesmo site": um
//      script num subdomínio irmão (site, landing page, GTM) mandaria POST com
//      o cookie junto. Route Handler não confere Origin sozinho (só a server
//      action confere). O ID é fixo pela chave pública do manifest.json ("key"):
//      sem ela, cada máquina daria um ID à extensão carregada sem compactação.
//      O ID NÃO autentica a extensão: a chave pública está no repositório, e
//      qualquer extensão carregada com ela tem o mesmo ID. A tranca vale contra
//      página da web (inclusive de subdomínio irmão); quem autentica é a sessão.
//   2. CONTENT-TYPE do que a rota espera: JSON ou multipart. Corpo de outro tipo
//      não passa. (multipart e text/plain dispensam o preflight do navegador; no
//      /trecho, que é multipart, quem barra outro site é o Origin.)
//   3. MÓDULO AGENDA: é o interruptor do assistente. O dado do lead em si pede
//      ainda Dashboard ou Contatos (lib/reunioes-lead.ts).
//   4. FREIO POR PESSOA, em memória, como o do login (app/login/acoes.ts): é
//      best-effort por instância. Existe para um laço na extensão não gastar a
//      Groq e a Anthropic que o atendimento de WhatsApp também usa.
import "server-only";
import { exigirModuloApi, type AcessoAoModulo } from "@/lib/auth/dal";

/** O ID da extensão, derivado da chave pública do manifest.json. Trocou a chave, troca aqui. */
export const ID_EXTENSAO = "eohffkhganngbodiakbkccchdjndkjpf";

type Rota = "inicio" | "leads" | "trecho" | "analise" | "resumo" | "encerrar";

// Chamadas por minuto, por pessoa. Uma reunião normal: dois trechos a cada 15 s
// (8/min) e uma análise por minuto, mais o botão "Analisar agora".
const TETO_POR_MINUTO: Record<Rota, number> = {
  inicio: 10,
  leads: 30,
  trecho: 12,
  analise: 4,
  // O resumo manda a reunião inteira ao modelo: é a chamada mais cara.
  resumo: 1,
  encerrar: 3,
};
const chamadas = new Map<string, number[]>();

function freou(usuarioId: string, rota: Rota): boolean {
  const agora = Date.now();
  const chave = `${usuarioId}:${rota}`;
  const recentes = (chamadas.get(chave) ?? []).filter((t) => agora - t < 60_000);
  if (recentes.length >= TETO_POR_MINUTO[rota]) {
    chamadas.set(chave, recentes);
    return true;
  }
  recentes.push(agora);
  chamadas.set(chave, recentes);
  return false;
}

/** O corpo JSON do pedido, ou null se não é um objeto (lista, número, nulo, texto quebrado). */
export async function lerCorpoJson(req: Request): Promise<Record<string, unknown> | null> {
  const corpo = await req.json().catch(() => null);
  return corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null;
}

/** Resposta JSON que não fica em cache nenhum: leva dado de lead. */
export function responder(dado: unknown, status = 200): Response {
  return Response.json(dado, { status, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Confere que o pedido veio da extensão, com o corpo esperado, de quem tem o
 * módulo Agenda e dentro do freio. Devolve o acesso ou a resposta de recusa.
 */
export async function pedidoDaExtensao(req: Request, rota: Rota, corpo: "json" | "multipart"): Promise<AcessoAoModulo | Response> {
  if (req.headers.get("origin") !== `chrome-extension://${ID_EXTENSAO}`) {
    return responder({ erro: "Origem não permitida." }, 403);
  }
  const tipo = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!tipo.startsWith(corpo === "json" ? "application/json" : "multipart/form-data")) {
    return responder({ erro: "Tipo de corpo não aceito." }, 415);
  }
  const acesso = await exigirModuloApi("agenda");
  if (acesso instanceof Response) return acesso;
  if (freou(acesso.usuario.id, rota)) {
    return responder({ erro: "Muitas chamadas seguidas; espere um instante." }, 429);
  }
  return acesso;
}
