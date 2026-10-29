"use server";

// As mensagens agendadas de um grupo, pela tela do chat (2026-10-29). A regra e
// o envio moram em lib/mensagens-agendadas.ts; aqui ficam a guarda, o
// agendador do n8n e o revalidate.
//
// Agendar é mandar mensagem no grupo, só que depois: pede o mesmo "criar" do
// chat que responder pede. Cancelar também.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/auth/dal";
import { enderecoDoCrm } from "@/lib/endereco";
import { agendarMensagem, cancelarAgendada } from "@/lib/mensagens-agendadas";
import { garantirAgendadorDeMensagens } from "@/lib/mensagens-agendadas-agendador";
import { comoResultado, Recusa, type ResultadoAcao } from "@/lib/resultado-acao";

export async function agendarMensagemNoGrupo(
  atendimentoId: string,
  dados: { texto: string; documentoId: string | null; enviarEm: string },
): Promise<ResultadoAcao<{ id: string; aviso: string | null }>> {
  const { usuario } = await exigirModulo("chat", "criar");
  return comoResultado(async () => {
    const r = await agendarMensagem({
      atendimentoId,
      texto: String(dados?.texto ?? ""),
      documentoId: typeof dados?.documentoId === "string" ? dados.documentoId : null,
      enviarEm: String(dados?.enviarEm ?? ""),
      usuarioId: usuario.id,
    });
    // O agendador do n8n só existe com o CRM num endereço público (no localhost
    // não cria). Falhar aqui não desfaz o agendamento: a mensagem fica na fila e
    // sai quando o agendador estiver no ar.
    let aviso: string | null = null;
    const endereco = enderecoDoCrm(await headers());
    if (endereco.publico) {
      await garantirAgendadorDeMensagens(endereco.url).catch((e) => {
        console.error("[agendadas] agendador do n8n:", e);
        aviso = "Agendada, mas não consegui conferir o agendador no n8n. Se não sair na hora, avise o TI.";
      });
    }
    revalidatePath("/chat");
    return { id: r.id, aviso };
  });
}

export async function cancelarMensagemAgendada(id: string): Promise<ResultadoAcao> {
  await exigirModulo("chat", "criar");
  return comoResultado(async () => {
    if (!(await cancelarAgendada(id))) throw new Recusa("Essa mensagem já saiu ou já foi cancelada.");
    revalidatePath("/chat");
  });
}
