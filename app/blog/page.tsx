import type { Metadata } from "next";
import Blogs from "./blogs";

export const metadata: Metadata = { title: "Blog · Chroma" };

// A tela busca no cliente (blogs + auditorias em paralelo, com skeleton): é
// lista curta, e a criação em linha já reescreve o estado local sem recarregar
// a rota. Deixar a página estática mantém a navegação instantânea.
export default function Page() {
  return <Blogs />;
}
