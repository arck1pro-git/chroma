"use client";

// A coluna de canais: por qual número nosso a pessoa quer olhar as conversas.
//
// Os números são agrupados pelo PAPEL, não pela tecnologia — "Comercial" e
// "Automações e IA" são o que a equipe entende; "uazapi" e "Cloud API" vão só
// como subtítulo. Cada canal aparece como uma pessoa: a foto e o nome do perfil
// que o cliente vê do outro lado, o número, e o ponto de conexão.
//
// Três larguras:
//   · xl+    → coluna cheia, com nome, número e contagem;
//   · lg     → só os avatares (a lista e a conversa precisam do espaço);
//   · < lg   → some; quem troca de canal é o menu do cabeçalho da lista.
import Link from "next/link";
import { Inbox, Settings2 } from "lucide-react";
import type { CanalChat, TipoCanal } from "./tipos";
import { Avatar, ESTADO, PAPEL, formatarTelefone } from "./ui";

function Contagem({ n, destaque }: { n: number; destaque?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={`flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
        destaque ? "bg-emerald-500 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function ItemCanal({
  canal,
  ativo,
  aoEscolher,
  compacto,
}: {
  canal: CanalChat;
  ativo: boolean;
  aoEscolher: () => void;
  /** No trilho estreito (lg) o texto some e fica só o avatar. */
  compacto: boolean;
}) {
  const estado = ESTADO[canal.estado];
  const titulo = canal.perfil && canal.perfil !== canal.nome ? `${canal.nome} · ${canal.perfil}` : canal.nome;
  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-current={ativo ? "true" : undefined}
      title={`${titulo}\n${formatarTelefone(canal.numero)} · ${estado.rotulo}`}
      className={`group relative flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition ${
        compacto ? "justify-center xl:justify-start xl:px-2 xl:py-2" : "px-2 py-2"
      } ${
        ativo
          ? "bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-900/70"
      }`}
    >
      <Avatar nome={canal.perfil ?? canal.nome} src={canal.foto} tamanho={36}>
        <span
          className={`absolute -bottom-px -right-px size-3 rounded-full ring-2 ring-zinc-50 dark:ring-zinc-950 ${estado.ponto}`}
          aria-label={estado.rotulo}
          role="img"
        />
        {/* No trilho estreito a contagem vira bolinha no canto do avatar. */}
        {compacto && canal.naoLidas > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white ring-2 ring-zinc-50 xl:hidden dark:ring-zinc-950">
            {canal.naoLidas > 9 ? "9+" : canal.naoLidas}
          </span>
        )}
      </Avatar>
      <span className={`min-w-0 flex-1 ${compacto ? "hidden xl:block" : ""}`}>
        <span className="flex items-center justify-between gap-2">
          <span className={`truncate text-[13px] ${ativo ? "font-semibold" : "font-medium"} text-zinc-900 dark:text-zinc-50`}>
            {canal.nome}
          </span>
          <Contagem n={canal.naoLidas} destaque />
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="truncate tabular-nums">{formatarTelefone(canal.numero)}</span>
          {canal.naFila > 0 && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              {canal.naFila} na fila
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function Grupo({
  tipo,
  canais,
  atual,
  aoEscolher,
  compacto,
}: {
  tipo: TipoCanal;
  canais: CanalChat[];
  atual: string;
  aoEscolher: (chave: string) => void;
  compacto: boolean;
}) {
  if (canais.length === 0) return null;
  const { rotulo, meio, Icone } = PAPEL[tipo];
  return (
    <div className="flex flex-col gap-1">
      <p
        className={`flex items-center gap-1.5 px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 ${
          compacto ? "justify-center xl:justify-start" : ""
        }`}
        title={`${rotulo} · ${meio}`}
      >
        <Icone className={`size-3.5 ${tipo === "api" ? "text-violet-500" : "text-emerald-500"}`} />
        <span className={compacto ? "hidden xl:inline" : ""}>{rotulo}</span>
        <span className={`font-normal normal-case tracking-normal ${compacto ? "hidden xl:inline" : ""}`}>· {meio}</span>
      </p>
      {canais.map((c) => (
        <ItemCanal key={c.chave} canal={c} ativo={atual === c.chave} aoEscolher={() => aoEscolher(c.chave)} compacto={compacto} />
      ))}
    </div>
  );
}

/** A lista dos canais, usada no trilho (desktop) e no menu (celular). */
export function ListaCanais({
  canais,
  atual,
  aoEscolher,
  compacto = false,
}: {
  canais: CanalChat[];
  atual: string;
  aoEscolher: (chave: string) => void;
  compacto?: boolean;
}) {
  const naoLidas = canais.reduce((s, c) => s + c.naoLidas, 0);
  const todos = atual === "";
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => aoEscolher("")}
        aria-current={todos ? "true" : undefined}
        title="Todas as conversas, de todos os números"
        className={`relative flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition ${
          compacto ? "justify-center xl:justify-start xl:px-2 xl:py-2" : "px-2 py-2"
        } ${
          todos
            ? "bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-900/70"
        }`}
      >
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
          <Inbox className="size-4" />
          {compacto && naoLidas > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white ring-2 ring-zinc-50 xl:hidden dark:ring-zinc-950">
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </span>
        <span className={`min-w-0 flex-1 ${compacto ? "hidden xl:block" : ""}`}>
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate text-[13px] ${todos ? "font-semibold" : "font-medium"} text-zinc-900 dark:text-zinc-50`}>
              Todas as conversas
            </span>
            <Contagem n={naoLidas} destaque />
          </span>
          <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
            {canais.length} {canais.length === 1 ? "número" : "números"}
          </span>
        </span>
      </button>

      <Grupo tipo="web" canais={canais.filter((c) => c.tipo === "web")} atual={atual} aoEscolher={aoEscolher} compacto={compacto} />
      <Grupo tipo="api" canais={canais.filter((c) => c.tipo === "api")} atual={atual} aoEscolher={aoEscolher} compacto={compacto} />

      {canais.length === 0 && (
        <p className={`px-2 text-[11px] leading-relaxed text-zinc-400 ${compacto ? "hidden xl:block" : ""}`}>
          Nenhum número conectado. Pareie um WhatsApp em Configurações.
        </p>
      )}
    </div>
  );
}

export function TrilhoCanais({
  canais,
  atual,
  aoEscolher,
}: {
  canais: CanalChat[];
  atual: string;
  aoEscolher: (chave: string) => void;
}) {
  return (
    <nav
      aria-label="Canais"
      className="hidden shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/70 lg:flex lg:w-[68px] xl:w-64 dark:border-zinc-800 dark:bg-zinc-950/50"
    >
      <header className="flex h-14 shrink-0 items-center justify-center border-b border-zinc-200 px-3 xl:justify-between xl:px-4 dark:border-zinc-800">
        <span className="hidden text-[13px] font-semibold tracking-tight text-zinc-900 xl:block dark:text-zinc-50">
          Canais
        </span>
        <Link
          href="/configuracoes/whatsapp"
          title="Gerenciar números"
          aria-label="Gerenciar números"
          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <Settings2 className="size-4" />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ListaCanais canais={canais} atual={atual} aoEscolher={aoEscolher} compacto />
      </div>
    </nav>
  );
}
