import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { carregarMetricas, periodoValido } from "./dados";
import TelaMetricas from "./tela";

export const metadata: Metadata = {
  title: "Métricas · Chroma",
};

export const dynamic = "force-dynamic";

export default async function MetricasPage({
  searchParams,
}: {
  // ?dias=7|30|90 — o período. Vive na URL e não em estado de cliente: assim o
  // recorte é um link que dá pra mandar no WhatsApp, e a tela continua inteira
  // renderizada no servidor, que é onde o filtro por dono TEM que acontecer.
  searchParams: Promise<{ dias?: string | string[] }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  //
  // `escopo` sai daqui e vai DIRETO pra consulta: é ele que decide se o SELECT
  // traz a carteira de todo mundo ou só a de quem está olhando.
  const { usuario, escopo } = await exigirModulo("metricas");

  const { dias } = await searchParams;
  const periodo = periodoValido(typeof dias === "string" ? dias : undefined);
  const dados = await carregarMetricas(escopo, usuario.id, periodo);

  return <TelaMetricas dados={dados} escopo={escopo} nome={usuario.nome} />;
}
