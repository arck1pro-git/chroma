import type { Metadata } from "next";
import ListaEmails from "./lista";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "E-mails · Chroma",
};

// A lista é client (estado de busca, filtro e do construtor), mas a página segue
// server só para manter o metadata — "use client" e metadata não convivem no
// mesmo arquivo. Mesmo arranjo de Contatos.
export default async function EmailsPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("emails");
  return <ListaEmails />;
}
