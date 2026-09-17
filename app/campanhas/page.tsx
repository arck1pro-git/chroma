import type { Metadata } from "next";
import { carregarCampanhas } from "./dados";
import Campanhas from "./campanhas";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Campanhas · Chroma" };

// Estática: enquanto o canal não existe, a tela lê o mock (app/mock/campanhas.json)
// e não há nada por request para resolver. Quando a API oficial do WhatsApp
// entrar e `carregarCampanhas` virar SQL, isto passa a precisar de
// `export const dynamic = "force-dynamic"` — como nas outras telas que leem o
// banco.
export default async function Page() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("campanhas");
  return <Campanhas dados={carregarCampanhas()} />;
}
