import type { ComponentType, SVGProps } from "react";

// Não é LucideIcon: o módulo da Meta entra com a logo da marca, que é um <svg>
// nosso. Todo LucideIcon continua servindo — só o tipo é que abriu.
type Icone = ComponentType<SVGProps<SVGSVGElement>>;

export default function ModuloEmBreve({
  Icone,
  titulo,
  descricao,
}: {
  Icone: Icone;
  titulo: string;
  descricao: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-conteudo px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        <Icone className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {titulo}
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        {descricao}
      </p>
      <span className="mt-5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        Em breve
      </span>
    </div>
  );
}
