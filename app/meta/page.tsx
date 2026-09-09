import type { Metadata } from "next";
import LogoMeta from "../components/logo-meta";
import ModuloEmBreve from "../components/modulo-em-breve";

export const metadata: Metadata = {
  title: "Meta · Chroma",
};

export default function MetaPage() {
  return (
    <ModuloEmBreve
      Icone={LogoMeta}
      titulo="Meta"
      descricao="Campanhas e formulários de leads do Facebook e Instagram, direto no funil."
    />
  );
}
