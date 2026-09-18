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
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  MessageSquareText,
  Paperclip,
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
  X,
  type LucideIcon,
} from "lucide-react";
import type { Contato, Etapa, Oportunidade, Tag, Usuario } from "../data";
import { brl } from "../formato";
import CartaoOportunidade from "../funil/cartao";
import ChatIa from "../components/chat-ia";
import {
  proximoIdDeMensagem,
  type AcaoCadencia,
} from "@/lib/automacoes/cadencia";
import { ICONE_PADRAO, ICONES } from "../automacoes/aparencia";
import type { CadenciaDaEtapa, InstanciaEscolhivel } from "./cadencias";
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
  documentoId: string | null;
};

/**
 * O anexo desta mensagem, dito na tela.
 *
 * "documento removido" não é enfeite: arquivar o documento na biblioteca não
 * limpa o fluxo, e uma coluna que aponta para um arquivo que saiu de circulação
 * precisa dizer isso ANTES de alguém apertar Disparar — no disparo, o envio
 * falha e o ramo morre no motor.
 */
function nomeDoDocumento(
  id: string | null,
  documentos: Documento[],
): string | null {
  if (!id) return null;
  return documentos.find((d) => d.id === id)?.nome ?? "documento removido";
}

// Nome curto da instância, para caber no cabeçalho da coluna. "Instância
// apagada" não é enfeite: se ela sumiu de Configurações depois de publicada, o
// bloco FALHA no disparo em vez de cair no .env — e a coluna precisa dizer
// isso antes de alguém apertar Disparar.
/**
 * De qual número a mensagem sai, dito na tela.
 *
 * Sem escolha, sai pela única cadastrada — e o nome dela é o que interessa
 * mostrar. O rótulo dizia "instância do .env", resquício de antes da tabela
 * `instancias_uazapi` existir: não há número nenhum no .env, e quem responde
 * é sempre o que está em Integrações.
 */
function nomeDaInstancia(
  id: string | null,
  instancias: InstanciaEscolhivel[],
): string {
  if (!id) {
    if (instancias.length === 1) return `${instancias[0].nome} (padrão)`;
    // Com duas ou mais, escolher é obrigatório: a publicação recusa e diz
    // qual mensagem ficou sem.
    return instancias.length === 0
      ? "nenhuma instância cadastrada"
      : "escolha o número";
  }
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
  documentos,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string;
  inicial: Rascunho;
  rotuloAcao: string;
  instancias: InstanciaEscolhivel[];
  documentos: Documento[];
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
  const [documentoId, setDocumentoId] = useState<string | null>(
    inicial.documentoId,
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
          // Anexo só sobrevive no WhatsApp: é o único canal que manda arquivo.
          // Trocar o canal depois de escolher o documento limpa a escolha em
          // vez de guardar um anexo que nada leria.
          documentoId: canal === "whatsapp" ? documentoId : null,
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

      {/* O ANEXO. Só no WhatsApp, como a instância, e pelo mesmo motivo: é o
          único canal que sabe mandar arquivo. O que a pessoa escolhe aqui é um
          documento da biblioteca (/documentos) — não se sobe arquivo na
          cadência, senão cada mensagem teria a sua cópia e ninguém saberia qual
          é a tabela de preços vigente. */}
      {canal === "whatsapp" && (
        <label className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
          <Paperclip className="size-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0">Anexo</span>
          <select
            value={documentoId ?? ""}
            onChange={(e) => setDocumentoId(e.target.value || null)}
            className={`${campoTexto} min-w-0 flex-1`}
          >
            <option value="">sem anexo</option>
            {documentos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {canal === "whatsapp" && documentos.length === 0 && (
        <p className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
          A biblioteca está vazia. Suba os arquivos em Documentos para poder
          anexá-los aqui.
        </p>
      )}

      <textarea
        value={mensagem}
        onChange={(e) => setMensagem(e.target.value)}
        rows={4}
        placeholder="Mensagem enviada nesta subetapa"
        className={`${campoTexto} resize-none`}
      />

      {/* Com anexo o texto muda de papel, e quem está escrevendo precisa saber
          disso: sai UM envio, o arquivo com a legenda — não duas mensagens. */}
      {canal === "whatsapp" && documentoId && (
        <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          O texto acima vai como legenda do anexo, num envio só. Pode ficar
          vazio: aí sai só o arquivo.
        </p>
      )}

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

/**
 * O que o fluxo faz ENTRE duas mensagens: esperar, mudar tag, mudar segmento,
 * chamar um serviço. Uma pill por bloco, na ordem em que rodam.
 *
 * DISCRETA DE PROPÓSITO, e estreita: a coluna é da mensagem, e a leitura da
 * cadência é a sequência de mensagens. O que acontece no intervalo importa,
 * mas não compete — quem varre o quadro está procurando em que mensagem cada
 * lead está, não quantas tags o fluxo mexe.
 *
 * Só leitura. Editar estes blocos é no builder, com o painel de cada um; o que
 * esta tela garante é que eles não somem ao salvar (ver `escreverCadencia`) e
 * que quem olha a cadência sabe que existem.
 *
 * Quem está PARADO num deles aparece embaixo da pill. Na prática é sempre a
 * espera: os outros blocos o lead atravessa em milissegundos.
 */
function Acoes({
  acoes,
  porAcao,
  contatoPorId,
  usuarioPorId,
  tagsDoContato,
}: {
  acoes: AcaoCadencia[];
  porAcao: Map<string, Oportunidade[]>;
  contatoPorId: Map<string, Contato>;
  usuarioPorId: Map<string, Usuario>;
  tagsDoContato: Map<string, Tag[]>;
}) {
  if (acoes.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 self-start pt-9">
      {acoes.map((a) => {
        const Icone = ICONES[a.tipo] ?? ICONE_PADRAO;
        const parados = porAcao.get(a.id) ?? [];
        const rotulo = a.detalhe || a.rotulo;

        return (
          <div key={a.id} className="flex flex-col gap-2">
            <span
              title={a.detalhe ? `${a.rotulo} · ${a.detalhe}` : a.rotulo}
              className="inline-flex max-w-32 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800/70 dark:text-zinc-400"
            >
              <Icone className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{rotulo}</span>
              {parados.length > 0 && (
                <span className="shrink-0 font-semibold tabular-nums">
                  · {parados.length}
                </span>
              )}
            </span>

            {/* O card tem largura propria: sem ela a faixa encolheria para o
                tamanho da pill e o cartao ficaria espremido. */}
            {parados.map((o) => (
              <div key={o.id} className="w-36">
              <CartaoOportunidade
                oportunidade={o}
                contato={contatoPorId.get(o.contato_id)}
                responsavel={
                  o.responsavel_id ? usuarioPorId.get(o.responsavel_id) : undefined
                }
                tags={tagsDoContato.get(o.contato_id) ?? []}
              />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

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
}: {
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
  aoRemover: (oportunidade: Oportunidade) => void;
}) {
  const { subetapa, oportunidades, alemDaUltima } = coluna;
  const canal = CANAIS[subetapa.canal] ?? CANAIS.whatsapp;
  const total = oportunidades.reduce((soma, o) => soma + o.valor, 0);

  return (
    <section
      // A MESMA CASCA DA ETAPA DO FUNIL (app/inicio/inicio.tsx): mesma largura,
      // mesmo raio, mesmo fundo, mesma faixa de cor no topo. Uma mensagem da
      // cadência é um passo da etapa, e ler as duas telas tem que ser a mesma
      // leitura — antes a coluna daqui tinha fundo próprio, tingido conforme a
      // posição na sequência, e parecia outro componente.
      className="group/coluna relative flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-zinc-100/70 dark:bg-zinc-900/50"
      aria-label={`Mensagem ${indice + 1} · ${subetapa.nome}`}
    >
      <span
        className={`h-1.5 shrink-0 rounded-t-xl ${cor}`}
        aria-hidden="true"
      />

      {/* Daqui pra baixo NÃO há cinza fixo: divisórias e rótulos são a própria
          tinta com alfa (zinc-900/N no claro, zinc-50/N no escuro). Sobre uma
          coluna que muda de tom a cada passo, um zinc-500 legível na 1ª coluna
          fica abaixo de 4,5:1 na 18ª — o alfa acompanha o fundo, o cinza não. */}
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {/* o número da mensagem é o que identifica a coluna — vem antes do nome */}
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-semibold tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
            {indice + 1}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
            {subetapa.nome}
          </h3>
          {/* "no topo o número de oportunidades ali" */}
          <span className="min-w-5 shrink-0 rounded-full bg-zinc-200 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {oportunidades.length}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 pl-7">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <canal.Icone className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{canal.rotulo}</span>
          </span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
            {brl(total)}
          </span>
        </div>

        {/* De qual número ESTA mensagem sai. Fica no cabeçalho da coluna e não
            só no formulário porque, com uma instância por mensagem, ler a
            cadência de fora é a única forma de perceber que a 5ª sai por outro
            número. */}
        {subetapa.canal === "whatsapp" && (
          <p className="mt-0.5 flex items-center gap-1 pl-7 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Send className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {nomeDaInstancia(subetapa.instanciaId, instancias)}
            </span>
          </p>
        )}

        {/* O anexo no cabeçalho da coluna, pela mesma razão da instância: ler a
            cadência de fora é a única forma de perceber que a 3ª mensagem leva
            a proposta junto. */}
        {subetapa.canal === "whatsapp" && subetapa.documentoId && (
          <p className="mt-0.5 flex items-center gap-1 pl-7 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Paperclip className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {nomeDoDocumento(subetapa.documentoId, documentos)}
            </span>
          </p>
        )}

        <div className="mt-0.5 flex items-center gap-1 pl-7">
          <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {rotuloDoDia(subetapa.dia)}
            {alemDaUltima > 0 ? " ou depois" : ""}
          </p>
          {/* Editar e excluir só aparecem no hover/foco da coluna: com 18
              delas, dois ícones fixos em cada uma competiriam com o conteúdo. */}
          <button
            type="button"
            onClick={aoEditar}
            aria-label={`Editar mensagem ${indice + 1}`}
            className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-900 focus-visible:opacity-100 group-hover/coluna:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <Pencil className="size-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={aoExcluir}
            aria-label={`Excluir mensagem ${indice + 1}`}
            className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-red-700 focus-visible:opacity-100 group-hover/coluna:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-red-400"
          >
            <Trash2 className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* a mensagem em si, em balão: é ela que dá nome à subetapa */}
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <p className="rounded-xl rounded-tl-sm bg-white px-2.5 py-2 text-[12px] leading-snug text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-300">
          {subetapa.mensagem || (
            <span className="italic text-zinc-400 dark:text-zinc-500">
              Sem mensagem escrita
            </span>
          )}
        </p>
      </div>

      <div className="rolagem-oculta flex min-h-0 flex-col gap-2.5 overflow-y-auto rounded-b-xl p-2.5">
        {oportunidades.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-center text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
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
  documentos,
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
  documentos: Documento[];
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
  const cor = etapa.cor;

  // Edição local. O que está aqui é o rascunho da tela; só vai ao banco no
  // Salvar. `chave` reseta o estado quando o servidor devolve outra versão —
  // é o que faz o fluxo escrito por prompt aparecer sem F5.
  const chave = `${cadencia?.fluxoId ?? "nenhuma"}:${cadencia?.numeroVersao ?? 0}`;
  const [subetapas, setSubetapas] = useState<Subetapa[]>(
    cadencia?.subetapas ?? [],
  );
  const [chaveVista, setChaveVista] = useState(chave);
  const [sujo, setSujo] = useState(false);
  // Quem o próximo Publicar pega. Mora aqui e vai junto no salvar: é decisão
  // da publicação, e não faz sentido gravá-la sem publicar.
  const [inscreverAtuais, setInscreverAtuais] = useState(
    cadencia?.inscreverAtuais ?? true,
  );
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
  // Quem está no fluxo sem passo marcado começa na primeira; quem nunca entrou
  // cai na régua de dias (ver `distribuir`).
  const posicao = cadencia?.posicao;

  // Os blocos de acao do fluxo, pelo id: e o que diz a `distribuir` que aquela
  // posicao nao e uma coluna, e sim uma espera (ou uma tag) entre duas.
  const idsDeAcao = useMemo(() => {
    const ids = new Set<string>();
    for (const s of subetapas) for (const a of s.acoes) ids.add(a.id);
    for (const a of cadencia?.acoesFinais ?? []) ids.add(a.id);
    return ids;
  }, [subetapas, cadencia?.acoesFinais]);

  const { colunas, porAcao } = useMemo(
    () =>
      distribuir(subetapas, oportunidades, hoje, posicao, emCadencia, idsDeAcao),
    [subetapas, oportunidades, hoje, posicao, emCadencia, idsDeAcao],
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
        // Coluna nova não tem ação nenhuma antes dela, e o instante é o que o
        // dia disser. Quem grava reescreve os dois a partir do fluxo no banco
        // (ver salvarCadencia) — aqui é só para o objeto nascer completo.
        minutos: dados.dia * 1440,
        acoes: [],
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
      {/* `absolute` e não `fixed`: o painel vive DENTRO da área de conteúdo
          (a raiz de inicio.tsx é `relative`), não sobre a janela inteira. Sem
          isso ele cobria a sidebar da esquerda — e a barra de navegação do app
          não é fundo de modal, é por onde se sai daqui.

          Sem escurecer: o véu só apanha o clique de fora e desfoca a moldura
          que sobra em volta. Escurecer aqui não separava nada que o próprio
          painel, opaco e ocupando quase toda a área, já não separe. */}
      <div
        className="veu-surge absolute inset-0 z-[60] backdrop-blur-md"
        onClick={aoFechar}
        aria-hidden="true"
      />

      <section
        className="surge absolute inset-3 z-[61] flex flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl md:inset-6 dark:border-zinc-800 dark:bg-zinc-950"
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

          {/* Barra de ações: DOIS controles, e não mais.
              
              À esquerda, o estado no n8n — rodando ou pausada —, que é o que
              decide se qualquer coisa aqui tem efeito no mundo. À direita,
              Publicar, que grava a versão, sobe pro motor, liga a cadência e
              inscreve as oportunidades abertas desta etapa.

              O que saiu: "Disparar" (Publicar já inscreve), o link do Builder e
              "Excluir". A cadência é editada AQUI; quem quiser o grafo inteiro
              ou apagar o fluxo tem /automacoes, onde ele também aparece. */}
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

              {/* O campo fica COLADO no Publicar, e não no cabeçalho, porque é
                  dele que ele fala: é o próximo Publicar que decide se as
                  oportunidades que já estão na etapa entram. Quem chegar
                  depois entra sozinho de qualquer jeito. */}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={inscreverAtuais}
                  onChange={(e) => setInscreverAtuais(e.target.checked)}
                  disabled={pendente}
                  className="size-3.5 accent-zinc-900 dark:accent-zinc-100"
                />
                Incluir as {quantidade} que já estão na etapa
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    executar(
                      salvarCadencia(
                        cadencia.fluxoId,
                        subetapas,
                        inscreverAtuais,
                      ),
                      { aoDarCerto: () => setSujo(false) },
                    )
                  }
                  disabled={pendente || subetapas.length === 0}
                  title={
                    inscreverAtuais
                      ? "Grava a versão, sobe pro n8n, liga a cadência e inscreve as oportunidades abertas desta etapa. As mensagens saem."
                      : "Grava a versão, sobe pro n8n e liga a cadência. Quem já está na etapa NÃO é inscrito — só quem entrar daqui pra frente."
                  }
                  className={botaoClaro}
                >
                  {pendente ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  Publicar{sujo ? " •" : ""}
                </button>

                {/* Remover fica por último e sem destaque: é a única ação
                    irreversível da barra, e não deve competir por atenção com
                    Publicar, que é a que se usa todo dia. */}
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
                    executar(excluirFluxo(cadencia.fluxoId), {
                      aoDarCerto: aoFechar,
                    });
                  }}
                  disabled={pendente}
                  title="Remover esta cadência"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Remover cadência
                </button>

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
                {colunas.map((coluna, i) => (
                  <Fragment key={coluna.subetapa.id}>
                    {/* O que o fluxo faz ANTES desta mensagem. Entre as
                        colunas porque é onde acontece — no intervalo. */}
                    <Acoes
                      acoes={coluna.subetapa.acoes}
                      porAcao={porAcao}
                      contatoPorId={contatoPorId}
                      usuarioPorId={usuarioPorId}
                      tagsDoContato={tagsDoContato}
                    />

                    {editando === coluna.subetapa.id ? (
                    <FormSubetapa
                      titulo={`Mensagem ${i + 1}`}
                      rotuloAcao="Salvar"
                      instancias={instancias}
                      documentos={documentos}
                      inicial={{
                        nome: coluna.subetapa.nome,
                        canal: coluna.subetapa.canal,
                        mensagem: coluna.subetapa.mensagem,
                        dia: coluna.subetapa.dia,
                        instanciaId: coluna.subetapa.instanciaId,
                        documentoId: coluna.subetapa.documentoId,
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
                      aoRemover={remover}
                    />
                    )}
                  </Fragment>
                ))}

                {/* Depois da última mensagem o fluxo ainda pode fazer coisa —
                    marcar uma tag no fim da sequência, por exemplo. */}
                <Acoes
                  acoes={cadencia.acoesFinais}
                  porAcao={porAcao}
                  contatoPorId={contatoPorId}
                  usuarioPorId={usuarioPorId}
                  tagsDoContato={tagsDoContato}
                />

                {/* A coluna nova nasce no FIM da fila, e não num botão do
                    cabeçalho: o lugar em que ela vai aparecer é o mesmo em que
                    se clica pra criá-la. */}
                {criando ? (
                  <FormSubetapa
                    titulo={`Mensagem ${subetapas.length + 1}`}
                    rotuloAcao="Criar"
                    instancias={instancias}
                    documentos={documentos}
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
                      // Anexo NÃO é herdado da última: a instância se repete
                      // pela cadência inteira, o documento quase nunca — cada
                      // mensagem leva o seu, quando leva. Herdar faria a
                      // proposta sair de novo na mensagem seguinte sem ninguém
                      // pedir.
                      documentoId: null,
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
