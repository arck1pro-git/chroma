import type { Metadata } from "next";
import Blogs from "./blogs";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Blog · Chroma" };

// A tela busca no cliente (blogs + auditorias em paralelo, com skeleton): é
// lista curta, e a criação em linha já reescreve o estado local sem recarregar
// a rota. Deixar a página estática mantém a navegação instantânea.
export default async function Page() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("blog");
  return <Blogs />;
}
