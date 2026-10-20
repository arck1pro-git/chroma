import type { MetadataRoute } from "next";

// O AmaanOffice instalável pelo navegador (PWA), sem Electron: no Chrome e no
// Edge aparece "Instalar app" na barra de endereço, e ele abre em janela
// própria, com ícone na área de trabalho e na barra de tarefas. Pedido dele,
// 2026-10-20.
//
// Sem service worker de propósito: o Chrome não exige mais para instalar, e o
// CRM não funciona offline de qualquer jeito (tudo vem do banco). Os ícones
// estão em public/icones e são servidos sem login (proxy.ts) — quem busca o
// manifest e os ícones é o navegador, sem o cookie da sessão.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AmaanOffice",
    short_name: "AmaanOffice",
    description: "CRM da AMAAN e da ARCK1PRO: funis, oportunidades, chat e IAs de atendimento.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icones/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
