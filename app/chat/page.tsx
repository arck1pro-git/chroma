import type { Metadata } from "next";
import Chat from "./chat";
import { carregarChat } from "./dados";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Chat · Chroma",
};

// Server: carrega atendimentos/mensagens/usuarios/contatos do Neon e passa como
// props. O Chat (client) cuida da seleção, fila e envio. Sem cache: a lista tem
// que refletir mensagem recebida pelo webhook a cada visita/refresh.
export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  // ?atendimento=<id> vem do botão "abrir" na lista de atendimentos da ficha
  // da oportunidade (app/funil/ficha-oportunidade.tsx).
  searchParams: Promise<{ atendimento?: string | string[] }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("chat");
  const { atendimento } = await searchParams;
  const dados = await carregarChat();
  return (
    <Chat
      dados={dados}
      atendimentoInicial={typeof atendimento === "string" ? atendimento : null}
    />
  );
}
