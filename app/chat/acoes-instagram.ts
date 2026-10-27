"use server";

// Os comentários do Instagram no /chat (2026-10-26): responder, as regras da
// IA, marcar lidos e buscar na Meta o que faltou. A regra mora em
// lib/instagram-comentarios.ts; aqui ficam a guarda, a validação da entrada e
// o revalidatePath.
//
// PERMISSÃO (revisão de segurança, item 13): ler e responder no DIRECT é do
// módulo chat. Responder EM PÚBLICO e ligar ou desligar a IA falam pela marca:
// só quem também tem o módulo meta (Admin e TI). Conferido aqui, na ação; a
// tela só esconde os controles (ComentariosDaConta.podeAdministrar).
//
// A tela manda o uuid da linha de instagram_comentarios, nunca id da Meta: o
// comentário, a conta e o autor saem do banco.
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { podeOperar } from "@/lib/auth/permissoes";
import { paginaDeComentarios } from "@/lib/instagram-leitura";
import type { AutomacaoComentarioInstagram, PaginaComentariosInstagram } from "@/lib/instagram-tipos";
import { comoResultado, type ResultadoAcao } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";
import {
  falaPelaMarca,
  marcarComentariosLidos as marcarLidos,
  responderComentarioPelaEquipe,
  salvarRegraIa,
  sincronizarComentarios as sincronizar,
} from "@/lib/instagram-comentarios";

const SO_ADMIN_TI = "Seu acesso não permite esta operação em nome da marca.";

export async function salvarAutomacaoInstagram(
  contaId: string, midiaId: string | null, iaId: string | null, ligada: boolean, automacao: AutomacaoComentarioInstagram,
): Promise<ResultadoAcao> {
  const { usuario } = await exigirModulo("chat");
  if (!podeOperar(usuario, "chat", "editar") || !falaPelaMarca(usuario)) return { ok: false, erro: SO_ADMIN_TI };
  if (typeof contaId !== "string" || (midiaId !== null && typeof midiaId !== "string") ||
      (iaId !== null && typeof iaId !== "string") || typeof ligada !== "boolean" || !automacao) {
    return { ok: false, erro: "Configuração inválida." };
  }
  const r = await comoResultado(() => salvarRegraIa(contaId, midiaId, iaId, ligada, automacao));
  revalidatePath("/chat");
  return r;
}

/** Responde a um comentário em público (Admin e TI) ou chama a pessoa no direct. */
export async function responderComentario(linhaId: string, texto: string, modo: "publico" | "direct"): Promise<ResultadoAcao> {
  const { usuario } = await exigirModulo("chat");
  if (!podeOperar(usuario, "chat", "criar")) return { ok: false, erro: "Seu acesso permite apenas ler estas mensagens." };
  if (modo !== "publico" && modo !== "direct") return { ok: false, erro: "Escolha como responder." };
  if (modo === "publico" && !falaPelaMarca(usuario, "criar")) return { ok: false, erro: SO_ADMIN_TI };
  if (!ehUuid(linhaId)) return { ok: false, erro: "Comentário não encontrado." };
  if (typeof texto !== "string" || !texto.trim()) return { ok: false, erro: "Escreva a resposta." };
  const r = await comoResultado(() => responderComentarioPelaEquipe(linhaId, texto, modo, usuario.id));
  revalidatePath("/chat");
  return r;
}

/** Liga, desliga ou troca a IA da conta (midiaId null) ou da postagem. iaId null apaga a regra. */
export async function salvarRegraIaInstagram(
  contaId: string,
  midiaId: string | null,
  iaId: string | null,
  ligada: boolean,
): Promise<ResultadoAcao> {
  const { usuario } = await exigirModulo("chat");
  if (!podeOperar(usuario, "chat", "editar") || !falaPelaMarca(usuario)) return { ok: false, erro: SO_ADMIN_TI };
  if (typeof contaId !== "string" || (midiaId !== null && typeof midiaId !== "string")) {
    return { ok: false, erro: "Conta ou postagem inválida." };
  }
  if (typeof ligada !== "boolean") return { ok: false, erro: "Diga se a IA fica ligada." };
  const r = await comoResultado(async () => {
    await salvarRegraIa(contaId, midiaId, iaId, ligada);
    // Quem mexeu fica no log: a regra não tem coluna de autor.
    console.info(
      `[instagram] regra da IA: conta ${contaId}, postagem ${midiaId ?? "todas"}, ` +
        `${iaId === null ? "apagada" : ligada ? "ligada" : "desligada"} por ${usuario.id}`,
    );
  });
  revalidatePath("/chat");
  return r;
}

/** Abriu a postagem = leu os comentários dela. */
export async function marcarComentariosLidos(contaId: string, midiaId: string, ids: string[]): Promise<ResultadoAcao> {
  await exigirModulo("chat");
  if (typeof contaId !== "string" || typeof midiaId !== "string") return { ok: false, erro: "Postagem inválida." };
  const r = await comoResultado(() => marcarLidos(contaId, midiaId, ids));
  revalidatePath("/chat");
  return r;
}

/** "Buscar comentários": grava os comentários recentes da postagem que faltam (sem IA). */
export async function sincronizarComentarios(contaId: string, midiaId: string): Promise<ResultadoAcao<{ novos: number }>> {
  await exigirModulo("chat");
  if (typeof contaId !== "string" || typeof midiaId !== "string") return { ok: false, erro: "Postagem inválida." };
  const r = await comoResultado(() => sincronizar(contaId, midiaId));
  revalidatePath("/chat");
  return r;
}

export async function comentariosAnteriores(contaId: string, midiaId: string, antes: string): Promise<ResultadoAcao<PaginaComentariosInstagram>> {
  await exigirModulo("chat");
  return comoResultado(() => paginaDeComentarios(contaId, midiaId, antes));
}
