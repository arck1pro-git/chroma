import type { Metadata } from "next";
import NavConfiguracoes from "./nav";
import { usuarioAtual } from "@/lib/auth/dal";

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
//
// Assíncrono desde os departamentos: a barra das seções precisa saber o que
// esta pessoa alcança. Quem NÃO tem o módulo 'configuracoes' mas administra
// acessos (não é o caso hoje, e passa a ser no dia em que alguém montar um
// departamento só de portaria) vê apenas Acessos, e não uma lista de links que
// a levariam todos pro mesmo redirecionamento.
//
// A barra só DESENHA o que a pessoa alcança; quem BARRA é o page.tsx de cada
// seção. Esconder item de menu não é controle de acesso — é cortesia.
export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const usuario = await usuarioAtual();

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <NavConfiguracoes
        temConfiguracoes={usuario?.modulos.has("configuracoes") ?? false}
        gerenciaAcessos={usuario?.departamento?.gerenciaAcessos ?? false}
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6 xl:px-10">
        {/* max-w-3xl era a medida da página única e continua sendo a certa:
            formulário de uma coluna não melhora ficando mais largo. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
