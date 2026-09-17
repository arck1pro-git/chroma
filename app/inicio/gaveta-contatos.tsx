"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserSearch,
  X,
} from "lucide-react";
import type {
  Anotacao,
  CampoPersonalizado,
  Contato,
  Etapa,
  Funil,
  Historico,
  Oportunidade,
  Segmento,
  Tag,
  Usuario,
} from "../data";
import { iniciais } from "../formato";
import { normalizar } from "../filtros-comuns";
import { indexarContatos } from "../contatos/filtros";
import {
  CamposContato,
  ChipsContato,
  SecoesContato,
} from "../contatos/detalhes";
import { CamposDoContato } from "../components/campos-personalizados";
import FormContato, { type DadosContato } from "../contatos/form-contato";
import {
  atualizarContato,
  criarContato,
  excluirContato,
  resumoExclusaoContato,
  type ResumoExclusao,
} from "../contatos/actions";

// Gaveta da direita da tela inicial. Dois níveis no MESMO painel: lista de
// contatos → dados do contato clicado (voltar traz a lista de volta).
//
// DEIXOU DE SER SÓ LEITURA: com /contatos fora do ar como rota, esta gaveta é o
// único caminho para criar, editar e excluir contato. O formulário é o MESMO de
// app/contatos/form-contato.tsx (um componente, dois modos) — não uma segunda
// cópia dos campos para divergir da primeira.
//
// A lista chega por props, do servidor. Depois de cada gravação vem um
// router.refresh(): é ele que traz a lista nova: sem isso a gaveta mostraria o
// estado anterior até a próxima navegação.

const semTags: Tag[] = [];

/**
 * Excluir em dois passos, sem window.confirm.
 *
 * Mesmo desenho do BotaoExcluir de app/blog/pecas.tsx, escrito aqui em vez de
 * importado: aquele arquivo se declara "as peças que as quatro telas do Blog
 * repetem" e traz lib/artigo junto. São vinte linhas — melhor repeti-las do que
 * amarrar a gaveta de contatos ao módulo de Blog.
 *
 * O primeiro clique troca o rótulo pelo que vai acontecer DE VERDADE ("Excluir
 * e apagar 34 mensagens"). Só o segundo executa. Sair do botão desarma.
 */
function BotaoExcluir({
  confirmacao,
  aoConfirmar,
  ocupado,
}: {
  confirmacao: string;
  aoConfirmar: () => void;
  ocupado?: boolean;
}) {
  const [armado, setArmado] = useState(false);

  return (
    <button
      type="button"
      disabled={ocupado}
      onBlur={() => setArmado(false)}
      onClick={() => (armado ? aoConfirmar() : setArmado(true))}
      className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition disabled:opacity-50 ${
        armado
          ? "bg-red-600 text-white hover:bg-red-700"
          : "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
      }`}
    >
      <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
      {armado ? confirmacao : "Excluir contato"}
    </button>
  );
}

/**
 * A frase do segundo clique. Enumera só o que EXISTE — "e apagar 0 mensagens"
 * assustaria à toa — e some inteira quando não há nada pendurado no contato.
 */
function frasePerda(r: ResumoExclusao): string {
  const partes: string[] = [];
  if (r.mensagens > 0) {
    partes.push(`${r.mensagens} mensagem${r.mensagens === 1 ? "" : "s"}`);
  }
  if (r.atendimentos > 0) {
    partes.push(`${r.atendimentos} atendimento${r.atendimentos === 1 ? "" : "s"}`);
  }
  if (r.anotacoes > 0) {
    partes.push(`${r.anotacoes} anotação${r.anotacoes === 1 ? "" : "ões"}`);
  }
  if (partes.length === 0) return "Confirmar exclusão";
  return `Excluir e apagar ${partes.join(", ")}`;
}

function Avatar({ nome, grande = false }: { nome: string; grande?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-100 font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 ${
        grande ? "size-10 text-xs" : "size-8 text-[10px]"
      }`}
    >
      {iniciais(nome)}
    </span>
  );
}

export default function GavetaContatos({
  contatos,
  segmentosDoContato,
  tagsDoContato,
  oportunidadesDoContato,
  historicoDoContato,
  anotacoesDoContato,
  etapaPorId,
  funilPorId,
  usuarioPorId,
  camposContato,
  aoAbrirOportunidade,
  aoFechar,
}: {
  contatos: Contato[];
  segmentosDoContato: Map<string, Segmento[]>;
  tagsDoContato: Map<string, Tag[]>;
  oportunidadesDoContato: Map<string, Oportunidade[]>;
  historicoDoContato: Map<string, Historico[]>;
  anotacoesDoContato: Map<string, Anotacao[]>;
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
  camposContato: CampoPersonalizado[];
  aoAbrirOportunidade: (id: string) => void;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [gravando, iniciarGravacao] = useTransition();

  const [termo, setTermo] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);

  // null = formulário fechado; "novo" = criar; objeto = editar aquele contato.
  const [form, setForm] = useState<"novo" | Contato | null>(null);

  // O que a exclusão levaria junto, buscado no servidor quando o contato abre.
  // Não dá pra tirar das props: mensagens não chegam aqui, e é justamente a
  // contagem delas que a confirmação precisa dizer.
  //
  // Os dois guardam o ID JUNTO do valor, e a tela deriva daí (resumoAtual /
  // erroAtual). Assim trocar de contato descarta o valor antigo por comparação,
  // sem um setState de limpeza dentro do efeito — que é justamente o que
  // dispara renderização em cascata.
  const [resumo, setResumo] = useState<{ id: string; dados: ResumoExclusao } | null>(null);
  const [erro, setErro] = useState<{ id: string; texto: string } | null>(null);

  const resumoAtual = resumo && resumo.id === abertoId ? resumo.dados : null;
  const erroAtual = erro && erro.id === abertoId ? erro.texto : null;

  // Mesmo índice da lista de /contatos: normalizar (NFD + regex unicode) é o
  // passo caro e o texto do contato não muda enquanto se digita.
  const indice = useMemo(() => indexarContatos(contatos), [contatos]);

  const visiveis = useMemo(() => {
    const busca = normalizar(termo.trim());
    if (!busca) return contatos;
    return contatos.filter((c) => indice.get(c.id)?.includes(busca));
  }, [contatos, indice, termo]);

  const aberto = useMemo(
    () => contatos.find((c) => c.id === abertoId) ?? null,
    [contatos, abertoId],
  );

  // Busca o resumo a cada contato aberto. `vivo` descarta a resposta que
  // chegar depois de a pessoa já ter trocado de contato — senão o rótulo do
  // botão mostraria a contagem do contato anterior.
  useEffect(() => {
    if (!abertoId) return;
    let vivo = true;
    resumoExclusaoContato(abertoId)
      .then((r) => {
        if (vivo) setResumo({ id: abertoId, dados: r });
      })
      .catch(() => {
        // Sem resumo o botão continua funcionando, só com a frase genérica.
      });
    return () => {
      vivo = false;
    };
  }, [abertoId]);

  const salvar = useCallback(
    (dados: DadosContato) => {
      const alvo = form;
      setForm(null);
      iniciarGravacao(async () => {
        if (alvo === "novo") {
          const id = await criarContato(dados);
          // Abre o recém-criado: é a confirmação de que gravou, e já deixa a
          // pessoa onde ela vai querer continuar (tags, segmentos, campos).
          setAbertoId(id);
        } else if (alvo) {
          await atualizarContato(alvo.id, dados);
        }
        router.refresh();
      });
    },
    [form, router],
  );

  const excluir = useCallback(() => {
    if (!abertoId) return;
    iniciarGravacao(async () => {
      const r = await excluirContato(abertoId);
      if (!r.ok) {
        // Caso real e esperado: contato com oportunidade no funil. O banco
        // recusaria de qualquer jeito; a ação devolve a frase em vez do erro
        // cru de chave estrangeira.
        setErro({ id: abertoId, texto: r.erro ?? "Não foi possível excluir." });
        return;
      }
      setAbertoId(null);
      router.refresh();
    });
  }, [abertoId, router]);

  // Esc desce um nível por vez: dos dados volta pra lista, da lista fecha a
  // gaveta. Fechar direto perderia a busca digitada sem o usuário ter pedido.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Com o formulário aberto, o Esc é dele: o FormContato tem o próprio
      // listener e fecha sozinho. Sem esta saída, uma tecla fecharia os dois.
      if (form) return;
      if (abertoId) setAbertoId(null);
      else aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [abertoId, aoFechar, form]);

  return (
    <>
      {/* mesmo véu da ficha de contatos: escurece o resto e fecha ao clicar */}
      <div
        className="veu-surge fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={aoFechar}
        aria-hidden="true"
      />

      <aside
        className="ficha-entra fixed bottom-4 right-4 top-4 z-50 flex w-[25rem] max-w-[92vw] flex-col overflow-hidden rounded-4xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        aria-label={aberto ? `Dados de ${aberto.nome}` : "Contatos"}
      >
        {aberto ? (
          <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setAbertoId(null)}
              aria-label="Voltar para a lista de contatos"
              className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <Avatar nome={aberto.nome} grande />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {aberto.nome}
              </h2>
              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {aberto.cidade}/{aberto.estado}
              </p>
            </div>
            {/* Editar fica no cabeçalho porque é a ação frequente. Excluir
                ficou lá embaixo, no fim da rolagem: é rara e destrutiva, e não
                deve estar a um pixel de distância do botão de fechar. */}
            <button
              type="button"
              onClick={() => setForm(aberto)}
              disabled={gravando}
              aria-label={`Editar ${aberto.nome}`}
              title="Editar contato"
              className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <Pencil className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar contatos"
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>
        ) : (
          <header className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Contatos
              </h2>
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                {contatos.length}
              </span>
              <button
                type="button"
                onClick={() => setForm("novo")}
                disabled={gravando}
                aria-label="Novo contato"
                title="Novo contato"
                className="ml-auto shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={aoFechar}
                aria-label="Fechar contatos"
                className="-mr-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Buscar por nome, e-mail, telefone…"
                aria-label="Buscar contato"
                autoFocus
                className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {aberto ? (
            <>
              <CamposContato contato={aberto} />
              <ChipsContato
                segmentos={segmentosDoContato.get(aberto.id) ?? []}
                tags={tagsDoContato.get(aberto.id) ?? semTags}
              />
              <CamposDoContato contatoId={aberto.id} definicoes={camposContato} />
              <SecoesContato
                oportunidades={oportunidadesDoContato.get(aberto.id) ?? []}
                anotacoes={anotacoesDoContato.get(aberto.id) ?? []}
                historico={historicoDoContato.get(aberto.id) ?? []}
                etapaPorId={etapaPorId}
                funilPorId={funilPorId}
                usuarioPorId={usuarioPorId}
                aoAbrirOportunidade={aoAbrirOportunidade}
              />

              <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
                <BotaoExcluir
                  ocupado={gravando}
                  confirmacao={
                    resumoAtual ? frasePerda(resumoAtual) : "Confirmar exclusão"
                  }
                  aoConfirmar={excluir}
                />
                {erroAtual && (
                  <p
                    role="alert"
                    className="surge mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[12px] leading-relaxed text-red-700 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {erroAtual}
                  </p>
                )}
              </div>
            </>
          ) : visiveis.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <UserSearch
                className="size-8 text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {contatos.length === 0
                  ? "Nenhum contato na base"
                  : "Nenhum contato com esse termo"}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {contatos.length === 0
                  ? "Use o + aqui em cima, ou deixe o webhook do chat trazer quem chamar no WhatsApp."
                  : `Os ${contatos.length} da base continuam aqui — só não batem com a busca.`}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col p-2">
              {visiveis.map((c) => {
                const tags = tagsDoContato.get(c.id) ?? semTags;
                const negocios = oportunidadesDoContato.get(c.id)?.length ?? 0;

                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setAbertoId(c.id)}
                      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100"
                    >
                      <Avatar nome={c.nome} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                          {c.nome}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {c.whatsapp || c.email || `${c.cidade}/${c.estado}`}
                          {tags.length > 0 && ` · ${tags[0].nome}`}
                          {tags.length > 1 && ` +${tags.length - 1}`}
                        </span>
                      </span>
                      {negocios > 0 && (
                        <span
                          title={`${negocios} ${negocios === 1 ? "oportunidade" : "oportunidades"}`}
                          className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                        >
                          {negocios}
                        </span>
                      )}
                      <ChevronRight
                        className="size-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </aside>

      {/* key por contato: trocar de alvo remonta o formulário, senão os campos
          ficariam com os valores do contato anterior (useState só lê o inicial
          na primeira montagem). */}
      {form && (
        <FormContato
          key={form === "novo" ? "novo" : form.id}
          inicial={
            form === "novo"
              ? undefined
              : {
                  nome: form.nome,
                  email: form.email,
                  whatsapp: form.whatsapp,
                  cidade: form.cidade,
                  estado: form.estado,
                  pais: form.pais,
                }
          }
          aoSalvar={salvar}
          aoFechar={() => setForm(null)}
        />
      )}
    </>
  );
}
