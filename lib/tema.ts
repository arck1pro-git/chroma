// O modo claro/escuro escolhido no botão da barra (app/components/botao-tema.tsx).
// Módulo neutro porque o layout (servidor) e o botão (cliente) leem o mesmo
// nome: constante exportada de arquivo "use client" chega ao servidor como
// referência de cliente, não como texto.
export const COOKIE_TEMA = "tema";

/** A classe do <html> para o valor do cookie; sem escolha, nenhuma (segue o sistema). */
export function classeDoTema(valor: string | undefined): "escuro" | "claro" | "" {
  return valor === "escuro" || valor === "claro" ? valor : "";
}
