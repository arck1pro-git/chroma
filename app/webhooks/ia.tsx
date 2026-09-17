"use client";

// O painel de IA da tela de Webhooks.
//
// Existe como componente próprio porque page.tsx é de SERVIDOR e `aoAplicar` é
// uma função: ela não atravessa a fronteira. Aqui dentro ela é o router.refresh
// — a lista e o painel são renderizados no servidor, e sem o refresh a captação
// que a IA acabou de montar só apareceria no próximo F5.
import { useRouter } from "next/navigation";
import ChatIa from "../components/chat-ia";

export default function IaWebhooks({
  /** Nome da captação aberta, quando há uma. Só para a IA saber do que se fala. */
  webhookAberta,
  conversaInicial,
}: {
  webhookAberta?: string | null;
  conversaInicial?: string | null;
}) {
  const router = useRouter();

  return (
    <ChatIa
      endpoint="/api/ia/webhooks"
      // Escopo sem id, ao contrário do editor de fluxo: esta conversa fala da
      // TELA — ela cria captação, e uma captação que ainda não existe não tem
      // id para prender a conversa.
      escopo="webhooks"
      conversaInicial={conversaInicial}
      titulo="Montar com IA"
      rotulo="Montar captação com IA"
      dica="Descreva de onde vem o lead e o que fazer com ele. A IA cria a captação, declara os campos e liga as ações."
      sugestoes={[
        "Crie uma captação para o formulário do site: nome, e-mail, whatsapp e mensagem",
        "Nos leads desta captação, abra oportunidade no funil de vendas e marque a tag Site",
        "Quais campos esta captação recebe hoje?",
      ]}
      campo="Descreva a captação…"
      contexto={
        webhookAberta
          ? `tela de Webhooks, com a captação "${webhookAberta}" aberta`
          : "tela de Webhooks, nenhuma captação aberta"
      }
      aoAplicar={() => router.refresh()}
    />
  );
}
