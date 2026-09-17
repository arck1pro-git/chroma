import type { Metadata } from "next";
import Integracoes from "./integracoes";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Integrações · Chroma",
};

// Client por dentro (estado das conexões e do painel), server aqui só para o
// metadata — mesmo arranjo de Contatos e E-mails.
export default async function IntegracoesPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("integracoes");
  return <Integracoes />;
}
