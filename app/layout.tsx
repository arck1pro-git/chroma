import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Sidebar, { type ItemDeModulo } from "./components/sidebar";
import ProvedorIaGlobal from "./components/ia-global";
import { temIaCompleta } from "@/lib/ia/modo-completo";
import { gereUsuarios, usuarioAtual } from "@/lib/auth/dal";
import { conferirDemandas } from "@/lib/demandas";
import { MODULOS } from "@/lib/auth/modulos";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chroma",
  description: "Gestão de funis e oportunidades",
};

// Assíncrono porque o layout agora pergunta QUEM está logado. A resposta vai
// pra barra lateral, que é onde o nome e o botão de sair aparecem — e é ela
// também que some quando não há ninguém, o que deixa /login sem barra sem
// precisar de nenhum teste de rota.
//
// A consulta não se paga duas vezes: usuarioAtual() é memorizada por render
// (React cache), então layout e página dividem a mesma ida ao banco.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const usuario = await usuarioAtual();

  // A barra é montada AQUI, no servidor, e não no cliente: a lista de módulos
  // de alguém não é coisa que se pede pelo navegador, e mandar o catálogo
  // inteiro pra esconder metade no React contaria pra qualquer um o que existe
  // do outro lado.
  //
  // `naBarra` tira /meta e /integracoes, que são rota e não item de menu —
  // isso já era assim antes das permissões.
  //
  // Esconder item não é controle de acesso: quem barra é o exigirModulo() de
  // cada page.tsx. Esta lista é o que a pessoa VÊ, não o que ela PODE.
  const modulos: ItemDeModulo[] = MODULOS.filter(
    (m) => m.naBarra && usuario?.modulos.has(m.chave),
  ).map((m) => ({ chave: m.chave, rotulo: m.rotulo, href: m.href }));

  // Configurações tem lugar próprio no rodapé da barra, e três portas: o módulo,
  // o direito de administrar acessos e — desde 2026-10-07 — gerir usuários
  // (Admin e TI, ver gereUsuarios).
  // O TI tem a IA num painel FIXO, igual em todas as telas
  // (app/components/ia-global.tsx).
  const iaFixa = usuario ? temIaCompleta(usuario) : false;

  // O número do item Demandas na barra, já na primeira pintura (sem piscar o
  // zero), e o ponto de partida da vigia de demandas novas. Daí em diante quem
  // o mantém em dia é a própria barra (app/components/vigia-demandas.tsx).
  const demandas = usuario?.modulos.has("demandas") ? await conferirDemandas(usuario) : null;

  const temConfiguracoes =
    (usuario?.modulos.has("configuracoes") ?? false) ||
    (usuario?.departamento?.gerenciaAcessos ?? false) ||
    (usuario ? gereUsuarios(usuario) : false);

  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} h-full antialiased`}
      // Extensão de navegador (Grammarly, Dark Reader, gerenciador de senha)
      // injeta atributo aqui antes do React hidratar — não é bug nosso, é
      // exatamente o caso que o suppressHydrationWarning existe pra cobrir.
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans" suppressHydrationWarning>
        <div className="flex min-h-screen">
          {/* A sidebar lê ?ia= para marcar a conversa aberta, e useSearchParams
              exige fronteira de Suspense nas rotas estáticas (/emails,
              /integracoes, /meta) — sem isto o build falha nelas. O fallback é a
              coluna vazia, do mesmo tamanho: nada pula quando ela chega. */}
          <Suspense fallback={<div className="w-[260px] shrink-0" />}>
            <Sidebar
              usuario={
                usuario && {
                  id: usuario.id,
                  nome: usuario.nome,
                  iniciais: usuario.iniciais,
                  email: usuario.email,
                  departamento: usuario.departamento?.nome ?? null,
                }
              }
              modulos={modulos}
              temConfiguracoes={temConfiguracoes}
              // Criar instância de WhatsApp exige o MÓDULO configuracoes, e
              // não o `temConfiguracoes` acima — aquele soma quem administra
              // acessos sem ter o módulo, e essas actions chamam
              // exigirModulo("configuracoes").
              podeWhatsApp={usuario?.modulos.has("configuracoes") ?? false}
              iaFixa={iaFixa}
              demandas={demandas}
            />
          </Suspense>
          <ProvedorIaGlobal ativa={iaFixa}>
            <div className="flex min-w-0 flex-1 flex-col">{children}</div>
          </ProvedorIaGlobal>

        </div>
      </body>
    </html>
  );
}
