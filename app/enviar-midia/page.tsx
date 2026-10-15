// A página de envio do conector MCP: o plano B de preparar_envio_midia
// (lib/mcp/ferramentas-postar.ts), para quando o modelo não consegue subir o
// arquivo sozinho. A pessoa abre o link que ele passou, escolhe o arquivo e o
// navegador sobe direto para o Storage.
//
// PÚBLICA (proxy.ts): quem abre pode estar num celular sem login no CRM. A
// tranca é o link de upload assinado, que vem no fragmento (#) — o fragmento
// nunca vai ao servidor nem aparece em log — e só serve para UM arquivo, por
// 2 horas.
import type { Metadata } from "next";
import Envio from "./envio";

export const metadata: Metadata = {
  title: "Enviar arquivo · AmaanOffice",
  robots: { index: false, follow: false },
};

export default function Pagina() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-conteudo px-4 py-10">
      <Envio />
    </main>
  );
}
