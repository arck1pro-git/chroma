import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Sidebar from "./components/sidebar";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chroma",
  description: "Gestão de funis e oportunidades",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} h-full antialiased`}
      // Extensão de navegador (Grammarly, Dark Reader, gerenciador de senha)
      // injeta atributo aqui antes do React hidratar — não é bug nosso, é
      // exatamente o caso que o suppressHydrationWarning existe pra cobrir.
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans" suppressHydrationWarning>
        <div className="flex min-h-screen">
          {/* A sidebar lê ?ia= para marcar a conversa aberta, e useSearchParams
              exige fronteira de Suspense nas rotas estáticas (/emails,
              /integracoes, /meta) — sem isto o build falha nelas. O fallback é a
              coluna vazia, do mesmo tamanho: nada pula quando ela chega. */}
          <Suspense fallback={<div className="w-[260px] shrink-0" />}>
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
