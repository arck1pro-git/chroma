"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  MapPin,
  SearchX,
  Tag as TagIcon,
  UserPlus,
  Users,
} from "lucide-react";
import { type Contato, type Tag } from "../data";
import type { DadosContatos } from "./dados";
import { criarContato } from "./actions";
import { dataCurta } from "../formato";
import BarraFiltros from "./barra-filtros";
import Ficha from "./ficha";
import FormContato, { type DadosContato } from "./form-contato";
import {
  filtrosVazios,
  indexarContatos,
  passaNoFiltro,
  prepararRecorte,
  type Filtros,
} from "./filtros";
import Indicador from "../components/indicador";

// border-separate (e não collapse) porque com o cabeçalho sticky o navegador
// descarta as bordas de uma tabela colapsada e a linha do topo some ao rolar.
const cabecalho =
  "sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-500";

const celula = "border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800/70";

// Referência única para "contato sem tag": `?? []` criaria um array novo a cada
// render e a Linha memoizada re-renderizaria sempre por causa dele.
const vazio: Tag[] = [];

// Escalonamento do fade: 14ms por linha, teto em 6 — a última linha animada
// entra 84ms depois da primeira. Sem o teto, uma página de 100 linhas levaria
// segundos para assentar e o efeito viraria espera.
function atrasoDaLinha(i: number) {
  return `${Math.min(i, 6) * 14}ms`;
}

// memo: abrir/fechar a ficha muda só `selecionadoId`. Sem isto as 30 linhas da
// página re-renderizavam a cada clique; com isto, só as duas que mudaram de
// estado. As props são estáveis (o array de tags vem do mesmo Map do servidor).
const Linha = memo(function Linha({
  contato,
  tags,
  aberto,
  ordem,
  aoSelecionar,
}: {
  contato: Contato;
  tags: Tag[];
  aberto: boolean;
  ordem: number;
  aoSelecionar: (id: string) => void;
}) {
  return (
    <tr
      onClick={() => aoSelecionar(contato.id)}
      // a linha inteira é o alvo do clique; sem isto ela fica
      // inalcançável por teclado
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault(); // espaço rolaria a lista
        aoSelecionar(contato.id);
      }}
      aria-current={aberto ? "true" : undefined}
      style={{ animationDelay: atrasoDaLinha(ordem) }}
      className={`surge-suave cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
        aberto
          ? "bg-white dark:bg-zinc-900"
          : "hover:bg-white dark:hover:bg-zinc-900/50"
      }`}
    >
      <td className={celula}>
        <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          {contato.nome}
        </p>
        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {contato.email}
        </p>
      </td>
      <td
        className={`${celula} truncate text-[13px] tabular-nums text-zinc-600 dark:text-zinc-300`}
      >
        {contato.whatsapp}
      </td>
      <td className={celula}>
        <p className="truncate text-[13px] text-zinc-600 dark:text-zinc-300">
          {contato.cidade}
        </p>
        <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
          {contato.estado} · {contato.pais}
        </p>
      </td>
      <td className={celula}>
        {/* duas tags e um "+N": a coluna tem largura fixa e três
            chips já estouram nos nomes mais longos */}
        <div className="flex items-center gap-1">
          {tags.slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700"
            >
              {t.nome}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="shrink-0 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
              +{tags.length - 2}
            </span>
          )}
          {tags.length === 0 && (
            <span className="text-[11px] text-zinc-300 dark:text-zinc-700">
              —
            </span>
          )}
        </div>
      </td>
      <td
        className={`${celula} text-right text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400`}
      >
        {dataCurta(contato.data_criacao)}
      </td>
    </tr>
  );
});

export default function ListaContatos({ dados }: { dados: DadosContatos }) {
  const [, startTransition] = useTransition();

  // Fonte única = props do servidor (Neon). Criar contato chama a server action
  // que faz revalidatePath('/contatos') e o React recomita com a lista nova.
  const { contatos, segmentos, tags, tagsDoContato } = dados;
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [tamanhoPagina, setTamanhoPagina] = useState(30);
  const [pagina, setPagina] = useState(1);
  // null = ordem original; primeiro clique em "Criado" ordena ascendente.
  const [ordemCriado, setOrdemCriado] = useState<"asc" | "desc" | null>(null);

  // Filtrar é trabalho de renderização, digitar é interação. useDeferredValue
  // deixa o React pintar a tecla primeiro e refazer a lista logo depois — em
  // base grande, o campo de busca não engasga mais a cada caractere.
  const filtrosAdiados = useDeferredValue(filtros);
  const recalculando = filtros !== filtrosAdiados;

  const indice = useMemo(() => indexarContatos(contatos), [contatos]);

  const recorte = useMemo(
    () =>
      prepararRecorte(
        filtrosAdiados,
        indice,
        dados.segmentosDoContato,
        tagsDoContato,
      ),
    [filtrosAdiados, indice, dados.segmentosDoContato, tagsDoContato],
  );

  const visiveis = useMemo(
    () => contatos.filter((c) => passaNoFiltro(c, recorte)),
    [contatos, recorte],
  );

  // data_criacao é ISO de largura fixa, então comparar como texto já dá a ordem
  // cronológica. Sem ordenação escolhida, mantém a ordem da base.
  const ordenados = useMemo(() => {
    if (!ordemCriado) return visiveis;
    const copia = [...visiveis].sort((a, b) =>
      a.data_criacao.localeCompare(b.data_criacao),
    );
    return ordemCriado === "desc" ? copia.reverse() : copia;
  }, [visiveis, ordemCriado]);

  // Fatia da página. paginaSegura corrige o caso de um filtro encolher a lista
  // abaixo da página atual — sem isto a tela ficaria vazia até clicar em voltar.
  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / tamanhoPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * tamanhoPagina;
  const naPagina = ordenados.slice(inicio, inicio + tamanhoPagina);

  // Primeiro clique: ascendente. Depois alterna asc/desc.
  const alternarOrdemCriado = useCallback(() => {
    setOrdemCriado((o) => (o === "asc" ? "desc" : "asc"));
    setPagina(1);
  }, []);

  // Trocar filtro ou tamanho volta pra primeira página, senão o usuário fica
  // preso numa página que deixou de existir.
  const trocarFiltros = useCallback((f: Filtros) => {
    setFiltros(f);
    setPagina(1);
  }, []);
  const trocarTamanho = useCallback((n: number) => {
    setTamanhoPagina(n);
    setPagina(1);
  }, []);

  // Novo contato: grava no Neon pela server action e, quando o revalidate traz a
  // lista nova, seleciona o recém-criado (a ficha abre como confirmação, mesmo
  // que um filtro ativo esconda a linha — o painel independe dos filtros).
  const registrar = useCallback(
    (novo: DadosContato) => {
      setNovoAberto(false);
      setPagina(1);
      startTransition(async () => {
        const id = await criarContato(novo);
        setSelecionadoId(id);
      });
    },
    [startTransition],
  );

  // O filtro pode esconder o contato aberto. Fechar a ficha nesse caso é pior:
  // some sem o usuário ter mandado fechar. Ela fica, e a linha é que some.
  const selecionado = useMemo(
    () => contatos.find((c) => c.id === selecionadoId) ?? null,
    [contatos, selecionadoId],
  );

  // estável: a ficha usa isto como dependência do listener de Esc
  const fechar = useCallback(() => setSelecionadoId(null), []);

  // Precisa ser estável e não depender de `selecionadoId`, senão a identidade
  // muda a cada abertura e o memo da Linha não segura nada. Daí o updater.
  const alternarSelecionado = useCallback(
    (id: string) => setSelecionadoId((atual) => (atual === id ? null : id)),
    [],
  );

  // "novos" contados a partir da data mais recente da base, não do relógio:
  // assim o número não zera quando os dados de exemplo envelhecem. Depende só da
  // base, então fica fora do memo dos indicadores — filtrar não mexe no corte.
  const corteNovos = useMemo(() => {
    const maisRecente = contatos.reduce(
      (max, c) => (c.data_criacao > max ? c.data_criacao : max),
      "",
    );
    if (!maisRecente) return "";
    const corte = new Date(maisRecente);
    corte.setDate(corte.getDate() - 30);
    return corte.toISOString().slice(0, 19) + "Z";
  }, [contatos]);

  // Uma varredura só: antes eram quatro (dois `map` para Set e dois `filter`),
  // cada uma alocando um array intermediário do tamanho da lista visível.
  const indicadores = useMemo(() => {
    const estados = new Set<string>();
    const cidades = new Set<string>();
    let comTags = 0;
    let novos = 0;

    for (const c of visiveis) {
      estados.add(c.estado);
      cidades.add(`${c.cidade}/${c.estado}`);
      if (tagsDoContato.get(c.id)?.length) comTags++;
      if (corteNovos && c.data_criacao >= corteNovos) novos++;
    }

    return { estados: estados.size, cidades: cidades.size, comTags, novos };
  }, [visiveis, tagsDoContato, corteNovos]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-conteudo">
      <div className="border-b border-zinc-200 px-6 py-3 xl:px-16 dark:border-zinc-800">
        <div className="mb-3 flex max-w-[1600px] items-center justify-between gap-3">
          <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Contatos
          </h1>
          <button
            type="button"
            onClick={() => setNovoAberto(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            Registrar contato
          </button>
        </div>
        <div className="grid max-w-[1600px] grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador
            ordem={0}
            Icone={Users}
            rotulo="Contatos"
            valor={String(visiveis.length)}
            detalhe={`de ${contatos.length} na base`}
          />
          <Indicador
            ordem={1}
            Icone={MapPin}
            rotulo="Localização"
            valor={String(indicadores.estados)}
            detalhe={`${indicadores.cidades} ${indicadores.cidades === 1 ? "cidade" : "cidades"}`}
          />
          <Indicador
            ordem={2}
            Icone={TagIcon}
            rotulo="Com tags"
            valor={String(indicadores.comTags)}
            detalhe={`${visiveis.length - indicadores.comTags} sem tag`}
          />
          <Indicador
            ordem={3}
            Icone={CalendarDays}
            rotulo="Novos (30d)"
            valor={String(indicadores.novos)}
            detalhe="Criados no período recente"
          />
        </div>
      </div>

      <BarraFiltros
        contatos={contatos}
        segmentos={segmentos}
        tags={tags}
        filtros={filtros}
        aoMudarFiltros={trocarFiltros}
        visiveis={visiveis.length}
        total={contatos.length}
        tamanhoPagina={tamanhoPagina}
        aoMudarTamanhoPagina={trocarTamanho}
        pagina={paginaSegura}
        totalPaginas={totalPaginas}
        aoMudarPagina={setPagina}
      />

      {/* relative: a ficha se posiciona por cima daqui, sem tirar largura da
          tabela — a tabela não pode reflowar só porque abriu um painel */}
      <div className="relative flex min-h-0 flex-1">
        {/* px-6 + max-w-[1600px]: mesma margem lateral das barras acima e do
            funil, para a tabela não ficar colada na sidebar nem na direita. */}
        <main className="min-w-0 flex-1 overflow-y-auto px-6 xl:px-16">
          {/* esmaece só enquanto o recorte novo não ficou pronto; some sozinho
              quando o React termina a renderização adiada */}
          <div
            className={`max-w-[1600px] ${recalculando ? "esmaecendo" : "transition-opacity duration-150"}`}
          >
          {visiveis.length === 0 ? (
            <div className="surge mx-auto flex max-w-md flex-col items-center justify-center gap-2 py-20 text-center">
              <SearchX
                className="size-8 text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Nenhum contato com esses filtros
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Os {contatos.length} da base continuam aqui — só estão fora do
                recorte. Limpe os filtros na barra acima.
              </p>
            </div>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className={`${cabecalho} w-[30%]`}>
                    Contato
                  </th>
                  <th scope="col" className={`${cabecalho} w-[18%]`}>
                    WhatsApp
                  </th>
                  <th scope="col" className={`${cabecalho} w-[18%]`}>
                    Localização
                  </th>
                  <th scope="col" className={`${cabecalho} w-[22%]`}>
                    Tags
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      ordemCriado === "asc"
                        ? "ascending"
                        : ordemCriado === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={`${cabecalho} w-[12%]`}
                  >
                    <button
                      type="button"
                      onClick={alternarOrdemCriado}
                      aria-label="Ordenar por data de criação"
                      className="flex w-full items-center justify-end gap-1 uppercase tracking-wider transition hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      Criado
                      {ordemCriado === "asc" ? (
                        <ChevronUp className="size-3.5" aria-hidden="true" />
                      ) : ordemCriado === "desc" ? (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronsUpDown
                          className="size-3.5 text-zinc-300 dark:text-zinc-600"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </th>
                </tr>
              </thead>

              {/* key na página/ordem: trocar de página remonta as linhas e o
                  fade escalonado roda de novo. Filtrar não remonta — só as
                  linhas que entraram na lista animam, e a digitação não vira
                  um piscar de tabela inteira a cada tecla. */}
              <tbody key={`${paginaSegura}-${ordemCriado ?? "base"}`}>
                {naPagina.map((c, i) => (
                  <Linha
                    key={c.id}
                    contato={c}
                    tags={tagsDoContato.get(c.id) ?? vazio}
                    aberto={c.id === selecionadoId}
                    ordem={i}
                    aoSelecionar={alternarSelecionado}
                  />
                ))}
              </tbody>
            </table>
          )}
          </div>
        </main>

        {/* key por contato: trocar de contato remonta a ficha, então o slide de
            entrada roda de novo em vez de o React reaproveitar o painel. */}
        {selecionado && (
          <Ficha
            key={selecionado.id}
            contato={selecionado}
            oportunidades={dados.oportunidadesDoContato.get(selecionado.id) ?? []}
            historico={dados.historicoDoContato.get(selecionado.id) ?? []}
            anotacoes={dados.anotacoesDoContato.get(selecionado.id) ?? []}
            segmentos={dados.segmentosDoContato.get(selecionado.id) ?? []}
            tags={tagsDoContato.get(selecionado.id) ?? []}
            segmentosDisponiveis={segmentos}
            tagsDisponiveis={tags}
            etapaPorId={dados.etapaPorId}
            funilPorId={dados.funilPorId}
            usuarioPorId={dados.usuarioPorId}
            aoFechar={fechar}
          />
        )}
      </div>

      {novoAberto && (
        <FormContato aoCriar={registrar} aoFechar={() => setNovoAberto(false)} />
      )}
    </div>
  );
}
