import type { Metadata } from "next";
import NavConfiguracoes from "./nav";

export const metadata: Metadata = {
  title: "Configurações · Chroma",
};

// Cada seção lê o banco na hora: funil criado aqui tem que aparecer já, e no
// quadro da raiz junto. Vale para todas as rotas abaixo deste layout.
export const dynamic = "force-dynamic";

// A casca das Configurações: a barra das entidades à esquerda (ao lado da barra
// de módulos, que é do layout raiz) e a seção escolhida à direita.
//
// O título da tela mora na barra, não num header em cima do conteúdo: com a
// barra dizendo "Configurações" e o item marcado dizendo qual seção, um header
// repetiria as duas coisas e comeria altura útil.
export default function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <NavConfiguracoes />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6 xl:px-10">
        {/* max-w-3xl era a medida da página única e continua sendo a certa:
            formulário de uma coluna não melhora ficando mais largo. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
