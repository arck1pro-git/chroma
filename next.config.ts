import type { NextConfig } from "next";

// Cabeçalhos de segurança em TODA resposta (2026-10-20, auditoria). Não havia
// nenhum: as telas podiam ser postas num iframe de outro site (clickjacking) e
// o navegador "adivinhava" tipo de arquivo. Sem CSP de script por enquanto —
// o Next injeta script inline e exigiria nonce; o que entra aqui não quebra
// nada do app:
//   · frame-ancestors 'none' + X-Frame-Options: ninguém enquadra o CRM (nenhuma
//     tela dele é aberta em iframe — os iframes do app são do Google e srcDoc);
//   · nosniff: tipo declarado é o tipo, sem adivinhação;
//   · Permissions-Policy: microfone só para o próprio site (o ditado), câmera e
//     localização para ninguém.
const CABECALHOS_DE_SEGURANCA = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Driver de banco não deve ser empacotado pelo bundler — tem que ser require()
  // normal do Node em runtime, senão a conexão (net/tls) trava. Sem isto, o
  // Turbopack bundlava o postgres e cada request de rota com banco levava ~30s.
  serverExternalPackages: ["postgres"],
  // Sem "X-Powered-By: Next.js": não anuncia a versão do framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: CABECALHOS_DE_SEGURANCA }];
  },
};

export default nextConfig;
