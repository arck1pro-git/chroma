import type { Metadata } from "next";
import LogoMeta from "../components/logo-meta";
import ModuloEmBreve from "../components/modulo-em-breve";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Meta · Chroma",
};

export default async function MetaPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("meta");
  return (
    <ModuloEmBreve
      Icone={LogoMeta}
      titulo="Meta"
      descricao="Campanhas e formulários de leads do Facebook e Instagram, direto no funil."
    />
  );
}
