"use client";

// A aba "Comentários" de uma conta do Instagram no /chat (2026-10-26).
//
// Ocupa as duas colunas da direita, no lugar da lista e da conversa: à
// esquerda as postagens recentes da conta (lidas da Meta, não do banco), com
// quantos comentários têm e quantos ninguém leu; à direita os comentários da
// postagem aberta, em thread (comentarios-thread.tsx). A postagem aberta está
// na URL (?postagem=), como a conversa: F5 volta ao mesmo lugar, e no celular
// a coluna das postagens cede a tela à thread.
//
// No topo das postagens, a regra da IA da CONTA (todas as postagens); a de cada
// postagem fica no topo da thread. Só Admin e TI veem os controles
// (podeAdministrar) — os outros leem o estado.
//
// Ao vivo pelo mesmo polling do chat (a versão de /api/chat/versao inclui os
// comentários): nenhuma pergunta nova ao servidor sai daqui.
import type { ReactNode } from "react";
import { Bot, Camera, Loader2, MessageCircle, TriangleAlert } from "lucide-react";
import { dataDoInstante } from "@/lib/formato";
import type { IaResumo } from "@/lib/ia/catalogo";
import type { ComentariosDaConta, PostagemInstagram } from "@/lib/instagram-tipos";
import type { CanalChat } from "./tipos";
import { CabecalhoCaixa } from "./lista";
import { ThreadComentarios } from "./comentarios-thread";
import { RegraIaComentarios, regraEfetiva } from "./regras-ia-instagram";
import { MiniaturaPostagem } from "./ui";

export function ComentariosInstagram({
  canais,
  canalAtual,
  dados,
  abas,
  ias,
  demo,
  postagemSelecionada,
  carregandoPostagem,
  postagensOcultas,
  aoTrocarCanal,
  aoAbrirPostagem,
  aoFecharPostagem,
  aoAbrirConversa,
}: {
  canais: CanalChat[];
  canalAtual: string;
  /** null quando o servidor não conseguiu montar a aba (ou na demonstração). */
  dados: ComentariosDaConta | null;
  /** Direct | Comentários. */
  abas: ReactNode;
  ias: IaResumo[];
  demo: boolean;
  /** A postagem destacada na lista — inclusive a clicada que ainda está chegando. */
  postagemSelecionada: string | null;
  carregandoPostagem: boolean;
  /** No celular, com uma postagem aberta, a lista cede a tela. */
  postagensOcultas: boolean;
  aoTrocarCanal: (chave: string) => void;
  aoAbrirPostagem: (midiaId: string) => void;
  aoFecharPostagem: () => void;
  aoAbrirConversa: (atendimentoId: string) => void;
}) {
  const postagemId = dados?.postagemId ?? null;
  const postagem = postagemId ? (dados?.postagens.find((p) => p.id === postagemId) ?? null) : null;

  return (
    <>
      <section
        className={`min-h-0 w-full flex-col border-r border-zinc-200 bg-white lg:flex lg:w-[340px] lg:shrink-0 dark:border-zinc-800 dark:bg-zinc-950 ${
          postagensOcultas ? "hidden" : "flex"
        }`}
      >
        <CabecalhoCaixa canais={canais} canalAtual={canalAtual} aoTrocarCanal={aoTrocarCanal} />
        {abas}

        {dados && (
          <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 tela-baixa:py-2 dark:border-zinc-800">
            <RegraIaComentarios
              contaId={dados.conta.id}
              usuario={dados.conta.usuario}
              midiaId={null}
              regras={dados.regras}
              ias={ias}
              podeAdministrar={dados.podeAdministrar}
              demo={demo}
            />
          </div>
        )}

        {dados?.erro && (
          <p
            role="alert"
            className="mx-3 mt-2.5 flex shrink-0 items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {/* O servidor já manda a frase inteira (Meta ou banco). */}
            <span>{dados.erro}</span>
          </p>
        )}

        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Postagens">
          {!dados ? (
            <Vazio titulo="Comentários indisponíveis" texto="Não consegui carregar os comentários desta conta. Tente de novo em instantes." />
          ) : dados.postagens.length === 0 ? (
            <Vazio titulo="Nenhuma postagem" texto="As postagens recentes da conta aparecem aqui." />
          ) : (
            dados.postagens.map((p) => (
              <ItemPostagem
                key={p.id}
                postagem={p}
                ativa={p.id === postagemSelecionada}
                iaLigada={Boolean(regraEfetiva(dados.regras, p.id)?.ligada)}
                aoAbrir={() => aoAbrirPostagem(p.id)}
              />
            ))
          )}
        </ul>
      </section>

      <section className={`relative min-w-0 flex-1 flex-col lg:flex ${postagensOcultas ? "flex" : "hidden"}`}>
        {carregandoPostagem ? (
          <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-900/30">
            <Loader2 className="size-5 animate-spin text-zinc-400" aria-label="Carregando comentários" />
          </div>
        ) : dados && postagemId ? (
          <ThreadComentarios
            key={postagemId}
            conta={dados.conta}
            postagemId={postagemId}
            postagem={postagem}
            comentarios={dados.comentarios}
            regras={dados.regras}
            ias={ias}
            podeAdministrar={dados.podeAdministrar}
            podeResponderPublico={dados.podeResponderPublico === true}
            podeResponderDirect={dados.podeResponderDirect === true}
            antesComentarios={dados.antesComentarios ?? null}
            temMaisComentarios={dados.temMaisComentarios === true}
            demo={demo}
            aoVoltar={aoFecharPostagem}
            aoAbrirConversa={aoAbrirConversa}
          />
        ) : (
          <SemPostagem usuario={dados?.conta.usuario ?? null} />
        )}
      </section>
    </>
  );
}

function ItemPostagem({
  postagem: p,
  ativa,
  iaLigada,
  aoAbrir,
}: {
  postagem: PostagemInstagram;
  ativa: boolean;
  iaLigada: boolean;
  aoAbrir: () => void;
}) {
  const legenda = p.legenda.replace(/\s+/g, " ").trim();
  const naoLidos = p.naoLidos > 0;
  return (
    <li>
      <button
        type="button"
        onClick={aoAbrir}
        aria-current={ativa ? "true" : undefined}
        className={`relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400 tela-baixa:py-2 ${
          ativa ? "bg-zinc-100 dark:bg-zinc-900" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
        }`}
      >
        {ativa && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-zinc-900 dark:bg-zinc-100" aria-hidden="true" />}
        <MiniaturaPostagem src={p.miniatura} tipo={p.tipo} tamanho={48} />
        <span className="min-w-0 flex-1">
          <span
            className={`line-clamp-2 text-[12.5px] leading-snug ${
              naoLidos ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-200"
            }`}
          >
            {legenda || "Sem legenda"}
          </span>
          <span className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span suppressHydrationWarning>{dataDoInstante(p.quando)}</span>
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <MessageCircle className="size-3" aria-hidden="true" />
              {p.comentarios}
              <span className="sr-only">{p.comentarios === 1 ? " comentário" : " comentários"}</span>
            </span>
            {iaLigada && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                <Bot className="size-2.5" aria-hidden="true" />
                IA
              </span>
            )}
          </span>
        </span>
        {naoLidos && (
          <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-pink-500 px-1 text-[10px] font-semibold tabular-nums text-white">
            {p.naoLidos > 99 ? "99+" : p.naoLidos}
            <span className="sr-only">{p.naoLidos === 1 ? " não lido" : " não lidos"}</span>
          </span>
        )}
      </button>
    </li>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <li className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
        <Camera className="size-5 text-zinc-400" aria-hidden="true" />
      </span>
      <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{titulo}</p>
      <p className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{texto}</p>
    </li>
  );
}

function SemPostagem({ usuario }: { usuario: string | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 px-6 text-center dark:bg-zinc-900/30">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <MessageCircle className="size-6 text-zinc-400" aria-hidden="true" />
      </span>
      <div>
        <p className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-50">
          {usuario ? `Comentários de @${usuario}` : "Comentários"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Escolha uma postagem à esquerda para ver os comentários, responder e chamar a pessoa no direct.
        </p>
      </div>
    </div>
  );
}
