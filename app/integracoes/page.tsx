import type { Metadata } from "next";
import Integracoes from "./integracoes";
import { exigirModulo } from "@/lib/auth/dal";
import { conexaoGoogle, googleConfigurado } from "@/lib/google-oauth";

export const metadata: Metadata = {
  title: "Integrações · Chroma",
};

// Client por dentro (estado das conexões e do painel). O Google Calendar é a
// primeira conexão de verdade: o estado dele vem do banco (google_conexao), as
// outras continuam mock.
export default async function IntegracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string | string[]; motivo?: string | string[] }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("integracoes");

  const [busca, google] = await Promise.all([searchParams, conexaoGoogle()]);
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // A volta de /api/google/callback: o resultado vem na URL.
  const resultado = um(busca.google);
  const aviso =
    resultado === "conectado"
      ? { tipo: "ok" as const, texto: `Google Calendar conectado${google ? ` (${google.contaEmail})` : ""}.` }
      : resultado === "erro"
        ? { tipo: "erro" as const, texto: um(busca.motivo) || "Não foi possível conectar o Google Calendar." }
        : null;

  return (
    <Integracoes
      google={google ? { conta: google.contaEmail, conectadoEm: google.conectadoEm } : null}
      googleConfigurado={googleConfigurado()}
      aviso={aviso}
    />
  );
}
