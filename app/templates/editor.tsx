"use client";

// O editor de template: o formulário à esquerda e, à direita, a mesma prévia
// da tela (./previa.tsx) montada com o que está sendo digitado. As regras da
// Meta vêm de lib/templates-whatsapp.ts, as mesmas que a rota confere de novo,
// e o primeiro problema aparece ao lado do botão de enviar: o botão diz o que
// falta em vez de só ficar apagado. As peças do formulário estão em
// ./campos-editor.tsx.
//
// O botão de link pode terminar em {{1}} ("Link com variável", 2026-10-27): o
// final é preenchido em cada envio — o uso típico é o link rastreável do vídeo
// com o WhatsApp do contato — e a Meta pede um exemplo dele para analisar.
//
// Fechar com texto escrito pede confirmação no próprio rodapé (Esc, véu ou
// Cancelar): um clique fora do modal não pode jogar fora um template inteiro.
//
// O cabeçalho pode ser de imagem, vídeo ou PDF (2026-10-28), com um arquivo de
// exemplo da biblioteca (./cabecalho-midia.tsx). Trocar de formato guarda o
// texto digitado: voltar para Texto o traz de volta.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Documento } from "@/lib/documentos";
import {
  avisosDo,
  baseDoLink,
  emGrupos,
  LIMITE,
  linksVariaveisDe,
  midiaDoRascunho,
  nomeDeTemplate,
  problemaDoLinkVariavel,
  problemasDo,
  variaveisDo,
  type BotaoRascunho,
  type Categoria,
  type ConteudoTemplate,
  type Problema,
  type Rascunho,
  type TipoBotao,
} from "@/lib/templates-whatsapp";
import {
  BellRing,
  Bold,
  Braces,
  ExternalLink,
  Italic,
  LayoutTemplate,
  Loader2,
  Megaphone,
  Phone,
  Reply,
  SendHorizonal,
  Strikethrough,
  Trash2,
  TriangleAlert,
  X,
  type TipoIcone,
} from "@/app/components/icones";
import { maiuscula } from "@/app/chat/ui";
import CamadaTopo from "../components/camada-topo";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO, BotaoIcone, CAMPO } from "../components/gaveta";
import {
  Bloco,
  CampoExemplo,
  CampoLink,
  Contador,
  Ferramenta,
  FIM_VARIAVEL,
  OpcaoLinkVariavel,
  Situacao,
} from "./campos-editor";
import { ArquivoDeExemplo, FormatosDoCabecalho } from "./cabecalho-midia";
import { PreviaWhatsApp } from "./previa";

const CATEGORIAS: Array<{ valor: Categoria; rotulo: string; descricao: string; Icone: TipoIcone }> = [
  { valor: "MARKETING", rotulo: "Marketing", descricao: "Ofertas, lançamentos, convites e reengajamento.", Icone: Megaphone },
  { valor: "UTILITY", rotulo: "Utilidade", descricao: "Confirmação, lembrete ou atualização de algo que a pessoa pediu.", Icone: BellRing },
];

const TIPOS_BOTAO: TipoBotao[] = ["QUICK_REPLY", "URL", "PHONE_NUMBER"];

const BOTAO_NOVO: Record<TipoBotao, { rotulo: string; Icone: TipoIcone; texto: string; destino?: string }> = {
  QUICK_REPLY: { rotulo: "Resposta", Icone: Reply, texto: "Quero saber mais" },
  URL: { rotulo: "Link", Icone: ExternalLink, texto: "Ver o site", destino: "https://" },
  PHONE_NUMBER: { rotulo: "Ligar", Icone: Phone, texto: "Ligar agora", destino: "" },
};

export default function Editor({
  inicial,
  origem,
  deFora,
  contaId,
  contaNome,
  nomesUsados,
  documentos,
  aoFechar,
  aoCriar,
}: {
  inicial: Rascunho;
  /** O nome do template duplicado; null num template em branco. */
  origem: string | null;
  /** O que a cópia do template de origem não pôde levar (ver rascunhoDe). */
  deFora: string[];
  contaId: string;
  contaNome: string | null;
  nomesUsados: Set<string>;
  /** A biblioteca, para o exemplo do cabeçalho de mídia; null = fora do acesso. */
  documentos: Documento[] | null;
  aoFechar: () => void;
  aoCriar: (id: string | null) => void;
}) {
  const [r, setR] = useState(inicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);
  const cabecalhoRef = useRef<HTMLInputElement>(null);
  const corpoRef = useRef<HTMLTextAreaElement>(null);
  const botoesRef = useRef<HTMLUListElement>(null);
  const tituloId = useId();
  const duplicado = origem !== null;

  const mudar = (parcial: Partial<Rascunho>) => {
    setR((atual) => ({ ...atual, ...parcial }));
    setErro(null);
    setSaindo(false);
  };

  const nomeRepetido = nomesUsados.has(r.nome.trim());
  const problemas = useMemo<Problema[]>(
    () => [
      ...(nomeRepetido ? [{ campo: "nome" as const, mensagem: "Já existe um template com esse nome nesta conta." }] : []),
      ...problemasDo(r),
    ],
    [r, nomeRepetido],
  );
  const avisos = useMemo(() => avisosDo(r), [r]);
  const sujo = JSON.stringify(r) !== JSON.stringify(inicial);
  // O problema de um campo só aparece embaixo dele depois que há algo escrito
  // ali; o que falta num formulário em branco fica só no rodapé.
  const problemaDe = (campo: Problema["campo"], valor: string) =>
    valor.trim() ? problemas.find((p) => p.campo === campo)?.mensagem : undefined;

  const varsCorpo = variaveisDo(r.corpo).sort((a, b) => a - b);
  const midia = midiaDoRascunho(r);
  const temVarCabecalho = !midia && variaveisDo(r.cabecalho).length > 0;

  const conteudo: ConteudoTemplate = {
    cabecalho: midia
      ? { formato: r.formatoCabecalho, texto: null }
      : r.cabecalho.trim()
        ? { formato: "TEXT", texto: r.cabecalho }
        : null,
    corpo: r.corpo,
    rodape: r.rodape.trim() || null,
    botoes: r.botoes.map((b) => ({ tipo: b.tipo, texto: b.texto, destino: b.destino })),
    exemplosCabecalho: r.exemplosCabecalho,
    exemplosCorpo: r.exemplosCorpo,
  };
  // Pela posição do botão: os links que terminam em {{1}} (a regra é da lib).
  const comVariavel = new Set(linksVariaveisDe(conteudo).map((l) => l.indice));

  useEffect(() => {
    const campo = nomeRef.current;
    campo?.focus();
    if (duplicado) campo?.select();
  }, [duplicado]);

  function pedirParaFechar() {
    if (enviando) return;
    if (sujo) setSaindo(true);
    else aoFechar();
  }

  useEffect(() => {
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || enviando) return;
      e.preventDefault();
      if (saindo) setSaindo(false);
      else if (sujo) setSaindo(true);
      else aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, enviando, saindo, sujo]);

  /**
   * Troca a seleção do campo por `antes + seleção + depois` e devolve o foco no
   * lugar certo. Ao envolver (negrito, itálico, riscado), o espaço das pontas
   * fica de fora da marca: o duplo clique do Windows seleciona a palavra com o
   * espaço depois dela, e "*palavra *" chega ao contato com os asteriscos.
   */
  function editarCampo(
    el: HTMLInputElement | HTMLTextAreaElement | null,
    campo: "corpo" | "cabecalho",
    antes: string,
    depois = "",
  ) {
    if (!el) return;
    const valor = el.value;
    let inicio = el.selectionStart ?? valor.length;
    let fim = el.selectionEnd ?? inicio;
    if (depois) {
      while (inicio < fim && /\s/.test(valor[inicio])) inicio++;
      while (fim > inicio && /\s/.test(valor[fim - 1])) fim--;
    }
    const novo = valor.slice(0, inicio) + antes + valor.slice(inicio, fim) + depois + valor.slice(fim);
    mudar(campo === "corpo" ? { corpo: novo } : { cabecalho: novo });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + antes.length, fim + antes.length);
    });
  }

  const formatar = (marca: string) => editarCampo(corpoRef.current, "corpo", marca, marca);
  const inserirVariavel = () =>
    editarCampo(corpoRef.current, "corpo", `{{${Math.max(0, ...variaveisDo(r.corpo)) + 1}}}`);

  function atalhos(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const marca = { b: "*", i: "_" }[e.key.toLowerCase()];
    if (!marca) return;
    e.preventDefault();
    formatar(marca);
  }

  function mudarExemplo(lista: "exemplosCorpo" | "exemplosCabecalho", n: number, valor: string) {
    const novos = [...r[lista]];
    while (novos.length < n) novos.push("");
    novos[n - 1] = valor;
    mudar(lista === "exemplosCorpo" ? { exemplosCorpo: novos } : { exemplosCabecalho: novos });
  }

  function adicionarBotao(tipo: TipoBotao) {
    const modelo = BOTAO_NOVO[tipo];
    // Em grupos desde já: o editor mostra a ordem em que a Meta vai receber.
    const botoes = emGrupos([...r.botoes, { tipo, texto: modelo.texto, destino: modelo.destino ?? "" }]);
    const posicao = tipo === "QUICK_REPLY" ? r.botoes.filter((b) => b.tipo === "QUICK_REPLY").length : botoes.length - 1;
    mudar({ botoes });
    requestAnimationFrame(() => {
      const campo = botoesRef.current?.querySelector<HTMLInputElement>(`[data-botao="${posicao}"]`);
      campo?.focus();
      campo?.select();
    });
  }

  const mudarBotao = (i: number, parcial: Partial<BotaoRascunho>) =>
    mudar({ botoes: r.botoes.map((b, j) => (j === i ? { ...b, ...parcial } : b)) });

  // Ligar acrescenta o {{1}} no fim do link; desligar tira, junto com o exemplo.
  function alternarLinkVariavel(i: number, ligar: boolean) {
    const base = baseDoLink(r.botoes[i].destino);
    mudarBotao(i, ligar ? { destino: base + FIM_VARIAVEL } : { destino: base, exemplo: undefined });
  }

  // Embaixo do link, como nos outros campos, só com algo escrito: primeiro o
  // problema do link, depois o do exemplo. O "https://" do botão novo não
  // conta. Exemplo com {{…}} fica com o rodapé: problemasDo tem a frase própria
  // ("valor de verdade"), e a do envio falaria do WhatsApp do contato.
  function erroDoLinkVariavel(b: BotaoRascunho): string | undefined {
    const base = baseDoLink(b.destino);
    if (!base || /^https:\/\/$/i.test(base)) return undefined;
    const exemplo = b.exemplo?.trim() ?? "";
    const problema =
      problemaDoLinkVariavel(b.destino, null) ??
      (exemplo && !/\{\{|\}\}/.test(exemplo) ? problemaDoLinkVariavel(b.destino, exemplo) : null);
    // A lib escreve em minúscula para quem põe o botão na frente; aqui o botão é o de cima.
    return problema ? maiuscula(problema) : undefined;
  }

  async function enviar() {
    if (problemas.length || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/meta/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waba: contaId, ...r }),
      });
      const json = (await resposta.json().catch(() => ({}))) as { erro?: string; resultado?: { id?: string } };
      if (!resposta.ok) {
        setErro(json.erro ?? `A Meta não aceitou o template (erro ${resposta.status}).`);
        return;
      }
      aoCriar(json.resultado?.id ?? null);
    } catch {
      setErro("O envio não chegou ao servidor. Confira a conexão e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const contagem = (tipo: TipoBotao) => r.botoes.filter((b) => b.tipo === tipo).length;
  const podeAdicionar: Record<TipoBotao, boolean> = {
    QUICK_REPLY: r.botoes.length < LIMITE.botoes,
    URL: r.botoes.length < LIMITE.botoes && contagem("URL") < LIMITE.links,
    PHONE_NUMBER: r.botoes.length < LIMITE.botoes && contagem("PHONE_NUMBER") < LIMITE.telefones,
  };

  return (
    <CamadaTopo>
      <div className="veu-surge fixed inset-0 z-[300] bg-zinc-950/40 backdrop-blur-[2px]" onClick={pedirParaFechar} aria-hidden="true" />
      <div className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-4 tela-baixa:p-3">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={tituloId}
          className="surge pointer-events-auto flex h-full max-h-[52rem] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)] ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-white/10"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-5 py-3.5 tela-baixa:py-3 dark:border-zinc-900">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              <LayoutTemplate className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={tituloId} className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Novo template
              </h2>
              <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                {origem && (
                  <>
                    A partir de <span className="font-mono text-zinc-700 dark:text-zinc-300">{origem}</span> ·{" "}
                  </>
                )}
                Vai para análise da Meta · Português (BR){contaNome ? ` · ${contaNome}` : ""}
              </p>
            </div>
            <BotaoIcone Icone={X} rotulo="Fechar" onClick={pedirParaFechar} disabled={enviando} />
          </header>

          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_23rem]">
            <div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain px-6 py-5 tela-baixa:space-y-5 tela-baixa:py-4">
              {deFora.length > 0 && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-50/80 px-3 py-2.5 text-[12px] leading-snug text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    A cópia não leva {deFora.join(", ")}. Este editor não cria esses itens; o resto veio igual.
                  </span>
                </p>
              )}

              <Bloco
                titulo="Nome"
                htmlFor={`${tituloId}-nome`}
                erro={nomeRepetido ? problemas[0].mensagem : problemaDe("nome", r.nome)}
                dica="Só minúsculas, números e _. É por ele que o chat e as campanhas acham o template; não muda depois."
              >
                <input
                  id={`${tituloId}-nome`}
                  ref={nomeRef}
                  value={r.nome}
                  onChange={(e) => mudar({ nome: nomeDeTemplate(e.target.value) })}
                  placeholder="convite_lancamento"
                  spellCheck={false}
                  autoComplete="off"
                  className={`${CAMPO} w-full font-mono`}
                />
              </Bloco>

              <Bloco
                titulo="Categoria"
                dica={
                  r.categoria === "UTILITY"
                    ? "Se o texto vender algo, a Meta muda a categoria para Marketing por conta própria."
                    : undefined
                }
              >
                <div role="radiogroup" aria-label="Categoria" className="grid gap-2 sm:grid-cols-2">
                  {CATEGORIAS.map((c) => {
                    const marcada = r.categoria === c.valor;
                    return (
                      <button
                        key={c.valor}
                        type="button"
                        role="radio"
                        aria-checked={marcada}
                        onClick={() => mudar({ categoria: c.valor })}
                        className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                          marcada
                            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-300 dark:bg-zinc-900"
                            : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
                        }`}
                      >
                        <c.Icone
                          className={`mt-0.5 size-4 shrink-0 ${marcada ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400"}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{c.rotulo}</span>
                          <span className="block text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{c.descricao}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Bloco>

              <Bloco
                titulo="Cabeçalho"
                opcional
                htmlFor={midia ? undefined : `${tituloId}-cabecalho`}
                contador={midia ? undefined : <Contador atual={r.cabecalho.length} maximo={LIMITE.cabecalho} />}
                acao={
                  !midia &&
                  !temVarCabecalho && (
                    <Ferramenta
                      Icone={Braces}
                      rotulo="Variável"
                      onClick={() => editarCampo(cabecalhoRef.current, "cabecalho", "{{1}}")}
                    />
                  )
                }
                erro={midia ? undefined : problemaDe("cabecalho", r.cabecalho)}
                dica={
                  midia
                    ? "O arquivo é só um exemplo para a análise da Meta. No envio, pelo chat ou por campanha, cada disparo escolhe o seu."
                    : undefined
                }
              >
                <FormatosDoCabecalho
                  formato={r.formatoCabecalho}
                  documentos={documentos}
                  aoMudar={(formatoCabecalho) => mudar({ formatoCabecalho, midiaCabecalho: "" })}
                />
                {midia ? (
                  <ArquivoDeExemplo
                    pede={midia}
                    escolhido={r.midiaCabecalho}
                    documentos={documentos}
                    aoEscolher={(midiaCabecalho) => mudar({ midiaCabecalho })}
                  />
                ) : (
                  <input
                    id={`${tituloId}-cabecalho`}
                    ref={cabecalhoRef}
                    value={r.cabecalho}
                    onChange={(e) => mudar({ cabecalho: e.target.value })}
                    maxLength={LIMITE.cabecalho}
                    placeholder="Uma linha em negrito no topo"
                    className={`${CAMPO} w-full`}
                  />
                )}
              </Bloco>

              <Bloco titulo="Mensagem" htmlFor={`${tituloId}-corpo`} erro={problemaDe("corpo", r.corpo)}>
                <div className="rounded-lg border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600">
                  <div className="flex items-center gap-0.5 border-b border-zinc-100 px-1.5 py-1 dark:border-zinc-800">
                    <Ferramenta Icone={Bold} rotulo="Negrito (Ctrl+B)" somenteIcone onClick={() => formatar("*")} />
                    <Ferramenta Icone={Italic} rotulo="Itálico (Ctrl+I)" somenteIcone onClick={() => formatar("_")} />
                    <Ferramenta Icone={Strikethrough} rotulo="Riscado" somenteIcone onClick={() => formatar("~")} />
                    <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />
                    <Ferramenta Icone={Braces} rotulo="Variável" onClick={inserirVariavel} />
                    <span className="ml-auto pr-1.5">
                      <Contador atual={r.corpo.length} maximo={LIMITE.corpo} />
                    </span>
                  </div>
                  <textarea
                    id={`${tituloId}-corpo`}
                    ref={corpoRef}
                    value={r.corpo}
                    onChange={(e) => mudar({ corpo: e.target.value })}
                    onKeyDown={atalhos}
                    maxLength={LIMITE.corpo}
                    rows={7}
                    placeholder={"Olá {{1}}, tudo bem?\n\nSeparamos uma condição especial para você conhecer o empreendimento."}
                    className="block min-h-36 w-full resize-y rounded-b-lg bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 tela-baixa:min-h-28 dark:text-zinc-50 dark:placeholder:text-zinc-600"
                  />
                </div>
              </Bloco>

              {(temVarCabecalho || varsCorpo.length > 0) && (
                <Bloco
                  titulo="Exemplos das variáveis"
                  dica="Só para a análise da Meta: use dados de exemplo, nunca de um cliente de verdade. No envio, pelo chat ou por campanha, cada variável pode levar um dado do contato (primeiro nome, e-mail, cidade…)."
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {temVarCabecalho && (
                      <CampoExemplo
                        rotulo="cabeçalho {{1}}"
                        valor={r.exemplosCabecalho[0] ?? ""}
                        aoMudar={(v) => mudarExemplo("exemplosCabecalho", 1, v)}
                      />
                    )}
                    {varsCorpo.map((n) => (
                      <CampoExemplo
                        key={n}
                        rotulo={`{{${n}}}`}
                        valor={r.exemplosCorpo[n - 1] ?? ""}
                        aoMudar={(v) => mudarExemplo("exemplosCorpo", n, v)}
                      />
                    ))}
                  </div>
                </Bloco>
              )}

              <Bloco
                titulo="Rodapé"
                opcional
                htmlFor={`${tituloId}-rodape`}
                contador={<Contador atual={r.rodape.length} maximo={LIMITE.rodape} />}
                erro={problemaDe("rodape", r.rodape)}
              >
                <input
                  id={`${tituloId}-rodape`}
                  value={r.rodape}
                  onChange={(e) => mudar({ rodape: e.target.value })}
                  maxLength={LIMITE.rodape}
                  placeholder="Responda SAIR para não receber mais"
                  className={`${CAMPO} w-full`}
                />
              </Bloco>

              <Bloco
                titulo="Botões"
                opcional
                acao={
                  <span className="flex items-center gap-0.5">
                    {TIPOS_BOTAO.map((tipo) => (
                      <Ferramenta
                        key={tipo}
                        Icone={BOTAO_NOVO[tipo].Icone}
                        rotulo={BOTAO_NOVO[tipo].rotulo}
                        onClick={() => adicionarBotao(tipo)}
                        disabled={!podeAdicionar[tipo]}
                      />
                    ))}
                  </span>
                }
                dica={
                  r.botoes.length === 0
                    ? "Resposta rápida (“Quero saber mais”) ou ação: abrir um link, ligar. Até 10, com 2 links e 1 telefone."
                    : undefined
                }
              >
                {r.botoes.length > 0 && (
                  <ul ref={botoesRef} className="flex flex-col gap-2">
                    {r.botoes.map((b, i) => {
                      const { Icone } = BOTAO_NOVO[b.tipo];
                      const variavel = comVariavel.has(i);
                      const erroLink = variavel ? erroDoLinkVariavel(b) : undefined;
                      return (
                        <li key={i} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
                              title={BOTAO_NOVO[b.tipo].rotulo}
                            >
                              <Icone className="size-3.5" aria-hidden="true" />
                            </span>
                            <input
                              data-botao={i}
                              value={b.texto}
                              onChange={(e) => mudarBotao(i, { texto: e.target.value })}
                              maxLength={LIMITE.textoBotao}
                              aria-label={`Texto do botão ${i + 1}`}
                              placeholder="Texto do botão"
                              className={`${CAMPO} ${b.tipo === "QUICK_REPLY" ? "flex-1" : "w-40 shrink-0"}`}
                            />
                            {b.tipo === "URL" && (
                              <CampoLink
                                destino={b.destino}
                                variavel={variavel}
                                rotulo={`Link do botão ${i + 1}`}
                                invalido={erroLink !== undefined}
                                aoMudar={(destino) => mudarBotao(i, { destino })}
                              />
                            )}
                            {b.tipo === "PHONE_NUMBER" && (
                              <input
                                value={b.destino}
                                onChange={(e) => mudarBotao(i, { destino: e.target.value })}
                                maxLength={LIMITE.telefone}
                                inputMode="tel"
                                aria-label={`Telefone do botão ${i + 1}`}
                                placeholder="47 99999-0000"
                                spellCheck={false}
                                className={`${CAMPO} min-w-0 flex-1`}
                              />
                            )}
                            <BotaoIcone
                              Icone={Trash2}
                              rotulo={`Tirar o botão ${b.texto || i + 1}`}
                              onClick={() => mudar({ botoes: r.botoes.filter((_, j) => j !== i) })}
                            />
                          </div>
                          {b.tipo === "URL" && (
                            <OpcaoLinkVariavel
                              ligado={variavel}
                              exemplo={b.exemplo ?? ""}
                              erro={erroLink}
                              aoAlternar={(ligar) => alternarLinkVariavel(i, ligar)}
                              aoMudarExemplo={(exemplo) => mudarBotao(i, { exemplo })}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Bloco>
            </div>

            <aside className="hidden min-h-0 overflow-y-auto overscroll-contain border-l border-zinc-100 bg-zinc-50/60 px-5 py-5 md:block tela-baixa:py-4 dark:border-zinc-900 dark:bg-zinc-900/30">
              <PreviaWhatsApp
                conteudo={conteudo}
                exemplosBotoes={r.botoes.map((b) => b.exemplo ?? "")}
                imagem={midia === "imagem" && r.midiaCabecalho ? `/api/documentos/${r.midiaCabecalho}` : null}
              />
              {avisos.length > 0 && (
                <ul className="mt-4 flex flex-col gap-2" aria-label="Avisos">
                  {avisos.map((a) => (
                    <li key={a} className="flex items-start gap-2 text-[12px] leading-snug text-amber-800 dark:text-amber-300">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      {a}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>

          <footer className="flex shrink-0 items-center gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
            {saindo ? (
              <>
                <p className="min-w-0 flex-1 text-[12.5px] text-zinc-700 dark:text-zinc-200">Descartar o que foi escrito?</p>
                <button type="button" onClick={() => setSaindo(false)} className={BOTAO_SECUNDARIO}>
                  Continuar editando
                </button>
                <button
                  type="button"
                  onClick={aoFechar}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-red-700"
                >
                  Descartar
                </button>
              </>
            ) : (
              <>
                <Situacao erro={erro} problema={problemas[0]?.mensagem} comAvisos={avisos.length > 0} />
                <button type="button" onClick={pedirParaFechar} disabled={enviando} className={BOTAO_SECUNDARIO}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void enviar()}
                  disabled={problemas.length > 0 || enviando}
                  className={BOTAO_PRIMARIO}
                >
                  {enviando ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <SendHorizonal className="size-3.5" aria-hidden="true" />
                  )}
                  Enviar para aprovação
                </button>
              </>
            )}
          </footer>
        </section>
      </div>
    </CamadaTopo>
  );
}
