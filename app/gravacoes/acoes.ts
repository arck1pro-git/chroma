"use server";

// As gravações do Meet para as telas: a lista inteira (a gaveta "Gravações" da
// Agenda) e o conteúdo de uma (o visor). Servem às duas telas onde reunião
// aparece — a Agenda e a ficha da oportunidade no Dashboard —, então basta ter
// um dos dois módulos.
import { exigirAlgumModulo } from "@/lib/auth/dal";
import { ErroDrive } from "@/lib/google-drive";
import { conteudoDaGravacao, gravacoesDoMeet, type ConteudoDaGravacao, type Gravacao } from "@/lib/gravacoes";

export type ListaDeGravacoes = { ok: true; gravacoes: Gravacao[] } | { ok: false; mensagem: string };

function motivo(e: unknown) {
  console.error("[gravacoes]", e);
  return e instanceof ErroDrive ? e.message : "Não foi possível ler as gravações no Google Drive agora.";
}

export async function listarGravacoes(): Promise<ListaDeGravacoes> {
  await exigirAlgumModulo("agenda", "inicio");
  try {
    return { ok: true, gravacoes: await gravacoesDoMeet() };
  } catch (e) {
    return { ok: false, mensagem: motivo(e) };
  }
}

export type ConteudoPedido = ({ ok: true } & ConteudoDaGravacao) | { ok: false; mensagem: string };

/**
 * O texto de uma gravação (anotações do Gemini, transcrição, chat). Recebe o id
 * da GRAVAÇÃO, não o do arquivo: só sai o que está na pasta do Meet — a conta
 * de serviço enxerga outros Drives, e um id qualquer não pode virar leitura.
 */
export async function conteudoDeGravacao(gravacaoId: string): Promise<ConteudoPedido> {
  await exigirAlgumModulo("agenda", "inicio");
  try {
    const g = (await gravacoesDoMeet()).find((x) => x.id === gravacaoId);
    if (!g) return { ok: false, mensagem: "Essa gravação não está mais na pasta do Meet." };
    return { ok: true, ...(await conteudoDaGravacao(g)) };
  } catch (e) {
    return { ok: false, mensagem: motivo(e) };
  }
}
