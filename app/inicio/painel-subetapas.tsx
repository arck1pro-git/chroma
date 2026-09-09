"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  MessageSquareText,
  Pause,
  Pencil,
  PhoneCall,
  Play,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  UserMinus,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Contato, Etapa, Oportunidade, Tag, Usuario } from "../data";
import { brl } from "../formato";
import CartaoOportunidade from "../funil/cartao";
import ChatIa from "../components/chat-ia";
import { proximoIdDeMensagem } from "@/lib/automacoes/cadencia";
import type { CadenciaDaEtapa, InstanciaEscolhivel } from "./cadencias";
import {
  alternarCadencia,
  criarCadencia,
  dispararCadencia,
  removerDaCadencia,
  salvarCadencia,
} from "./acoes-cadencia";
import {
  corDaEtapa,
  distribuir,
  passoDaCadencia,
  rotuloDoDia,
  type ColunaSubetapa,
  type Subetapa,
} from "./subetapas";

// Painel da cadência de UMA etapa, sobreposto ao quadro com o fundo desfocado.
// Cada coluna é uma mensagem — e uma mensagem é um BLOCO de uma automação de
// verdade (lib/automacoes/cadencia.ts), não um item de uma lista de tela.
//
// O ciclo tem dois botões, não quatro:
//   escrever (à mão ou por prompt) → Salvar → [Rodando|Pausada]
// Salvar grava a versão E leva ao n8n; o interruptor liga e desliga o workflow
// lá. "Disparar" continua existindo para inscrever de uma vez as oportunidades
// abertas da etapa — é a única ação em lote.
//
// O quadro NÃO se arrasta. Chegou a arrastar — soltar um card em outra coluna
// reinscrevia a oportunidade começando naquela mensagem —, e saiu: mover
// promete uma precisão que a cadência não tem. A coluna é ONDE O MOTOR CHEGOU,
// não um lugar em que se põe alguém; e "empurrar" um contato para a 4ª
// mensagem significava mandar aquele texto na hora, fora de qualquer régua.
//
// O que ficou é o que resolve na prática: TIRAR a oportunidade da cadência.
// O botão aparece no card de quem está no fluxo, cancela a inscrição e a
// espera pendurada nela, e a partir dali nada mais sai por aqui.
//
// Também não há checklist: marcar à mão o que "já saiu" competiria com o que o
// motor de fato executou, que é o que a coluna mostra.

const CANAIS: Record<string, { Icone: LucideIcon; rotulo: string }> = {
  whatsapp: { Icone: MessageSquareText, rotulo: "WhatsApp" },
  email: { Icone: Mail, rotulo: "E-mail" },
  ligacao: { Icone: PhoneCall, rotulo: "Ligação" },
};

const campoTexto =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

const botaoBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition disabled:pointer-events-none disabled:opacity-40";
const botaoClaro = `${botaoBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`;
const botaoEscuro = `${botaoBase} bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white`;

type Rascunho = {
  nome: string;
  canal: string;
  mensagem: string;
  dia: number;
  instanciaId: string | null;
};

// Nome curto da instância, para caber no cabeçalho da coluna. "Instância
// apagada" não é enfeite: se ela sumiu de Configurações depois de publicada, o
// bloco FALHA no disparo em vez de cair no .env — e a coluna precisa dizer
// isso antes de alguém apertar Disparar.
function nomeDaInstancia(
  id: string | null,
  instancias: InstanciaEscolhivel[],
): string {
  if (!id) return "instância do .env";
  const i = instancias.find((x) => x.id === id);
  return i ? i.nome : "instância apagada";
}

// ── Formulário de uma mensagem ──────────────────────────────────────────────
// O mesmo para criar e para editar: os campos são idênticos, e duplicá-los
// garantiria que um ganhasse validação que o outro não tem.
function FormSubetapa({
  titulo,
  inicial,
  rotuloAcao,
  instancias,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string;
  inicial: Rascunho;
  rotuloAcao: string;
  instancias: InstanciaEscolhivel[];
  aoConfirmar: (dados: Rascunho) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial.nome);
  const [canal, setCanal] = useState(inicial.canal);
  const [mensagem, setMensagem] = useState(inicial.mensagem);
  const [dia, setDia] = useState(String(inicial.dia));
  const [instanciaId, setInstanciaId] = useState<string | null>(
    inicial.instanciaId,
  );
  const nomeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nomeRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const limpo = nome.trim();
        if (!limpo) return;
        aoConfirmar({
          nome: limpo,
          canal,
          mensagem: mensagem.trim(),
          dia: Math.max(0, Number(dia) || 0),
          instanciaId,
        });
      }}
      onKeyDown={(e) => {
        // Esc fecha só o formulário; o listener do painel para no
        // stopPropagation, senão uma tecla fecharia as duas coisas de uma vez.
        if (e.key === "Escape") {
          e.stopPropagation();
          aoCancelar();
        }
      }}
      className="flex w-64 shrink-0 flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
      aria-label={titulo}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {titulo}
      </p>

      <input
        ref={nomeRef}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome da mensagem"
        className={campoTexto}
      />

      <div className="flex gap-1">
        {Object.entries(CANAIS).map(([chave, { Icone, rotulo }]) => (
          <button
            key={chave}
            type="button"
            onClick={() => setCanal(chave)}
            aria-pressed={canal === chave}
            title={rotulo}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-medium transition ${
              canal === chave
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            <Icone className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{rotulo}</span>
          </button>
        ))}
      </div>

      {/* O DIA é o que vira bloco de espera no fluxo — é ele, e não a ordem da
          coluna, que o motor obedece. Por isso está no formulário e não
          escondido numa regra implícita de "uma por dia". */}
      <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
        <span className="shrink-0">Sai no dia</span>
        <input
          type="number"
          min={0}
          value={dia}
          onChange={(e) => setDia(e.target.value)}
          className={`${campoTexto} w-20 tabular-nums`}
        />
        <span className="shrink-0 text-[11px] text-zinc-400">após entrar</span>
      </label>

      {/* A INSTÂNCIA é POR MENSAGEM: é ela que decide de qual número esta sai.
          Só aparece no WhatsApp porque é o único canal que fala com a uazapi —
          num bloco de e-mail ou de aviso ninguém a leria. */}
      {canal === "whatsapp" && (
        <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <Send className="size-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0">Enviar por</span>
          <select
            value={instanciaId ?? ""}
            onChange={(e) => setInstanciaId(e.target.value || null)}
            className={`${campoTexto} min-w-0 flex-1`}
          >
            <option value="">instância do .env</option>
            {instancias.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome}
                {i.numero ? ` · ${i.numero}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <textarea
        value={mensagem}
        onChange={(e) => setMensagem(e.target.value)}
        rows={4}
        placeholder="Mensagem enviada nesta subetapa"
        className={`${campoTexto} resize-none`}
      />

      <p className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
        Variáveis: {"{{nome}}"}, {"{{primeiro_nome}}"}, {"{{oportunidade}}"},{" "}
        {"{{valor}}"}.
      </p>

      {/* O que cada canal FAZ de verdade quando a automação dispara. Sem isto,
          uma coluna de e-mail parece que envia e-mail — e não envia. */}
      {canal !== "whatsapp" && (
        <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-300">
          {canal === "email"
            ? "E-mail ainda não sai: o motor pula este bloco e registra o motivo."
            : "Ligação não é discada pelo motor: vira um aviso no histórico do contato."}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={!nome.trim()} className={`${botaoEscuro} flex-1 justify-center`}>
          {rotuloAcao}
        </button>
        <button type="button" onClick={aoCancelar} className={botaoClaro}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ── Um card do quadro ───────────────────────────────────────────────────────
// O botão de sair só existe para quem está DENTRO do fluxo. Para quem nunca
// entrou, a coluna é previsão (a régua de dias) e não há inscrição nenhuma
// para cancelar — um botão ali prometeria desfazer algo que não aconteceu.
function CartaoNaCadencia({
  oportunidade,
  contato,
  responsavel,
  tags,
  noFluxo,
  removendo,
  aoRemover,
}: {
  oportunidade: Oportunidade;
  contato: Contato | undefined;
  responsavel: Usuario | undefined;
  tags: Tag[];
  noFluxo: boolean;
  removendo: boolean;
  aoRemover: () => void;
}) {
  return (
    <div className="group/card relative">
      <CartaoOportunidade
        oportunidade={oportunidade}
        contato={contato}
        responsavel={responsavel}
        tags={tags}
      />

      {noFluxo && (
        <button
          type="button"
          onClick={aoRemover}
          disabled={removendo}
          aria-label={`Remover ${oportunidade.nome} da cadência`}
          title="Remover da cadência: cancela a inscrição e nada mais é enviado por este fluxo"
          // Só no hover/foco do card, como o editar e o excluir da coluna: um
          // ícone fixo por card competiria com o conteúdo em 18 colunas.
          className="absolute right-1.5 top-1.5 rounded-lg bg-white/90 p-1 text-zinc-400 opacity-0 shadow-sm transition hover:text-red-700 focus-visible:opacity-100 group-hover/card:opacity-100 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-900/90 dark:text-zinc-500 dark:hover:text-red-400"
        >
          {removendo ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <UserMinus className="size-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}

// ── Uma coluna ──────────────────────────────────────────────────────────────

function Coluna({
  coluna,
  indice,
  cor,
  passo,
  instancias,
  emCadencia,
  removendoId,
  contatoPorId,
  usuarioPorId,
  tagsDoContato,
  aoEditar,
  aoExcluir,
  aoRemover,
}: {
  coluna: ColunaSubetapa;
  indice: number;
  // cor da etapa já traduzida para valor CSS
  cor: string;
  // posição desta coluna na cadência, de 0 a 100
  passo: number;
  instancias: InstanciaEscolhivel[];
  // quem tem inscrição viva neste fluxo agora
  emCadencia: Set<string>;
  removendoId: string | null;
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  tagsDoContato: Map<string, Tag[]>;
  aoEditar: () => void;
  aoExcluir: () => void;
  aoRemover: (oportunidade: Oportunidade) => void;
}) {
  const { subetapa, oportunidades, alemDaUltima } = coluna;
  const canal = CANAIS[subetapa.canal] ?? CANAIS.whatsapp;
  const total = oportunidades.reduce((soma, o) => soma + o.valor, 0);

  return (
    <section
      // .subetapa e .subetapa-faixa (logo abaixo) misturam --cor-etapa conforme
      // --passo, cada uma na sua proporção e com anexo próprio por tema; ver
      // globals.css. Daqui saem só a cor e a posição na cadência.
      className="subetapa group/coluna flex max-h-full w-64 shrink-0 flex-col rounded-2xl"
      style={{ "--cor-etapa": cor, "--passo": passo } as CSSProperties}
      aria-label={`Mensagem ${indice + 1} · ${subetapa.nome}`}
    >
      {/* Mesma faixa que identifica a etapa no quadro de trás, aqui na cor
          cheia e subindo com a cadência. É o sinal de cor à primeira vista: o
          corpo da coluna, preso ao teto de contraste, não chega lá sozinho. */}
      <span className="subetapa-faixa h-1.5 shrink-0 rounded-t-2xl" aria-hidden="true" />

      {/* Daqui pra baixo NÃO há cinza fixo: divisórias e rótulos são a própria
          tinta com alfa (zinc-900/N no claro, zinc-50/N no escuro). Sobre uma
          coluna que muda de tom a cada passo, um zinc-500 legível na 1ª coluna
          fica abaixo de 4,5:1 na 18ª — o alfa acompanha o fundo, o cinza não. */}
      <div className="shrink-0 border-b border-zinc-900/10 px-3 py-2.5 dark:border-zinc-50/15">
        <div className="flex items-center gap-2">
          {/* o número da mensagem é o que identifica a coluna — vem antes do nome */}
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-semibold tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
            {indice + 1}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
            {subetapa.nome}
          </h3>
          {/* "no topo o número de oportunidades ali" */}
          <span className="min-w-5 shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-zinc-800 dark:bg-black/40 dark:text-zinc-50">
            {oportunidades.length}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 pl-7">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-zinc-900/80 dark:text-zinc-50/80">
            <canal.Icone className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{canal.rotulo}</span>
          </span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-900/80 dark:text-zinc-50/80">
            {brl(total)}
          </span>
        </div>

        {/* De qual número ESTA mensagem sai. Fica no cabeçalho da coluna e não
            só no formulário porque, com uma instância por mensagem, ler a
            cadência de fora é a única forma de perceber que a 5ª sai por outro
            número. */}
        {subetapa.canal === "whatsapp" && (
          <p className="mt-0.5 flex items-center gap-1 pl-7 text-[11px] text-zinc-900/70 dark:text-zinc-50/70">
            <Send className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {nomeDaInstancia(subetapa.instanciaId, instancias)}
            </span>
          </p>
        )}

        <div className="mt-0.5 flex items-center gap-1 pl-7">
          <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-900/70 dark:text-zinc-50/70">
            {rotuloDoDia(subetapa.dia)}
            {alemDaUltima > 0 ? " ou depois" : ""}
          </p>
          {/* Editar e excluir só aparecem no hover/foco da coluna: com 18
              delas, dois ícones fixos em cada uma competiriam com o conteúdo. */}
          <button
            type="button"
            onClick={aoEditar}
            aria-label={`Editar mensagem ${indice + 1}`}
            className="shrink-0 rounded p-1 text-zinc-900/50 opacity-0 transition hover:bg-white/60 hover:text-zinc-900 focus-visible:opacity-100 group-hover/coluna:opacity-100 dark:text-zinc-50/60 dark:hover:bg-black/30 dark:hover:text-zinc-50"
          >
            <Pencil className="size-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={aoExcluir}
            aria-label={`Excluir mensagem ${indice + 1}`}
            className="shrink-0 rounded p-1 text-zinc-900/50 opacity-0 transition hover:bg-white/60 hover:text-red-700 focus-visible:opacity-100 group-hover/coluna:opacity-100 dark:text-zinc-50/60 dark:hover:bg-black/30 dark:hover:text-red-400"
          >
            <Trash2 className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* a mensagem em si, em balão: é ela que dá nome à subetapa */}
      <div className="shrink-0 border-b border-zinc-900/10 px-3 py-2.5 dark:border-zinc-50/15">
        <p className="rounded-xl rounded-tl-sm bg-white px-2.5 py-2 text-[12px] leading-snug text-zinc-600 shadow-sm dark:bg-zinc-950/70 dark:text-zinc-300">
          {subetapa.mensagem || (
            <span className="italic text-zinc-400 dark:text-zinc-500">
              Sem mensagem escrita
            </span>
          )}
        </p>
      </div>

      <div className="rolagem-oculta flex min-h-0 flex-col gap-2.5 overflow-y-auto rounded-b-2xl p-2.5">
        {oportunidades.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-900/20 px-3 py-4 text-center text-[11px] text-zinc-900/70 dark:border-zinc-50/25 dark:text-zinc-50/70">
            Ninguém nesta mensagem
          </p>
        ) : (
          oportunidades.map((o) => {
            const contato = contatoPorId.get(o.contato_id);
            return (
              <CartaoNaCadencia
                key={o.id}
                oportunidade={o}
                contato={contato}
                responsavel={
                  o.responsavel_id ? usuarioPorId.get(o.responsavel_id) : undefined
                }
                tags={contato ? (tagsDoContato.get(contato.id) ?? []) : []}
                noFluxo={emCadencia.has(o.id)}
                removendo={removendoId === o.id}
                aoRemover={() => aoRemover(o)}
              />
            );
          })
        )}
      </div>

      {alemDaUltima > 0 && (
        <p className="shrink-0 px-3 pb-2 pt-1 text-center text-[11px] tabular-nums text-zinc-900/70 dark:text-zinc-50/70">
          {alemDaUltima} {alemDaUltima === 1 ? "já passou" : "já passaram"} da
          última mensagem
        </p>
      )}
    </section>
  );
}

// ── Painel ──────────────────────────────────────────────────────────────────

export default function PainelSubetapas({
  etapa,
  cadencia,
  oportunidades,
  emCadencia,
  instancias,
  contatoPorId,
  usuarioPorId,
  tagsDoContato,
  aoFechar,
  conversaInicial = null,
}: {
  etapa: Etapa;
  // null = esta etapa ainda não tem cadência nenhuma
  cadencia: CadenciaDaEtapa | null;
  // as oportunidades REAIS da etapa; a régua de dias corre sobre elas
  oportunidades: Oportunidade[];
  instancias: InstanciaEscolhivel[];
  // quem tem inscrição viva em alguma cadência agora — é quem pode sair dela
  emCadencia: Set<string>;
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  tagsDoContato: Map<string, Tag[]>;
  aoFechar: () => void;
  // ?ia= da URL quando o link da sidebar apontou para a conversa DESTA cadência.
  conversaInicial?: string | null;
}) {
  const router = useRouter();
  const [pendente, comecar] = useTransition();

  // "Hoje" congelado na abertura do painel. O painel só monta depois de um
  // clique, então isto nunca roda no servidor e não há risco de hidratação —
  // mas recalcular a cada render faria as colunas mudarem no meio da sessão se
  // ela cruzasse a meia-noite, no meio de uma rolagem.
  const hoje = useMemo(() => new Date(), []);
  const cor = corDaEtapa(etapa.cor);

  // Edição local. O que está aqui é o rascunho da tela; só vai ao banco no
  // Salvar. `chave` reseta o estado quando o servidor devolve outra versão —
  // é o que faz o fluxo escrito por prompt aparecer sem F5.
  const chave = `${cadencia?.fluxoId ?? "nenhuma"}:${cadencia?.numeroVersao ?? 0}`;
  const [subetapas, setSubetapas] = useState<Subetapa[]>(
    cadencia?.subetapas ?? [],
  );
  const [chaveVista, setChaveVista] = useState(chave);
  const [sujo, setSujo] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro"; texto: string } | null>(
    null,
  );

  // Oportunidade cujo botão de sair está em curso: é o que troca o ícone pelo
  // giro naquele card e evita dois cliques na mesma remoção.
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  if (chave !== chaveVista) {
    // Durante o render, de propósito: é o padrão do React para estado derivado
    // de props. Num efeito, a tela pisca com as colunas velhas antes de trocar.
    setChaveVista(chave);
    setSubetapas(cadencia?.subetapas ?? []);
    setSujo(false);
  }

  const [editando, setEditando] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  // Onde cada oportunidade está: o último bloco que o motor executou para ela.
  // Quem nunca entrou no fluxo cai na régua de dias (ver `distribuir`).
  const posicao = cadencia?.posicao;

  const colunas = useMemo(
    () => distribuir(subetapas, oportunidades, hoje, posicao),
    [subetapas, oportunidades, hoje, posicao],
  );

  const quantidade = oportunidades.length;
  const total = oportunidades.reduce((s, o) => s + o.valor, 0);
  const quadroRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  // ── Edição das colunas ─────────────────────────────────────────────────────

  function criar(dados: Rascunho) {
    setSubetapas((atuais) => {
      // O id da coluna é o id do NÓ no fluxo — quem o escolhe é o mesmo módulo
      // que traduz coluna em bloco, senão os dois se desencontrariam.
      const nova: Subetapa = {
        id: proximoIdDeMensagem(atuais),
        ordem: atuais.length + 1,
        ...dados,
      };
      return ordenar([...atuais, nova]);
    });
    setSujo(true);
    setCriando(false);
    // A coluna nova nasce fora da tela, no fim de outras 18. Sem isto o clique
    // em "Criar" não teria efeito visível nenhum.
    requestAnimationFrame(() => {
      quadroRef.current?.scrollTo({
        left: quadroRef.current.scrollWidth,
        behavior: "smooth",
      });
    });
  }

  function editar(id: string, dados: Rascunho) {
    setSubetapas((atuais) =>
      ordenar(atuais.map((s) => (s.id === id ? { ...s, ...dados } : s))),
    );
    setSujo(true);
    setEditando(null);
  }

  function excluir(id: string) {
    setSubetapas((atuais) => ordenar(atuais.filter((s) => s.id !== id)));
    setSujo(true);
  }

  // Ordena por dia e renumera. `ordem` é o desempate de duas mensagens no
  // mesmo dia, e é o que escreverCadencia usa para montar a corrente.
  function ordenar(lista: Subetapa[]): Subetapa[] {
    return [...lista]
      .sort((a, b) => (a.dia === b.dia ? a.ordem - b.ordem : a.dia - b.dia))
      .map((s, i) => ({ ...s, ordem: i + 1 }));
  }

  // ── Ações do servidor ──────────────────────────────────────────────────────

  function executar(
    promessa: Promise<{ ok: boolean; mensagem?: string; erro?: string }>,
    opcoes?: { aoDarCerto?: () => void; aoFalhar?: () => void },
  ) {
    comecar(async () => {
      try {
        const r = await promessa;
        setAviso(
          r.ok
            ? { tom: "ok", texto: r.mensagem ?? "Pronto." }
            : { tom: "erro", texto: r.erro ?? "Não deu certo." },
        );
        if (r.ok) {
          opcoes?.aoDarCerto?.();
          router.refresh();
        } else {
          opcoes?.aoFalhar?.();
        }
      } catch (e) {
        // Server action que ESTOURA (erro de banco, motor fora do ar) rejeita a
        // promessa em vez de devolver { ok: false }. Sem este catch vira uma
        // "Uncaught PostgresError" no console e a tela não diz nada — que foi
        // exatamente o que aconteceu com o motor NOT NULL em fluxo_execucoes.
        setAviso({
          tom: "erro",
          texto: e instanceof Error ? e.message : "Falhou no servidor.",
        });
        opcoes?.aoFalhar?.();
      }
    });
  }

  function aoCriarCadencia() {
    comecar(async () => {
      try {
        await criarCadencia(etapa.id, etapa.nome);
        setAviso({
          tom: "ok",
          texto:
            "Cadência criada. Escreva as mensagens — ou peça à IA — e salve: é o Salvar que cria o workflow no n8n, pausado.",
        });
        router.refresh();
      } catch (e) {
        setAviso({
          tom: "erro",
          texto: e instanceof Error ? e.message : "Não consegui criar.",
        });
      }
    });
  }

  // ── Tirar uma oportunidade da cadência ─────────────────────────────────────
  //
  // Cancela a inscrição dela e a espera pendurada nela: a partir daí nada mais
  // é enviado por este fluxo para aquele contato. Sem confirmação de propósito
  // — o custo de errar é baixo (o próximo Disparar reinscreve) e um diálogo a
  // mais por card, num quadro com dezenas deles, cansa mais do que protege.
  function remover(o: Oportunidade) {
    if (!cadencia || removendoId) return;
    setRemovendoId(o.id);
    executar(removerDaCadencia(cadencia.fluxoId, o.id), {
      aoDarCerto: () => setRemovendoId(null),
      aoFalhar: () => setRemovendoId(null),
    });
  }

  const rodando = cadencia?.estado === "publicado";
  const estadoRotulo: Record<string, string> = {
    rascunho: "Não publicada",
    publicado: "Rodando",
    pausado: "Pausada",
    arquivado: "Arquivada",
  };

  return (
    <>
      {/* Véu mais forte que o das gavetas: aqui o pedido é desfocar o fundo,
          não só escurecê-lo — o quadro atrás tem colunas de cartões e
          continuaria disputando a leitura com as daqui. */}
      <div
        className="veu-surge fixed inset-0 z-[60] bg-black/50 backdrop-blur-md"
        onClick={aoFechar}
        aria-hidden="true"
      />

      <section
        className="surge fixed inset-3 z-[61] flex flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl md:inset-6 dark:border-zinc-800 dark:bg-zinc-950"
        role="dialog"
        aria-modal="true"
        aria-label={`Cadência de ${etapa.nome}`}
      >
        <header className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <span
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${etapa.cor}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Cadência · {etapa.nome}
                </h2>
                {cadencia && (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    {estadoRotulo[cadencia.estado] ?? cadencia.estado}
                    {cadencia.numeroVersao ? ` · v${cadencia.numeroVersao}` : ""}
                  </span>
                )}
                <span className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                  {quantidade} {quantidade === 1 ? "oportunidade" : "oportunidades"} ·{" "}
                  {brl(total)}
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {subetapas.length}{" "}
                  {subetapas.length === 1 ? "mensagem" : "mensagens"}
                </span>
                {cadencia && cadencia.noFluxo > 0 && (
                  <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {cadencia.noFluxo} na automação
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Cada coluna é uma mensagem da automação desta etapa, e cada uma
                sai pelo número escolhido nela. O card fica na última mensagem
                que o motor já executou para aquela oportunidade; quem ainda não
                entrou no fluxo aparece pela régua de dias. Para tirar alguém da
                sequência, use o botão no card.
              </p>
            </div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar cadência"
              className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* Barra de ações. O interruptor vem primeiro, à esquerda: é o estado
              da cadência, e é ele que decide se qualquer outra coisa aqui tem
              efeito no mundo. */}
          {cadencia && (
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <button
                type="button"
                role="switch"
                aria-checked={rodando}
                onClick={() =>
                  executar(alternarCadencia(cadencia.fluxoId, !rodando))
                }
                disabled={pendente || !cadencia.publicadoAlgumaVez}
                title={
                  cadencia.publicadoAlgumaVez
                    ? rodando
                      ? "Desativa o workflow no motor: nada entra nem anda"
                      : "Ativa o workflow no motor"
                    : "Salve a cadência primeiro — é o Salvar que cria o workflow no n8n"
                }
                className={`${botaoBase} border ${
                  rodando
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                {rodando ? (
                  <>
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                    Rodando
                    <Pause className="size-3.5 opacity-60" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-zinc-400"
                      aria-hidden="true"
                    />
                    Pausada
                    <Play className="size-3.5 opacity-60" aria-hidden="true" />
                  </>
                )}
              </button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    executar(salvarCadencia(cadencia.fluxoId, subetapas), {
                      aoDarCerto: () => setSujo(false),
                    })
                  }
                  disabled={pendente || subetapas.length === 0}
                  title="Grava a versão, sobe pro n8n, liga a cadência e inscreve as oportunidades abertas desta etapa. As mensagens saem."
                  className={botaoClaro}
                >
                  {pendente ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  Publicar{sujo ? " •" : ""}
                </button>

                <button
                  type="button"
                  onClick={() => executar(dispararCadencia(cadencia.fluxoId))}
                  disabled={pendente || sujo || !rodando}
                  title={
                    rodando
                      ? "Inscreve de uma vez as oportunidades abertas desta etapa"
                      : "A cadência precisa estar rodando para inscrever alguém"
                  }
                  className={botaoEscuro}
                >
                  <Send className="size-3.5" aria-hidden="true" />
                  Disparar
                </button>

                <Link
                  href={`/automacoes/${cadencia.fluxoId}`}
                  className={botaoClaro}
                  title="Abrir no editor de fluxo, com todos os blocos"
                >
                  <Workflow className="size-3.5" aria-hidden="true" />
                  Builder
                </Link>
              </div>
            </div>
          )}

          {aviso && (
            <p
              role="status"
              className={`ml-6 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] ${
                aviso.tom === "ok"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                  : "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200"
              }`}
            >
              {aviso.tom === "ok" ? (
                <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">{aviso.texto}</span>
              <button
                type="button"
                onClick={() => setAviso(null)}
                aria-label="Dispensar aviso"
                className="shrink-0 opacity-60 transition hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </p>
          )}

          {/* Quem já está dentro do fluxo continua na versão que o inscreveu, e
              o disparo usa a publicada. Este aviso é o caso em que o Salvar
              gravou a versão mas ela não chegou ao motor. */}
          {cadencia?.rascunhoPendente && !sujo && (
            <p className="ml-6 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Há uma versão salva que não chegou ao n8n. Quem for disparado
                agora recebe a versão que está lá, não esta — salve de novo.
              </span>
            </p>
          )}

          {cadencia && !cadencia.linear && (
            <p className="ml-6 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Esta automação tem desvios ou blocos que não cabem em colunas —
                o quadro mostra só o trecho em linha reta. Edite pelo{" "}
                <Link
                  href={`/automacoes/${cadencia.fluxoId}`}
                  className="underline underline-offset-2"
                >
                  builder
                </Link>{" "}
                para não perder o resto ao salvar daqui.
              </span>
            </p>
          )}
        </header>

        {/* barra de rolagem à mostra: com muitas colunas, esconder o único sinal
            de que existe mais coisa à direita seria esconder o quadro inteiro */}
        <div
          ref={quadroRef}
          className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-5 pb-4 pt-4"
        >
          {!cadencia ? (
            <div className="m-auto max-w-md text-center">
              <Sparkles
                className="mx-auto size-6 text-zinc-300 dark:text-zinc-600"
                aria-hidden="true"
              />
              <h3 className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Esta etapa ainda não tem cadência
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                A cadência é uma automação do n8n: cada coluna vira um bloco de
                mensagem, o intervalo entre elas vira uma espera, e salvar leva
                tudo isso ao motor — pausado, até você ligar. Crie e descreva o
                que quer no botão de IA — ou escreva as colunas à mão.
              </p>
              <button
                type="button"
                onClick={aoCriarCadencia}
                disabled={pendente}
                className={`${botaoEscuro} mx-auto mt-3`}
              >
                {pendente ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-3.5" aria-hidden="true" />
                )}
                Criar cadência desta etapa
              </button>
            </div>
          ) : (
            <>
                {colunas.map((coluna, i) =>
                  editando === coluna.subetapa.id ? (
                    <FormSubetapa
                      key={coluna.subetapa.id}
                      titulo={`Mensagem ${i + 1}`}
                      rotuloAcao="Salvar"
                      instancias={instancias}
                      inicial={{
                        nome: coluna.subetapa.nome,
                        canal: coluna.subetapa.canal,
                        mensagem: coluna.subetapa.mensagem,
                        dia: coluna.subetapa.dia,
                        instanciaId: coluna.subetapa.instanciaId,
                      }}
                      aoConfirmar={(d) => editar(coluna.subetapa.id, d)}
                      aoCancelar={() => setEditando(null)}
                    />
                  ) : (
                    <Coluna
                      key={coluna.subetapa.id}
                      coluna={coluna}
                      indice={i}
                      cor={cor}
                      passo={passoDaCadencia(i, colunas.length)}
                      instancias={instancias}
                      emCadencia={emCadencia}
                      removendoId={removendoId}
                      contatoPorId={contatoPorId}
                      usuarioPorId={usuarioPorId}
                      tagsDoContato={tagsDoContato}
                      aoEditar={() => setEditando(coluna.subetapa.id)}
                      aoExcluir={() => excluir(coluna.subetapa.id)}
                      aoRemover={remover}
                    />
                  ),
                )}

                {/* A coluna nova nasce no FIM da fila, e não num botão do
                    cabeçalho: o lugar em que ela vai aparecer é o mesmo em que
                    se clica pra criá-la. */}
                {criando ? (
                  <FormSubetapa
                    titulo={`Mensagem ${subetapas.length + 1}`}
                    rotuloAcao="Criar"
                    instancias={instancias}
                    inicial={{
                      nome: "",
                      canal: "whatsapp",
                      mensagem: "",
                      // um dia depois da última: é a cadência diária de sempre,
                      // e quem quiser outro intervalo troca o número no campo.
                      dia: subetapas.length
                        ? subetapas[subetapas.length - 1].dia + 1
                        : 0,
                      // e pelo mesmo número da última: trocar de instância no
                      // meio da cadência é a exceção, não o padrão.
                      instanciaId: subetapas.length
                        ? subetapas[subetapas.length - 1].instanciaId
                        : null,
                    }}
                    aoConfirmar={criar}
                    aoCancelar={() => setCriando(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setCriando(true)}
                    className="flex h-32 w-56 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-zinc-300 text-[12px] font-medium text-zinc-500 transition hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Nova mensagem
                  </button>
                )}
            </>
          )}
        </div>
      </section>

      {/* O prompt que monta a cadência. É a MESMA conversa do editor de fluxo
          (/api/ia/automacoes), presa ao fluxo desta etapa — o que ela grava é
          rascunho, e o `mudou` no fim do stream traz o canvas de volta com as
          colunas novas. z-[70] para ficar acima do painel (z-61). */}
      {cadencia && (
        <ChatIa
          camada="z-[70]"
          endpoint="/api/ia/automacoes"
          escopo={`cadencia:${cadencia.fluxoId}`}
          conversaInicial={conversaInicial}
          extra={{ fluxo_id: cadencia.fluxoId }}
          titulo="Montar esta cadência"
          rotulo="Montar a cadência com IA"
          dica={`Descreva a cadência da etapa "${etapa.nome}". A IA escreve os blocos e as esperas; salvar e ligar continuam sendo seu clique.`}
          campo="Ex.: 7 mensagens de WhatsApp em 10 dias…"
          sugestoes={[
            "Monte uma cadência de 5 mensagens de WhatsApp em 7 dias",
            "Acrescente uma mensagem no 14º dia retomando quem não respondeu",
            "Deixe os textos mais curtos e menos formais",
          ]}
          contexto={`cadência da etapa "${etapa.nome}", ${subetapas.length} mensagens, estado ${cadencia.estado}`}
          aoAplicar={() => {
            setSujo(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
