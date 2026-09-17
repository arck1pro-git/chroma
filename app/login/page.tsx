import type { Metadata } from "next";
import Formulario from "./formulario";

export const metadata: Metadata = {
  title: "Entrar · Chroma",
  // Tela de login não entra em índice de busca.
  robots: { index: false, follow: false },
};

// A ÚNICA página do CRM que responde sem sessão (ver a lista em proxy.ts).
//
// Quem já está logado nunca chega aqui: o proxy manda pra raiz antes de
// renderizar. Por isso esta página não repete a checagem.
export default async function Login({
  searchParams,
}: {
  // ?de=<caminho> — para onde voltar depois de entrar. Quem preenche é o
  // proxy, ao barrar alguém no meio do caminho.
  searchParams: Promise<{ de?: string | string[] }>;
}) {
  const { de } = await searchParams;
  const volta = typeof de === "string" ? de : null;

  return (
    <div className="pagina-surge flex min-h-screen flex-1 items-center justify-center px-6">
      <div className="w-full max-w-[20rem]">
        <h1 className="mb-1 text-[20px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Chroma
        </h1>
        <p className="mb-5 text-[13px] text-zinc-500 dark:text-zinc-400">
          Entre para continuar.
        </p>
        <Formulario de={volta} />
      </div>
    </div>
  );
}
