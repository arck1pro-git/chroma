"use client";

// A barra lateral: a marca, os módulos da pessoa em grupos e, no pé, o estado do
// sistema (avisos, números de WhatsApp), Configurações e a conta.
//
// REDESENHO DE 2026-10-27 (pedido dele: "dê uma boa caprichada"):
//
// · GRUPOS. Eram 17 módulos numa coluna só, e numa tela de 800px a lista rolava
//   sem dizer onde cada coisa ficava. Agora são três: o dia a dia, o marketing e
//   o conteúdo, separados por um fio fino. Sem título na tela (pedido dele, no
//   mesmo dia: "tira o Conteúdo e o Marketing"); o nome fica só para o leitor de
//   tela. O grupo é desenho, então mora aqui, ao lado do ícone (GRUPOS); quem
//   decide se o módulo aparece continua sendo o servidor. Módulo sem grupo cai
//   num último em vez de sumir.
//
// · HIERARQUIA DE TINTA. O ativo tem fundo, texto cheio e peso médio; os outros,
//   texto um degrau abaixo e ícone apagado, que acendem no hover. Antes tudo era
//   a mesma tinta cheia e só o fundo dizia "você está aqui" — numa lista longa,
//   o olho não achava o ativo.
//
// · RITMO. Linhas de 36px (32px em tela baixa — o tablet deitado), texto de
//   14,5px e ícone num quadro fixo de 18px para os rótulos alinharem (um degrau
//   acima do primeiro desenho, a pedido dele).
//
// · AS CONVERSAS COM IA SAÍRAM DA BARRA (pedido dele, 2026-10-27). A IA continua
//   no botão flutuante de cada tela e, para o TI, no painel fixo.
//
// · A CONTA é um botão só: avatar na tinta do nome (a mesma de Demandas e da
//   gaveta), nome e departamento. Tema e Sair moram no menu dele — eram três
//   controles soltos numa linha.
//
// · RECOLHIDA (60px), cada módulo e Configurações mostram o nome numa etiqueta
//   ao lado, no hover e no foco do teclado: o `title` do navegador demorava e não
//   aparecia no teclado. A etiqueta é `fixed` porque a lista rola, e quem rola
//   corta o que vaza para o lado. Para o leitor de tela o nome vai como texto
//   oculto, e não aria-label, que esconderia a contagem de Demandas.
//
// Ficou como era: a barra não tem fundo próprio (mostra o --background, e a
// borda à direita diz onde ela acaba); recolher é preferência do aparelho, e
// abaixo de 1280px ela já nasce recolhida; Blog é sanfona com os blogs e o
// "+ Novo blog".
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ChaveModulo } from "@/lib/auth/modulos";
import type { ContagemDemandas, SituacaoDemandas } from "@/lib/demandas-tipos";
import { sair } from "@/app/login/acoes";
import ItemDoTema from "./botao-tema";
import {
  CalendarDays,
  ChartNoAxesColumn,
  ChevronRight,
  ChevronsUpDown,
  Clapperboard,
  ClipboardList,
  Grid2x2,
  LayoutDashboard,
  LayoutTemplate,
  Link2,
  ListChecks,
  LogOut,
  Mail,
  Megaphone,
  MessagesSquare,
  Newspaper,
  PanelLeft,
  PanelLeftClose,
  Paperclip,
  Plus,
  Settings,
  UsersRound,
  Webhook,
  Workflow,
  type TipoIcone,
} from "./icones";
import ModalNovoBlog, { type BlogCriado } from "./modal-novo-blog";
import { criarPreferencia } from "./preferencia-local";
import SeloWhatsApp from "./selo-whatsapp";
import { tintaDe } from "./tinta";
import { LigarAvisos, useVigiaDemandas } from "./vigia-demandas";

// A lista de módulos vem do servidor, já peneirada pelo departamento de quem
// está logado (app/layout.tsx → lib/auth/dal.ts). O que mora aqui é o DESENHO:
// o ícone (componente React não atravessa a fronteira servidor→cliente) e o
// grupo. Módulo sem ícone cai no Grid2x2 em vez de sumir da barra.
const ICONES: Record<ChaveModulo, TipoIcone> = {
  inicio: LayoutDashboard,
  chat: MessagesSquare,
  contatos: UsersRound,
  agenda: CalendarDays,
  demandas: ListChecks,
  metricas: ChartNoAxesColumn,
  emails: Mail,
  automacoes: Workflow,
  campanhas: Megaphone,
  templates: LayoutTemplate,
  blog: Newspaper,
  webhooks: Webhook,
  formularios: ClipboardList,
  documentos: Paperclip,
  videos: Clapperboard,
  meta: Grid2x2,
  integracoes: Link2,
  configuracoes: Settings,
};

const GRUPOS: Array<{ titulo: string | null; chaves: ChaveModulo[] }> = [
  { titulo: null, chaves: ["inicio", "chat", "contatos", "agenda", "demandas", "metricas"] },
  { titulo: "Marketing", chaves: ["campanhas", "automacoes", "templates", "formularios", "webhooks", "emails"] },
  { titulo: "Conteúdo", chaves: ["blog", "videos", "documentos"] },
];

/** O que o servidor manda desenhar. Ver `modulosDaBarra` em app/layout.tsx. */
export type ItemDeModulo = { chave: ChaveModulo; rotulo: string; href: string };

// A barra recolhida é preferência do APARELHO (ver ./preferencia-local.ts).
// Quem nunca escolheu ganha a barra recolhida abaixo de 1280px de largura: no
// tablet deitado os 260px dela comiam um quarto da tela.
const barraRecolhida = criarPreferencia(
  "chroma:barra-recolhida",
  () => window.innerWidth < 1280,
);

/** O mínimo que a barra precisa saber de um blog para listá-lo. */
type BlogNaBarra = { id: number; nome: string };

// Uma classe para módulo, Configurações, aviso e conta: é o que mantém o pé e a
// lista parecendo a mesma barra. `group/item` deixa o ícone acender junto no
// hover da linha.
function classesDoItem(ativo: boolean, recolhida = false) {
  return `group/item relative flex h-9 w-full shrink-0 items-center rounded-lg text-[14.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900/15 tela-baixa:h-8 dark:focus-visible:ring-white/20 ${
    recolhida ? "justify-center" : "gap-2.5 px-2"
  } ${
    ativo
      ? "bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-800/80 dark:text-zinc-50"
      : "text-zinc-600 hover:bg-zinc-100/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50"
  }`;
}

function classesDoIcone(ativo: boolean) {
  return `size-[18px] shrink-0 transition-colors ${
    ativo
      ? "text-zinc-950 dark:text-zinc-50"
      : "text-zinc-400 group-hover/item:text-zinc-800 dark:text-zinc-500 dark:group-hover/item:text-zinc-100"
  }`;
}

// A linha de um blog dentro da sanfona: um degrau menor e pendurada num fio à
// esquerda, que diz "isto está dentro de Blog" sem caixa em volta.
function classesDoSubitem(ativo: boolean) {
  return `flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:focus-visible:ring-white/20 ${
    ativo
      ? "bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-800/80 dark:text-zinc-50"
      : "text-zinc-600 hover:bg-zinc-100/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50"
  }`;
}

// O usuário vem do layout (servidor), não de um fetch daqui. Repito o formato em
// vez de importar o tipo de lib/auth/dal: aquele módulo é `server-only`.
export type UsuarioDaBarra = {
  id: string;
  nome: string;
  iniciais: string;
  email: string;
  /** O nome do departamento; null = conta sem departamento, que não vê módulo nenhum. */
  departamento: string | null;
};

type Dica = { texto: string; y: number };

export default function Sidebar({
  usuario,
  modulos,
  temConfiguracoes,
  podeWhatsApp = false,
  demandas = null,
}: {
  usuario: UsuarioDaBarra | null;
  /** Já peneirados pelo departamento, no servidor. */
  modulos: ItemDeModulo[];
  /** Módulo 'configuracoes' OU direito de administrar acessos. */
  temConfiguracoes: boolean;
  /** Só o módulo 'configuracoes': é o que as actions da uazapi exigem. */
  podeWhatsApp?: boolean;
  /** O que está a fazer para a pessoa em Demandas; null sem o módulo. */
  demandas?: SituacaoDemandas | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const estaEm = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // O número de Demandas nasce do servidor e se mantém em dia sozinho — e,
  // junto, avisa no Windows quando chega demanda (./vigia-demandas.tsx).
  const contagem = useVigiaDemandas(demandas ?? null);
  const temDemandas = demandas !== null && demandas !== undefined;

  // A largura vem da loja externa lá de cima: o valor é do APARELHO, não do render.
  const recolhida = barraRecolhida.useValor();

  // ── A etiqueta da barra recolhida ─────────────────────────────────────────
  const [dica, setDica] = useState<Dica | null>(null);
  function dicaDe(texto: string) {
    if (!recolhida) return {};
    const mostrar = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setDica({ texto, y: r.top + r.height / 2 });
    };
    return {
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => mostrar(e.currentTarget),
      onMouseLeave: () => setDica(null),
      onFocus: (e: React.FocusEvent<HTMLElement>) => mostrar(e.currentTarget),
      onBlur: () => setDica(null),
    };
  }

  function alternarRecolhida() {
    setDica(null);
    barraRecolhida.definir(!recolhida);
  }

  // ── Blog: a sanfona ───────────────────────────────────────────────────────
  // O estado guarda a INTENÇÃO de quem clicou, e `null` é "ainda não opinei":
  // enquanto ninguém opina, quem manda é a rota — estar em /blog/7 abre a
  // sanfona sozinha. Derivado, e não um efeito que reage ao pathname (que
  // pintaria uma vez errado e corrigiria na segunda).
  const temBlog = modulos.some((m) => m.chave === "blog");
  const [sanfonaBlog, setSanfonaBlog] = useState<boolean | null>(null);
  const blogsAbertos = sanfonaBlog ?? pathname.startsWith("/blog");

  // `null` = ainda não busquei: separa "carregando" de "nenhum blog".
  const [blogs, setBlogs] = useState<BlogNaBarra[] | null>(null);
  const [criandoBlog, setCriandoBlog] = useState(false);

  // Só busca com a sanfona aberta, e refaz a cada navegação (blog criado em
  // /blog aparece aqui sem F5). Erro vira lista vazia: a sanfona é acessória e
  // não pode derrubar a barra, que está em todas as telas.
  useEffect(() => {
    if (!temBlog || !blogsAbertos) return;
    let vivo = true;
    fetch("/api/blogs")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: unknown) => {
        if (!vivo) return;
        setBlogs(Array.isArray(lista) ? (lista as BlogNaBarra[]).map((b) => ({ id: b.id, nome: b.nome })) : []);
      })
      .catch(() => {
        if (vivo) setBlogs([]);
      });
    return () => {
      vivo = false;
    };
  }, [temBlog, blogsAbertos, pathname]);

  // Sem sessão não há barra (é o que deixa /login ocupando a tela inteira), e a
  // página do vídeo (/v/…) é do LEAD. Depois de TODOS os hooks, nunca antes.
  if (!usuario || pathname.startsWith("/v/")) return null;

  // Clicar em Blog com a barra recolhida ABRE a barra junto: a sanfona não cabe
  // num trilho de 60px.
  function alternarBlogs() {
    if (recolhida) {
      setDica(null);
      barraRecolhida.definir(false);
      setSanfonaBlog(true);
      return;
    }
    setSanfonaBlog(!blogsAbertos);
  }

  // O blog nasceu: entra na lista sem esperar a próxima busca, e a navegação
  // leva direto para dentro dele.
  function blogCriado(novo: BlogCriado) {
    setBlogs((atuais) => [...(atuais ?? []), novo].sort((a, b) => a.nome.localeCompare(b.nome)));
    setCriandoBlog(false);
    setSanfonaBlog(true);
    router.push(`/blog/${novo.id}`);
  }

  // Os grupos com o que a pessoa vê; grupo vazio some, e o separador é de quem
  // vem depois do primeiro.
  const porChave = new Map(modulos.map((m) => [m.chave, m]));
  const agrupados = GRUPOS.map((g) => ({
    titulo: g.titulo,
    modulos: g.chaves.flatMap((c) => porChave.get(c) ?? []),
  }));
  const semGrupo = modulos.filter((m) => !GRUPOS.some((g) => g.chaves.includes(m.chave)));
  if (semGrupo.length) agrupados.push({ titulo: "Outros", modulos: semGrupo });
  const grupos = agrupados.filter((g) => g.modulos.length > 0);

  function linhaDoModulo({ chave, href, rotulo }: ItemDeModulo) {
    const Icone = ICONES[chave] ?? Grid2x2;
    const ativo = estaEm(href);

    // Blog é o único item que não navega: abre a lista de blogs aqui mesmo, e
    // continua marcado como ativo em qualquer rota /blog.
    if (chave === "blog") {
      return (
        <div key={chave} className="flex flex-col gap-px">
          <button
            type="button"
            onClick={alternarBlogs}
            aria-expanded={!recolhida && blogsAbertos}
            className={classesDoItem(ativo, recolhida)}
            {...dicaDe(rotulo)}
          >
            <Icone className={classesDoIcone(ativo)} aria-hidden="true" />
            {recolhida && <span className="sr-only">{rotulo}</span>}
            {!recolhida && (
              <>
                <span className="flex-1 truncate text-left">{rotulo}</span>
                <ChevronRight
                  className={`size-3.5 shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${blogsAbertos ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
              </>
            )}
          </button>

          {!recolhida && blogsAbertos && (
            <ul className="mb-1 ml-[15px] flex flex-col gap-px border-l border-zinc-200 py-0.5 pl-2 dark:border-zinc-800">
              {blogs === null ? (
                <li className="flex h-7 items-center px-2 text-[13px] text-zinc-400 dark:text-zinc-500">Carregando…</li>
              ) : blogs.length === 0 ? (
                <li className="flex h-7 items-center px-2 text-[13px] text-zinc-400 dark:text-zinc-500">Nenhum blog ainda</li>
              ) : (
                blogs.map((b) => {
                  const rota = `/blog/${b.id}`;
                  return (
                    <li key={b.id}>
                      <Link
                        href={rota}
                        aria-current={pathname === rota ? "page" : undefined}
                        title={b.nome}
                        className={classesDoSubitem(pathname === rota)}
                      >
                        <span className="truncate">{b.nome}</span>
                      </Link>
                    </li>
                  );
                })
              )}
              {/* Blog novo abre um modal por cima da tela, sem navegar. */}
              <li>
                <button type="button" onClick={() => setCriandoBlog(true)} className={classesDoSubitem(false)}>
                  <Plus className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Novo blog</span>
                </button>
              </li>
            </ul>
          )}
        </div>
      );
    }

    const contador = chave === "demandas" ? contagem : null;
    const resumo =
      contador && contador.pendentes > 0
        ? `${contador.pendentes} a fazer${contador.atrasadas ? ` · ${contador.atrasadas} ${contador.atrasadas === 1 ? "atrasada" : "atrasadas"}` : ""}`
        : null;
    return (
      <Link
        key={chave}
        href={href}
        aria-current={ativo ? "page" : undefined}
        title={!recolhida && resumo ? resumo : undefined}
        className={classesDoItem(ativo, recolhida)}
        {...dicaDe(resumo ? `${rotulo} · ${resumo}` : rotulo)}
      >
        <Icone className={classesDoIcone(ativo)} aria-hidden="true" />
        <span className={recolhida ? "sr-only" : "truncate"}>{rotulo}</span>
        {contador && contador.pendentes > 0 && <Contador contagem={contador} recolhida={recolhida} />}
      </Link>
    );
  }

  return (
    <aside
      className={`sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-zinc-200 p-2 dark:border-zinc-800 ${
        recolhida ? "w-[60px]" : "w-[260px]"
      }`}
    >
      {/* A marca: "Amaan" forte e "Office" leve, na fonte da interface — o nome
          por extenso faz o papel de logotipo. Recolhida, sobra o botão. */}
      <div className={`mb-2 flex h-10 shrink-0 items-center ${recolhida ? "justify-center" : "gap-1 pl-2"}`}>
        {!recolhida && (
          <Link
            href="/"
            className="min-w-0 flex-1 truncate rounded-md text-[17px] tracking-tight text-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:text-zinc-50 dark:focus-visible:ring-white/20"
          >
            <span className="font-semibold">Amaan</span>
            <span className="font-light text-zinc-500 dark:text-zinc-400">Office</span>
          </Link>
        )}
        <button
          type="button"
          onClick={alternarRecolhida}
          aria-label={recolhida ? "Expandir barra" : "Recolher barra"}
          aria-expanded={!recolhida}
          title={recolhida ? "Expandir barra" : "Recolher barra"}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 outline-none transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:text-zinc-500 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50 dark:focus-visible:ring-white/20"
        >
          {recolhida ? <PanelLeft className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
        </button>
      </div>

      {/* Quem rola é a lista, por dentro (min-h-0 + flex-1): em tela baixa os
          módulos não cabem, e sem isto a página inteira rolava. Rolar fecha a
          etiqueta, que ficaria apontando para o lugar antigo. */}
      <nav
        onScroll={() => setDica(null)}
        className="rolagem-oculta flex min-h-0 flex-1 flex-col overflow-y-auto"
        aria-label="Módulos"
      >
        {grupos.map((g, i) => (
          <div key={g.titulo ?? `grupo-${i}`} role="group" aria-label={g.titulo ?? "Principal"} className="flex flex-col gap-px">
            {i > 0 && (
              <span
                className={`my-2.5 h-px shrink-0 bg-zinc-200/80 tela-baixa:my-2 dark:bg-zinc-800/80 ${recolhida ? "mx-auto w-5" : "mx-2"}`}
                aria-hidden="true"
              />
            )}
            {g.modulos.map(linhaDoModulo)}
          </div>
        ))}
      </nav>

      {/* O pé: estado do sistema e a conta, separados da navegação por um fio. */}
      <div className="mt-2 flex shrink-0 flex-col gap-px border-t border-zinc-200/80 pt-2 dark:border-zinc-800/80">
        {/* O convite para ligar os avisos de demanda no Windows; some quando a
            pessoa responde ao navegador ou fecha no ×. */}
        {temDemandas && <LigarAvisos recolhida={recolhida} classe={classesDoItem(false, recolhida)} />}

        {/* Os números de WhatsApp: estado do sistema, não navegação. */}
        <SeloWhatsApp podeCriar={podeWhatsApp} recolhida={recolhida} />

        {temConfiguracoes && (
          <Link
            href="/configuracoes"
            aria-current={estaEm("/configuracoes") ? "page" : undefined}
            className={classesDoItem(estaEm("/configuracoes"), recolhida)}
            {...dicaDe("Configurações")}
          >
            <Settings className={classesDoIcone(estaEm("/configuracoes"))} aria-hidden="true" />
            <span className={recolhida ? "sr-only" : "truncate"}>Configurações</span>
          </Link>
        )}

        <MenuDaConta usuario={usuario} recolhida={recolhida} />
      </div>

      {recolhida && dica && (
        <div
          role="tooltip"
          className="pointer-events-none fixed left-[66px] z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[12px] font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
          style={{ top: dica.y }}
        >
          {dica.texto}
        </div>
      )}

      {/* Fora da <aside>, por portal: a barra é `sticky` com z-30, e preso aqui
          dentro o modal ficaria abaixo dos véus das telas. */}
      {criandoBlog &&
        createPortal(<ModalNovoBlog aoFechar={() => setCriandoBlog(false)} aoCriar={blogCriado} />, document.body)}
    </aside>
  );
}

const ITEM_DO_MENU =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-zinc-700 outline-none transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:focus-visible:bg-zinc-800";

/**
 * A conta: avatar, nome e departamento; o clique abre o painel com o e-mail, o
 * tema e o Sair. Aberto, sobe acima do botão; na barra recolhida, abre ao lado.
 *
 * É um painel que abre e fecha (disclosure), e não um role="menu": esse papel
 * promete setas e foco no primeiro item, que aqui não existem — o Tab percorre
 * os botões como em qualquer lugar. Fecha no toque fora (pointerdown, que
 * também chega no tablet), no Esc (devolvendo o foco ao botão, senão ele cai no
 * <body> junto com o painel que sumiu) e quando o Tab sai dele.
 */
function MenuDaConta({ usuario, recolhida }: { usuario: UsuarioDaBarra; recolhida: boolean }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const idPainel = useId();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (ref.current?.contains(document.activeElement)) botaoRef.current?.focus();
      setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const departamento = usuario.departamento ?? "Sem departamento";
  return (
    <div
      ref={ref}
      className="relative"
      // Só quando o foco vai para OUTRO elemento fora daqui (o Tab): clique em
      // área sem foco dentro do painel não tem destino e não pode fechá-lo.
      onBlur={(e) => {
        const destino = e.relatedTarget as Node | null;
        if (aberto && destino && !ref.current?.contains(destino)) setAberto(false);
      }}
    >
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-controls={aberto ? idPainel : undefined}
        aria-expanded={aberto}
        aria-label={`Conta de ${usuario.nome}`}
        title={recolhida ? `${usuario.nome} · ${departamento}` : undefined}
        className={`flex w-full items-center rounded-lg outline-none transition-colors hover:bg-zinc-100/70 focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:hover:bg-zinc-800/50 dark:focus-visible:ring-white/20 ${
          aberto ? "bg-zinc-100/70 dark:bg-zinc-800/50" : ""
        } ${recolhida ? "h-10 justify-center" : "h-12 gap-2.5 px-1.5 tela-baixa:h-11"}`}
      >
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${tintaDe(usuario.nome)}`}
          aria-hidden="true"
        >
          {usuario.iniciais}
        </span>
        {!recolhida && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[14px] font-medium leading-tight text-zinc-950 dark:text-zinc-50">
                {usuario.nome}
              </span>
              <span className="block truncate text-[12px] leading-tight text-zinc-500 dark:text-zinc-400">{departamento}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
          </>
        )}
      </button>

      {aberto && (
        <div
          id={idPainel}
          className={`surge absolute z-40 w-60 rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)] dark:border-zinc-800 dark:bg-zinc-900 ${
            recolhida ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-1.5"
          }`}
        >
          <div className="px-2 pb-2 pt-1.5">
            <p className="truncate text-[13px] font-medium text-zinc-950 dark:text-zinc-50">{usuario.nome}</p>
            <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400" title={usuario.email}>
              {usuario.email}
            </p>
          </div>
          <div className="mx-1 mb-1 h-px bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />
          <ItemDoTema className={ITEM_DO_MENU} />
          {/* <form> e não onClick: sair apaga o cookie, e o cookie só some numa
              resposta do servidor. */}
          <form action={sair}>
            <button type="submit" className={ITEM_DO_MENU}>
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
              Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// A bolinha de Demandas: quantas estão a fazer. Neutra quando é só trabalho na
// fila, vermelha quando alguma passou do prazo — a cor só muda quando há o que
// cobrar. Na barra recolhida ela sobe para o canto do ícone. Acima de 99 vira
// "99+": é um aviso, não um relatório.
function Contador({ contagem, recolhida }: { contagem: ContagemDemandas; recolhida: boolean }) {
  const texto = contagem.pendentes > 99 ? "99+" : String(contagem.pendentes);
  const cor =
    contagem.atrasadas > 0
      ? "bg-red-500 text-white"
      : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100";
  const leitura = `${contagem.pendentes} a fazer${contagem.atrasadas ? `, ${contagem.atrasadas} ${contagem.atrasadas === 1 ? "atrasada" : "atrasadas"}` : ""}`;
  return (
    <span
      className={`${cor} inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums leading-none ${
        recolhida
          ? "absolute right-2 top-0.5 h-4 min-w-4 px-1 text-[9px] ring-2 ring-[var(--background)]"
          : "ml-auto h-[18px] min-w-[18px] px-1.5 text-[10.5px]"
      }`}
    >
      <span aria-hidden="true">{texto}</span>
      <span className="sr-only">{leitura}</span>
    </span>
  );
}
