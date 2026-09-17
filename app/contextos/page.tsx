import type { Metadata } from "next";
import { listarContextos } from "@/lib/contextos";
import PainelContextos from "./painel";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Contextos · Chroma",
};

export const dynamic = "force-dynamic";

export default async function ContextosPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("contextos");
  const contextos = await listarContextos();
  return <PainelContextos contextos={contextos} />;
}
