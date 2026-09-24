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
// · A barra RECOLHE, pelo botão no topo: 260px viram 60px e sobram os ícones.
//   Quem trabalha no quadro do funil ou no chat recupera a largura sem perder a
//   navegação. A escolha fica no localStorage — é preferência de quem está no
//   aparelho, não dado de conta, e não vale uma ida ao banco.
//
// · Blog não navega mais: virou SANFONA. O clique abre os blogs existentes aqui
//   mesmo, e cada um leva direto a /blog/<id>. No fim da lista, "+ Novo blog"
//   abre um modal por cima da tela (./modal-novo-blog.tsx) — criar blog deixou
//   de custar uma ida a /blog. Aquela tela virou o lugar de CONFIGURAR: é lá,
//   na engrenagem do cartão, que ficam endereço, autor, descrição e chave.
//
// A lista de conversas vem de TODOS os painéis de IA juntos, e cada uma sabe
// voltar para a tela onde foi feita (lib/ia/navegacao.ts).
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Blocks,
  CalendarDays,
  ChartNoAxesColumn,
  ChevronRight,
  Grid2x2,
  FileText,
  LayoutDashboard,
  Link2,
  Mail,
  Megaphone,
  MessagesSquare,
  Newspaper,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings,
  Sparkles,
  Paperclip,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { conversasDaBarra } from "./acoes-ia";
import ModalNovoBlog, { type BlogCriado } from "./modal-novo-blog";
import SeloWhatsApp from "./selo-whatsapp";
import type { ConversaNaBarra } from "@/lib/ia/conversas";
import { lugarDoEscopo, rotaDaConversa } from "@/lib/ia/navegacao";
import { sair } from "@/app/login/acoes";
import type { ChaveModulo } from "@/lib/auth/modulos";

// A LISTA DE MÓDULOS NÃO MORA MAIS AQUI. Ela vem do servidor, já peneirada
// pelo departamento de quem está logado (app/layout.tsx → lib/auth/dal.ts).
// Antes era um array fixo: todo mundo via os mesmos oito itens, e quem clicava
// no que não podia descobria pelo redirecionamento.
//
// O que sobra aqui é o ÍCONE, e ele fica porque não atravessa a fronteira
// servidor→cliente: componente React não é dado serializável. O servidor manda
// a chave do módulo, esta tabela vira chave em desenho.
//
// Módulo sem entrada aqui cai no Grid2x2 em vez de sumir da barra — item sem
// ícone é um detalhe visual, e esconder o módulo por causa disso seria perder
// acesso por um esquecimento de design.
const ICONES: Record<ChaveModulo, LucideIcon> = {
  inicio: LayoutDashboard,
  chat: MessagesSquare,
  agenda: CalendarDays,
  metricas: ChartNoAxesColumn,
  emails: Mail,
  automacoes: Workflow,
  campanhas: Megaphone,
  templates: FileText,
  blog: Newspaper,
  webhooks: Webhook,
  documentos: Paperclip,
  contextos: Blocks,
  meta: Grid2x2,
  integracoes: Link2,
  configuracoes: Settings,
};

/** O que o servidor manda desenhar. Ver `modulosDaBarra` em app/layout.tsx. */
export type ItemDeModulo = { chave: ChaveModulo; rotulo: string; href: string };

/** Onde a preferência de barra recolhida fica, no aparelho de quem usa. */
const CHAVE_RECOLHIDA = "chroma:barra-recolhida";

// ── A preferência como LOJA EXTERNA ─────────────────────────────────────────
//
// O localStorage é um sistema de fora do React, e é assim que o React quer que
// se leia um: `useSyncExternalStore`, não `useState` + efeito que grava no
// primeiro render. O caminho do efeito pinta uma vez errado e corrige na
// segunda — é a cascata de render que o lint deste projeto barra
// (react-hooks/set-state-in-effect).
//
// `snapshotNoServidor` devolve `false` porque no servidor não existe
// localStorage: o HTML sai com a barra aberta e o cliente ajusta na primeira
// leitura, sem divergência de hidratação.
//
// O cache existe porque `getSnapshot` tem que devolver o MESMO valor enquanto
// nada muda. Ler o localStorage a cada chamada devolveria um booleano novo a
// cada render e o React entraria em laço.
let recolhidaEmCache: boolean | null = null;
const ouvintesDaBarra = new Set<() => void>();

function assinarRecolhida(ouvinte: () => void) {
  ouvintesDaBarra.add(ouvinte);
  return () => {
    ouvintesDaBarra.delete(ouvinte);
  };
}

function lerRecolhida() {
  if (recolhidaEmCache === null) {
    try {
      recolhidaEmCache = localStorage.getItem(CHAVE_RECOLHIDA) === "1";
    } catch {
      // Navegador com armazenamento bloqueado. A barra abre e funciona; só não
      // lembra da escolha.
      recolhidaEmCache = false;
    }
  }
  return recolhidaEmCache;
}

function snapshotNoServidor() {
  return false;
}

function definirRecolhida(valor: boolean) {
  recolhidaEmCache = valor;
  try {
    localStorage.setItem(CHAVE_RECOLHIDA, valor ? "1" : "0");
  } catch {}
  for (const ouvinte of ouvintesDaBarra) ouvinte();
}

/** O mínimo que a barra precisa saber de um blog para listá-lo. */
type BlogNaBarra = { id: number; nome: string };

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
// Inativo e ativo dividem a MESMA cor de texto, e essa cor é o FIM da escala:
// zinc-950 no claro, zinc-50 no escuro. A barra inteira é tinta cheia, e o que
// diz "onde estou" é só o fundo do ativo. Ícone e escrita usam o mesmo tom —
// não há cinza de apoio aqui, nem no "+", nem na seta, nem no botão de sair.
//
// Daqui não dá pra escurecer mais sem mudar a cor de fundo da barra. Hover de
// cor saiu junto: com o texto já no extremo, ele não tinha para onde ir, e quem
// responde ao mouse é o fundo.
//
// Efeito colateral aceito: sem degrau de cor, o item ativo depende inteiramente
// do bg-zinc-100. Se algum dia esse fundo sair, a marcação de posição vai junto.
//
// No escuro o equivalente é SUBIR (zinc-50), não descer: contraste é distância
// da superfície, e a superfície lá é preta.
//
// `recolhida` troca só o miolo da linha: o ícone vai pro centro e o rótulo some.
// Cor, raio e altura continuam os mesmos — recolher muda a largura da barra,
// não transforma o item em outro componente.
function classesDoItem(ativo: boolean, recolhida = false) {
  return `flex w-full items-center rounded-lg py-2 text-[14px] font-light transition-colors ${
    recolhida ? "justify-center px-0" : "gap-2.5 px-2.5"
  } ${
    ativo
      // O ativo não volta pra font-medium: a 14px o degrau de peso ficava
      // gritante ao lado dos finos. Peso normal basta — quem separa mesmo é o
      // fundo.
      ? "bg-zinc-100 font-normal text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
      : "text-zinc-950 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800/60"
  }`;
}

// A linha de um blog dentro da sanfona: 13px e recuo, contra os 14px do módulo.
// O degrau de corpo é o que diz "isto está dentro daquilo" sem precisar de
// borda nem de linha vertical.
//
// A COR é a mesma dos módulos (zinc-950 / zinc-50 no escuro), e não um cinza
// mais claro: cinza para dizer "menor" apagaria o nome do blog, que é o que se
// lê aqui. Quem marca hierarquia é o tamanho e o recuo; a tinta é cheia.
function classesDoSubitem(ativo: boolean) {
  return `flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-light transition-colors ${
    ativo
      ? "bg-zinc-100 font-normal text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
      : "text-zinc-950 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800/60"
  }`;
}

// O usuário vem do layout (servidor), não de um fetch daqui: a barra é client
// component por causa do usePathname, e conta de usuário não é coisa que se
// pede pelo navegador.
//
// Repito o formato em vez de importar o tipo de lib/auth/dal: aquele módulo é
// `server-only` e não deve nem aparecer no grafo de import do cliente.
export type UsuarioDaBarra = {
  id: string;
  nome: string;
  iniciais: string;
  email: string;
  // O nome do departamento, só pra mostrar no title do rodapé. Era `papel`,
  // que deixou de existir com migration-departamentos.sql. null = conta sem
  // departamento, que não vê módulo nenhum.
  departamento: string | null;
};

export default function Sidebar({
  usuario,
  modulos,
  temConfiguracoes,
  podeWhatsApp = false,
}: {
  usuario: UsuarioDaBarra | null;
  /** Já peneirados pelo departamento, no servidor. */
  modulos: ItemDeModulo[];
  /** Módulo 'configuracoes' OU direito de administrar acessos. */
  temConfiguracoes: boolean;
  /** Só o módulo 'configuracoes': é o que as actions da uazapi exigem. */
  podeWhatsApp?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const parametros = useSearchParams();
  const conversaAberta = parametros.get("ia");

  const estaEm = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // ── Recolher ──────────────────────────────────────────────────────────────
  // A largura da barra vem da loja externa lá de cima: o valor é do APARELHO e
  // não do render, e é por isso que ele não é `useState` aqui dentro.
  const recolhida = useSyncExternalStore(
    assinarRecolhida,
    lerRecolhida,
    snapshotNoServidor,
  );

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

  // ── Blog: a sanfona ───────────────────────────────────────────────────────
  // O estado guarda a INTENÇÃO de quem clicou, e `null` é "ainda não opinei".
  // Enquanto ninguém opina, quem manda é a rota: estar em /blog/7 — por link,
  // por F5 ou vindo de outra tela — abre a sanfona sozinha, porque esconder de
  // alguém o lugar onde ela está seria o pior padrão possível.
  //
  // Depois do primeiro clique a intenção vale em todas as telas: quem fechou
  // não vê abrir de novo, quem abriu continua com os blogs à mão.
  //
  // Derivado, e não um efeito que reage ao pathname: efeito que chama setState
  // pinta uma vez errado e corrige na segunda — a cascata que o lint deste
  // projeto barra.
  const temBlog = modulos.some((m) => m.chave === "blog");
  const [sanfonaBlog, setSanfonaBlog] = useState<boolean | null>(null);
  const blogsAbertos = sanfonaBlog ?? pathname.startsWith("/blog");

  // `null` = ainda não busquei. É o que separa "carregando" de "nenhum blog
  // cadastrado" — duas frases diferentes para quem está olhando.
  const [blogs, setBlogs] = useState<BlogNaBarra[] | null>(null);

  // O modal de criação. Mora na barra porque o botão que o abre está aqui, e
  // porque é a barra que guarda a lista onde o blog novo tem que aparecer.
  const [criandoBlog, setCriandoBlog] = useState(false);

  // Só busca com a sanfona aberta: quem nunca abre nunca paga a consulta.
  // Refaz a cada navegação, pelo mesmo motivo das conversas — blog criado em
  // /blog aparece aqui sem F5.
  //
  // Erro vira lista vazia. A sanfona é acessória e não pode derrubar a barra,
  // que está em todas as telas.
  useEffect(() => {
    if (!temBlog || !blogsAbertos) return;
    let vivo = true;
    fetch("/api/blogs")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: unknown) => {
        if (!vivo) return;
        setBlogs(
          Array.isArray(lista)
            ? (lista as BlogNaBarra[]).map((b) => ({ id: b.id, nome: b.nome }))
            : [],
        );
      })
      .catch(() => {
        if (vivo) setBlogs([]);
      });
    return () => {
      vivo = false;
    };
  }, [temBlog, blogsAbertos, pathname]);

  // Sem sessão não há barra. É o que deixa /login ocupando a tela inteira sem
  // nenhum teste de rota aqui dentro — e, se um dia aparecer outra tela
  // pública, ela nasce sem barra de graça.
  //
  // Depois de TODOS os hooks, nunca antes: sair no meio muda a quantidade de
  // hooks entre um render e outro e o React quebra.
  if (!usuario) return null;

  // Clicar em Blog com a barra recolhida ABRE a barra junto: a sanfona não cabe
  // num trilho de 60px, e abrir uma lista que ninguém consegue ler seria um
  // clique morto.
  function alternarBlogs() {
    if (recolhida) {
      definirRecolhida(false);
      setSanfonaBlog(true);
      return;
    }
    setSanfonaBlog(!blogsAbertos);
  }

  // O blog nasceu: entra na lista sem esperar a próxima busca, e a navegação
  // leva direto para dentro dele — quem cria um blog quer escrever nele, não
  // voltar para a tela de onde clicou.
  function blogCriado(novo: BlogCriado) {
    setBlogs((atuais) =>
      [...(atuais ?? []), novo].sort((a, b) => a.nome.localeCompare(b.nome)),
    );
    setCriandoBlog(false);
    setSanfonaBlog(true);
    router.push(`/blog/${novo.id}`);
  }

  return (
    <aside
      className={`sticky top-0 z-30 flex h-screen shrink-0 flex-col gap-1 border-r border-zinc-200 p-2 dark:border-zinc-800 ${
        recolhida ? "w-[60px]" : "w-[260px]"
      }`}
    >
      {/* A marca: só o nome, na fonte da interface. O quadradinho com o "C"
          saiu — era um segundo logotipo ao lado do primeiro, e com a barra
          larga o nome por extenso já cumpre o papel sozinho.

          Maior que os itens de módulo (14px) de propósito: no mesmo corpo, a
          marca virava só mais uma linha da lista. O degrau de tamanho é o que
          diz que ela é o topo da barra, e não o primeiro item dela.

          Recolhida, a marca some e fica só o botão, centralizado: o nome por
          extenso não cabe em 60px, e abreviá-lo para "C" ressuscitaria o
          quadradinho que saiu daqui. */}
      <div className="mb-1 flex items-center gap-1">
        {!recolhida && (
          <Link
            href="/"
            className="flex min-w-0 flex-1 items-center rounded-lg px-2.5 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
          >
            <span className="truncate text-[20px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Chroma
            </span>
          </Link>
        )}

        <button
          type="button"
          onClick={() => definirRecolhida(!recolhida)}
          aria-label={recolhida ? "Expandir barra" : "Recolher barra"}
          aria-expanded={!recolhida}
          title={recolhida ? "Expandir barra" : "Recolher barra"}
          className={`flex size-8 items-center justify-center rounded-md text-zinc-950 transition-colors hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800/60 ${
            recolhida ? "mx-auto" : "shrink-0"
          }`}
        >
          {recolhida ? (
            <PanelLeft className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Módulos">
        {modulos.map(({ chave, href, rotulo }) => {
          const Icone = ICONES[chave] ?? Grid2x2;
          const ativo = estaEm(href);

          // Blog é o único item que não navega: ele abre a lista de blogs aqui
          // mesmo. Continua marcado como ativo em qualquer rota /blog — a
          // marcação diz onde a pessoa ESTÁ, e isso não muda por o item ter
          // virado botão.
          if (chave === "blog") {
            return (
              <div key={chave} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={alternarBlogs}
                  aria-expanded={!recolhida && blogsAbertos}
                  title={recolhida ? rotulo : undefined}
                  className={classesDoItem(ativo, recolhida)}
                >
                  <Icone className="size-4 shrink-0" aria-hidden="true" />
                  {!recolhida && (
                    <>
                      <span className="flex-1 truncate text-left">{rotulo}</span>
                      {/* Uma seta que gira, e não duas setas diferentes: a
                          transição conta o movimento de abrir, e o ícone de
                          chegada é o mesmo objeto do de partida. */}
                      <ChevronRight
                        className={`size-3.5 shrink-0 text-zinc-950 transition-transform dark:text-zinc-50 ${
                          blogsAbertos ? "rotate-90" : ""
                        }`}
                        aria-hidden="true"
                      />
                    </>
                  )}
                </button>

                {!recolhida && blogsAbertos && (
                  <ul className="flex flex-col gap-0.5 pl-6">
                    {blogs === null ? (
                      <li className="px-2.5 py-1.5 text-[13px] font-light text-zinc-950 dark:text-zinc-50">
                        Carregando…
                      </li>
                    ) : blogs.length === 0 ? (
                      <li className="px-2.5 py-1.5 text-[13px] font-light text-zinc-950 dark:text-zinc-50">
                        Nenhum blog ainda.
                      </li>
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

                    {/* Blog novo: abre o modal por cima da tela, sem navegar.
                        Criar pede nome e contexto, e os dois cabem num modal
                        pequeno — mandar a pessoa a /blog custaria a ida e, na
                        volta, o lugar onde ela estava.

                        Mesma tinta dos nomes de blog ao lado: o que separa a
                        ação da lista é o "+", não um cinza mais fraco. */}
                    <li>
                      <button
                        type="button"
                        onClick={() => setCriandoBlog(true)}
                        title="Novo blog"
                        className={classesDoSubitem(false)}
                      >
                        <Plus className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">Novo blog</span>
                      </button>
                    </li>
                  </ul>
                )}
              </div>
            );
          }

          return (
            <Link
              key={chave}
              href={href}
              aria-current={ativo ? "page" : undefined}
              title={recolhida ? rotulo : undefined}
              className={classesDoItem(ativo, recolhida)}
            >
              <Icone className="size-4 shrink-0" aria-hidden="true" />
              {!recolhida && <span className="truncate">{rotulo}</span>}
            </Link>
          );
        })}
      </nav>

      {/* ── Conversas ──────────────────────────────────────────────────────
          Ocupa o resto da altura e rola sozinha. min-h-0 é o que permite ao
          filho rolar dentro de um flex — sem isso a lista empurra a barra e
          quem rola vira a página.

          Recolhida, a lista sai inteira: título de conversa sem rótulo vira uma
          coluna de ícones iguais, indistinguíveis. Sobra o botão de nova
          análise, que continua sendo uma ação de um clique. */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {recolhida ? (
          <Link
            href="/?ia=nova"
            aria-label="Nova análise"
            title="Nova análise"
            className="flex h-8 w-full items-center justify-center rounded-lg text-zinc-950 transition-colors hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800/60"
          >
            <Plus className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <>
            <div className="flex items-center justify-between gap-1 pb-1 pl-2.5 pr-1">
              <h2 className="text-[12px] font-normal text-zinc-950 dark:text-zinc-50">
                Análises
              </h2>

              {/* Abre o painel de IA em branco, na raiz. Substituiu o botão
                  flutuante que ficava no canto da tela.

                  Aponta para a RAIZ e não para a tela atual: a análise do funil
                  é a única que vive numa rota própria. As outras (cadência,
                  editor de fluxo) acontecem dentro de painéis que a sidebar nem
                  alcança, e essas mantêm o botão flutuante delas.

                  "?ia=nova" é consumido pelo painel assim que ele abre — a URL
                  fica limpa de novo, e é isso que faz o segundo clique aqui
                  voltar a ser uma navegação de verdade. */}
              <Link
                href="/?ia=nova"
                aria-label="Nova análise"
                title="Nova análise"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-950 transition-colors hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800/60"
              >
                <Plus className="size-3.5" aria-hidden="true" />
              </Link>
            </div>

            {conversas.length === 0 ? (
              <p className="px-2.5 text-[13px] font-light leading-relaxed text-zinc-950 dark:text-zinc-50">
                Suas conversas com a IA aparecem aqui.
              </p>
            ) : (
              <ul className="rolagem-oculta flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                {conversas.map((c) => {
                  // Ativa quando é ESTA conversa que a URL pede — é o que mantém
                  // o item marcado depois de o clique navegar.
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
                          className="size-3.5 shrink-0 text-zinc-950 dark:text-zinc-50"
                          aria-hidden="true"
                        />
                        <span className="truncate">{c.titulo}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {/* Os números de WhatsApp: foto com borda verde ou vermelha, e o "+"
            de número novo. Ficam ACIMA de Configurações porque são da mesma
            família que ela — estado do sistema, não navegação. Clicar numa foto
            abre o painel dela ao lado da barra. */}
        <SeloWhatsApp podeCriar={podeWhatsApp} recolhida={recolhida} />

        {/* Some pra quem não tem o módulo. `temConfiguracoes` já soma o caso
            de quem administra acessos sem ter Configurações — senão a única
            porta pra tela de Acessos seria digitar a URL. */}
        {temConfiguracoes && (
          <Link
            href="/configuracoes"
            aria-current={estaEm("/configuracoes") ? "page" : undefined}
            title={recolhida ? "Configurações" : undefined}
            className={classesDoItem(estaEm("/configuracoes"), recolhida)}
          >
            <Settings className="size-4 shrink-0" aria-hidden="true" />
            {!recolhida && <span className="truncate">Configurações</span>}
          </Link>
        )}

        {/* Quem está logado, de verdade — era "FA · Fabrício" escrito no
            código, de quando não havia login.

            Recolhida, sobram as iniciais e o botão de sair, um sobre o outro:
            são as duas coisas do rodapé que funcionam sem rótulo. */}
        <div
          className={`flex rounded-lg py-2 ${
            recolhida
              ? "flex-col items-center gap-1 px-0"
              : "items-center gap-2.5 px-2.5"
          }`}
        >
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
            title={recolhida ? `${usuario.nome} · ${usuario.email}` : undefined}
          >
            {usuario.iniciais}
          </span>
          {!recolhida && (
            <span
              className="min-w-0 flex-1 truncate text-[14px] font-light text-zinc-950 dark:text-zinc-50"
              title={`${usuario.email}${usuario.departamento ? ` · ${usuario.departamento}` : " · sem departamento"}`}
            >
              {usuario.nome}
            </span>
          )}

          {/* <form> e não onClick: sair é uma ação de servidor que apaga o
              cookie, e o cookie só some numa resposta do servidor. Um botão de
              cliente teria que chamar uma rota mesmo assim. */}
          <form action={sair}>
            <button
              type="submit"
              aria-label="Sair"
              title="Sair"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-950 transition-colors hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <LogOut className="size-3.5" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>

      {/* Fora da <aside>, por portal: a barra é `sticky` com z-30 e isso cria um
          contexto de empilhamento. Preso lá dentro, o modal ficaria ABAIXO dos
          véus z-40 das telas — a gaveta de contatos, por exemplo.

          `criandoBlog` só vira true por clique, ou seja, depois da hidratação:
          é o que deixa chamar createPortal sem testar se `document` existe. */}
      {criandoBlog &&
        createPortal(
          <ModalNovoBlog
            aoFechar={() => setCriandoBlog(false)}
            aoCriar={blogCriado}
          />,
          document.body,
        )}
    </aside>
  );
}
