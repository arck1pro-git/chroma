import type { Metadata } from "next";
import Integracoes from "./integracoes";

export const metadata: Metadata = {
  title: "Integrações · Chroma",
};

// Client por dentro (estado das conexões e do painel), server aqui só para o
// metadata — mesmo arranjo de Contatos e E-mails.
export default function IntegracoesPage() {
  return <Integracoes />;
}
