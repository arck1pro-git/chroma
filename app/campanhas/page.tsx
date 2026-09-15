import type { Metadata } from "next";
import { carregarCampanhas } from "./dados";
import Campanhas from "./campanhas";

export const metadata: Metadata = { title: "Campanhas · Chroma" };

// Estática: enquanto o canal não existe, a tela lê o mock (app/mock/campanhas.json)
// e não há nada por request para resolver. Quando a API oficial do WhatsApp
// entrar e `carregarCampanhas` virar SQL, isto passa a precisar de
// `export const dynamic = "force-dynamic"` — como nas outras telas que leem o
// banco.
export default function Page() {
  return <Campanhas dados={carregarCampanhas()} />;
}
