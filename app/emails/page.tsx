import type { Metadata } from "next";
import ListaEmails from "./lista";

export const metadata: Metadata = {
  title: "E-mails · Chroma",
};

// A lista é client (estado de busca, filtro e do construtor), mas a página segue
// server só para manter o metadata — "use client" e metadata não convivem no
// mesmo arquivo. Mesmo arranjo de Contatos.
export default function EmailsPage() {
  return <ListaEmails />;
}
