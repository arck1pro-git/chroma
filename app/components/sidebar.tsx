"use client";

// Barra lateral no formato do ChatGPT: larga, com os módulos em cima e a lista
// de conversas embaixo, ocupando o resto da altura.
//
// O QUE MUDOU E POR QUÊ:
//
// · Era um trilho de 56px só com ícones. Virou 260px com ícone + rótulo. Sem o
//   rótulo não cabe uma lista de conversas — que é o ponto desta barra.
//
// · O item ativo NÃO tem mais fundo escuro. Era `bg-zinc-900 text-white`, um
//   bloco preto que dominava a barra inteira. Agora é o cinza sutil do ChatGPT:
//   o mesmo tom do hover, só que fixo. Marcar onde você está não precisa de
//   contraste máximo — precisa ser o único item diferente.
//
// · A barra não tem fundo próprio: mostra o --background (globals.css), e o
//   conteúdo usa --conteudo, que hoje aponta para o MESMO token. Uma superfície
//   só, da esquerda à direita — os cabeçalhos de página e os painéis de lista
//   que eram brancos foram nivelados junto.
//
// · A separação é só a BORDA à direita, na mesma cor que o resto do app já usa
//   para separar coisas (border-zinc-200 / dark:border-zinc-800). Com o mesmo
//   tom dos dois lados, é ela que diz onde a barra termina.
//
// A lista de conversas vem de TODOS os painéis de IA juntos, e cada uma sabe
// voltar para a tela onde foi feita (lib/ia/navegacao.ts).
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Blocks,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessagesSquare,
  Newspaper,
  Plus,
  Settings,
  Sparkles,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { conversasDaBarra } from "./acoes-ia";
import type { ConversaNaBarra } from "@/lib/ia/conversas";
import { lugarDoEscopo, rotaDaConversa } from "@/lib/ia/navegacao";

// Dashboard, funil/kanbans e contatos moram todos na raiz — um item só,
// "Dashboard". As rotas /dashboard, /funil e /contatos não existem mais: o
// nome do item é o do conteúdo, mas o href continua sendo a raiz.
//
// /meta e /integracoes continuam existindo como rota, mas ficam fora daqui: a
// barra é para o que se usa todo dia.
const modulos: { href: string; rotulo: string; Icone: LucideIcon }[] = [
  { href: "/", rotulo: "Dashboard", Icone: LayoutDashboard },
  { href: "/chat", rotulo: "Chat", Icone: MessagesSquare },
  { href: "/emails", rotulo: "E-mails", Icone: Mail },
  { href: "/automacoes", rotulo: "Automações", Icone: Workflow },
  { href: "/campanhas", rotulo: "Campanhas", Icone: Megaphone },
  { href: "/blog", rotulo: "Blog", Icone: Newspaper },
  { href: "/webhooks", rotulo: "Webhooks", Icone: Webhook },
  { href: "/contextos", rotulo: "Contextos", Icone: Blocks },
];

// Uma classe para módulo, configurações e conversa — é o que faz os três grupos
// continuarem parecendo a mesma barra quando um deles for mexido.
//
// O ativo usa o MESMO cinza do hover. No ChatGPT a diferença entre "onde estou"
// e "onde o mouse está" é só a permanência, não a intensidade.
//
// 14px em peso 300, e não 13px em 400: corpo maior com traço mais leve lê
// melhor na barra do que corpo menor em peso normal — a mancha de tinta fica
// parecida e o desenho da letra é que cresce. Só vale porque o Inter daqui é
// variável (app/layout.tsx, sem weight fixo) e tem o eixo até 300 de verdade;
// com fonte estática o navegador sintetizaria o peso e o traço sujaria.
//
// Inativo e ativo agora dividem a MESMA cor de texto (zinc-900 / zinc-100 no
// escuro): a barra inteira é tinta cheia, e o que diz "onde estou" passou a ser
// só o fundo do ativo. É o extremo da escala — daqui não dá pra escurecer mais
// sem mudar a cor de fundo da barra.
//
// Efeito colateral aceito: sem degrau de cor, o item ativo depende inteiramente
// do bg-zinc-100. Se algum dia esse fundo sair, a marcação de posição vai junto.
//
// No escuro o equivalente é SUBIR (zinc-100), não descer: contraste é distância
// da superfície, e a superfície lá é preta.
function classesDoItem(ativo: boolean) {
  return `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-light transition-colors ${
    ativo
      // O ativo não volta pra font-medium: a 14px o degrau de peso ficava
      // gritante ao lado dos finos. Peso normal basta — quem separa mesmo é o
      // fundo.
      ? "bg-zinc-100 font-normal text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
      : "text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"
  }`;
}

export default function Sidebar() {
  const pathname = usePathname();
  const parametros = useSearchParams();
  const conversaAberta = parametros.get("ia");

  const estaEm = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // ── Conversas ─────────────────────────────────────────────────────────────
  // Buscadas no cliente, depois da primeira pintura: a sidebar está em TODAS as
  // telas, e fazer o layout esperar por esta consulta atrasaria a página
  // inteira por uma lista acessória. `conversasDaBarra` já engole os próprios
  // erros e devolve lista vazia.
  //
  // A dependência é o pathname: navegar entre módulos rebusca, que é o que faz
  // uma conversa nova aparecer aqui sem F5.
  const [conversas, setConversas] = useState<ConversaNaBarra[]>([]);

  useEffect(() => {
    let vivo = true;
    conversasDaBarra().then((lista) => {
      if (vivo) setConversas(lista);
    });
    return () => {
      vivo = false;
    };
  }, [pathname]);

  return (
    <aside className="sticky top-0 z-30 flex h-screen w-[260px] shrink-0 flex-col gap-1 border-r border-zinc-200 p-2 dark:border-zinc-800">
      {/* A marca: só o nome, na fonte da interface. O quadradinho com o "C"
          saiu — era um segundo logotipo ao lado do primeiro, e com a barra
          larga o nome por extenso já cumpre o papel sozinho.

          Maior que os itens de módulo (14px) de propósito: no mesmo corpo, a
          marca virava só mais uma linha da lista. O degrau de tamanho é o que
          diz que ela é o topo da barra, e não o primeiro item dela. */}
      <Link
        href="/"
        className="mb-1 flex items-center rounded-lg px-2.5 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
      >
        <span className="text-[20px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Chroma
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5" aria-label="Módulos">
        {modulos.map(({ href, rotulo, Icone }) => {
          const ativo = estaEm(href);
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

      {/* ── Conversas ──────────────────────────────────────────────────────
          Ocupa o resto da altura e rola sozinha. min-h-0 é o que permite ao
          filho rolar dentro de um flex — sem isso a lista empurra a barra e
          quem rola vira a página. */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-1 pb-1 pl-2.5 pr-1">
          <h2 className="text-[12px] font-normal text-zinc-700 dark:text-zinc-200">
            Análises
          </h2>

          {/* Abre o painel de IA em branco, na raiz. Substituiu o botão
              flutuante que ficava no canto da tela.

              Aponta para a RAIZ e não para a tela atual: a análise do funil é a
              única que vive numa rota própria. As outras (cadência, editor de
              fluxo) acontecem dentro de painéis que a sidebar nem alcança, e
              essas mantêm o botão flutuante delas.

              "?ia=nova" é consumido pelo painel assim que ele abre — a URL fica
              limpa de novo, e é isso que faz o segundo clique aqui voltar a ser
              uma navegação de verdade. */}
          <Link
            href="/?ia=nova"
            aria-label="Nova análise"
            title="Nova análise"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        {conversas.length === 0 ? (
          <p className="px-2.5 text-[13px] font-light leading-relaxed text-zinc-700 dark:text-zinc-300">
            Suas conversas com a IA aparecem aqui.
          </p>
        ) : (
          <ul className="rolagem-oculta flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {conversas.map((c) => {
              // Ativa quando é ESTA conversa que a URL pede — é o que mantém o
              // item marcado depois de o clique navegar.
              const ativa = conversaAberta === c.id;
              return (
                <li key={c.id}>
                  <Link
                    href={rotaDaConversa(c.escopo, c.id)}
                    aria-current={ativa ? "page" : undefined}
                    className={classesDoItem(ativa)}
                    title={`${c.titulo} · ${lugarDoEscopo(c.escopo)}`}
                  >
                    <Sparkles
                      className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
                      aria-hidden="true"
                    />
                    <span className="truncate">{c.titulo}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <Link
          href="/configuracoes"
          aria-current={estaEm("/configuracoes") ? "page" : undefined}
          className={classesDoItem(estaEm("/configuracoes"))}
        >
          <Settings className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Configurações</span>
        </Link>

        <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            FA
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-light text-zinc-900 dark:text-zinc-100">
            Fabrício
          </span>
        </div>
      </div>
    </aside>
  );
}
