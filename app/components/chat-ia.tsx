"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUp,
  Loader2,
  MessagesSquare,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { dataHora } from "../formato";
import {
  apagarConversaIa,
  criarConversaIa,
  gravarConversaIa,
  lerConversaIa,
  listarConversasIa,
  contextosDisponiveis,
  type ContextoDisponivel,
} from "./acoes-ia";
import TextoIa from "./texto-ia";
import { tomEscuro } from "@/lib/cores-funil";

// Botão flutuante de conversa com a IA. Canto inferior DIREITO. Quando uma
// ficha ou a gaveta está aberta o véu delas (z-40/z-50) cobre o botão — o que
// é o comportamento certo: com um painel modal aberto, ele não deve ser
// clicável.
//
// O componente NÃO CONHECE O CRM: manda a pergunta, o histórico e uma frase do
// que está na tela para o `endpoint` que receber, e quem sabe dos dados são as
// ferramentas do servidor. É o que permite as conversas de hoje — a que lê o
// funil (/api/ia) e a que monta automação (/api/ia/automacoes) — usarem a mesma
// tela sem uma saber da outra.
//
// `aoAplicar` fecha o ciclo da segunda: quando o servidor avisa que gravou
// alguma coisa, quem chamou decide o que recarregar.
//
// AS CONVERSAS FICAM NO BANCO (ia_conversas, via ./acoes-ia.ts). Antes viviam
// no localStorage: sumiam ao limpar o cache e não existiam em outro navegador.
// A lista é por `escopo` — a conversa sobre o funil não se mistura com a que
// monta uma cadência — e não tem dono, porque o CRM ainda não tem sessão
// (migration-ia-conversas.sql explica o que isso expõe).
//
// Sem a tabela, ou com o banco fora, a conversa CONTINUA funcionando: ela só
// não fica salva, e a tela diz isso em vez de fingir que gravou.

type Fala = { papel: "eu" | "ia"; texto: string };

/** Símbolo monoline de IA: três eixos, sem a estrela decorativa tradicional. */
function EstrelaIa({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
/**
 * A marca da IA: a estrela BRANCA sobre o tom escuro do funil aberto.
 *
 * A cor vem de fora (`cor`, uma classe pronta tipo "bg-blue-950") porque ela é
 * DADO do funil, e este componente não conhece o CRM — ver `corIcone`. Nas
 * telas sem funil fica o tom padrão.
 *
 * `girando` anima só a estrela, não o quadrado: com a animação no recipiente,
 * o bloco escuro rodava junto e a marca virava um losango piscando.
 */
function MarcaIa({ cor, girando = false }: { cor: string; girando?: boolean }) {
  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center rounded-lg ${cor}`}
      aria-hidden="true"
    >
      <EstrelaIa className={`size-3.5 text-white ${girando ? "estrela-pensando" : ""}`} />
    </span>
  );
}


// A conversa como a lista a mostra: título e tamanho, sem o texto.
type Resumo = { id: string; titulo: string; em: string; falas: number };

// A sombra dos balões: leve, e ao REDOR (sem deslocamento vertical). É ela
// que separa o balão branco da página branca agora que o painel não tem
// fundo — uma sombra caída para baixo deixaria a borda de cima sumir.
const SOMBRA = "shadow-[0_0_10px_rgba(0,0,0,0.12)]";

// A forma do balão da resposta. Constante, e não classe repetida nos dois
// lugares: a fala PRONTA e a que ainda está chegando pelo stream têm de ter a
// mesma caixa — se as medidas saírem de sincronia, o texto pula de lugar no
// instante em que o stream termina.
const BALAO_IA = `min-w-0 max-w-[90%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 ${SOMBRA} dark:bg-zinc-900`;

const SUGESTOES_PADRAO = [
  "Onde este funil está vazando?",
  "Quais oportunidades estão paradas há mais tempo?",
  "Resuma o funil em 3 linhas",
];

function tituloDe(pergunta: string) {
  const limpo = pergunta.trim().replace(/\s+/g, " ");
  return limpo.length > 42 ? `${limpo.slice(0, 41)}…` : limpo;
}

export default function ChatIa({
  contexto,
  endpoint = "/api/ia",
  // Uma lista por escopo: as trocas sobre o funil e as do editor de fluxo não
  // se misturam no histórico. Vai como está na coluna `escopo` da tabela.
  escopo = "funil",
  titulo = "Analisar esta tela",
  rotulo = "Analisar esta tela com IA",
  dica = "Pergunte sobre o funil aberto. A IA lê os mesmos números do quadro.",
  sugestoes = SUGESTOES_PADRAO,
  campo = "Pergunte sobre este funil…",
  // Campos extras no corpo do POST — o editor manda o fluxo_id por aqui.
  extra,
  // Chamado quando o servidor sinaliza que gravou algo; o editor recarrega o
  // canvas.
  aoAplicar,
  // Camada do botão e do painel. O padrão (z-40) fica SOB os véus das fichas e
  // gavetas, que é o certo: com um modal aberto, o botão não deve ser clicável.
  // Quem abre a conversa de DENTRO de um painel (a cadência, em z-61) passa uma
  // camada acima dele — senão o próprio véu do painel esconderia o botão.
  camada = "z-40",
  // "flutuante": cartão solto por cima da tela, ancorado no canto (o padrão, e
  // o único que serve dentro de um modal).
  // "lateral": o painel vira um elemento de FLUXO — quem o renderiza o coloca
  // como irmão do conteúdo num flex horizontal, e abrir empurra o conteúdo em
  // vez de cobri-lo. É o modo da tela inicial, onde o quadro não pode ficar
  // escondido atrás da conversa.
  modo = "flutuante",
  // Este painel oferece o seletor de blocos de prompt (módulo Contextos)?
  //
  // Era `escopoContexto`, que dizia QUAL categoria de contexto mostrar. A
  // categoria saiu do modelo: um contexto é só nome, descrição e prompt, e onde
  // ele se aplica é decisão da interface. Sobrou o liga/desliga — quais blocos
  // entram naquela conversa quem marca é a pessoa, na hora.
  usaContextos = false,
  // Id de conversa vindo da URL (?ia=<id>), posto lá pela sidebar. Quando
  // presente, o painel abre sozinho já nessa conversa — é o que faz clicar numa
  // análise da barra voltar exatamente para onde ela parou.
  conversaInicial = null,
  // O botão flutuante no canto. Desligado onde existe OUTRA porta de entrada —
  // hoje a raiz, que abre a análise pelo "+" da sidebar. Nos painéis modais
  // (cadência, editor de fluxo) ele continua ligado: ali a sidebar está coberta
  // pelo véu, e sem o botão não haveria como abrir a IA.
  botaoFlutuante = true,
  // Versão enxuta usada sobre construtores: só campo e balões, sem cartão,
  // cabeçalho ou tela de boas-vindas envolvendo a conversa.
  compacto = false,
  // O tom escuro do funil aberto, para a marca da IA (ex.: "bg-blue-950").
  // Entra por prop porque a cor é dado do funil e este painel também roda
  // onde funil nenhum existe (editor de fluxo, webhooks) — lá fica o padrão.
  corIcone = tomEscuro(null),
}: {
  contexto: string;
  endpoint?: string;
  escopo?: string;
  titulo?: string;
  rotulo?: string;
  dica?: string;
  sugestoes?: string[];
  campo?: string;
  extra?: Record<string, string>;
  aoAplicar?: () => void;
  camada?: string;
  modo?: "flutuante" | "lateral";
  usaContextos?: boolean;
  conversaInicial?: string | null;
  botaoFlutuante?: boolean;
  compacto?: boolean;
  corIcone?: string;
}) {
  // Já nasce aberto quando a URL trouxe uma conversa (?ia=): abrir num efeito
  // faria o painel piscar fechado antes de aparecer.
  const [aberto, setAberto] = useState(!!conversaInicial);
  const [conversas, setConversas] = useState<Resumo[]>([]);
  const [atualId, setAtualId] = useState<string | null>(null);
  const [falas, setFalas] = useState<Fala[]>([]);
  const [vendoLista, setVendoLista] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  // O que impediu de salvar (tabela faltando, banco fora). Fica à vista: uma
  // conversa que o usuário acha que está guardada e não está é pior que uma
  // linha de aviso.
  const [avisoArmazem, setAvisoArmazem] = useState<string | null>(null);

  const [pergunta, setPergunta] = useState("");
  const [parcial, setParcial] = useState("");
  const [ferramenta, setFerramenta] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const router = useRouter();
  const caminho = usePathname();

  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const atual = conversas.find((c) => c.id === atualId) ?? null;

  // ── Contextos ─────────────────────────────────────────────────────────────
  // Carregados junto da lista de conversas, no primeiro clique — pelo mesmo
  // motivo: há vários painéis destes por tela e nenhum precisa de banco antes
  // de alguém abrir.
  const [contextos, setContextos] = useState<ContextoDisponivel[]>([]);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);

  function alternarContexto(id: string) {
    setEscolhidos((atuais) =>
      atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id],
    );
  }

  // Carrega a lista no primeiro clique, não na montagem: são ~3 painéis destes
  // por tela, e nenhum precisa de banco antes de alguém abrir.
  async function carregarLista() {
    setCarregandoLista(true);
    if (usaContextos) {
      // Falha aqui não pode derrubar o painel: contexto é acessório, a conversa
      // funciona sem nenhum escolhido.
      contextosDisponiveis()
        .then(setContextos)
        .catch(() => setContextos([]));
    }
    const r = await listarConversasIa(escopo);
    if (r.ok) {
      setConversas(r.dados);
      setAvisoArmazem(null);
    } else {
      setAvisoArmazem(r.erro);
    }
    setCarregandoLista(false);
  }

  function abrir() {
    if (!carregado) {
      setCarregado(true);
      void carregarLista();
    }
    setAberto(true);
  }

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [falas, parcial, ferramenta]);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (vendoLista) setVendoLista(false);
      else setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, vendoLista]);

  /**
   * Abre o painel e garante a lista carregada.
   *
   * Função nomeada, e não as três linhas soltas dentro do efeito abaixo: os dois
   * caminhos que a URL dispara (conversa existente e "nova") precisavam da mesma
   * abertura, e duplicá-la era o tipo de repetição que sai de sincronia na
   * primeira mudança. De quebra, sai do corpo do efeito o setState direto que o
   * react-hooks/set-state-in-effect reclama.
   */
  function abrirComLista() {
    setAberto(true);
    if (!carregado) {
      setCarregado(true);
      void carregarLista();
    }
  }

  // Abre na conversa que a URL pediu. Roda uma vez por id: `atendida` guarda
  // qual já foi tratado, senão qualquer re-render reabriria o painel que a
  // pessoa acabou de fechar.
  //
  // Vários painéis de IA coexistem numa tela (a raiz tem o do funil; abrir uma
  // cadência acrescenta o dela). Só reage quem RECEBEU o prop — quem renderiza
  // decide se aquele ?ia= é dele, comparando o escopo.
  // Ref, não estado: guardar isto em useState significaria um setState no corpo
  // do efeito (render em cascata, e o que o react-hooks/set-state-in-effect
  // reclama). Aqui o valor só existe para o efeito não se repetir — ninguém
  // renderiza a partir dele.
  const atendidaRef = useRef<string | null>(null);
  const abertoPelaSidebarRef = useRef(Boolean(conversaInicial));

  /* eslint-disable react-hooks/set-state-in-effect --
     Este efeito é o único do arquivo que sincroniza com um sistema EXTERNO: a
     URL. Abrir o painel e trocar a conversa aberta é reação a uma navegação,
     não estado derivado de render — que é o caso que a regra existe para pegar.

     O disable é do efeito inteiro, e não linha a linha, por um motivo prático:
     a regra reporta apenas a PRIMEIRA chamada ofensora e enxerga dentro das
     funções nomeadas do componente, então o alvo se muda de lugar a cada
     refator e os disables pontuais viram diretiva morta. */
  useEffect(() => {
    if (!conversaInicial || atendidaRef.current === conversaInicial) return;
    abertoPelaSidebarRef.current = true;
    atendidaRef.current = conversaInicial;

    // "nova" não é id de conversa: é o pedido do "+" da sidebar para abrir em
    // branco. Consumido na hora — a URL volta a ficar sem ?ia= para que o
    // PRÓXIMO clique no "+" seja uma navegação de verdade. Sem isso, clicar de
    // novo estando na mesma URL não faria nada.
    //
    // Só o "nova" é consumido. O ?ia=<uuid> de uma conversa existente FICA na
    // URL: é por ele que a sidebar marca qual está aberta.
    if (conversaInicial === "nova") {
      abrirComLista();
      // Limpar o que estava aberto é o PONTO do "+": se o painel já estava numa
      // conversa, ela tem que sair da tela. Na primeira montagem isto é inócuo
      // (nasce vazio); o caso que exige é clicar "+" com uma conversa aberta.
      novaConversa();
      const busca = new URLSearchParams(window.location.search);
      busca.delete("ia");
      const resto = busca.toString();
      router.replace(resto ? `${caminho}?${resto}` : caminho, { scroll: false });
      return;
    }

    // abrirComLista também garante o painel ABERTO. Na montagem o useState já
    // abriu; isto cobre o outro caso: trocar de conversa pela sidebar SEM sair
    // da tela (de ?ia=A para ?ia=B). Aí o componente não remonta, e um painel
    // que a pessoa tinha fechado precisa voltar.
    abrirComLista();
    void escolher(conversaInicial);
    // escolher/carregarLista são recriadas a cada render (funções do corpo do
    // componente); incluí-las no array faria o efeito rodar sem parar. O que
    // realmente governa é o id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaInicial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Fechar o painel corta a resposta em andamento: sem isto o modelo continua
  // gerando (e sendo cobrado) para uma tela que ninguém está vendo.
  function fechar() {
    abortRef.current?.abort();
    setAberto(false);
  }

  function novaConversa() {
    abortRef.current?.abort();
    setAtualId(null);
    setFalas([]);
    setVendoLista(false);
    setParcial("");
    setPergunta("");
    campoRef.current?.focus();
  }

  // Abrir uma conversa da lista: as falas só vêm agora, no clique. A lista
  // carrega título e tamanho de 50 conversas; o texto de todas elas seria a
  // conversa inteira por linha.
  async function escolher(id: string) {
    abortRef.current?.abort();
    setVendoLista(false);
    setParcial("");
    setAtualId(id);
    setFalas([]);
    setAbrindo(true);

    const r = await lerConversaIa(id, escopo);
    if (r.ok && r.dados) {
      setFalas(r.dados.falas);
    } else if (r.ok) {
      // Sumiu do banco entre a lista e o clique (outra aba apagou).
      setConversas((cs) => cs.filter((c) => c.id !== id));
      setAtualId(null);
    } else {
      setAvisoArmazem(r.erro);
    }
    setAbrindo(false);
  }

  async function apagar(id: string) {
    setConversas((cs) => cs.filter((c) => c.id !== id));
    if (id === atualId) {
      setAtualId(null);
      setFalas([]);
    }
    const r = await apagarConversaIa(id, escopo);
    // Falhou: a linha continua no banco, e esconder isso faria a conversa
    // "voltar" no próximo carregamento sem explicação.
    if (!r.ok) {
      setAvisoArmazem(r.erro);
      void carregarLista();
    }
  }

  /**
   * Salva a conversa depois de cada troca.
   *
   * Sem id ainda, CRIA — inclusive quando a criação da troca anterior falhou:
   * `todas` carrega a conversa inteira, então o que se perdeu entra junto, e
   * não nasce uma segunda linha para a mesma conversa.
   */
  async function salvar(todas: Fala[], primeiraPergunta: string) {
    if (atualId) {
      const r = await gravarConversaIa(atualId, escopo, todas);
      if (!r.ok) {
        setAvisoArmazem(r.erro);
        return;
      }
      setAvisoArmazem(null);
      // Mexeu, vai pro topo — é o que qualquer lista de chat faz.
      setConversas((cs) => {
        const alvo = cs.find((c) => c.id === atualId);
        if (!alvo) return cs;
        const nova = {
          ...alvo,
          em: r.dados.em ?? alvo.em,
          falas: todas.length,
        };
        return [nova, ...cs.filter((c) => c.id !== atualId)];
      });
      return;
    }

    const r = await criarConversaIa(escopo, tituloDe(primeiraPergunta), todas);
    if (!r.ok) {
      setAvisoArmazem(r.erro);
      return;
    }
    setAvisoArmazem(null);
    setAtualId(r.dados.id);
    setConversas((cs) => [r.dados, ...cs]);
  }

  async function perguntar(texto: string) {
    const limpo = texto.trim();
    if (!limpo || ocupado) return;

    // O histórico que vai ao modelo é o de ANTES desta pergunta — ela viaja no
    // campo `pergunta`, e mandá-la duas vezes faria o modelo se ver repetido.
    const historico = falas;
    const comPergunta: Fala[] = [...historico, { papel: "eu", texto: limpo }];
    setFalas(comPergunta);

    setPergunta("");
    setParcial("");
    setVendoLista(false);
    setOcupado(true);

    const controle = new AbortController();
    abortRef.current = controle;

    let resposta: Fala | null = null;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pergunta: limpo,
          historico,
          contexto,
          // Ids dos blocos de prompt ligados na tela. O servidor confere que
          // ainda estão ativos — desligar um contexto vale na hora, inclusive
          // para uma aba aberta há uma hora.
          contextos: escolhidos,
          // Para gravar em ia_conversa_contextos qual bloco explicou esta
          // conversa. Null na primeira pergunta: a conversa só nasce depois.
          conversa_id: atualId,
          ...extra,
        }),
        signal: controle.signal,
      });

      if (!res.ok || !res.body) {
        const { erro } = await res.json().catch(() => ({ erro: null }));
        resposta = {
          papel: "ia",
          texto: erro ?? "Não consegui responder agora.",
        };
        return;
      }

      // NDJSON: uma linha JSON por evento. O último pedaço pode vir partido no
      // meio de uma linha, então o resto fica guardado pro próximo read().
      const leitor = res.body.getReader();
      const decodificador = new TextDecoder();
      let resto = "";
      let completa = "";

      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;

        resto += decodificador.decode(value, { stream: true });
        const linhas = resto.split("\n");
        resto = linhas.pop() ?? "";

        for (const linha of linhas) {
          if (!linha.trim()) continue;
          let evento: { t?: string; v?: string };
          try {
            evento = JSON.parse(linha);
          } catch {
            continue;
          }

          if (evento.t === "ferramenta") setFerramenta(evento.v ?? null);
          if (evento.t === "texto") {
            setFerramenta(null);
            completa += evento.v ?? "";
            setParcial(completa);
          }
          if (evento.t === "erro") completa += `\n\n${evento.v ?? ""}`;
          // O servidor gravou alguma coisa (hoje: o rascunho do fluxo). O
          // aviso vem depois da última palavra do modelo, então a tela
          // recarrega já com a versão nova no banco.
          if (evento.t === "mudou") aoAplicar?.();
        }
      }

      resposta = { papel: "ia", texto: completa || "Sem resposta." };
    } catch (e) {
      // Abortar é escolha do usuário, não falha. A pergunta já está na tela e
      // vai para o banco assim mesmo — foi feita.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        resposta = { papel: "ia", texto: "Falhou ao falar com o servidor." };
      }
    } finally {
      if (abortRef.current === controle) abortRef.current = null;

      const todas = resposta ? [...comPergunta, resposta] : comPergunta;
      if (resposta) setFalas(todas);
      setParcial("");
      setFerramenta(null);
      setOcupado(false);
      campoRef.current?.focus();

      // Depois de tudo na tela: gravar não pode segurar o campo de digitação.
      void salvar(todas, limpo);
    }
  }

  // Conversa aberta pela sidebar (?ia=...) usa sempre a apresentação enxuta:
  // ela sobe sobre a página como os chats de campanha, sem montar um painel.
  const compactoEfetivo = compacto || abertoPelaSidebarRef.current;
  const lateral = modo === "lateral" && !compactoEfetivo;

  const acaoCabecalho =
    "shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";

  return (
    <>
      {aberto && (
        <section
          className={
            lateral
              ? // Coluna de verdade: altura cheia e SEM SUPERFÍCIE PRÓPRIA —
                // nem fundo nem divisa. O fundo daqui era #ffffff, o mesmo do
                // <body> (globals.css), então o que ela marcava de fato era só
                // a borda; sem as duas, sobram os balões, e a profundidade passa
                // a vir da sombra deles.
                "surge flex h-full w-[26rem] max-w-[85vw] shrink-0 flex-col overflow-hidden"
              : // acima do botão; a camada padrão fica sob os véus das fichas (z-40/50)
                compactoEfetivo
                  ? `fixed bottom-20 right-5 ${camada} flex max-h-[70vh] w-[26rem] max-w-[calc(100vw-6rem)] flex-col overflow-visible`
                  : `surge fixed bottom-20 right-5 ${camada} flex max-h-[70vh] w-[26rem] max-w-[calc(100vw-6rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950`
          }
          aria-label={rotulo}
        >
          {!compactoEfetivo&&<header className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            {/* O ícone do histórico é o primeiro item do cabeçalho, como nos
                chats de IA: é por ele que se volta para as conversas salvas. */}
            <button
              type="button"
              onClick={() => {
                const indo = !vendoLista;
                setVendoLista(indo);
                // Recarrega ao abrir a lista: outra aba pode ter conversado
                // desde que este painel montou.
                if (indo) void carregarLista();
              }}
              aria-pressed={vendoLista}
              aria-label="Conversas salvas"
              title="Conversas salvas"
              className={acaoCabecalho}
            >
              <MessagesSquare className="size-4" aria-hidden="true" />
            </button>

            <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {vendoLista ? "Conversas" : (atual?.titulo ?? titulo)}
            </h2>

            <button
              type="button"
              onClick={novaConversa}
              aria-label="Nova conversa"
              title="Nova conversa"
              className={acaoCabecalho}
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              className={`-mr-0.5 ${acaoCabecalho}`}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>}

          {/* Uma linha, sempre visível enquanto durar: sem ela, "não ficou
              salva" só apareceria no dia em que a conversa não voltasse. */}
          {avisoArmazem && (
            <p className="flex shrink-0 items-start gap-1.5 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] leading-snug text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{avisoArmazem}</span>
              <button
                type="button"
                onClick={() => setAvisoArmazem(null)}
                aria-label="Dispensar aviso"
                className="shrink-0 opacity-60 transition hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </p>
          )}

          {vendoLista ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {carregandoLista ? (
                <p className="flex items-center justify-center gap-1.5 px-2 py-8 text-[12px] text-zinc-400 dark:text-zinc-500">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Carregando…
                </p>
              ) : conversas.length === 0 ? (
                <p className="px-2 py-8 text-center text-[12px] text-zinc-400 dark:text-zinc-500">
                  Nenhuma conversa ainda.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {conversas.map((c) => (
                    <li key={c.id} className="group/linha flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void escolher(c.id)}
                        className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left transition ${
                          c.id === atualId
                            ? "bg-zinc-100 dark:bg-zinc-900"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                        }`}
                      >
                        <span className="block truncate text-[13px] text-zinc-900 dark:text-zinc-50">
                          {c.titulo}
                        </span>
                        <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
                          {dataHora(c.em)} · {c.falas}{" "}
                          {c.falas === 1 ? "fala" : "falas"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void apagar(c.id)}
                        aria-label={`Apagar conversa "${c.titulo}"`}
                        className="shrink-0 rounded-lg p-1.5 text-zinc-300 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:opacity-100 group-hover/linha:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {abrindo && (
                <p className="flex items-center gap-1.5 text-[12px] text-zinc-400 dark:text-zinc-500">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Abrindo a conversa…
                </p>
              )}

              {!compactoEfetivo && !abrindo && falas.length === 0 && !parcial && (
                <div className="flex flex-col gap-2">
                  {/* Abertura: a marca ao lado do título dá cara de "converse
                      comigo" em vez de formulário vazio. */}
                  <div className="surge mb-1 flex items-center gap-2">
                    <MarcaIa cor={corIcone} />
                    <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                      {titulo}
                    </p>
                  </div>
                  <p className="surge text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {dica}
                  </p>
                  {sugestoes.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void perguntar(s)}
                      // O escalonamento é o que faz a lista "cair" em vez de
                      // aparecer em bloco. 60ms é curto o bastante para não
                      // atrasar quem já sabe o que quer clicar.
                      style={{ animationDelay: `${60 + i * 60}ms` }}
                      className="surge rounded-xl border border-zinc-200 px-3 py-2 text-left text-[12px] leading-snug text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-4">
                {falas.map((f, i) =>
                  f.papel === "eu" ? (
                    // Minha fala: balão PRETO à direita. Era cinza para não
                    // roubar o olho da resposta; com o painel sem fundo, o par
                    // preto/branco passou a ser o que separa pergunta de
                    // resposta. No tema escuro os dois se invertem — a mesma
                    // troca que o botão de enviar e as pílulas já fazem.
                    <div key={i} className="surge flex justify-end">
                      <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2 text-[14px] leading-[1.6] text-white ${SOMBRA} dark:bg-zinc-50 dark:text-zinc-900`}>
                        {f.texto}
                      </p>
                    </div>
                  ) : (
                    // Resposta: balão BRANCO, com a marca da IA fora dele. Ela
                    // ganhou balão junto com o fundo transparente do painel —
                    // sem fundo, texto solto não teria superfície nenhuma, e é a
                    // sombra que o descola da página (branca também).
                    //
                    // Mais largo que a pergunta (90% contra 85%): aqui cabe
                    // markdown com título e lista, e apertar isso só aumentaria
                    // a rolagem.
                    <div key={i} className="surge flex gap-2.5">
                      <MarcaIa cor={corIcone} />
                      <div className={BALAO_IA}>
                        <TextoIa texto={f.texto} />
                      </div>
                    </div>
                  ),
                )}

                {/* Em andamento: MESMA forma da fala pronta, para o texto não
                    pular de lugar quando o stream termina. A estrela gira
                    enquanto escreve; o cursor pisca no fim da linha. */}
                {parcial && (
                  <div className="flex gap-2.5">
                    <MarcaIa cor={corIcone} girando />
                    <div className={BALAO_IA}>
                      {/* O cursor vai DENTRO do TextoIa, no último bloco: solto
                          aqui embaixo ele pularia para uma linha própria a cada
                          parágrafo novo que o stream abre. */}
                      <TextoIa texto={parcial} cursor />
                    </div>
                  </div>
                )}

                {ocupado && !parcial && (
                  <div className="surge flex items-center gap-2.5">
                    <MarcaIa cor={corIcone} girando />
                    {/* O texto respira junto: só a estrela girando parecia
                        travada quando a ferramenta demora. */}
                    <span className="respira text-[12px] text-zinc-500 dark:text-zinc-400">
                      {ferramenta
                        ? `Consultando ${ferramenta.replaceAll("_", " ")}…`
                        : "Pensando…"}
                    </span>
                  </div>
                )}
              </div>

              <div ref={fimRef} />
            </div>
          )}

          {/* Contextos ligados nesta pergunta. Fica ACIMA do campo, à vista:
              um bloco de prompt esquecido ligado muda a resposta sem que
              ninguém entenda por quê. */}
          {!compactoEfetivo && !vendoLista && contextos.length > 0 && (
            <div className="shrink-0 border-t border-zinc-200 px-2.5 pt-2 dark:border-zinc-800">
              <div className="flex flex-wrap gap-1">
                {contextos.map((c) => {
                  const ligado = escolhidos.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => alternarContexto(c.id)}
                      title={c.descricao ?? "Bloco de prompt do projeto"}
                      aria-pressed={ligado}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                        ligado
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                          : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {c.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!vendoLista && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perguntar(pergunta);
              }}
              className={`flex shrink-0 items-end ${compactoEfetivo?"relative pt-3":"gap-2 border-t border-zinc-200 p-2.5 dark:border-zinc-800"}`}
            >
              <textarea
                ref={campoRef}
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                onKeyDown={(e) => {
                  // Enter envia, Shift+Enter quebra linha
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void perguntar(pergunta);
                  }
                }}
                rows={1}
                placeholder={campo}
                aria-label="Sua pergunta"
                autoFocus
                className={`max-h-24 min-h-9 flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-[13px] text-zinc-900 shadow-lg outline-none transition placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 ${compactoEfetivo?"rolagem-oculta min-h-11 rounded-2xl py-3 pr-12 focus:border-zinc-300 focus:ring-0 dark:focus:border-zinc-700":"focus-visible:ring-2 focus-visible:ring-zinc-900/10"}`}
              />
              <button
                type="submit"
                disabled={ocupado || !pergunta.trim()}
                aria-label="Enviar pergunta"
                className={`flex shrink-0 items-center justify-center bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 ${compactoEfetivo?"absolute bottom-1.5 right-1.5 size-8 rounded-full":"size-9 rounded-lg"}`}
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </button>
            </form>
          )}
        </section>
      )}

      {/* Na lateral aberta o botão sumiria atrás da própria coluna, e ela já
          tem o X no cabeçalho — dois controles de fechar no mesmo canto é ruído. */}
      {botaoFlutuante && (
      <button
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        aria-expanded={aberto}
        aria-label={rotulo}
        title={rotulo}
        // Preto e branco, não azul-sobre-azul. Com o app inteiro numa
        // superfície só, o botão de borda azul clara era o único objeto
        // saturado da tela e puxava o olho o tempo todo — para um controle que
        // fica parado no canto. Agora ele tem o mesmo peso dos outros botões
        // primários e cresce um nada no hover, que é o que sinaliza que é
        // clicável sem precisar de cor.
        className={`fixed bottom-5 right-5 ${camada} flex size-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-md transition hover:scale-105 hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 active:scale-95 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:border-zinc-500 dark:focus-visible:ring-zinc-100`}
      >
        {/* Respondendo: a MESMA estrela girando, não um spinner. Trocar o
            desenho no meio do trabalho faria o botão piscar de forma; girar a
            estrela mantém a identidade e diz o mesmo. */}
        <EstrelaIa
          className={`size-5 ${ocupado ? "estrela-pensando" : ""}`}
        />
      </button>
      )}
    </>
  );
}
