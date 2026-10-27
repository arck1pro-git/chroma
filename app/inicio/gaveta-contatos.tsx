"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CampoPersonalizado, Contato, Etapa, Funil, Usuario } from "@/lib/entidades";
import type { Ia } from "@/lib/ia/catalogo";
import type { ContatoEncontrado, DadosDoContato } from "@/lib/contatos-busca";
import { MIN_DIGITOS, MIN_LETRAS, prepararTermo } from "@/lib/contatos-termo";
import { localizacao } from "@/lib/formato";
import { telefoneLegivel } from "@/lib/telefone";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserSearch,
  X,
} from "@/app/components/icones";
import { CamposContato, SecoesContato } from "../contatos/detalhes";
import { haQuanto } from "../contatos/pecas";
import { Avatar, BOTAO_SECUNDARIO, BotaoIcone, CascaGaveta, CorpoGaveta, LINHA } from "../components/gaveta";
import FormContato, { type DadosContato } from "../contatos/form-contato";
import IaDoContato from "./ia-contato";
import {
  atualizarContato,
  buscarContatos,
  criarContato,
  dadosDoContato,
  excluirContato,
  resumoExclusaoContato,
  type ResumoExclusao,
} from "../contatos/actions";

// Gaveta da direita da tela inicial. Dois níveis no MESMO painel: busca de
// contatos → dados do contato clicado (voltar traz a busca de volta).
//
// DEIXOU DE SER SÓ LEITURA: com /contatos fora do ar como rota, esta gaveta é o
// único caminho para criar, editar e excluir contato. O formulário é o MESMO de
// app/contatos/form-contato.tsx (um componente, dois modos) — não uma segunda
// cópia dos campos para divergir da primeira.
//
// SÓ APARECE QUEM FOI PESQUISADO (pedido dele, 2026-10-15). A base não vem mais
// nas props: com os ~27 mil leads do SprintHub ela eram ~9 MB por abertura da
// tela inicial. A busca e a ficha vêm do servidor sob demanda
// (lib/contatos-busca.ts). `versao` muda a cada router.refresh() — é o sinal
// para buscar de novo o que está na tela depois de uma gravação.

const ESPERA_DIGITACAO_MS = 300;

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
      className={`-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${
        armado
          ? "surge bg-red-600 px-3 text-white hover:bg-red-700"
          : "text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
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

function Aguarde({ texto }: { texto: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-2 px-6 py-16 text-xs text-zinc-500 dark:text-zinc-400">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      {texto}
    </p>
  );
}

export default function GavetaContatos({
  totalContatos,
  versao,
  etapaPorId,
  funilPorId,
  usuarioPorId,
  euId,
  camposContato,
  ias,
  aoAbrirOportunidade,
  aoFechar,
}: {
  /** Quantos contatos a base tem — o número do cabeçalho, sem trazer nenhum. */
  totalContatos: number;
  /** Muda a cada router.refresh(): busca de novo a lista e a ficha abertas. */
  versao: unknown;
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
  /** Quem está logado (apagar anotação é só de quem escreveu). */
  euId: string;
  camposContato: CampoPersonalizado[];
  ias: Ia[];
  aoAbrirOportunidade: (id: string) => void;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [gravando, iniciarGravacao] = useTransition();

  const [termo, setTermo] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);

  // A busca guarda o TERMO junto da resposta: a tela só mostra a lista quando
  // ela é do termo que está no campo, então digitar mais não pisca a lista
  // velha e nenhum setState de limpeza precisa rodar dentro do efeito.
  const [achados, setAchados] = useState<{ termo: string; versao: unknown; lista: ContatoEncontrado[] } | null>(null);
  const podeBuscar = prepararTermo(termo) !== null;
  const lista = podeBuscar && achados?.termo === termo ? achados.lista : null;
  const buscando = podeBuscar && (achados?.termo !== termo || achados?.versao !== versao);

  useEffect(() => {
    if (!podeBuscar) return;
    let vivo = true;
    const espera = setTimeout(() => {
      buscarContatos(termo)
        .then((r) => {
          if (vivo) setAchados({ termo, versao, lista: r });
        })
        .catch(() => {
          if (vivo) setAchados({ termo, versao, lista: [] });
        });
    }, ESPERA_DIGITACAO_MS);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [termo, podeBuscar, versao]);

  // A ficha do contato aberto, do servidor. Mesmo truque do id junto do valor:
  // trocar de contato descarta a ficha anterior por comparação.
  const [ficha, setFicha] = useState<{ id: string; dados: DadosDoContato | null } | null>(null);
  useEffect(() => {
    if (!abertoId) return;
    let vivo = true;
    dadosDoContato(abertoId)
      .then((d) => {
        if (vivo) setFicha({ id: abertoId, dados: d });
      })
      .catch(() => {
        if (vivo) setFicha({ id: abertoId, dados: null });
      });
    return () => {
      vivo = false;
    };
  }, [abertoId, versao]);
  const fichaAtual = ficha && ficha.id === abertoId ? ficha.dados : null;
  const carregandoFicha = Boolean(abertoId) && (!ficha || ficha.id !== abertoId);
  // Ficha que voltou vazia: o contato foi excluído (por outra aba, outra pessoa).
  const sumiu = Boolean(abertoId) && ficha?.id === abertoId && ficha.dados === null;
  // Enquanto a ficha chega, o cabeçalho já mostra o que a lista sabia.
  const aberto: Contato | null = sumiu
    ? null
    : (fichaAtual?.contato ?? (abertoId ? (lista?.find((c) => c.id === abertoId) ?? null) : null));

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
          const r = await criarContato(dados);
          if (!r.ok) {
            // Ainda não há contato aberto onde mostrar o aviso (ex.: nome só
            // com espaços passa pelo `required` do formulário e cai aqui).
            alert(r.erro);
            return;
          }
          // Abre o recém-criado: é a confirmação de que gravou, e já deixa a
          // pessoa onde ela vai querer continuar (tags, segmentos, campos).
          setAbertoId(r.id);
        } else if (alvo) {
          const r = await atualizarContato(alvo.id, dados);
          if (!r.ok) {
            setErro({ id: alvo.id, texto: r.erro });
            return;
          }
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
    <CascaGaveta
      rotulo={aberto ? `Dados de ${aberto.nome}` : "Contatos"}
      aoFechar={aoFechar}
      // key por contato: trocar de alvo remonta o formulário, senão os campos
      // ficariam com os valores do contato anterior (useState só lê o inicial
      // na primeira montagem).
      depois={
        form && (
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
        )
      }
    >
      {aberto ? (
        <header className="shrink-0 px-5 pb-4 pt-3">
          <div className="-mx-2 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setAbertoId(null)}
              className="inline-flex items-center gap-1 rounded-lg py-1.5 pl-1.5 pr-2.5 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Contatos
            </button>
            {/* Editar fica no cabeçalho porque é a ação frequente. Excluir
                ficou lá embaixo, no fim da rolagem: é rara e destrutiva, e não
                deve estar a um pixel de distância do botão de fechar. */}
            <BotaoIcone Icone={Pencil} rotulo="Editar contato" onClick={() => setForm(aberto)} disabled={gravando} className="ml-auto" />
            <BotaoIcone Icone={X} rotulo="Fechar contatos" onClick={aoFechar} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Avatar nome={aberto.nome} tamanho="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[19px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
                {aberto.nome}
              </h2>
              <p className="truncate text-[12.5px] text-zinc-500 dark:text-zinc-400">
                {[localizacao(aberto), `no CRM ${haQuanto(aberto.data_criacao)}`].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </header>
      ) : (
        <header className="shrink-0 px-5 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Contatos</h2>
            <span className="text-[12px] tabular-nums text-zinc-400 dark:text-zinc-500">{totalContatos.toLocaleString("pt-BR")}</span>
            <button
              type="button"
              onClick={() => setForm("novo")}
              disabled={gravando}
              className={`${BOTAO_SECUNDARIO} ml-auto ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800`}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Novo
            </button>
            <BotaoIcone Icone={X} rotulo="Fechar contatos" onClick={aoFechar} className="-mr-2" />
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome, e-mail ou telefone"
              aria-label="Buscar contato"
              autoFocus
              className="w-full rounded-xl bg-zinc-100 py-2.5 pl-9 pr-9 text-[13.5px] text-zinc-900 outline-none ring-1 ring-inset ring-transparent transition placeholder:text-zinc-400 focus:bg-white focus:ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:bg-zinc-950 dark:focus:ring-zinc-700"
            />
            {buscando && (
              <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden="true" />
            )}
          </div>
        </header>
      )}

      <CorpoGaveta>
        {aberto && !fichaAtual ? (
          <>
            <CamposContato contato={aberto} semLocal />
            <Aguarde texto="Carregando o contato…" />
          </>
        ) : aberto && fichaAtual ? (
          <>
            {/* Local e "no CRM há" já estão no cabeçalho. */}
            <CamposContato contato={aberto} segmentos={fichaAtual.segmentos} tags={fichaAtual.tags} semLocal />
            <IaDoContato
              // Remonta por contato: o valor otimista é do contato aberto.
              key={aberto.id}
              contato={aberto}
              oportunidades={fichaAtual.oportunidades}
              etapaPorId={etapaPorId}
              funilPorId={funilPorId}
              ias={ias}
            />
            <SecoesContato
              contato={aberto}
              oportunidades={fichaAtual.oportunidades}
              anotacoes={fichaAtual.anotacoes}
              historico={fichaAtual.historico}
              camposContato={camposContato}
              etapaPorId={etapaPorId}
              funilPorId={funilPorId}
              usuarioPorId={usuarioPorId}
              euId={euId}
              aoAbrirOportunidade={aoAbrirOportunidade}
            />

            <div className="border-t border-zinc-100 px-5 pt-4 dark:border-zinc-900">
              <BotaoExcluir
                ocupado={gravando}
                confirmacao={resumoAtual ? frasePerda(resumoAtual) : "Confirmar exclusão"}
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
        ) : carregandoFicha ? (
          // Contato aberto que não estava na lista (o recém-criado, por exemplo).
          <Aguarde texto="Carregando o contato…" />
        ) : !podeBuscar ? (
          <Estado
            titulo={totalContatos === 0 ? "Nenhum contato na base" : "Pesquise para ver um contato"}
            texto={
              totalContatos === 0
                ? "Use o Novo aqui em cima, ou deixe o webhook do chat trazer quem chamar no WhatsApp."
                : `A partir de ${MIN_LETRAS} letras ou ${MIN_DIGITOS} números. Os ${totalContatos.toLocaleString("pt-BR")} contatos só aparecem quando pesquisados, para a tela abrir leve.`
            }
          />
        ) : !lista ? (
          <Aguarde texto="Procurando…" />
        ) : lista.length === 0 ? (
          <Estado titulo="Nenhum contato com esse termo" texto="A busca procura no nome (inclusive parecido), no e-mail e nos números do telefone." />
        ) : (
          <ul className={`flex flex-col px-5 pt-1 transition-opacity ${buscando ? "opacity-60" : ""}`}>
            {lista.map((c) => {
              const tags = c.tags;
              const negocios = c.negocios;
              const linha2 = telefoneLegivel(c.whatsapp) || c.email || localizacao(c) || "Sem contato cadastrado";

              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setAbertoId(c.id)} className={LINHA}>
                    <Avatar nome={c.nome} suave />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{c.nome}</span>
                      <span className="block truncate text-[11.5px] tabular-nums text-zinc-500 dark:text-zinc-400">
                        {linha2}
                        {tags.length > 0 && ` · ${tags[0].nome}`}
                        {tags.length > 1 && ` +${tags.length - 1}`}
                      </span>
                    </span>
                    {negocios > 0 && (
                      <span
                        title={`${negocios} ${negocios === 1 ? "oportunidade" : "oportunidades"}`}
                        className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                      >
                        {negocios}
                      </span>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CorpoGaveta>
    </CascaGaveta>
  );
}

function Estado({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
        <UserSearch className="size-5" aria-hidden="true" />
      </span>
      <p className="mt-1 text-[13.5px] font-medium text-zinc-900 dark:text-zinc-50">{titulo}</p>
      <p className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">{texto}</p>
    </div>
  );
}
