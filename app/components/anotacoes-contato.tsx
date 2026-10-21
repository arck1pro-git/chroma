"use client";

// A seção "Anotações" do contato com o campo de anotar DENTRO dela — usada na
// gaveta de contatos e na aba Cliente da ficha da oportunidade.
//
// Fechado, o campo é uma linha "Anotar algo sobre Fulano…" com o microfone à
// vista, como na ficha de /contatos: anotar é a ação mais comum da gaveta e não
// pode morar atrás de um "+ Nova" miúdo. Ditar com ele fechado já abre o campo
// com o texto, para revisar antes de salvar.
//
// Quem usa passa key={contatoId}: trocar de contato descarta o rascunho em vez
// de levá-lo para o contato seguinte.
import { useState, useTransition } from "react";
import { Bot } from "lucide-react";
import type { Anotacao, Usuario } from "@/lib/entidades";
import { dataHora } from "@/lib/formato";
import { adicionarAnotacao } from "../contatos/actions";
import BotaoDitado, { juntarDitado } from "./botao-ditado";
import { Avatar, BOTAO_PRIMARIO, BOTAO_SECUNDARIO, MaisMenos, Secao, Vazio } from "./gaveta";

/** Acima disto a nota abre cortada, com "Ver tudo". */
const NOTA_LONGA = 220;
const VISIVEIS = 4;

export function AnotacoesContato({
  contatoId,
  nome,
  anotacoes,
  usuarioPorId,
}: {
  contatoId: string;
  nome?: string;
  anotacoes: Anotacao[];
  usuarioPorId: Map<string, Usuario>;
}) {
  const [escrevendo, setEscrevendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciarSalvamento] = useTransition();
  const [todas, setTodas] = useState(false);

  function fechar() {
    setEscrevendo(false);
    setTexto("");
    setErro(null);
  }

  function salvar() {
    const limpo = texto.trim();
    if (!limpo || salvando) return;
    setErro(null);
    iniciarSalvamento(async () => {
      try {
        // O revalidatePath da action devolve a lista nova na mesma ida ao
        // servidor — não precisa de router.refresh().
        const r = await adicionarAnotacao(contatoId, limpo);
        if (!r.ok) {
          // O texto fica no campo para a pessoa corrigir sem redigitar.
          setErro(r.erro);
          return;
        }
        fechar();
      } catch {
        // Falha inesperada: em produção a mensagem chega mascarada, então a
        // frase é daqui. O texto fica no campo para tentar de novo.
        setErro("Não foi possível salvar a anotação. Tente de novo.");
      }
    });
  }

  const primeiroNome = nome?.trim().split(/\s+/)[0];
  const vistas = todas ? anotacoes : anotacoes.slice(0, VISIVEIS);

  return (
    <Secao titulo="Anotações" contagem={anotacoes.length}>
      {escrevendo ? (
        <div className="surge mb-3 rounded-xl ring-1 ring-zinc-300 focus-within:ring-2 focus-within:ring-zinc-900/20 dark:ring-zinc-700 dark:focus-within:ring-white/20">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // O Esc aqui é do formulário: sem o stopPropagation ele também
              // chegaria ao listener da gaveta/ficha e fecharia o contato.
              if (e.key === "Escape") {
                e.stopPropagation();
                fechar();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                salvar();
              }
            }}
            maxLength={4000}
            rows={3}
            autoFocus
            disabled={salvando}
            aria-label="Nova anotação"
            placeholder={primeiroNome ? `O que você sabe sobre ${primeiroNome}?` : "Escreva uma anotação…"}
            className="block w-full resize-none rounded-t-xl bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-50"
          />
          {erro && (
            <p role="alert" className="px-3 pb-1 text-[11.5px] text-red-500">
              {erro}
            </p>
          )}
          <div className="flex items-center gap-1 px-2 pb-2">
            {/* Ditar: o que for falado entra no campo, para revisar antes de salvar. */}
            <BotaoDitado desligado={salvando} aoTranscrever={(t) => setTexto((v) => juntarDitado(v, t))} className="mr-auto" />
            <button type="button" onClick={fechar} disabled={salvando} className={BOTAO_SECUNDARIO}>
              Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando || !texto.trim()} title="Ctrl+Enter" className={BOTAO_PRIMARIO}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-1 rounded-xl bg-zinc-50 pr-1.5 ring-1 ring-inset ring-zinc-200/70 transition hover:ring-zinc-300 dark:bg-zinc-900/60 dark:ring-zinc-800 dark:hover:ring-zinc-700">
          <button
            type="button"
            onClick={() => setEscrevendo(true)}
            className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-[13px] text-zinc-400 outline-none dark:text-zinc-500"
          >
            {primeiroNome ? `Anotar algo sobre ${primeiroNome}…` : "Anotar algo…"}
          </button>
          <BotaoDitado
            aoTranscrever={(t) => {
              setTexto((v) => juntarDitado(v, t));
              setEscrevendo(true);
            }}
          />
        </div>
      )}

      {anotacoes.length === 0 ? (
        !escrevendo && <Vazio>Nada anotado ainda</Vazio>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {vistas.map((a) => (
              <Nota key={a.id} anotacao={a} usuarioPorId={usuarioPorId} />
            ))}
          </ul>
          {anotacoes.length > VISIVEIS && (
            <MaisMenos todos={todas} resto={anotacoes.length - VISIVEIS} aoAlternar={() => setTodas((v) => !v)} />
          )}
        </>
      )}
    </Secao>
  );
}

function Nota({ anotacao: a, usuarioPorId }: { anotacao: Anotacao; usuarioPorId: Map<string, Usuario> }) {
  const [aberta, setAberta] = useState(false);
  // A IA não é usuário: as anotações dela (o resumo do atendimento,
  // lib/ia/atendente.ts) vêm sem autor e com 🤖 no começo. A primeira linha
  // dela é o título ("Resumo do atendimento (IA comercial), reunião em …").
  const daIa = !a.autor_id && a.texto.startsWith("🤖");
  const autor = usuarioPorId.get(a.autor_id)?.nome;
  const limpo = daIa ? a.texto.replace(/^🤖\s*/, "") : a.texto;
  const quebra = daIa ? limpo.indexOf("\n") : -1;
  const titulo = quebra > 0 ? limpo.slice(0, quebra).trim() : null;
  const corpo = (titulo ? limpo.slice(quebra) : limpo).trim();
  // Longa pelo tamanho OU pelas linhas: o resumo da IA é uma lista curta por linha.
  const longa = corpo.length > NOTA_LONGA || corpo.split("\n").length > 4;

  return (
    <li
      className={`rounded-xl px-3 py-2.5 ${
        daIa
          ? "bg-violet-50/70 ring-1 ring-inset ring-violet-100 dark:bg-violet-500/[0.07] dark:ring-violet-500/15"
          : "bg-amber-50/80 ring-1 ring-inset ring-amber-100/80 dark:bg-amber-400/[0.06] dark:ring-amber-400/10"
      }`}
    >
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {daIa ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-violet-600 text-white dark:bg-violet-500">
            <Bot className="size-3" aria-hidden="true" />
          </span>
        ) : (
          <Avatar nome={autor ?? "?"} tamanho="sm" equipe />
        )}
        <span className="font-medium text-zinc-700 dark:text-zinc-200">{daIa ? "IA" : (autor ?? "Autor desconhecido")}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{dataHora(a.data_criacao)}</span>
        {/* anotação se edita (o histórico não) — marcar isso evita discussão
            sobre "eu não escrevi assim" */}
        {a.data_atualizacao && <span>· editada</span>}
      </p>
      {titulo && <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-zinc-900 dark:text-zinc-50">{titulo}</p>}
      <p
        className={`mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200 ${
          longa && !aberta ? "line-clamp-4" : ""
        }`}
      >
        {corpo}
      </p>
      {longa && (
        <button
          type="button"
          onClick={() => setAberta((v) => !v)}
          className="mt-1 text-[12px] font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {aberta ? "Mostrar menos" : "Ver tudo"}
        </button>
      )}
    </li>
  );
}
