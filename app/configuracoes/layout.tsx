import type { Metadata } from "next";
import NavConfiguracoes from "./nav";
import { gereUsuarios, usuarioAtual } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Configurações · Chroma",
};

// Cada seção lê o banco na hora: funil criado aqui tem que aparecer já, e no
// quadro da raiz junto. Vale para todas as rotas abaixo deste layout.
export const dynamic = "force-dynamic";

// A casca das Configurações: a barra das entidades à esquerda (ao lado da barra
// de módulos, que é do layout raiz) e a seção escolhida à direita.
//
// O título de cada seção mora no conteúdo (Cabecalho, em ./secoes/pecas.tsx),
// com a frase do que ela resolve e a ação principal ao lado. Era só a barra
// que dizia onde se estava, e cada seção abria direto num formulário de criar
// — a primeira coisa da tela era um campo vazio, não o que já existe.
//
// Assíncrono desde os departamentos: a barra das seções precisa saber o que
// esta pessoa alcança. Quem NÃO tem o módulo 'configuracoes' mas administra
// acessos (não é o caso hoje, e passa a ser no dia em que alguém montar um
// departamento só de portaria) vê apenas Acessos, e não uma lista de links que
// a levariam todos pro mesmo redirecionamento. Do mesmo jeito, o Admin — que
// não tem Configurações, mas cria e edita contas desde 2026-10-07 — vê só
// Usuários.
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
        gereUsuarios={usuario ? gereUsuarios(usuario) : false}
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-16 pt-8 xl:px-10">
        {/* max-w-4xl desde o redesenho de 2026-10-08: a de 3xl servia ao
            formulário de uma coluna, mas Acessos virou uma grade (departamento
            × módulo) e as listas ganharam colunas de contagem. Mais largo que
            isso, linha de lista vira um corredor entre o nome e as ações. */}
        <div className="mx-auto flex max-w-4xl flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
