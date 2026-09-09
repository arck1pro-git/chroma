import type { Metadata } from "next";
import Chat from "./chat";
import { carregarChat } from "./dados";

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
  const { atendimento } = await searchParams;
  const dados = await carregarChat();
  return (
    <Chat
      dados={dados}
      atendimentoInicial={typeof atendimento === "string" ? atendimento : null}
    />
  );
}
