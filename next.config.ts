import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Driver de banco não deve ser empacotado pelo bundler — tem que ser require()
  // normal do Node em runtime, senão a conexão (net/tls) trava. Sem isto, o
  // Turbopack bundlava o postgres e cada request de rota com banco levava ~30s.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
