"use client";

// O FEED da ficha: tudo o que aconteceu com o contato, numa linha do tempo só,
// do mais novo para o mais antigo, agrupado por dia.
//
// Junta o que o CRM guarda em lugares diferentes — as conversas (resumidas por
// dia), o histórico (etapa, reunião, IA, automação), as anotações, os vídeos,
// as captações e as campanhas — porque quem atende quer UMA resposta: "o que
// rolou com essa pessoa?". Cada coisa no seu cartão obrigava a montar a
// ordem de cabeça.
//
// Anotar fica no topo, como nos melhores CRMs: é a ação mais frequente da
// ficha, e a nota nova aparece logo abaixo, no dia de hoje.
//
// Os filtros só mostram assunto que existe — chip de "Vídeos (0)" é ruído.
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Smartphone,
  Sparkles,
  CalendarCheck2,
  Clapperboard,
  History,
  Inbox,
  Megaphone,
  MessageCircle,
  StickyNote,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { FichaContato, MensagemDaFicha } from "@/lib/contatos-ficha";
import { adicionarAnotacao } from "./actions";
import { assuntoDoHistorico, diaDe, hora, lerObjecao, rotuloDoDia, Selo, tempo, type Assunto, type Objecao } from "./pecas";

type Item = { id: string; quando: string; assunto: Assunto } & (
  | { tipo: "conversa"; dia: FichaContato["dias"][number] }
  | { tipo: "historico"; descricao: string; autor: string | null }
  | { tipo: "nota"; texto: string; autor: string }
  | { tipo: "video"; video: FichaContato["videos"][number] }
  | { tipo: "captacao"; captacao: FichaContato["origem"]["captacoes"][number] }
  | { tipo: "campanha"; campanha: FichaContato["campanhas"][number] }
);

const ASSUNTOS: { valor: Assunto; rotulo: string; Icone: LucideIcon }[] = [
  { valor: "conversa", rotulo: "Conversas", Icone: MessageCircle },
  { valor: "negocio", rotulo: "Negócio", Icone: TrendingUp },
  { valor: "ia", rotulo: "IA", Icone: Bot },
  { valor: "agenda", rotulo: "Agenda", Icone: CalendarCheck2 },
  { valor: "video", rotulo: "Vídeos", Icone: Clapperboard },
  { valor: "nota", rotulo: "Notas", Icone: StickyNote },
  { valor: "automacao", rotulo: "Automações", Icone: Workflow },
  { valor: "entrada", rotulo: "Entrada", Icone: Inbox },
  { valor: "sistema", rotulo: "Sistema", Icone: History },
];
const ICONE = Object.fromEntries(ASSUNTOS.map((a) => [a.valor, a.Icone])) as Record<Assunto, LucideIcon>;

const CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  whatsapp_oficial: "WhatsApp oficial",
  instagram: "Instagram",
  email: "e-mail",
};

const POR_VEZ = 30;

function montarItens(ficha: FichaContato, nomeDoAutor: (id: string) => string): Item[] {
  const itens: Item[] = [];
  for (const d of ficha.dias) {
    itens.push({ id: `c${d.atendimentoId}${d.dia}`, quando: d.ultimaEm, assunto: "conversa", tipo: "conversa", dia: d });
  }
  for (const h of ficha.historico) {
    const assunto = assuntoDoHistorico(h.descricao);
    // "Abriu o vídeo" já aparece, mais completo, no item do vídeo.
    if (assunto === "video") continue;
    itens.push({ id: `h${h.id}`, quando: h.quando, assunto, tipo: "historico", descricao: h.descricao, autor: h.autor });
  }
  for (const a of ficha.anotacoes) {
    // Sem autor é a IA (o resumo que a IA comercial grava ao marcar reunião).
    itens.push({ id: `n${a.id}`, quando: a.data_criacao, assunto: "nota", tipo: "nota", texto: a.texto, autor: a.autor_id ? nomeDoAutor(a.autor_id) : "IA" });
  }
  for (const v of ficha.videos) {
    itens.push({ id: `v${v.id}`, quando: v.ultima, assunto: "video", tipo: "video", video: v });
  }
  for (const c of ficha.origem.captacoes) {
    itens.push({ id: `w${c.id}`, quando: c.quando, assunto: "entrada", tipo: "captacao", captacao: c });
  }
  ficha.campanhas.forEach((c, i) =>
    itens.push({ id: `k${i}`, quando: c.enviadoEm ?? c.quando, assunto: "automacao", tipo: "campanha", campanha: c }),
  );
  return itens.sort((a, b) => b.quando.localeCompare(a.quando));
}

export default function Atividade({
  ficha,
  nomeDoAutor,
  aoMudar,
}: {
  ficha: FichaContato;
  nomeDoAutor: (id: string) => string;
  aoMudar: () => void;
}) {
  const [filtro, setFiltro] = useState<Assunto | "tudo">("tudo");
  const [quantos, setQuantos] = useState(POR_VEZ);
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const campoRef = useRef<HTMLTextAreaElement>(null);

  const itens = useMemo(() => montarItens(ficha, nomeDoAutor), [ficha, nomeDoAutor]);
  const contagem = useMemo(() => {
    const c = new Map<Assunto, number>();
    for (const i of itens) c.set(i.assunto, (c.get(i.assunto) ?? 0) + 1);
    return c;
  }, [itens]);

  const filtrados = filtro === "tudo" ? itens : itens.filter((i) => i.assunto === filtro);
  const visiveis = filtrados.slice(0, quantos);

  // Agrupados por dia, na ordem em que já vêm (do mais novo).
  const grupos: { dia: string; itens: Item[] }[] = [];
  for (const item of visiveis) {
    const dia = diaDe(item.quando);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.dia === dia) ultimo.itens.push(item);
    else grupos.push({ dia, itens: [item] });
  }

  const primeiroNome = ficha.contato.nome.split(" ")[0] || "o contato";

  function anotar() {
    const texto = nota.trim();
    if (!texto || salvando) return;
    setErro(null);
    iniciar(async () => {
      try {
        await adicionarAnotacao(ficha.contato.id, texto);
        setNota("");
        aoMudar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui salvar a nota.");
      }
    });
  }

  return (
    <div className="min-w-0">
      {/* ── Anotar ── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          anotar();
        }}
        className="rounded-xl border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:border-zinc-600"
      >
        <textarea
          ref={campoRef}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              anotar();
            }
          }}
          rows={nota ? 3 : 1}
          placeholder={`Anotar algo sobre ${primeiroNome}…`}
          aria-label="Nova anotação"
          className="block w-full resize-none rounded-xl bg-transparent px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
        />
        {nota && (
          <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Ctrl + Enter para salvar · fica no histórico, ninguém edita</span>
            <button
              type="submit"
              disabled={salvando}
              className="rounded-lg bg-zinc-900 px-3 py-1 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {salvando ? "Salvando…" : "Anotar"}
            </button>
          </div>
        )}
      </form>
      {erro && <p role="alert" className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{erro}</p>}

      {/* ── Filtros ── */}
      {itens.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1" role="tablist" aria-label="Filtrar a atividade">
          {[{ valor: "tudo" as const, rotulo: "Tudo", n: itens.length }, ...ASSUNTOS.filter((a) => contagem.get(a.valor)).map((a) => ({ valor: a.valor, rotulo: a.rotulo, n: contagem.get(a.valor)! }))].map((f) => (
            <button
              key={f.valor}
              type="button"
              role="tab"
              aria-selected={filtro === f.valor}
              onClick={() => {
                setFiltro(f.valor);
                setQuantos(POR_VEZ);
              }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                filtro === f.valor
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              }`}
            >
              {f.rotulo}
              <span className={`ml-1 tabular-nums ${filtro === f.valor ? "opacity-60" : "text-zinc-400 dark:text-zinc-600"}`}>{f.n}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── A linha do tempo ── */}
      {itens.length === 0 ? (
        <div className="mt-10 text-center">
          <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Nada aconteceu ainda com {primeiroNome}.</p>
          <p className="mt-1 text-[12px] text-zinc-400 dark:text-zinc-500">Conversas, mudanças de etapa, reuniões e vídeos aparecem aqui conforme acontecem.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {grupos.map((g) => (
            <section key={g.dia} aria-label={rotuloDoDia(g.dia)}>
              <h4 className="mb-2 text-[11px] font-semibold text-zinc-400 first-letter:uppercase dark:text-zinc-500" suppressHydrationWarning>
                {rotuloDoDia(g.dia)}
              </h4>
              <ol>
                {g.itens.map((item, i) => (
                  <Linha key={item.id} item={item} ultimo={i === g.itens.length - 1} primeiroNome={primeiroNome} />
                ))}
              </ol>
            </section>
          ))}
          {filtrados.length > quantos && (
            <button
              type="button"
              onClick={() => setQuantos((q) => q + POR_VEZ)}
              className="w-full rounded-lg py-2 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              Ver mais {Math.min(POR_VEZ, filtrados.length - quantos)} de {filtrados.length - quantos}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Linha({ item, ultimo, primeiroNome }: { item: Item; ultimo: boolean; primeiroNome: string }) {
  const Icone = ICONE[item.assunto];
  const objecao = item.tipo === "historico" ? lerObjecao(item.descricao) : null;
  return (
    <li className="relative pb-4 pl-10 last:pb-1">
      {!ultimo && <span className="absolute bottom-0 left-[13px] top-7 w-px bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />}
      <span
        className={`absolute left-0 top-0 flex size-7 items-center justify-center rounded-full ${
          objecao
            ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
        }`}
      >
        <Icone className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 pt-1">
        <Conteudo item={item} objecao={objecao} primeiroNome={primeiroNome} />
      </div>
    </li>
  );
}

function Meta({ children, quando }: { children?: React.ReactNode; quando: string }) {
  return (
    <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500" suppressHydrationWarning>
      {hora(quando)}
      {children ? <> · {children}</> : null}
    </p>
  );
}

const linkSutil =
  "ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-50";

function Conteudo({
  item,
  objecao,
  primeiroNome,
}: {
  item: Item;
  objecao: Objecao | null;
  primeiroNome: string;
}) {
  switch (item.tipo) {
    case "conversa":
      return <TrechoDeConversa dia={item.dia} primeiroNome={primeiroNome} />;
    case "historico":
      return objecao ? (
        <>
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-zinc-900 dark:text-zinc-50">
            Objeção <Selo tom="aviso">{objecao.tema}</Selo>
          </p>
          <blockquote className="mt-1.5 border-l-2 border-amber-300 pl-2.5 text-[12.5px] italic leading-relaxed text-zinc-700 dark:border-amber-500/50 dark:text-zinc-200">
            “{objecao.fala}”
          </blockquote>
          {(objecao.motivo || objecao.resposta) && (
            <dl className="mt-1.5 space-y-0.5 text-[12px] leading-snug">
              {objecao.motivo && (
                <div>
                  <dt className="inline font-medium text-zinc-500 dark:text-zinc-400">Por trás: </dt>
                  <dd className="inline text-zinc-600 dark:text-zinc-300">{objecao.motivo}</dd>
                </div>
              )}
              {objecao.resposta && (
                <div>
                  <dt className="inline font-medium text-zinc-500 dark:text-zinc-400">A IA respondeu: </dt>
                  <dd className="inline text-zinc-600 dark:text-zinc-300">{objecao.resposta}</dd>
                </div>
              )}
            </dl>
          )}
          <Meta quando={item.quando}>registrada pela IA</Meta>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-snug text-zinc-800 dark:text-zinc-200">{item.descricao}</p>
          <Meta quando={item.quando}>{item.autor ?? "Sistema"}</Meta>
        </>
      );
    case "nota":
      return <Nota texto={item.texto} autor={item.autor} quando={item.quando} />;
    case "video": {
      const v = item.video;
      const fracao = v.duracao ? Math.min(1, v.cobertura / v.duracao) : null;
      return (
        <>
          <p className="text-[13px] text-zinc-900 dark:text-zinc-50">
            Assistiu <span className="font-medium">{v.nome}</span>
            <Link href={`/videos?video=${v.id}`} className={linkSutil}>
              ver <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </p>
          <div className="mt-1.5 flex max-w-xs items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100"
                style={{ width: `${fracao === null ? 0 : Math.max(fracao * 100, v.cobertura > 0 ? 3 : 0)}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
              {fracao === null ? tempo(v.cobertura) : `${Math.round(fracao * 100)}%`}
            </span>
          </div>
          <Meta quando={v.ultima}>
            {tempo(v.cobertura)} vistos · abriu {v.aberturas} {v.aberturas === 1 ? "vez" : "vezes"}
          </Meta>
        </>
      );
    }
    case "captacao": {
      const c = item.captacao;
      return (
        <>
          <p className="text-[13px] text-zinc-900 dark:text-zinc-50">
            Chegou pela captação <span className="font-medium">{c.webhook}</span>
            <Link href={`/webhooks?webhook=${c.webhookId}`} className={linkSutil}>
              ver <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </p>
          <Meta quando={c.quando}>{c.estado === "ok" ? (c.resumo ?? "recebido") : (c.erro ?? c.estado)}</Meta>
        </>
      );
    }
    case "campanha": {
      const c = item.campanha;
      return (
        <>
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-zinc-900 dark:text-zinc-50">
            <Megaphone className="size-3.5 text-zinc-400" aria-hidden="true" />
            Recebeu a campanha <span className="font-medium">{c.campanha}</span>
            {c.conversao ? <Selo tom="bom">converteu</Selo> : c.respondeuEm ? <Selo>respondeu</Selo> : null}
          </p>
          <Meta quando={c.enviadoEm ?? c.quando}>{c.erro ?? c.estado}</Meta>
        </>
      );
    }
  }
}

/** Nota longa (o resumo da IA passa de dez linhas) vem dobrada, com "ver tudo". */
function Nota({ texto, autor, quando }: { texto: string; autor: string; quando: string }) {
  const [aberta, setAberta] = useState(false);
  const longa = texto.length > 320 || texto.split(/\r?\n/).length > 6;
  return (
    <>
      <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
        <p className={`whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200 ${longa && !aberta ? "line-clamp-5" : ""}`}>
          {texto}
        </p>
        {longa && (
          <button
            type="button"
            onClick={() => setAberta((a) => !a)}
            className="mt-1 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            {aberta ? "ver menos" : "ver tudo"}
          </button>
        )}
      </div>
      <Meta quando={quando}>{autor === "IA" ? "resumo da IA" : `nota de ${autor}`}</Meta>
    </>
  );
}

// ── A conversa do dia ─────────────────────────────────────────────────────────
//
// Um dia de conversa, como CHAT — e não como uma linha "trocou 12 mensagens":
// o contexto de uma fala está nas falas em volta dela. O dia vem INTEIRO, de
// uma vez (pedido de 2026-10-06: ler o histórico sem ficar abrindo nada).
// "Abrir no chat" é para responder.
//
// O desenho é o do Chat do CRM (app/chat/conversa.tsx), em escala menor: o lead
// em branco à esquerda; à direita, violeta para IA e automação ("não foi
// gente") e escuro para a equipe — quem já usa o Chat lê sem aprender nada.

const MIDIA: Record<string, string> = {
  imagem: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  documento: "📄 Documento",
  sticker: "Figurinha",
  localizacao: "📍 Localização",
  contato: "👤 Contato",
};

function TrechoDeConversa({ dia, primeiroNome }: { dia: FichaContato["dias"][number]; primeiroNome: string }) {
  const mensagens = dia.mensagens;
  // Só acontece com conversa enorme, além do teto da ficha (lib/contatos-ficha.ts).
  const cortadas = dia.total - mensagens.length;

  return (
    <>
      <p className="text-[13px] text-zinc-900 dark:text-zinc-50">
        Conversa no {CANAL[dia.canal] ?? dia.canal}
        <span className="text-zinc-500 dark:text-zinc-400">
          {" "}
          · {dia.total} {dia.total === 1 ? "mensagem" : "mensagens"}
        </span>
        <Link href={`/chat?atendimento=${dia.atendimentoId}`} className={linkSutil}>
          abrir no chat <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </p>

      <div className="mt-2 rounded-xl bg-zinc-50 px-3 pb-3 pt-1 dark:bg-zinc-900/60">
        {cortadas > 0 && (
          <Link
            href={`/chat?atendimento=${dia.atendimentoId}`}
            className="mx-auto mt-2 block w-fit rounded-full px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            {cortadas} mensagens mais antigas deste dia estão no chat
          </Link>
        )}
        {mensagens.map((m, i) => (
          <BalaoMini key={m.id} m={m} inicioDeBloco={i === 0 || !mesmoLado(mensagens[i - 1], m)} primeiroNome={primeiroNome} />
        ))}
      </div>

      <Meta quando={dia.ultimaEm}>
        {[dia.dele && `${dia.dele} dele`, dia.ia && `${dia.ia} da IA`, dia.equipe && `${dia.equipe} da equipe`].filter(Boolean).join(", ")}
      </Meta>
    </>
  );
}

/** Duas falas seguidas do mesmo "lado" e do mesmo jeito formam um bloco. */
function mesmoLado(a: MensagemDaFicha, b: MensagemDaFicha) {
  return a.deQuem === b.deQuem && (a.deQuem === "contato" || (a.por === b.por && a.autor === b.autor));
}

function BalaoMini({
  m,
  inicioDeBloco,
  primeiroNome,
}: {
  m: MensagemDaFicha;
  inicioDeBloco: boolean;
  primeiroNome: string;
}) {
  const nosso = m.deQuem === "agente";
  const ia = nosso && m.por === "ia";
  const automacao = nosso && (m.por === "automacao" || ia);
  const celular = nosso && m.por === "aparelho";
  const falhou = m.status === "erro";

  const cor = !nosso
    ? "bg-white text-zinc-800 ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
    : automacao
      ? "bg-violet-50 text-violet-950 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-50 dark:ring-violet-400/25"
      : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
  const canto = inicioDeBloco ? (nosso ? "rounded-tr-md" : "rounded-tl-md") : "";
  const apagado = nosso && !automacao ? "text-white/55 dark:text-zinc-900/50" : "text-zinc-400 dark:text-zinc-500";

  const rotulo = !inicioDeBloco
    ? null
    : !nosso
      ? primeiroNome
      : ia
        ? "Assistente IA"
        : automacao
          ? "Automação"
          : celular
            ? `${m.autor ? `${m.autor} · ` : ""}pelo celular`
            : m.autor;

  return (
    <div className={`flex flex-col ${nosso ? "items-end" : "items-start"} ${inicioDeBloco ? "mt-2.5" : "mt-0.5"}`}>
      {rotulo && (
        <span
          className={`mb-0.5 inline-flex items-center gap-1 px-1 text-[10px] font-medium ${
            automacao ? "text-violet-600 dark:text-violet-300" : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {ia && <Sparkles className="size-2.5" aria-hidden="true" />}
          {automacao && !ia && <Bot className="size-2.5" aria-hidden="true" />}
          {celular && <Smartphone className="size-2.5" aria-hidden="true" />}
          {rotulo}
        </span>
      )}
      <div
        className={`relative max-w-[82%] rounded-2xl px-2.5 py-1.5 text-[12.5px] leading-relaxed shadow-[0_1px_0.5px_rgba(0,0,0,0.04)] ${cor} ${canto} ${
          falhou ? "ring-2 ring-red-400/70" : ""
        }`}
      >
        {m.tipo !== "texto" && (
          <span className={`block text-[11px] font-medium ${apagado}`}>
            {MIDIA[m.tipo] ?? m.tipo}
            {m.tipo === "audio" && m.texto ? " · transcrição" : ""}
          </span>
        )}
        {m.texto && (
          <p className="whitespace-pre-wrap break-words">
            {m.texto}
            {/* O canto da última linha fica para a hora, como no WhatsApp. */}
            <span className="inline-block w-9" aria-hidden="true" />
          </p>
        )}
        <span className={`absolute bottom-1 right-2 text-[9.5px] leading-none tabular-nums ${apagado}`}>{hora(m.quando)}</span>
      </div>
      {falhou && <span className="mt-0.5 px-1 text-[10px] text-red-600 dark:text-red-400">não enviada</span>}
    </div>
  );
}
