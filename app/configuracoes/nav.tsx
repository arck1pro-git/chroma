"use client";

// A segunda barra: as entidades configuráveis, ao lado da barra de módulos.
//
// POR QUE UMA BARRA, E NÃO A PÁGINA ÚNICA DE ANTES:
//
// · Eram seis seções empilhadas numa coluna só. Achar "Campos personalizados"
//   era rolar até o fim, e mexer nas etapas de um funil deixava o resto da
//   tela como ruído. Cada seção agora é uma rota — e uma rota carrega só os
//   próprios dados (ver ./dados.ts).
//
// · Deliberadamente parecida com a barra de módulos (app/components/sidebar.tsx):
//   mesma altura de item, mesmo cinza no ativo, mesma borda à direita. Duas
//   barras vizinhas com gramáticas diferentes leriam como dois aplicativos.
//
// · Mais estreita que ela (200px contra 260px) porque não tem lista embaixo —
//   e porque a hierarquia tem que ficar óbvia: esta barra está DENTRO do que
//   a outra selecionou.
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Layers,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Tag as TagIcon,
  Users,
  type LucideIcon,
} from "lucide-react";

type Item = { href: string; rotulo: string; Icone: LucideIcon };

// Dois grupos, e a divisão não é decorativa: em cima está o que o CRM guarda
// (linhas nossas, no nosso banco); embaixo, o que ele liga a um sistema de fora
// — onde um clique errado tem consequência lá, não aqui.
const GRUPOS: { titulo: string; itens: Item[] }[] = [
  {
    titulo: "Entidades",
    itens: [
      { href: "/configuracoes/funis", rotulo: "Funis e etapas", Icone: Layers },
      { href: "/configuracoes/tags", rotulo: "Tags", Icone: TagIcon },
      { href: "/configuracoes/segmentos", rotulo: "Segmentos", Icone: Boxes },
      { href: "/configuracoes/usuarios", rotulo: "Usuários", Icone: Users },
      {
        href: "/configuracoes/campos",
        rotulo: "Campos personalizados",
        Icone: SlidersHorizontal,
      },
    ],
  },
  {
    titulo: "Conexões",
    itens: [
      { href: "/configuracoes/whatsapp", rotulo: "WhatsApp", Icone: Smartphone },
    ],
  },
];

// Fora dos GRUPOS acima de propósito: Acessos não é uma entidade do CRM nem uma
// conexão com sistema de fora — é a portaria. E não é liberada pelo módulo
// 'configuracoes', e sim pela coluna `gerencia_acessos` do departamento, que é
// o que impede quem tem Configurações de se dar qualquer módulo (ver
// migration-departamentos.sql).
const ACESSOS: Item = {
  href: "/configuracoes/acessos",
  rotulo: "Acessos",
  Icone: ShieldCheck,
};

function classesDoItem(ativo: boolean) {
  return `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
    ativo
      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"
  }`;
}

export default function NavConfiguracoes({
  temConfiguracoes,
  gerenciaAcessos,
}: {
  temConfiguracoes: boolean;
  gerenciaAcessos: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-[200px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 p-2 dark:border-zinc-800">
      <div className="mb-1 flex items-center gap-2 px-2.5 py-1.5">
        <Settings className="size-4 shrink-0 text-zinc-500" aria-hidden="true" />
        <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Configurações
        </h1>
      </div>

      {(temConfiguracoes ? GRUPOS : []).map(({ titulo, itens }) => (
        <nav key={titulo} className="flex flex-col gap-0.5" aria-label={titulo}>
          <h2 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
            {titulo}
          </h2>
          {itens.map(({ href, rotulo, Icone }) => {
            const ativo = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={ativo ? "page" : undefined}
                className={classesDoItem(ativo)}
              >
                <Icone className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{rotulo}</span>
              </Link>
            );
          })}
        </nav>
      ))}

      {gerenciaAcessos && (
        <nav className="flex flex-col gap-0.5" aria-label="Permissões">
          <h2 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
            Permissões
          </h2>
          <Link
            href={ACESSOS.href}
            aria-current={pathname === ACESSOS.href ? "page" : undefined}
            className={classesDoItem(pathname === ACESSOS.href)}
          >
            <ACESSOS.Icone className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{ACESSOS.rotulo}</span>
          </Link>
        </nav>
      )}
    </aside>
  );
}
