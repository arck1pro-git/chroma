import type { Metadata } from "next";
import { cookies } from "next/headers";
import Chat from "./chat";
import { carregarChat } from "./dados";
import { carregarChatDemo } from "./demo";
import type { AbaInstagram } from "./tipos";
import { podeOperar } from "@/lib/auth/permissoes";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Chat · AmaanOffice",
};

// Sem cache: a lista tem que refletir a mensagem que o webhook acabou de gravar.
export const dynamic = "force-dynamic";

/** Cookie com o último canal escolhido — ver `trocarCanal` em chat.tsx. */
const COOKIE_CANAL = "chat_canal";

export default async function ChatPage({
  searchParams,
}: {
  // A tela inteira é guiada pela URL:
  //   ?canal=<dígitos do número> | todos
  //   ?atendimento=<id>  — a conversa aberta (é o link que a ficha da
  //                        oportunidade usa, app/funil/ficha-oportunidade.tsx)
  //   ?demo=1            — dados fictícios, só em desenvolvimento
  //   ?aba=comentarios   — numa conta do Instagram, os comentários em vez do
  //                        direct (o padrão); desde 2026-10-26
  //   ?postagem=<id>     — a postagem aberta na aba de comentários
  searchParams: Promise<{
    canal?: string | string[];
    atendimento?: string | string[];
    demo?: string | string[];
    aba?: string | string[];
    postagem?: string | string[];
  }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação (guia de autenticação do Next).
  const { usuario } = await exigirModulo("chat");
  const sp = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

  const atendimento = texto(sp.atendimento);
  const pedido = texto(sp.canal);
  // Prioridade do canal: o da URL; senão, chegando por link direto de uma
  // conversa, "todos" (para ela aparecer na lista seja de qual número for);
  // senão, o último escolhido.
  const lembrado = (await cookies()).get(COOKIE_CANAL)?.value ?? null;
  const bruto = pedido ?? (atendimento ? "todos" : lembrado) ?? "todos";
  const canal = bruto === "todos" ? "" : bruto.replace(/\D/g, "");

  // Qualquer outra coisa em ?aba= vale direct. A postagem é id da Meta (só
  // dígitos) e só faz sentido nos comentários; o servidor confere de novo.
  const aba: AbaInstagram = texto(sp.aba) === "comentarios" ? "comentarios" : "direct";
  const postagem = (texto(sp.postagem) ?? "").replace(/\D/g, "").slice(0, 40);
  const postagemId = aba === "comentarios" && postagem ? postagem : null;

  const demo = texto(sp.demo) === "1" && process.env.NODE_ENV !== "production";
  const dados = demo
    ? carregarChatDemo({ canal, atendimentoId: atendimento, usuarioId: usuario.id, aba, postagemId })
    : await carregarChat({ canal, atendimentoId: atendimento, aba, postagemId });

  return <Chat dados={dados} usuarioId={usuario.id} permissoes={{ criar: podeOperar(usuario, "chat", "criar"), editar: podeOperar(usuario, "chat", "editar") }} />;
}
