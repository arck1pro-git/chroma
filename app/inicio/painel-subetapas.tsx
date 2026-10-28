"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { INSTANCIA_RESPONSAVEL, USUARIO_RESPONSAVEL } from "@/lib/automacoes/saida";
import {
  AlertTriangle,
  BellRing,
  Check,
  ChevronRight,
  Clock,
  Loader2,
  Mail,
  MessageSquareText,
  Paperclip,
  Pencil,
  PhoneCall,
  Plus,
  Send,
  Sparkles,
  Trash2,
  UserMinus,
  UserRound,
  X,
  type TipoIcone,
} from "@/app/components/icones";
import SeletorRemetente from "./seletor-remetente";
import Link from "next/link";
import type { Contato, Etapa, Oportunidade, Tag, Usuario } from "@/lib/entidades";
import { brl } from "@/lib/formato";
import CartaoOportunidade from "../funil/cartao";
import { corDoRobo } from "../funil/ia";
import ChatIa from "../components/chat-ia";
import {
  duracaoEmTexto,
  esperaDaReuniao,
  instanteEmTexto,
  proximoIdDeMensagem,
  type AcaoCadencia,
  type Ancora,
} from "@/lib/automacoes/cadencia";
import { VARIAVEIS_DA_REUNIAO } from "@/lib/automacoes/reuniao-no-texto";
import { ICONE_PADRAO, ICONES } from "../automacoes/aparencia";
import type {
  CadenciaDaEtapa,
  InstanciaEscolhivel,
  PessoaAvisavel,
} from "./cadencias";
import type { Documento } from "@/lib/documentos";
import { excluirFluxo } from "../automacoes/acoes";
import {
  alternarCadencia,
  criarCadencia,
  removerDaCadencia,
  salvarCadencia,
} from "./acoes-cadencia";
import {
  distribuir,
  rotuloDoDia,
  type ColunaSubetapa,
  type Subetapa,
} from "./subetapas";

/** A cor do robô da IA no card deste contato NESTA etapa (null = sem IA). */
type Robo = (contato: Contato | undefined) => string | null;

// Painel da cadência de UMA etapa, sobreposto ao quadro com o fundo desfocado.
// Cada coluna é uma mensagem — e uma mensagem é um BLOCO de uma automação de
// verdade (lib/automacoes/cadencia.ts), não um item de uma lista de tela.
//
// O ciclo tem dois botões, não quatro:
//   escrever (à mão ou por prompt) → Publicar → [Rodando|Pausada]
// Publicar grava a versão E leva ao n8n; o interruptor liga e desliga o
// workflow lá.
//
// O quadro NÃO se arrasta. Chegou a arrastar — soltar um card em outra coluna
// reinscrevia a oportunidade começando naquela mensagem —, e saiu: mover
// promete uma precisão que a cadência não tem. A coluna é ONDE O MOTOR CHEGOU,
// não um lugar em que se põe alguém. O que ficou é TIRAR a oportunidade da
// cadência: o botão no card de quem está no fluxo cancela a inscrição.
//
// REVISÃO DE 2026-10-05 ("melhore 1000x"): a mesma lógica, outra leitura.
//   · o DIA virou a primeira coisa da coluna — é a régua da cadência, e era a
//     linha mais apagada dela;
//   · o cabeçalho separa o que a cadência É (título, estado, números) do que
//     se FAZ com ela (enviar por, publicar), e Publicar é a ação principal
//     quando há alteração;
//   · a mensagem mostra as variáveis como etiquetas, e o editor as insere no
//     cursor em vez de pedir que se digite {{primeiro_nome}} de cabeça;
//   · quem está parado numa espera aparece como nome, não como um cartão
//     espremido em 144px.

const CANAIS: Record<string, { Icone: TipoIcone; rotulo: string }> = {
  whatsapp: { Icone: MessageSquareText, rotulo: "WhatsApp" },
  email: { Icone: Mail, rotulo: "E-mail" },
  // "Aviso", não "Ligação": o motor não disca — manda um WhatsApp para alguém
  // da equipe (2026-10-16, o aviso de lead sem resposta é o uso de verdade).
  ligacao: { Icone: PhoneCall, rotulo: "Aviso" },
};

const MINUTOS_POR_DIA = 1440;
const UNIDADES = { min: 1, h: 60, dias: MINUTOS_POR_DIA } as const;
type Unidade = keyof typeof UNIDADES;

/** O instante da coluna na unidade mais redonda: 2880 → 2 dias, 120 → 2 h, 260 → 260 min. */
function emUnidade(minutos: number): { valor: number; unidade: Unidade } {
  if (minutos % MINUTOS_POR_DIA === 0) return { valor: minutos / MINUTOS_POR_DIA, unidade: "dias" };
  if (minutos % 60 === 0) return { valor: minutos / 60, unidade: "h" };
  return { valor: minutos, unidade: "min" };
}

/** A régua da coluna: "Na entrada", "Após 2 h", "Dia 3" ou "2 h antes da reunião". */
function rotuloDoInstante(s: { minutos: number; dia: number; ancora?: Ancora }): string {
  if (s.ancora === "reuniao") return instanteEmTexto("reuniao", s.minutos);
  if (s.minutos <= 0) return "Na entrada";
  if (s.minutos < MINUTOS_POR_DIA || s.minutos % MINUTOS_POR_DIA !== 0) return `Após ${duracaoEmTexto(s.minutos)}`;
  return `Dia ${s.dia}`;
}

// As variáveis que o motor troca no envio (textoParaExpressao, no adaptador do
// n8n). A ordem é a de uso: quase toda mensagem começa pelo primeiro nome.
const VARIAVEIS: { chave: string; rotulo: string }[] = [
  { chave: "primeiro_nome", rotulo: "Primeiro nome" },
  { chave: "nome", rotulo: "Nome" },
  { chave: "oportunidade", rotulo: "Oportunidade" },
  { chave: "valor", rotulo: "Valor" },
  // Só dígitos — é o que vai no link de vídeo rastreável (/videos):
  // …/v/<código>?w={{numero}}.
  { chave: "numero", rotulo: "WhatsApp" },
  // As da reunião marcada (2026-10-20): quem troca é o CRM, no envio, com a
  // reunião daquela hora (lib/automacoes/reuniao-no-texto.ts).
  ...VARIAVEIS_DA_REUNIAO.map((v) => ({ chave: v.chave, rotulo: v.rotulo })),
];
const ROTULO_DA_VARIAVEL = new Map(VARIAVEIS.map((v) => [v.chave, v.rotulo]));

// Sem largura: quem usa diz a sua. Com `w-full` aqui, um `w-14` ao lado perdia
// a disputa de classe e o campo do dia vazava do formulário.
const campo =
  "rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";
const campoTexto = `w-full ${campo}`;

const botaoBase =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition disabled:pointer-events-none disabled:opacity-40";
const botaoClaro = `${botaoBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`;
const botaoEscuro = `${botaoBase} bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white`;
const botaoIcone =
  "shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-900 focus-visible:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-50";

type Rascunho = {
  nome: string;
  canal: string;
  mensagem: string;
  // O instante em MINUTOS desde a entrada na cadência (o `dia` sai dele).
  minutos: number;
  instanciaId: string | null;
  documentoId: string | null;
  usuarioId: string | null;
  soSemResposta: boolean;
  // De onde conta `minutos`: a entrada, ou a reunião (aí negativo = antes).
  ancora: Ancora;
  // WhatsApp que sai mesmo que o lead tenha respondido (lembrete de reunião).
  ignorarResposta: boolean;
};

// "Quando", contado de onde: o terceiro campo do formulário.
type Sentido = "entrada" | "antes" | "depois";

/**
 * O anexo desta mensagem, dito na tela.
 *
 * "documento removido" não é enfeite: arquivar o documento na biblioteca não
 * limpa o fluxo, e uma coluna que aponta para um arquivo que saiu de circulação
 * precisa dizer isso ANTES de alguém publicar — no disparo, o envio falha.
 */
function nomeDoDocumento(id: string | null, documentos: Documento[]): string | null {
  if (!id) return null;
  return documentos.find((d) => d.id === id)?.nome ?? "documento removido";
}

/**
 * De qual número a mensagem sai, dito na tela, e se isso é um problema.
 *
 * Sem escolha, sai pela única cadastrada. Com duas ou mais, escolher é
 * obrigatório: a publicação recusa e diz qual mensagem ficou sem. Instância
 * apagada depois de publicada FALHA no disparo — a coluna avisa antes.
 */
function remetenteDaMensagem(
  id: string | null,
  instancias: InstanciaEscolhivel[],
): { rotulo: string; problema: boolean } {
  if (id === INSTANCIA_RESPONSAVEL) {
    return { rotulo: "Responsável da oportunidade", problema: false };
  }
  if (!id) {
    if (instancias.length === 1) return { rotulo: instancias[0].nome, problema: false };
    return {
      rotulo: instancias.length === 0 ? "nenhum número cadastrado" : "escolha o número",
      problema: true,
    };
  }
  const i = instancias.find((x) => x.id === id);
  return i ? { rotulo: i.nome, problema: false } : { rotulo: "número apagado", problema: true };
}

/** O texto da mensagem com as variáveis como etiquetas, como o lead não vê. */
function TextoComVariaveis({ texto }: { texto: string }) {
  const partes = texto.split(/(\{\{\s*\w+\s*\}\})/g);
  return (
    <>
      {partes.map((p, i) => {
        const chave = /^\{\{\s*(\w+)\s*\}\}$/.exec(p)?.[1];
        if (!chave) return <Fragment key={i}>{p}</Fragment>;
        return (
          <span
            key={i}
            className="inline-flex items-center rounded bg-sky-100 px-1 text-[11px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-200"
            title={`Trocado no envio: {{${chave}}}`}
          >
            {ROTULO_DA_VARIAVEL.get(chave) ?? chave}
          </span>
        );
      })}
    </>
  );
}

// ── Formulário de uma mensagem ──────────────────────────────────────────────
// O mesmo para criar e para editar: os campos são idênticos, e duplicá-los
// garantiria que um ganhasse validação que o outro não tem.
function FormSubetapa({
  titulo,
  inicial,
  rotuloAcao,
  instancias,
  documentos,
  avisaveis,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string;
  inicial: Rascunho;
  rotuloAcao: string;
  instancias: InstanciaEscolhivel[];
  documentos: Documento[];
  avisaveis: PessoaAvisavel[];
  aoConfirmar: (dados: Rascunho) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial.nome);
  const [canal, setCanal] = useState(inicial.canal);
  const [mensagem, setMensagem] = useState(inicial.mensagem);
  const [quando, setQuando] = useState(() => String(emUnidade(Math.abs(inicial.minutos)).valor));
  const [unidade, setUnidade] = useState<Unidade>(() => emUnidade(Math.abs(inicial.minutos)).unidade);
  const [sentido, setSentido] = useState<Sentido>(() =>
    inicial.ancora !== "reuniao" ? "entrada" : inicial.minutos < 0 ? "antes" : "depois",
  );
  const [instanciaId, setInstanciaId] = useState<string | null>(inicial.instanciaId);
  const [documentoId, setDocumentoId] = useState<string | null>(inicial.documentoId);
  const [usuarioId, setUsuarioId] = useState<string | null>(inicial.usuarioId);
  const [soSemResposta, setSoSemResposta] = useState(inicial.soSemResposta);
  const [ignorarResposta, setIgnorarResposta] = useState(inicial.ignorarResposta);
  const quantidade = Math.max(0, Math.round((Number(quando.replace(",", ".")) || 0) * UNIDADES[unidade]));
  const ancora: Ancora = sentido === "entrada" ? "entrada" : "reuniao";
  const minutos = sentido === "antes" ? -quantidade : quantidade;
  const nomeRef = useRef<HTMLInputElement | null>(null);
  const textoRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    nomeRef.current?.focus();
  }, []);

  // Insere {{variavel}} onde está o cursor (ou no fim), e devolve o foco ao
  // texto já depois dela: é o gesto de quem está no meio de uma frase.
  function inserir(chave: string) {
    const campo = textoRef.current;
    const marca = `{{${chave}}}`;
    const inicio = campo?.selectionStart ?? mensagem.length;
    const fim = campo?.selectionEnd ?? mensagem.length;
    setMensagem(mensagem.slice(0, inicio) + marca + mensagem.slice(fim));
    requestAnimationFrame(() => {
      campo?.focus();
      campo?.setSelectionRange(inicio + marca.length, inicio + marca.length);
    });
  }

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
          minutos,
          instanciaId,
          // Anexo só sobrevive no WhatsApp: é o único canal que manda arquivo.
          documentoId: canal === "whatsapp" ? documentoId : null,
          // Só a notificação tem alguém para avisar.
          usuarioId: canal === "ligacao" ? usuarioId : null,
          soSemResposta: canal === "ligacao" && soSemResposta,
          ancora,
          ignorarResposta: canal === "whatsapp" && ignorarResposta,
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
      className="flex w-[22rem] shrink-0 flex-col gap-3 rounded-xl border border-zinc-300 bg-white p-3.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      aria-label={titulo}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {titulo}
      </p>

      <input
        ref={nomeRef}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome da mensagem (só a equipe vê)"
        aria-label="Nome da mensagem"
        className={campoTexto}
      />

      {/* Canal e dia, as duas escolhas que definem a coluna. Em linhas
          separadas: lado a lado, "WhatsApp" não cabia e virava "WhatsA…". */}
      <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800" role="radiogroup" aria-label="Canal">
        {Object.entries(CANAIS).map(([chave, { Icone, rotulo }]) => (
          <button
            key={chave}
            type="button"
            role="radio"
            aria-checked={canal === chave}
            onClick={() => setCanal(chave)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition ${
              canal === chave
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            <Icone className="size-3.5 shrink-0" aria-hidden="true" />
            {rotulo}
          </button>
        ))}
      </div>

      {/* QUANDO SAI é o que vira bloco de espera no fluxo — é ele, e não a
          ordem da coluna, que o motor obedece. Em minutos, horas ou dias
          (2026-10-16: mensagem 2h depois, aviso 20 min depois da última), e
          contado da entrada ou da REUNIÃO marcada (2026-10-20: o anti no-show
          sai 1 dia, 2 h e 10 min antes dela, e na hora). */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <Clock className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="w-14 shrink-0">Quando</span>
          <input
            type="number"
            min={0}
            value={quando}
            onChange={(e) => setQuando(e.target.value)}
            aria-label="Quanto tempo"
            className={`${campo} w-14 px-1.5 text-center tabular-nums`}
          />
          <select
            value={unidade}
            onChange={(e) => setUnidade(e.target.value as Unidade)}
            aria-label="Unidade"
            className={`${campo} w-[4.25rem] px-1.5`}
          >
            <option value="min">min</option>
            <option value="h">h</option>
            <option value="dias">dias</option>
          </select>
        </div>
        {/* Contado de onde, numa linha própria: ao lado do número não cabia. */}
        <div className="flex items-center gap-2 pl-[5.5rem]">
          <select
            value={sentido}
            onChange={(e) => setSentido(e.target.value as Sentido)}
            aria-label="Contado de onde"
            className={`${campo} min-w-0 flex-1 px-1.5`}
          >
            <option value="entrada">depois de entrar na etapa</option>
            <option value="antes">antes da reunião marcada</option>
            <option value="depois">depois da reunião marcada</option>
          </select>
        </div>
        <p className="pl-[5.5rem] text-[11px] text-zinc-400 dark:text-zinc-500">Sai: {instanteEmTexto(ancora, minutos).toLowerCase()}</p>
      </div>

      {/* DE ONDE SAI: a instância é POR MENSAGEM. WhatsApp e ligação (o aviso
          à equipe também é um WhatsApp) saem por um número escolhido aqui. */}
      {(canal === "whatsapp" || canal === "ligacao") && (
        <SeletorRemetente valor={instanciaId} instancias={instancias} aoMudar={setInstanciaId} />
      )}

      {/* O ANEXO. Só no WhatsApp: é o único canal que sabe mandar arquivo. O
          que se escolhe é um documento da biblioteca (/documentos), não um
          upload — senão cada mensagem teria a sua cópia. */}
      {canal === "whatsapp" && (
        <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <Paperclip className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="w-14 shrink-0">Anexo</span>
          <select
            value={documentoId ?? ""}
            onChange={(e) => setDocumentoId(e.target.value || null)}
            disabled={documentos.length === 0}
            className={`${campoTexto} min-w-0 flex-1 disabled:opacity-60`}
          >
            <option value="">{documentos.length === 0 ? "biblioteca vazia" : "sem anexo"}</option>
            {documentos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* QUEM AVISAR. O aviso é um WhatsApp para o número da pessoa
          (usuarios.whatsapp) — só aparece quem tem número cadastrado. */}
      {canal === "ligacao" && (
        <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <PhoneCall className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="w-14 shrink-0">Avisar</span>
          <select
            value={usuarioId ?? ""}
            onChange={(e) => setUsuarioId(e.target.value || null)}
            className={`${campoTexto} min-w-0 flex-1`}
          >
            <option value="">escolha quem recebe</option>
            {/* Quem for o responsável na hora do aviso: trocar o responsável
                da oportunidade leva o aviso junto. */}
            <option value={USUARIO_RESPONSAVEL}>Responsável da oportunidade</option>
            {avisaveis.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      {canal === "ligacao" && (
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={soSemResposta}
            onChange={(e) => setSoSemResposta(e.target.checked)}
            className="size-3.5 shrink-0 accent-zinc-900 dark:accent-zinc-100"
          />
          Só se o lead não tiver respondido
        </label>
      )}
      {/* O padrão da cadência é parar quando o lead fala. Lembrete de reunião é
          a exceção: sai mesmo assim (e para se o card sair da etapa). */}
      {canal === "whatsapp" && (
        <label className="flex cursor-pointer items-start gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={ignorarResposta}
            onChange={(e) => setIgnorarResposta(e.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-zinc-900 dark:accent-zinc-100"
          />
          <span>
            Enviar mesmo se o lead responder
            <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
              Para lembretes. Sem isso, a cadência para quando ele responde.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-col gap-1.5">
        <textarea
          ref={textoRef}
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          rows={7}
          placeholder={canal === "ligacao" ? "O que a pessoa avisada deve fazer" : "O que o lead recebe"}
          aria-label="Texto da mensagem"
          className={`${campoTexto} resize-y leading-relaxed`}
        />
        <div className="flex flex-wrap items-center gap-1">
          {VARIAVEIS.map((v) => (
            <button
              key={v.chave}
              type="button"
              onClick={() => inserir(v.chave)}
              title={`Insere {{${v.chave}}} no cursor`}
              className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 transition hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500/25"
            >
              + {v.rotulo}
            </button>
          ))}
          <span className="ml-auto text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {mensagem.length}
          </span>
        </div>
      </div>

      {/* O que muda no envio. Com anexo, sai UM envio: o arquivo com o texto de
          legenda. E-mail e ligação não fazem o que o nome sugere. */}
      {(canal !== "whatsapp" || documentoId) && (
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {canal === "email"
            ? "E-mail ainda não sai: o motor pula este bloco e registra o motivo."
            : canal === "ligacao"
              ? "Sai um WhatsApp para quem você escolher, com este texto e os dados do lead: nome, WhatsApp, valor, funil, etapa e o link da conversa."
              : "O texto vai como legenda do anexo, num envio só. Vazio, sai só o arquivo."}
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
// para cancelar.
function CartaoNaCadencia({
  oportunidade,
  contato,
  responsavel,
  tags,
  ia,
  pediuAtendimento,
  noFluxo,
  removendo,
  aoRemover,
}: {
  oportunidade: Oportunidade;
  contato: Contato | undefined;
  responsavel: Usuario | undefined;
  tags: Tag[];
  ia: string | null;
  pediuAtendimento: boolean;
  noFluxo: boolean;
  removendo: boolean;
  aoRemover: (() => void) | null;
}) {
  return (
    <div className="group/card relative">
      <CartaoOportunidade
        oportunidade={oportunidade}
        contato={contato}
        responsavel={responsavel}
        tags={tags}
        ia={ia}
        pediuAtendimento={pediuAtendimento}
      />

      {noFluxo && aoRemover && (
        <button
          type="button"
          onClick={aoRemover}
          disabled={removendo}
          aria-label={`Remover ${oportunidade.nome} da cadência`}
          title="Tirar da cadência: cancela a inscrição e nada mais é enviado por este fluxo"
          className="absolute right-2 top-2 rounded-lg bg-white/90 p-1 text-zinc-400 opacity-0 shadow-sm transition hover:text-red-700 focus-visible:opacity-100 group-hover/card:opacity-100 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-900/90 dark:text-zinc-500 dark:hover:text-red-400"
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

// ── O intervalo entre duas mensagens ────────────────────────────────────────

/**
 * O que o fluxo faz ENTRE duas mensagens: esperar, mudar tag, mudar segmento,
 * chamar um serviço. Uma etiqueta por bloco, na ordem em que rodam, sobre um
 * traço que liga as duas colunas.
 *
 * Só leitura. Editar estes blocos é no builder; o que esta tela garante é que
 * eles não somem ao salvar (ver `escreverCadencia`) e que quem olha a cadência
 * sabe que existem.
 *
 * Quem está PARADO num deles (na prática, numa espera) aparece pelo NOME, logo
 * abaixo: era um cartão inteiro espremido em 144px, com "7 dias na etapa"
 * quebrando em três linhas.
 */
function Intervalo({
  acoes,
  porAcao,
  contatoPorId,
  seNaoResponder = false,
}: {
  acoes: AcaoCadencia[];
  porAcao: Map<string, Oportunidade[]>;
  contatoPorId: Map<string, Contato>;
  /** O passo seguinte só sai se o lead não respondeu (mensagem, ou aviso com a trava). */
  seNaoResponder?: boolean;
}) {
  if (acoes.length === 0) {
    // Mensagens no mesmo dia: um traço curto, sem etiqueta, só para a
    // sequência não parecer duas cadências.
    return <div className="mt-[3.25rem] h-px w-4 shrink-0 bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />;
  }

  return (
    <div className="flex w-32 shrink-0 flex-col items-stretch gap-2 pt-11">
      {acoes.map((a) => {
        const Icone = ICONES[a.tipo] ?? ICONE_PADRAO;
        const parados = porAcao.get(a.id) ?? [];
        const espera = a.tipo === "esperar";
        // "Até 2 h antes" + "da reunião" embaixo: numa linha só não cabe.
        const daReuniao = esperaDaReuniao(a);
        const m = Math.round(Number(a.config.minutos) || 0);
        const rotulo = daReuniao
          ? m === 0
            ? "Até a hora"
            : `Até ${duracaoEmTexto(Math.abs(m))} ${m < 0 ? "antes" : "depois"}`
          : espera
            ? `Espera ${a.detalhe}`
            : a.detalhe || a.rotulo;
        return (
          <div key={a.id} className="flex flex-col items-center gap-1.5">
            {/* A seta da sequência: mensagem → espera → próxima. Lida da
                esquerda para a direita como o fluxo anda (pedido dele,
                2026-10-16: ver as esperas e as mensagens de um jeito
                intuitivo). */}
            <div className="relative flex w-full items-center justify-center">
              <span className="absolute inset-x-0 top-1/2 h-px bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />
              <ChevronRight className="absolute -right-1.5 top-1/2 size-4 -translate-y-1/2 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
              <span
                title={a.detalhe ? `${a.rotulo} · ${a.detalhe}` : a.rotulo}
                className="relative inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
              >
                <Icone className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="truncate">{rotulo}</span>
              </span>
            </div>
            {daReuniao && <span className="-mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">da reunião</span>}
            {espera && seNaoResponder && (
              <span className="-mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">se não responder</span>
            )}
            {parados.length > 0 && (
              <ul className="flex w-full flex-col gap-1" aria-label={`Esperando: ${parados.length}`}>
                {parados.map((o) => (
                  <li
                    key={o.id}
                    title={`${o.nome} · ${o.dias_na_etapa} ${o.dias_na_etapa === 1 ? "dia" : "dias"} na etapa`}
                    className="flex items-center gap-1.5 truncate rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    <Clock className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{contatoPorId.get(o.contato_id)?.nome ?? o.nome}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Uma coluna ──────────────────────────────────────────────────────────────

function Coluna({
  coluna,
  indice,
  cor,
  instancias,
  documentos,
  emCadencia,
  removendoId,
  contatoPorId,
  usuarioPorId,
  tagsDoContato,
  aoEditar,
  aoExcluir,
  aoRemover,
  robo,
  pediu,
}: {
  robo: Robo;
  /** O contato foi para o atendimento humano e espera resposta (a pill do card). */
  pediu: (contato: Contato | undefined) => boolean;
  coluna: ColunaSubetapa;
  indice: number;
  // A classe de cor da etapa ("bg-sky-500"), a mesma que pinta a faixa da
  // coluna no quadro de trás.
  cor: string;
  instancias: InstanciaEscolhivel[];
  documentos: Documento[];
  // quem tem inscrição viva neste fluxo agora
  emCadencia: Set<string>;
  removendoId: string | null;
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  tagsDoContato: Map<string, Tag[]>;
  aoEditar: () => void;
  aoExcluir: () => void;
  aoRemover: ((oportunidade: Oportunidade) => void) | null;
}) {
  const { subetapa, oportunidades, alemDaUltima } = coluna;
  const canal = CANAIS[subetapa.canal] ?? CANAIS.whatsapp;
  const remetente = remetenteDaMensagem(subetapa.instanciaId, instancias);
  const anexo = subetapa.canal === "whatsapp" ? nomeDoDocumento(subetapa.documentoId, documentos) : null;

  return (
    <section
      // A MESMA CASCA DA ETAPA DO FUNIL (app/inicio/inicio.tsx): mesma largura,
      // mesmo raio, mesmo fundo, mesma faixa de cor no topo. Uma mensagem da
      // cadência é um passo da etapa, e ler as duas telas é a mesma leitura.
      className="group/coluna relative flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-zinc-100/70 dark:bg-zinc-900/50"
      aria-label={`Mensagem ${indice + 1} · ${subetapa.nome}`}
    >
      <span className={`h-1.5 shrink-0 rounded-t-xl ${cor}`} aria-hidden="true" />

      <div className="shrink-0 px-3 pb-2.5 pt-2.5">
        {/* A RÉGUA PRIMEIRO: o número da mensagem e o dia em que ela sai. */}
        <div className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
            {indice + 1}
          </span>
          <span className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">
            {rotuloDoInstante(subetapa)}
          </span>
          <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {/* "amanhã", "em 3 dias": só para quem sai em dia cheio. */}
            {rotuloDoInstante(subetapa).startsWith("Dia") ? rotuloDoDia(subetapa.dia) : ""}
            {alemDaUltima > 0 ? " ou depois" : ""}
          </span>
          {/* Editar e excluir no hover/foco da coluna: com 18 delas, dois
              ícones fixos em cada uma competiriam com o conteúdo. */}
          <span className="ml-auto flex shrink-0 items-center opacity-0 transition group-focus-within/coluna:opacity-100 group-hover/coluna:opacity-100">
            <button type="button" onClick={aoEditar} aria-label={`Editar mensagem ${indice + 1}`} className={botaoIcone}>
              <Pencil className="size-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={aoExcluir}
              aria-label={`Excluir mensagem ${indice + 1}`}
              className={`${botaoIcone} hover:text-red-700 dark:hover:text-red-400`}
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </button>
          </span>
        </div>

        <h3 className="mt-1.5 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50" title={subetapa.nome}>
          {subetapa.nome}
        </h3>

        {/* Canal e de onde sai, numa linha só. O número fica à vista na
            coluna, e não só no formulário: com uma instância por mensagem,
            ler a cadência de fora é a única forma de ver que a 5ª sai por
            outro. Em âmbar quando não vai sair. */}
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <canal.Icone className="size-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0">{canal.rotulo}</span>
          {(subetapa.canal === "whatsapp" || subetapa.canal === "ligacao") && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className={`truncate ${remetente.problema ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}
                title="Número de onde esta mensagem sai"
              >
                {remetente.rotulo}
              </span>
            </>
          )}
          <span className="ml-auto shrink-0 rounded-full bg-zinc-200 px-1.5 py-px text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Oportunidades nesta mensagem">
            {oportunidades.length}
          </span>
        </p>

        {anexo && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Paperclip className="size-3 shrink-0" aria-hidden="true" />
            <span className={`truncate ${anexo === "documento removido" ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>
              {anexo}
            </span>
          </p>
        )}

        {/* QUEM O AVISO AVISA, à vista na coluna: é a pergunta de quem lê a
            cadência ("e se ele não responder, quem fica sabendo?"). */}
        {subetapa.canal === "ligacao" && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <UserRound className="size-3 shrink-0" aria-hidden="true" />
            <span
              title={
                subetapa.soSemResposta
                  ? "O aviso só sai se o lead não tiver respondido desde que entrou na cadência"
                  : "O aviso sai mesmo que o lead tenha respondido"
              }
              className={`truncate ${subetapa.usuarioId ? "" : "font-medium text-amber-700 dark:text-amber-400"}`}
            >
              {subetapa.usuarioId === USUARIO_RESPONSAVEL
                ? "Para o responsável"
                : subetapa.usuarioId
                  ? `Para ${usuarioPorId.get(subetapa.usuarioId)?.nome ?? "pessoa removida"}`
                  : "escolha quem recebe"}
              {subetapa.soSemResposta ? " · só se não respondeu" : ""}
            </span>
          </p>
        )}

        {/* O LEMBRETE sai mesmo que o lead tenha respondido — diferente do
            resto da cadência, e por isso dito na coluna. */}
        {subetapa.canal === "whatsapp" && subetapa.ignorarResposta && (
          <p
            className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
            title="Sai mesmo se o lead tiver respondido. Para se a oportunidade sair da etapa."
          >
            <BellRing className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">Lembrete · sai mesmo se responder</span>
          </p>
        )}

        {/* A mensagem em balão, e o balão é o atalho para editar: é nela que
            se clica quando se quer mudar o texto. */}
        <button
          type="button"
          onClick={aoEditar}
          title="Editar esta mensagem"
          className="mt-2.5 block w-full rounded-xl rounded-tl-sm bg-white px-3 py-2 text-left text-[12px] leading-relaxed text-zinc-700 shadow-sm ring-1 ring-zinc-200/70 transition hover:ring-zinc-300 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:ring-zinc-700"
        >
          {subetapa.mensagem ? (
            <span className="line-clamp-[8] whitespace-pre-line">
              <TextoComVariaveis texto={subetapa.mensagem} />
            </span>
          ) : (
            <span className="italic text-zinc-400 dark:text-zinc-500">Sem texto. Clique para escrever.</span>
          )}
        </button>
      </div>

      <div className="rolagem-oculta flex min-h-0 flex-col gap-2.5 overflow-y-auto rounded-b-xl border-t border-zinc-200 p-2.5 dark:border-zinc-800">
        {oportunidades.length === 0 ? (
          <p className="px-3 py-3 text-center text-[11px] text-zinc-400 dark:text-zinc-500">Ninguém nesta mensagem</p>
        ) : (
          oportunidades.map((o) => {
            const contato = contatoPorId.get(o.contato_id);
            return (
              <CartaoNaCadencia
                key={o.id}
                oportunidade={o}
                contato={contato}
                responsavel={o.responsavel_id ? usuarioPorId.get(o.responsavel_id) : undefined}
                tags={contato ? (tagsDoContato.get(contato.id) ?? []) : []}
                ia={robo(contato)}
                pediuAtendimento={pediu(contato)}
                noFluxo={emCadencia.has(o.id)}
                removendo={removendoId === o.id}
                aoRemover={aoRemover ? () => aoRemover(o) : null}
              />
            );
          })
        )}
      </div>

      {alemDaUltima > 0 && (
        <p className="shrink-0 px-3 pb-2 pt-1 text-center text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {alemDaUltima} {alemDaUltima === 1 ? "já passou" : "já passaram"} da última mensagem
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
  documentos,
  avisaveis,
  contatoPorId,
  usuarioPorId,
  tagsDoContato,
  pediramAtendimento,
  aoFechar,
  conversaInicial = null,
}: {
  etapa: Etapa;
  // null = esta etapa ainda não tem cadência nenhuma
  cadencia: CadenciaDaEtapa | null;
  // as oportunidades REAIS da etapa; a régua de dias corre sobre elas
  oportunidades: Oportunidade[];
  instancias: InstanciaEscolhivel[];
  documentos: Documento[];
  avisaveis: PessoaAvisavel[];
  // quem tem inscrição viva em alguma cadência agora — é quem pode sair dela
  emCadencia: Set<string>;
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  tagsDoContato: Map<string, Tag[]>;
  /** Contatos que foram para o atendimento humano e esperam resposta (a pill do card). */
  pediramAtendimento: Set<string>;
  aoFechar: () => void;
  // ?ia= da URL quando o link da sidebar apontou para a conversa DESTA cadência.
  conversaInicial?: string | null;
}) {
  const router = useRouter();
  const [pendente, comecar] = useTransition();
  // Demonstração (?demo=cadencia): não há fluxo por trás, então nada chama o
  // servidor — os botões que gravam ficam desligados e o topo avisa.
  const demo = cadencia?.demonstracao === true;

  // "Hoje" congelado na abertura do painel. O painel só monta depois de um
  // clique, então isto nunca roda no servidor e não há risco de hidratação —
  // mas recalcular a cada render faria as colunas mudarem no meio da sessão se
  // ela cruzasse a meia-noite.
  const hoje = useMemo(() => new Date(), []);
  const cor = etapa.cor;
  // O painel é de UMA etapa: o robô de cada card depende só do contato.
  const robo: Robo = (contato) => corDoRobo(contato, etapa);
  const pediu = (contato: Contato | undefined) => (contato ? pediramAtendimento.has(contato.id) : false);

  // Edição local. O que está aqui é o rascunho da tela; só vai ao banco no
  // Publicar. `chave` reseta o estado quando o servidor devolve outra versão —
  // é o que faz o fluxo escrito por prompt aparecer sem F5.
  const chave = `${cadencia?.fluxoId ?? "nenhuma"}:${cadencia?.numeroVersao ?? 0}`;
  const [subetapas, setSubetapas] = useState<Subetapa[]>(cadencia?.subetapas ?? []);
  const [chaveVista, setChaveVista] = useState(chave);
  const [sujo, setSujo] = useState(false);
  // Quem o próximo Publicar pega. Vai junto no salvar: é decisão da
  // publicação, e não faz sentido gravá-la sem publicar.
  const [inscreverAtuais, setInscreverAtuais] = useState(cadencia?.inscreverAtuais ?? true);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  // Oportunidade cujo botão de sair está em curso.
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  const [editando, setEditando] = useState<string | null>(null);
  // Cadência sem mensagem nenhuma já abre no formulário da primeira: é a única
  // coisa a fazer ali, e um quadro vazio com um botão "+" era um clique a mais.
  const [criando, setCriando] = useState(!cadencia || cadencia.subetapas.length === 0);

  if (chave !== chaveVista) {
    // Durante o render, de propósito: é o padrão do React para estado derivado
    // de props. Num efeito, a tela pisca com as colunas velhas antes de trocar.
    setChaveVista(chave);
    setSubetapas(cadencia?.subetapas ?? []);
    setSujo(false);
    if (cadencia && cadencia.subetapas.length === 0) setCriando(true);
  }

  // Onde cada oportunidade está: o último bloco que o motor executou para ela.
  const posicao = cadencia?.posicao;

  // Os blocos de ação do fluxo, pelo id: é o que diz à `distribuir` que aquela
  // posição não é uma coluna, e sim uma espera (ou uma tag) entre duas.
  const idsDeAcao = useMemo(() => {
    const ids = new Set<string>();
    for (const s of subetapas) for (const a of s.acoes) ids.add(a.id);
    for (const a of cadencia?.acoesFinais ?? []) ids.add(a.id);
    return ids;
  }, [subetapas, cadencia?.acoesFinais]);

  const { colunas, porAcao } = useMemo(
    () => distribuir(subetapas, oportunidades, hoje, posicao, emCadencia, idsDeAcao),
    [subetapas, oportunidades, hoje, posicao, emCadencia, idsDeAcao],
  );

  const quantidade = oportunidades.length;
  const total = oportunidades.reduce((s, o) => s + o.valor, 0);
  // Até onde a cadência vai: "em 12 dias" ou, com lembretes, "até 10 min
  // depois da reunião".
  const ultimaSub = subetapas.length ? subetapas[subetapas.length - 1] : null;
  const duracao = ultimaSub && ultimaSub.ancora !== "reuniao" ? ultimaSub.minutos : 0;
  const ateReuniao = ultimaSub?.ancora === "reuniao" ? instanteEmTexto("reuniao", ultimaSub.minutos).toLowerCase() : null;
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
        // Coluna nova não tem ação nenhuma antes dela; a espera sai do
        // instante, e quem grava a monta a partir dele.
        dia: dados.ancora === "reuniao" ? 0 : Math.round(dados.minutos / MINUTOS_POR_DIA),
        acoes: [],
      };
      return ordenar([...atuais, nova]);
    });
    setSujo(true);
    setCriando(false);
    // A coluna nova nasce no fim da fila, fora da tela.
    requestAnimationFrame(() => {
      quadroRef.current?.scrollTo({ left: quadroRef.current.scrollWidth, behavior: "smooth" });
    });
  }

  function editar(id: string, dados: Rascunho) {
    setSubetapas((atuais) =>
      ordenar(
        atuais.map((s) =>
          s.id === id
            ? { ...s, ...dados, dia: dados.ancora === "reuniao" ? 0 : Math.round(dados.minutos / MINUTOS_POR_DIA) }
            : s,
        ),
      ),
    );
    setSujo(true);
    setEditando(null);
  }

  function excluir(id: string) {
    setSubetapas((atuais) => ordenar(atuais.filter((s) => s.id !== id)));
    setSujo(true);
  }

  // Ordena pelo instante e renumera. `ordem` é o desempate de duas mensagens
  // no mesmo instante, e é o que escreverCadencia usa para montar a corrente.
  // As contadas da REUNIÃO vêm depois das contadas da entrada — a mesma ordem
  // de escreverCadencia (lib/automacoes/cadencia.ts).
  function ordenar(lista: Subetapa[]): Subetapa[] {
    const daReuniao = (s: Subetapa) => s.ancora === "reuniao";
    return [...lista]
      .sort((a, b) => {
        if (daReuniao(a) !== daReuniao(b)) return daReuniao(a) ? 1 : -1;
        return a.minutos === b.minutos ? a.ordem - b.ordem : a.minutos - b.minutos;
      })
      .map((s, i) => ({ ...s, ordem: i + 1 }));
  }

  // ── Ações do servidor ──────────────────────────────────────────────────────

  function executar(
    promessa: () => Promise<{ ok: boolean; mensagem?: string; erro?: string }>,
    opcoes?: { aoDarCerto?: () => void; aoFalhar?: () => void },
  ) {
    if (demo) {
      setAviso({ tom: "erro", texto: "Demonstração: nada aqui é gravado nem enviado." });
      opcoes?.aoFalhar?.();
      return;
    }
    comecar(async () => {
      try {
        const r = await promessa();
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
        // "Uncaught" no console e a tela não diz nada.
        setAviso({ tom: "erro", texto: e instanceof Error ? e.message : "Falhou no servidor." });
        opcoes?.aoFalhar?.();
      }
    });
  }

  // CRIAR É ABRIR. O painel só abre sem cadência pelo botão "Criar cadência"
  // da coluna, então chegar aqui já é o pedido: cria na hora, em vez de
  // mostrar um segundo "Criar cadência" (pedido dele, 2026-10-05). Criar só
  // grava o rascunho — nada vai ao n8n antes do Publicar.
  const [erroAoCriar, setErroAoCriar] = useState<string | null>(null);
  const criouRef = useRef(false);

  function aoCriarCadencia() {
    setErroAoCriar(null);
    comecar(async () => {
      try {
        const r = await criarCadencia(etapa.id, etapa.nome);
        if (!r.ok) {
          setErroAoCriar(r.erro);
          return;
        }
        router.refresh();
      } catch (e) {
        setErroAoCriar(e instanceof Error ? e.message : "Não consegui criar a cadência.");
      }
    });
  }

  useEffect(() => {
    // O ref segura o StrictMode, que roda o efeito duas vezes em
    // desenvolvimento: sem ele nasceriam duas cadências para a mesma etapa.
    if (cadencia || criouRef.current) return;
    criouRef.current = true;
    aoCriarCadencia();
    // Só na abertura: depois disso, quem cria de novo é o "Tentar de novo".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tirar uma oportunidade da cadência ─────────────────────────────────────
  // Sem confirmação de propósito — o custo de errar é baixo (o próximo
  // Publicar reinscreve) e um diálogo a mais por card cansa mais do que
  // protege.
  function remover(o: Oportunidade) {
    if (!cadencia || removendoId) return;
    setRemovendoId(o.id);
    executar(() => removerDaCadencia(cadencia.fluxoId, o.id), {
      aoDarCerto: () => setRemovendoId(null),
      aoFalhar: () => setRemovendoId(null),
    });
  }

  const rodando = cadencia?.estado === "publicado";
  // Rodando e pausada quem diz é o interruptor, à direita; a etiqueta fica
  // com a versão e com os estados que ele não tem como mostrar.
  const estadoAtual = !cadencia
    ? null
    : cadencia.estado === "rascunho"
      ? "Não publicada"
      : cadencia.estado === "arquivado"
        ? "Arquivada"
        : null;

  return (
    <>
      {/* `absolute` e não `fixed`: o painel vive DENTRO da área de conteúdo
          (a raiz de inicio.tsx é `relative`), não sobre a janela inteira. A
          barra de navegação do app não é fundo de modal, é por onde se sai. */}
      <div className="veu-surge absolute inset-0 z-[200] backdrop-blur-md" onClick={aoFechar} aria-hidden="true" />

      <section
        className="surge absolute inset-3 z-[201] flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl md:inset-6 dark:border-zinc-800 dark:bg-zinc-950"
        role="dialog"
        aria-modal="true"
        aria-label={`Cadência de ${etapa.nome}`}
      >
        <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
          {/* O QUE A CADÊNCIA É: nome, estado e os números dela. */}
          <div className="flex flex-wrap items-start gap-3 px-5 pb-3 pt-4">
            <span className={`mt-[7px] size-2.5 shrink-0 rounded-full ${etapa.cor}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Cadência <span className="font-normal text-zinc-400 dark:text-zinc-500">·</span> {etapa.nome}
                </h2>
                {(estadoAtual || cadencia?.numeroVersao) && (
                  <span
                    className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                    title={cadencia?.numeroVersao ? `Versão publicada: v${cadencia.numeroVersao}` : undefined}
                  >
                    {estadoAtual ?? `v${cadencia?.numeroVersao}`}
                  </span>
                )}
                {sujo && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    Alterações não publicadas
                  </span>
                )}
              </div>
              {cadencia && (
              <p className="mt-1 text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {subetapas.length} {subetapas.length === 1 ? "mensagem" : "mensagens"}
                {ateReuniao ? ` até ${ateReuniao}` : subetapas.length > 1 && duracao > 0 ? ` em ${duracaoEmTexto(duracao)}` : ""}
                {" · "}
                {quantidade} {quantidade === 1 ? "oportunidade" : "oportunidades"} ({brl(total)})
                {cadencia && cadencia.noFluxo > 0 ? ` · ${cadencia.noFluxo} na automação` : ""}
                {cadencia && cadencia.erros14d > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {" · "}
                    {cadencia.erros14d} {cadencia.erros14d === 1 ? "erro" : "erros"} em 14 dias
                  </span>
                )}
              </p>
              )}
            </div>

            {/* O QUE SE FAZ COM ELA, na mesma linha do que ela É: publicar
                (com a escolha de quem entra) e remover. A segunda linha que
                existia só para isto deixava meia barra vazia. */}
            {cadencia && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                {/* Colado no Publicar porque é dele que fala: é o próximo
                    Publicar que decide se quem já está na etapa entra. Com a
                    etapa vazia não há quem incluir, e a pergunta some. */}
                {quantidade > 0 && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={inscreverAtuais}
                    onChange={(e) => {
                      setInscreverAtuais(e.target.checked);
                      setSujo(true);
                    }}
                    disabled={pendente}
                    className="size-3.5 accent-zinc-900 dark:accent-zinc-100"
                  />
                  Incluir {quantidade === 1 ? "a que já está" : `as ${quantidade} que já estão`} na etapa
                </label>
                )}

                <button
                  type="button"
                  onClick={() =>
                    executar(() => salvarCadencia(cadencia.fluxoId, subetapas, inscreverAtuais), {
                      aoDarCerto: () => setSujo(false),
                    })
                  }
                  disabled={pendente || subetapas.length === 0}
                  title={
                    inscreverAtuais
                      ? "Grava a versão, sobe pro n8n, liga a cadência e inscreve as oportunidades abertas desta etapa. As mensagens saem."
                      : "Grava a versão, sobe pro n8n e liga a cadência. Quem já está na etapa NÃO é inscrito — só quem entrar daqui pra frente."
                  }
                  // Principal quando há o que publicar; sem alteração, ainda
                  // serve para reinscrever, mas não pede atenção.
                  className={sujo || !cadencia.publicadoAlgumaVez ? botaoEscuro : botaoClaro}
                >
                  {pendente ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-3.5" aria-hidden="true" />
                  )}
                  {sujo ? "Publicar alterações" : "Publicar"}
                </button>

                {/* Remover: só ícone e sem destaque — é a única ação
                    irreversível da barra e não deve competir com Publicar. */}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Remover a cadência da etapa "${etapa.nome}"? As inscrições em andamento são canceladas e o workflow sai do n8n. As mensagens já enviadas continuam no histórico de cada lead.`,
                      )
                    ) {
                      return;
                    }
                    executar(() => excluirFluxo(cadencia.fluxoId), { aoDarCerto: aoFechar });
                  }}
                  disabled={pendente}
                  aria-label="Remover esta cadência"
                  title="Remover esta cadência"
                  className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            )}
            {cadencia && <span className="mt-1.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />}

            {/* O interruptor mora junto do estado, que é o que ele muda. */}
            {cadencia && (
              <button
                type="button"
                role="switch"
                aria-checked={rodando}
                aria-label={rodando ? "Pausar a cadência" : "Ligar a cadência"}
                onClick={() => executar(() => alternarCadencia(cadencia.fluxoId, !rodando))}
                disabled={pendente || !cadencia.publicadoAlgumaVez}
                title={
                  cadencia.publicadoAlgumaVez
                    ? rodando
                      ? "Pausa o workflow no motor: nada entra nem anda"
                      : "Liga o workflow no motor"
                    : "Publique primeiro — é o Publicar que cria o workflow no n8n"
                }
                className="mt-0.5 flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-[12px] text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <span
                  className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition ${rodando ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
                  aria-hidden="true"
                >
                  <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all ${rodando ? "left-3.5" : "left-0.5"}`} />
                </span>
                {rodando ? "Rodando" : "Pausada"}
              </button>
            )}
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar cadência"
              className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* Os avisos, numa faixa só, logo abaixo do cabeçalho. */}
          {(aviso || demo || (cadencia?.rascunhoPendente && !sujo) || (cadencia && !cadencia.linear)) && (
            <div className="flex flex-col gap-1.5 px-5 pb-3 pl-[2.6rem]">

              {demo && (
                <p className="flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-[12px] text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
                  <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                  Demonstração com dados fictícios (app/mock/cadencia.json): nada aqui é gravado nem enviado.
                </p>
              )}

              {aviso && (
                <p
                  role="status"
                  className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] ${
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
                  <button type="button" onClick={() => setAviso(null)} aria-label="Dispensar aviso" className="shrink-0 opacity-60 transition hover:opacity-100">
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </p>
              )}

              {/* A versão foi gravada mas não chegou ao motor. */}
              {cadencia?.rascunhoPendente && !sujo && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {cadencia.publicadoAlgumaVez
                      ? "Há uma versão salva que não chegou ao n8n. Quem entrar agora recebe a versão que está lá, não esta — publique de novo."
                      : "Rascunho, nunca publicado: nada sai daqui até alguém clicar em Publicar."}
                  </span>
                </p>
              )}

              {cadencia && !cadencia.linear && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Esta automação tem desvios ou blocos que não cabem em colunas — o quadro mostra só o trecho em linha
                    reta. Edite pelo{" "}
                    <Link href={`/automacoes/${cadencia.fluxoId}`} className="underline underline-offset-2">
                      builder
                    </Link>{" "}
                    para não perder o resto ao publicar daqui.
                  </span>
                </p>
              )}
            </div>
          )}
        </header>

        {/* barra de rolagem à mostra: com muitas colunas, esconder o único sinal
            de que existe mais coisa à direita seria esconder o quadro inteiro */}
        <div
          ref={quadroRef}
          className="flex min-h-0 flex-1 items-start overflow-x-auto bg-zinc-50/60 px-5 pb-5 pt-5 dark:bg-zinc-950"
        >
          {!cadencia ? (
            // Criando (o efeito acima) ou o motivo de não ter dado certo.
            <div className="m-auto max-w-md text-center" role="status">
              {erroAoCriar ? (
                <>
                  <AlertTriangle className="mx-auto size-5 text-amber-500" aria-hidden="true" />
                  <p className="mt-2 text-[13px] font-medium text-zinc-900 dark:text-zinc-50">Não deu para criar a cadência</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{erroAoCriar}</p>
                  <button type="button" onClick={aoCriarCadencia} disabled={pendente} className={`${botaoEscuro} mx-auto mt-4`}>
                    {pendente ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                    Tentar de novo
                  </button>
                </>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Criando a cadência de {etapa.nome}…
                </p>
              )}
            </div>
          ) : (
            <>
              {colunas.map((coluna, i) => (
                <Fragment key={coluna.subetapa.id}>
                  {/* O que o fluxo faz ANTES desta mensagem, no intervalo. A
                      primeira coluna só tem intervalo se o fluxo esperar antes
                      dela. */}
                  {(i > 0 || coluna.subetapa.acoes.length > 0) && (
                    <Intervalo
                      acoes={coluna.subetapa.acoes}
                      porAcao={porAcao}
                      contatoPorId={contatoPorId}
                      seNaoResponder={
                        (coluna.subetapa.canal === "whatsapp" && coluna.subetapa.ignorarResposta !== true) ||
                        (coluna.subetapa.canal === "ligacao" && coluna.subetapa.soSemResposta === true)
                      }
                    />
                  )}

                  {editando === coluna.subetapa.id ? (
                    <FormSubetapa
                      titulo={`Mensagem ${i + 1}`}
                      rotuloAcao="Aplicar"
                      instancias={instancias}
                      documentos={documentos}
                      avisaveis={avisaveis}
                      inicial={{
                        nome: coluna.subetapa.nome,
                        canal: coluna.subetapa.canal,
                        mensagem: coluna.subetapa.mensagem,
                        minutos: coluna.subetapa.minutos,
                        instanciaId: coluna.subetapa.instanciaId,
                        documentoId: coluna.subetapa.documentoId,
                        usuarioId: coluna.subetapa.usuarioId,
                        soSemResposta: coluna.subetapa.soSemResposta === true,
                        ancora: coluna.subetapa.ancora === "reuniao" ? "reuniao" : "entrada",
                        ignorarResposta: coluna.subetapa.ignorarResposta === true,
                      }}
                      aoConfirmar={(d) => editar(coluna.subetapa.id, d)}
                      aoCancelar={() => setEditando(null)}
                    />
                  ) : (
                    <Coluna
                      coluna={coluna}
                      indice={i}
                      cor={cor}
                      instancias={instancias}
                      documentos={documentos}
                      emCadencia={emCadencia}
                      removendoId={removendoId}
                      contatoPorId={contatoPorId}
                      usuarioPorId={usuarioPorId}
                      tagsDoContato={tagsDoContato}
                      aoEditar={() => setEditando(coluna.subetapa.id)}
                      aoExcluir={() => excluir(coluna.subetapa.id)}
                      aoRemover={demo ? null : remover}
                      robo={robo}
                      pediu={pediu}
                    />
                  )}
                </Fragment>
              ))}

              {/* Depois da última mensagem o fluxo ainda pode fazer coisa —
                  marcar uma tag no fim da sequência, por exemplo. */}
              {cadencia.acoesFinais.length > 0 && (
                <Intervalo acoes={cadencia.acoesFinais} porAcao={porAcao} contatoPorId={contatoPorId} />
              )}

              {/* A coluna nova nasce no FIM da fila: o lugar em que ela vai
                  aparecer é o mesmo em que se clica pra criá-la. */}
              <div className={`shrink-0 ${colunas.length ? "pl-4" : ""}`}>
                {criando ? (
                  <FormSubetapa
                    titulo={`Mensagem ${subetapas.length + 1}`}
                    rotuloAcao="Adicionar"
                    instancias={instancias}
                    documentos={documentos}
                    avisaveis={avisaveis}
                    inicial={{
                      nome: "",
                      canal: "whatsapp",
                      mensagem: "",
                      // um dia depois da última: é a cadência diária de sempre.
                      // Depois de um lembrete da reunião, a nova segue contada da
                      // reunião (10 min depois da última).
                      minutos: !subetapas.length
                        ? 0
                        : subetapas[subetapas.length - 1].ancora === "reuniao"
                          ? subetapas[subetapas.length - 1].minutos + 10
                          : (subetapas[subetapas.length - 1].dia + 1) * MINUTOS_POR_DIA,
                      ancora: subetapas.length && subetapas[subetapas.length - 1].ancora === "reuniao" ? "reuniao" : "entrada",
                      ignorarResposta: false,
                      // e pelo mesmo número da última: trocar de instância no
                      // meio da cadência é a exceção.
                      instanciaId: subetapas.length ? subetapas[subetapas.length - 1].instanciaId : null,
                      // Anexo e destinatário do aviso são escolhas de UMA
                      // mensagem, não da cadência: não são herdados.
                      documentoId: null,
                      usuarioId: null,
                      // Aviso novo só sai se o lead não respondeu: é o uso
                      // dele (aviso de lead sem resposta à cadência).
                      soSemResposta: true,
                    }}
                    aoConfirmar={criar}
                    aoCancelar={() => setCriando(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setCriando(true)}
                    className="flex h-40 w-56 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 text-[12px] font-medium text-zinc-500 transition hover:border-zinc-400 hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {subetapas.length ? "Nova mensagem" : "Primeira mensagem"}
                    {subetapas.length > 0 && subetapas[subetapas.length - 1].ancora !== "reuniao" && (
                      <span className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                        no dia {subetapas[subetapas.length - 1].dia + 1}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* O prompt que monta a cadência. É a MESMA conversa do editor de fluxo
          (/api/ia/automacoes), presa ao fluxo desta etapa — o que ela grava é
          rascunho, e o `mudou` no fim do stream traz as colunas novas. */}
      {cadencia && !demo && (
        <ChatIa
          camada="z-[210]"
          compacto
          endpoint="/api/ia/automacoes"
          escopo={`cadencia:${cadencia.fluxoId}`}
          conversaInicial={conversaInicial}
          extra={{ fluxo_id: cadencia.fluxoId }}
          titulo="Montar esta cadência"
          rotulo="Montar a cadência com IA"
          dica={`Descreva a cadência da etapa "${etapa.nome}". A IA escreve os blocos e as esperas; publicar e ligar continuam sendo seu clique.`}
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
