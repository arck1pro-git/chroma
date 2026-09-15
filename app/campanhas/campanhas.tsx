"use client";

// Campanhas · WhatsApp: criar, gerir e ACOMPANHAR.
//
// A tela é uma lista de campanhas; clicar numa abre o acompanhamento por cima,
// com um bloco por coluna e os leads dentro do bloco em que estão. É a mesma
// leitura da cadência de etapa, e de propósito: quem aprendeu uma sabe a outra.
//
// O QUE ESTA TELA NÃO FAZ AINDA: enviar. O canal é a API oficial do WhatsApp,
// que não está ligada — ver o cabeçalho de ./dados.ts. Os botões que disparam
// mensagem dizem isso em vez de fingir que mandaram.
import { useMemo, useState } from "react";
import {
  Ban,
  Clock,
  Layers,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Send,
  Target,
  Users,
  X,
} from "lucide-react";
import { Sobreposicao } from "../blog/pecas";
import {
  duracao,
  resumoDaCampanha,
  ritmoDoLote,
  tempoDeEscoamento,
  type Bloco,
  type Campanha,
  type DadosCampanhas,
  type EstadoLead,
  type LeadNaCampanha,
  type Segmento,
} from "./dados";

const ESTADO_CAMPANHA: Record<string, { rotulo: string; classe: string }> = {
  ativa: {
    rotulo: "Ativa",
    classe:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  pausada: {
    rotulo: "Pausada",
    classe: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  },
};

const ESTADO_LEAD: Record<EstadoLead, { rotulo: string; classe: string }> = {
  na_fila: { rotulo: "na fila", classe: "text-zinc-400 dark:text-zinc-500" },
  andando: { rotulo: "andando", classe: "text-zinc-500 dark:text-zinc-400" },
  respondeu: {
    rotulo: "respondeu",
    classe: "text-sky-600 dark:text-sky-400",
  },
  falhou: { rotulo: "falhou", classe: "text-red-600 dark:text-red-400" },
};

/**
 * As metas prontas. É o que a campanha persegue, e o rótulo escolhido aqui vira
 * o nome da métrica na lista — por isso são substantivos no plural, do jeito
 * que aparecem embaixo do número.
 *
 * A lista é curta de propósito e termina em "outro": o resultado de uma
 * campanha é do negócio, não do CRM, e um catálogo fechado ia obrigar a
 * chamar de "lead gerado" o que a empresa chama de "inscrição".
 */
const METAS = [
  "Leads gerados",
  "Entradas na comunidade",
  "Agendamentos",
  "Vendas",
];

/** Reais, do jeito que se lê: R$ 91,12. */
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const num = (v: number) => v.toLocaleString("pt-BR");

export default function Campanhas({ dados }: { dados: DadosCampanhas }) {
  const [aberta, setAberta] = useState<Campanha | null>(null);
  const [criando, setCriando] = useState(false);

  const segmentoPorId = useMemo(
    () => new Map(dados.segmentos.map((s) => [s.id, s])),
    [dados.segmentos],
  );

  return (
    <div className="pagina-surge min-h-screen bg-conteudo">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Campanhas · WhatsApp
            </h1>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Uma campanha manda uma sequência para um segmento inteiro, em
              levas: o bloco de lote solta alguns leads por vez para a linha não
              ir a nocaute. Clique numa campanha para ver onde cada lead está.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCriando(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="size-4" aria-hidden="true" />
            Nova campanha
          </button>
        </header>

        {/* O canal ainda não existe, e a tela diz isso UMA vez, no topo: repetir
            em cada botão viraria ruído, e esconder faria alguém esperar
            mensagem que não vai sair. */}
        <p className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-3 text-[12px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong className="font-semibold">Canal ainda não conectado.</strong>{" "}
          Campanha sai pela API oficial do WhatsApp — a conexão que existe hoje
          (uazapi) é WhatsApp Web e atende o chat e as cadências de etapa. Até a
          API entrar, esta tela roda com dados de demonstração e nada é enviado.
        </p>

        {/* LISTA, uma abaixo da outra, e não grade: cada linha carrega seis
            números (enviadas, gasto, respostas, conversões e as duas taxas), e
            compará-los entre campanhas é o que se faz aqui. Em cartões lado a
            lado, os mesmos números ficam em alturas diferentes e a comparação
            vira caça ao dado. */}
        <ul className="mt-6 flex flex-col gap-2">
          {dados.campanhas.map((c) => (
            <Linha
              key={c.id}
              campanha={c}
              segmento={segmentoPorId.get(c.segmentoId)}
              segmentos={dados.segmentos}
              aoAbrir={() => setAberta(c)}
            />
          ))}
        </ul>

        {dados.campanhas.length === 0 && (
          <p className="mt-6 text-[12px] text-zinc-400 dark:text-zinc-500">
            Nenhuma campanha ainda.
          </p>
        )}
      </div>

      {aberta && (
        <PainelCampanha
          key={aberta.id}
          campanha={aberta}
          segmento={segmentoPorId.get(aberta.segmentoId)}
          segmentos={dados.segmentos}
          aoFechar={() => setAberta(null)}
        />
      )}

      {criando && (
        <FormCampanha
          segmentos={dados.segmentos}
          aoFechar={() => setCriando(false)}
        />
      )}
    </div>
  );
}

// ── Uma linha da lista ─────────────────────────────────────────

function Linha({
  campanha,
  segmento,
  segmentos,
  aoAbrir,
}: {
  campanha: Campanha;
  segmento: Segmento | undefined;
  segmentos: Segmento[];
  aoAbrir: () => void;
}) {
  const r = resumoDaCampanha(campanha, segmentos);
  const estado = ESTADO_CAMPANHA[campanha.estado] ?? ESTADO_CAMPANHA.pausada;
  const mensagens = campanha.blocos.filter((b) => b.tipo === "mensagem").length;

  return (
    <li>
      <button
        type="button"
        onClick={aoAbrir}
        className="surge flex w-full flex-col gap-3 rounded-2xl border border-zinc-200 p-4 text-left transition hover:border-zinc-300 hover:bg-zinc-50 lg:flex-row lg:items-center dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50"
      >
        {/* Identificação à esquerda, largura fixa a partir de lg: com todas as
            linhas começando os números na mesma coluna, a leitura vertical
            funciona. */}
        <div className="min-w-0 lg:w-64 lg:shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${estado.classe}`}
            >
              {estado.rotulo}
            </span>
            <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium text-zinc-900 dark:text-zinc-50">
              {campanha.nome}
            </h2>
          </div>

          <p className="mt-1 flex items-center gap-1 text-[12px] text-zinc-500 dark:text-zinc-400">
            <Users className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {segmento?.nome ?? "segmento removido"} · {num(r.publico)}
            </span>
          </p>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100"
              style={{ width: `${r.progresso}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {r.progresso}% disparado · {num(r.naFila)} na fila · {mensagens}{" "}
            mensagem{mensagens === 1 ? "" : "s"}
          </p>
        </div>

        {/* As métricas. Valor grande, rótulo pequeno embaixo — o olho desce a
            coluna lendo só os valores, e o rótulo está lá quando ele precisa. */}
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metrica valor={num(r.enviadas)} rotulo="mensagens" />
          <Metrica valor={brl(r.gasto)} rotulo="gasto" />
          <Metrica
            valor={`${r.taxaResposta}%`}
            rotulo={`${num(r.responderam)} responderam`}
            tom={r.taxaResposta > 0 ? "sky" : undefined}
            apoio={
              r.custoPorResposta > 0 ? `${brl(r.custoPorResposta)} cada` : null
            }
          />
          {/* O NOME desta métrica vem do bloco de meta: "Leads gerados" numa
              campanha, "Entradas na comunidade" noutra. Sem meta, o lugar fica
              dizendo o que falta — um zero ali pareceria fracasso. */}
          {r.meta ? (
            <Metrica
              valor={num(r.meta.total)}
              rotulo={r.meta.rotulo.toLowerCase()}
              tom={r.meta.total > 0 ? "emerald" : undefined}
              apoio={r.meta.custo > 0 ? `${brl(r.meta.custo)} cada` : null}
            />
          ) : (
            <Metrica valor="—" rotulo="sem bloco de meta" />
          )}
        </div>
      </button>
    </li>
  );
}

function Metrica({
  valor,
  rotulo,
  apoio,
  tom,
}: {
  valor: string;
  rotulo: string;
  apoio?: string | null;
  tom?: "sky" | "emerald";
}) {
  const cor =
    tom === "sky"
      ? "text-sky-600 dark:text-sky-400"
      : tom === "emerald"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-zinc-900 dark:text-zinc-50";

  return (
    <div className="min-w-0">
      <p className={`truncate text-[15px] font-semibold tabular-nums ${cor}`}>
        {valor}
      </p>
      <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {rotulo}
      </p>
      {apoio && (
        <p className="truncate text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {apoio}
        </p>
      )}
    </div>
  );
}

// ── Acompanhamento ──────────────────────────────────────────────────────────

function PainelCampanha({
  campanha,
  segmento,
  segmentos,
  aoFechar,
}: {
  campanha: Campanha;
  segmento: Segmento | undefined;
  segmentos: Segmento[];
  aoFechar: () => void;
}) {
  const r = resumoDaCampanha(campanha, segmentos);
  const estado = ESTADO_CAMPANHA[campanha.estado] ?? ESTADO_CAMPANHA.pausada;
  const ativa = campanha.estado === "ativa";

  // Lead por bloco: é o que põe o card na coluna certa. Quem aponta para um
  // bloco que não existe mais fica de fora em vez de sumir sem explicação.
  const porBloco = useMemo(() => {
    const m = new Map<string, LeadNaCampanha[]>();
    for (const l of campanha.leads) {
      m.set(l.blocoId, [...(m.get(l.blocoId) ?? []), l]);
    }
    return m;
  }, [campanha.leads]);

  return (
    <Sobreposicao rotulo={campanha.nome} aoFechar={aoFechar}>
      <header className="shrink-0 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {campanha.nome}
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${estado.classe}`}
              >
                {estado.rotulo}
              </span>
            </div>

            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <Users className="size-3 shrink-0" aria-hidden="true" />
                {segmento?.nome ?? "segmento removido"} · {num(r.publico)}{" "}
                contatos
              </span>
              <span className="tabular-nums">{r.progresso}% disparado</span>
              <span className="tabular-nums">{num(r.naFila)} na fila</span>
              {r.falharam > 0 && (
                <span className="tabular-nums text-red-600 dark:text-red-400">
                  {num(r.falharam)} falharam
                </span>
              )}
            </p>

            {/* As mesmas métricas da lista, para não precisar fechar o painel
                para lembrar quanto a campanha custou. */}
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Metrica valor={num(r.enviadas)} rotulo="mensagens" />
              <Metrica valor={brl(r.gasto)} rotulo="gasto" />
              <Metrica
                valor={`${r.taxaResposta}%`}
                rotulo={`${num(r.responderam)} responderam`}
                tom={r.taxaResposta > 0 ? "sky" : undefined}
                apoio={
                  r.custoPorResposta > 0
                    ? `${brl(r.custoPorResposta)} cada`
                    : null
                }
              />
              {r.meta ? (
                <Metrica
                  valor={num(r.meta.total)}
                  rotulo={r.meta.rotulo.toLowerCase()}
                  tom={r.meta.total > 0 ? "emerald" : undefined}
                  apoio={r.meta.custo > 0 ? `${brl(r.meta.custo)} cada` : null}
                />
              ) : (
                <Metrica valor="—" rotulo="sem bloco de meta" />
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar campanha"
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled
            title="Disponível quando a API oficial do WhatsApp estiver conectada"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            {ativa ? (
              <>
                <Pause className="size-3.5" aria-hidden="true" />
                Pausar
              </>
            ) : (
              <>
                <Play className="size-3.5" aria-hidden="true" />
                Rodar
              </>
            )}
          </button>

          <span className="flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            <Ban className="size-3 shrink-0" aria-hidden="true" />
            Sem canal conectado, nada é enviado
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-5 py-4">
        {campanha.blocos.map((b) => (
          <ColunaBloco
            key={b.id}
            bloco={b}
            publico={r.publico}
            leads={porBloco.get(b.id) ?? []}
          />
        ))}
      </div>
    </Sobreposicao>
  );
}

function ColunaBloco({
  bloco,
  publico,
  leads,
}: {
  bloco: Bloco;
  publico: number;
  leads: LeadNaCampanha[];
}) {
  const { Icone, titulo, detalhe, corpo } = descrever(bloco, publico);

  return (
    <section
      className="flex max-h-full w-64 shrink-0 flex-col rounded-xl bg-zinc-100/70 dark:bg-zinc-900/50"
      aria-label={titulo}
    >
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-zinc-200 dark:bg-zinc-800">
            <Icone
              className="size-3 text-zinc-600 dark:text-zinc-300"
              aria-hidden="true"
            />
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
            {titulo}
          </h3>
          <span className="min-w-5 shrink-0 rounded-full bg-zinc-200 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {leads.length}
          </span>
        </div>

        {detalhe && (
          <p className="mt-1 truncate pl-7 text-[11px] text-zinc-500 dark:text-zinc-400">
            {detalhe}
          </p>
        )}
      </div>

      {corpo && (
        <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <p className="rounded-xl rounded-tl-sm bg-white px-2.5 py-2 text-[12px] leading-snug text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-300">
            {corpo}
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto rounded-b-xl p-2.5">
        {leads.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-center text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            Ninguém aqui agora
          </p>
        ) : (
          leads.map((l) => <CartaoLead key={l.id} lead={l} />)
        )}
      </div>
    </section>
  );
}

/** O que cada tipo de bloco mostra. Um lugar só, para a coluna não decidir. */
function descrever(bloco: Bloco, publico: number) {
  if (bloco.tipo === "liberar_lote") {
    return {
      Icone: Layers,
      titulo: "Liberar lote",
      detalhe: ritmoDoLote(bloco.quantidade, bloco.minutos),
      corpo: `Segura a fila e solta ${bloco.quantidade} por vez. O segmento inteiro leva ${tempoDeEscoamento(publico, bloco.quantidade, bloco.minutos)} para sair.`,
    };
  }
  if (bloco.tipo === "esperar") {
    return {
      Icone: Clock,
      titulo: "Esperar",
      detalhe: duracao(bloco.minutos),
      corpo: null,
    };
  }
  if (bloco.tipo === "meta") {
    return {
      Icone: Target,
      titulo: bloco.rotulo,
      detalhe: "linha de chegada",
      corpo:
        "Quem chega aqui é o resultado da campanha. É este bloco que dá nome à métrica da lista.",
    };
  }
  return {
    Icone: MessageCircle,
    titulo: bloco.nome,
    detalhe: "WhatsApp",
    corpo: bloco.texto,
  };
}

function CartaoLead({ lead }: { lead: LeadNaCampanha }) {
  const e = ESTADO_LEAD[lead.estado];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="truncate text-[12px] font-medium text-zinc-900 dark:text-zinc-50">
        {lead.nome}
      </p>
      <p className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate font-mono text-zinc-400 dark:text-zinc-500">
          {lead.whatsapp}
        </span>
        <span className={`shrink-0 ${e.classe}`}>{e.rotulo}</span>
      </p>
    </div>
  );
}

// ── Criação ─────────────────────────────────────────────────────────────────

function FormCampanha({
  segmentos,
  aoFechar,
}: {
  segmentos: Segmento[];
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [segmentoId, setSegmentoId] = useState(segmentos[0]?.id ?? "");
  const [quantidade, setQuantidade] = useState(40);
  const [minutos, setMinutos] = useState(60);
  const [meta, setMeta] = useState(METAS[0]);

  const segmento = segmentos.find((s) => s.id === segmentoId);
  const publico = segmento?.contatos ?? 0;

  return (
    <Sobreposicao
      rotulo="Nova campanha"
      medida="max-h-[88vh] w-[min(32rem,94vw)]"
      aoFechar={aoFechar}
    >
      <header className="shrink-0 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
          Nova campanha
        </h2>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Nome
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Black Friday · aquecimento"
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Segmento
          </span>
          <select
            value={segmentoId}
            onChange={(e) => setSegmentoId(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none dark:border-zinc-800 dark:text-zinc-50"
          >
            {segmentos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome} ({s.contatos.toLocaleString("pt-BR")})
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            O público é o segmento inteiro. Quem entrar nele depois entra na
            campanha.
          </span>
        </label>

        {/* O lote na criação, e não só no editor: é ele que decide se a
            campanha leva uma hora ou dois dias, e essa conta tem que aparecer
            ANTES de alguém apertar o botão. */}
        <fieldset className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            <Layers className="size-3" aria-hidden="true" />
            Ritmo de disparo
          </legend>

          <div className="flex flex-wrap items-center gap-2 text-[13px] text-zinc-700 dark:text-zinc-300">
            <span>Liberar</span>
            <input
              type="number"
              min={1}
              value={quantidade}
              onChange={(e) => setQuantidade(Number(e.target.value))}
              className="w-16 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-center tabular-nums outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
            />
            <span>leads a cada</span>
            <input
              type="number"
              min={1}
              value={minutos}
              onChange={(e) => setMinutos(Number(e.target.value))}
              className="w-20 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-center tabular-nums outline-none focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
            />
            <span>minutos</span>
          </div>

          <p className="px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {publico.toLocaleString("pt-BR")} contatos levam{" "}
            <strong className="font-medium">
              {tempoDeEscoamento(publico, quantidade, minutos)}
            </strong>{" "}
            para sair inteiros, em {Math.ceil(publico / Math.max(1, quantidade))}{" "}
            levas.
          </p>
        </fieldset>

        {/* A META NA CRIAÇÃO, e não depois: é ela que diz para que a campanha
            existe, e escolher isso antes de escrever a primeira mensagem muda o
            que se escreve. Vira o último bloco da corrente. */}
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            <Target className="size-3" aria-hidden="true" />
            O que esta campanha conta
          </span>
          <select
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-900 outline-none dark:border-zinc-800 dark:text-zinc-50"
          >
            {METAS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Vira o bloco final da campanha: quem chega nele entra nesta conta, e
            o nome escolhido é o da métrica na lista.
          </span>
        </label>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          As mensagens são escritas depois, na campanha.
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-full px-3 py-1.5 text-[12px] text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Fechar
          </button>
          <button
            type="button"
            disabled
            title="Disponível quando a API oficial do WhatsApp estiver conectada"
            className="flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            <Send className="size-3.5" aria-hidden="true" />
            Criar campanha
          </button>
        </div>
      </footer>
    </Sobreposicao>
  );
}
