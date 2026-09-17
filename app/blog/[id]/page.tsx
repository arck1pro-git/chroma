import type { Metadata } from "next";
import { headers } from "next/headers";
import { enderecoDoCrm } from "@/lib/endereco";
import BlogArtigos from "./artigos";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Artigos · Chroma" };

// `params` é Promise nesta versão do Next — resolver aqui, no servidor, evita
// um efeito no cliente só para descobrir de qual blog a tela é.
//
// O ENDEREÇO DO CRM TAMBÉM VEM DAQUI, e pelo mesmo motivo de /webhooks: a URL
// de conexão do blog é absoluta e alguém de fora vai chamá-la. Montá-la no
// cliente com `window.location` daria divergência de hidratação (no servidor
// não há window) e um piscar no lugar mais sensível da tela — o endereço que a
// pessoa vai copiar.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("blog");
  const [{ id }, cabecalhos] = await Promise.all([params, headers()]);
  const endereco = enderecoDoCrm(cabecalhos);

  return (
    <BlogArtigos
      blogId={Number(id)}
      base={endereco.url}
      basePublica={endereco.publico}
    />
  );
}
