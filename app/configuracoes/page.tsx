import type { Metadata } from "next";
import Configuracoes from "./configuracoes";
import { carregarConfiguracoes } from "./dados";

export const metadata: Metadata = {
  title: "Configurações · Chroma",
};

// Server: carrega funis + etapas do banco e passa pro client. Sem cache: funil
// criado aqui tem que aparecer na hora (e refletir no /funil).
export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const dados = await carregarConfiguracoes();
  return <Configuracoes dados={dados} />;
}
