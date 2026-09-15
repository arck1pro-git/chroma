import { redirect } from "next/navigation";

// /configuracoes não tem tela própria: a barra da esquerda sempre tem um item
// marcado, e "nenhum" não é um estado que valha desenhar. Funis é a primeira
// entidade da lista e a que estrutura o resto do CRM.
export default function ConfiguracoesPage() {
  redirect("/configuracoes/funis");
}
