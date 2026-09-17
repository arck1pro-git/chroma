import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { exigirLogin } from "@/lib/auth/dal";
import { sair } from "@/app/login/acoes";

export const metadata: Metadata = {
  title: "Sem acesso · Chroma",
};

export const dynamic = "force-dynamic";

// O fundo do poço do redirecionamento. Quem cai aqui está autenticado e não tem
// NENHUM módulo — conta nova que ninguém classificou, ou departamento que ficou
// sem nenhuma permissão marcada.
//
// POR QUE UMA TELA E NÃO MANDAR PRA RAIZ: a raiz é o módulo 'inicio', e quem
// não tem 'inicio' seria mandado de volta pra cá — laço de redirecionamento, a
// tela piscando até o navegador desistir. Esta página exige só login, então é
// sempre alcançável, e é isso que fecha o ciclo com segurança.
//
// Também é o que a pessoa vê depois de ser rebaixada com o cookie ainda na mão:
// a DAL corta no próximo carregamento e o destino é este.
export default async function SemAcessoPage() {
  const usuario = await exigirLogin();

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-conteudo px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        <Lock className="size-6" aria-hidden="true" />
      </span>

      <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Sem acesso a nenhum módulo
      </h1>

      {/* Diz QUAL conta está na mão e a que departamento ela pertence: sem
          isso, quem tem duas contas não sabe se errou a de entrar ou se o
          departamento é que está vazio — e pede ajuda pela coisa errada. */}
      <p className="mt-1.5 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        Você entrou como <strong className="font-medium">{usuario.email}</strong>
        {usuario.departamento ? (
          <>
            {" "}
            no departamento{" "}
            <strong className="font-medium">{usuario.departamento.nome}</strong>,
            que ainda não tem nenhum módulo liberado.
          </>
        ) : (
          <>
            , e essa conta ainda não está em nenhum departamento.
          </>
        )}{" "}
        Peça ao time de TI para ajustar em Configurações · Acessos.
      </p>

      <form action={sair} className="mt-5">
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Sair e entrar com outra conta
        </button>
      </form>
    </div>
  );
}
