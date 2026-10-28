import { NextRequest } from "next/server";
import { podeOperar } from "@/lib/auth/permissoes";
import { ehUuid } from "@/lib/validacao";
import { lerCorpoJson, pedidoDaExtensao, responder } from "@/lib/reunioes-extensao";
import { escopoDoLead, salvarResumoNaFicha } from "@/lib/reunioes-lead";

// O fim da reunião na extensão: o resumo que o vendedor revisou no painel vira
// UMA anotação na ficha do lead, com ele como autor (lib/reunioes-lead.ts,
// salvarResumoNaFicha). Só quando ele pede (botão "Salvar na ficha"), nunca
// sozinho. Criar anotação pede a mesma operação da ficha
// (app/contatos/actions.ts, adicionarAnotacao): "criar" em Dashboard ou Contatos.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const acesso = await pedidoDaExtensao(req, "encerrar", "json");
  if (acesso instanceof Response) return acesso;
  const { usuario } = acesso;
  if (!escopoDoLead(usuario) || (!podeOperar(usuario, "inicio", "criar") && !podeOperar(usuario, "contatos", "criar"))) {
    return responder({ erro: "Sem permissão para criar anotação." }, 403);
  }

  const corpo = await lerCorpoJson(req);
  if (!corpo) return responder({ erro: "Corpo inválido." }, 400);
  const contatoId = String(corpo.contato_id ?? "");
  const sessao = String(corpo.sessao ?? "");
  const resumo = typeof corpo.texto === "string" ? corpo.texto.trim().slice(0, 3500) : "";
  const consentimentoEm = new Date(String(corpo.consentimento_em ?? ""));
  if (!ehUuid(contatoId) || !ehUuid(sessao)) return responder({ erro: "Reunião inválida." }, 400);
  if (!resumo) return responder({ erro: "Escreva o resumo." }, 400);
  if (Number.isNaN(consentimentoEm.getTime())) return responder({ erro: "Falta a confirmação do aviso de gravação." }, 400);

  const r = await salvarResumoNaFicha({ contatoId, autor: { id: usuario.id, nome: usuario.nome }, resumo, sessao, consentimentoEm });
  if (r === "sem-contato") return responder({ erro: "Lead não encontrado." }, 404);
  return responder({ ok: true, jaSalvo: r === "ja-salvo" });
}
