"use client";

// Métricas: o desempenho em demandas — GERADAS e ENTREGUES — da equipe e de
// cada pessoa.
//
// A BASE é o pedido dele de 2026-10-07: "ver demandas geradas por dia, na
// semana, no mês e entregues, podendo filtrar por usuário" — os três períodos
// e o gráfico por dia/semana/mês continuam.
//
// O DESEMPENHO DE CADA UM LADO A LADO (pedido dele de 2026-10-08: "precisa
// ficar mais prático ver o desempenho de cada um"): no lugar do menu que
// mostrava uma pessoa por vez, uma tabela com todas — entregues (com a barra
// comparando com a equipe), geradas, em aberto e atrasadas agora, e a faísca
// das entregas dos últimos 30 dias. O período da tabela (hoje, semana, mês) é
// dela; a ordem é por qualquer coluna. Clicar numa linha abre a ficha da
// pessoa (./ficha-pessoa.tsx), e as setas dela passam pela equipe na ordem da
// tabela.
//
// PARA TODO MUNDO, com a equipe só para Admin e TI (2026-10-07): os demais
// veem os próprios números — o servidor só mandou a própria pessoa — com o
// mesmo desenho da ficha, direto na página.
//
// Tudo é instantâneo: o servidor já manda o recorte de cada pessoa e as três
// escalas, e trocar é só escolher qual mostrar. Pessoa aberta, escala e
// período ficam na URL (?pessoa=, ?ver=, ?periodo=) pelo history do navegador
// — sem ida ao servidor — para o link abrir no mesmo lugar.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Aberta, MetricasDemandas, PessoaDasMetricas, Recorte } from "./demandas";
import FichaPessoa from "./ficha-pessoa";
import {
  Agora,
  Avatar,
  COR_ENTREGUES,
  contarAgora,
  doPeriodo,
  Faisca,
  Grafico,
  NaMesa,
  periodos,
  Segmentos,
  TOM,
  TresPeriodos,
  type PeriodoId,
  type Visao,
} from "./pecas";

export type { PeriodoId, Visao } from "./pecas";

type Coluna = "nome" | "entregues" | "geradas" | "abertas" | "atrasadas";
type Ordem = { coluna: Coluna; desc: boolean };

type LinhaPessoa = {
  pessoa: PessoaDasMetricas;
  r: Recorte;
  entregues: number;
  geradas: number;
  anterior: { entregues: number; geradas: number };
  abertas: number;
  atrasadas: number;
};

/** As colunas da tabela larga: pessoa, entregues (com barra), três números e a faísca. */
const GRADE =
  "grid grid-cols-[minmax(0,1.9fr)_minmax(0,1.7fr)_repeat(3,minmax(0,0.75fr))_7rem] items-center gap-x-5";

export default function TelaMetricas({
  metricas,
  veEquipe,
  nome,
  pessoaInicial,
  visaoInicial,
  periodoInicial,
}: {
  metricas: MetricasDemandas;
  /** Admin e TI: a equipe toda e a tabela por pessoa. */
  veEquipe: boolean;
  nome: string;
  pessoaInicial: string | null;
  visaoInicial: Visao;
  periodoInicial: PeriodoId;
}) {
  const [aberta, setAberta] = useState<string | null>(pessoaInicial);
  const [visao, setVisao] = useState<Visao>(visaoInicial);
  const [periodo, setPeriodo] = useState<PeriodoId>(periodoInicial);
  const [ordem, setOrdem] = useState<Ordem>({ coluna: "entregues", desc: true });
  const { hoje } = metricas;

  // Na URL, sem ida ao servidor: o Next acompanha o history nativo, e o link
  // copiado da barra abre no mesmo recorte.
  function naUrl(chave: string, valor: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (valor) params.set(chave, valor);
    else params.delete(chave);
    const busca = params.toString();
    window.history.replaceState(null, "", busca ? `?${busca}` : window.location.pathname);
  }

  function mudarVisao(v: Visao) {
    setVisao(v);
    naUrl("ver", v === "dia" ? null : v);
  }

  function abrir(id: string | null) {
    setAberta(id);
    naUrl("pessoa", id);
  }

  // O que está com cada pessoa agora. O chamado do TI sem dono fica só na
  // linha da equipe.
  const abertasDe = useMemo(() => {
    const mapa = new Map<string, Aberta[]>();
    for (const a of metricas.abertas) {
      if (!a.responsavelId) continue;
      const da = mapa.get(a.responsavelId);
      if (da) da.push(a);
      else mapa.set(a.responsavelId, [a]);
    }
    return mapa;
  }, [metricas.abertas]);

  const linhas = useMemo(() => {
    const lista: LinhaPessoa[] = metricas.pessoas.map((p) => {
      const r = metricas.porPessoa[p.id];
      const { atual, anterior } = doPeriodo(r, periodo);
      const agora = contarAgora(abertasDe.get(p.id) ?? [], hoje);
      return { pessoa: p, r, ...atual, anterior, abertas: agora.abertas, atrasadas: agora.atrasadas };
    });
    const sinal = ordem.desc ? -1 : 1;
    return lista.sort((a, b) => {
      if (ordem.coluna === "nome") return sinal * a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR");
      const d = a[ordem.coluna] - b[ordem.coluna];
      if (d) return sinal * d;
      // Empate: quem entregou mais, depois o nome.
      return b.entregues - a.entregues || a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR");
    });
  }, [metricas.pessoas, metricas.porPessoa, periodo, abertasDe, hoje, ordem]);

  // ── Quem não é Admin nem TI: os próprios números, com o desenho da ficha ──
  if (!veEquipe) {
    return (
      <Pagina titulo="Métricas" subtitulo={`Seu desempenho em demandas · ${nome}`}>
        {metricas.faltaTabela ? (
          <FaltaTabela />
        ) : (
          <>
            <Agora abertas={metricas.abertas} hoje={hoje} />
            <TresPeriodos r={metricas.equipe} hoje={hoje} />
            <Grafico r={metricas.equipe} hoje={hoje} visao={visao} aoMudarVisao={mudarVisao} />
            <NaMesa abertas={metricas.abertas} hoje={hoje} vazio="Nada em aberto com você. Tudo em dia." />
          </>
        )}
      </Pagina>
    );
  }

  const indice = aberta ? linhas.findIndex((l) => l.pessoa.id === aberta) : -1;
  const naFicha = indice >= 0 ? linhas[indice] : null;

  return (
    <Pagina titulo="Métricas" subtitulo="Demandas geradas e entregues · a equipe e cada pessoa">
      {metricas.faltaTabela ? (
        <FaltaTabela />
      ) : (
        <>
          <TresPeriodos r={metricas.equipe} hoje={hoje} />
          <TabelaPessoas
            linhas={linhas}
            equipe={metricas.equipe}
            abertasEquipe={metricas.abertas}
            hoje={hoje}
            periodo={periodo}
            aoMudarPeriodo={(p) => {
              setPeriodo(p);
              naUrl("periodo", p === "semana" ? null : p);
            }}
            ordem={ordem}
            aoOrdenar={(coluna) =>
              setOrdem((o) => (o.coluna === coluna ? { coluna, desc: !o.desc } : { coluna, desc: coluna !== "nome" }))
            }
            aberta={aberta}
            aoAbrir={abrir}
          />
          <Grafico r={metricas.equipe} hoje={hoje} visao={visao} aoMudarVisao={mudarVisao} titulo="Geradas e entregues · equipe toda" />
        </>
      )}

      {naFicha && (
        <FichaPessoa
          pessoa={naFicha.pessoa}
          recorte={naFicha.r}
          abertas={abertasDe.get(naFicha.pessoa.id) ?? []}
          hoje={hoje}
          visao={visao}
          aoMudarVisao={mudarVisao}
          posicao={{ atual: indice + 1, total: linhas.length }}
          aoAnterior={indice > 0 ? () => abrir(linhas[indice - 1].pessoa.id) : null}
          aoProxima={indice < linhas.length - 1 ? () => abrir(linhas[indice + 1].pessoa.id) : null}
          aoFechar={() => abrir(null)}
        />
      )}
    </Pagina>
  );
}

// ── Peças da página ─────────────────────────────────────────────────────────

function Pagina({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-conteudo px-4 py-6 sm:px-6 xl:px-10">
      {/* @container: as colunas seguem a largura DESTA área, não a da janela —
          com a barra lateral aberta, uma janela de 1024px deixa ~720px aqui. */}
      <div className="@container mx-auto flex max-w-6xl flex-col gap-5">
        <header className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{titulo}</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitulo}</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function FaltaTabela() {
  return (
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      A tabela de demandas ainda não existe neste banco. Rode <code>migration-demandas.sql</code> e recarregue.
    </p>
  );
}

function TabelaPessoas({
  linhas,
  equipe,
  abertasEquipe,
  hoje,
  periodo,
  aoMudarPeriodo,
  ordem,
  aoOrdenar,
  aberta,
  aoAbrir,
}: {
  linhas: LinhaPessoa[];
  equipe: Recorte;
  abertasEquipe: Aberta[];
  hoje: string;
  periodo: PeriodoId;
  aoMudarPeriodo: (p: PeriodoId) => void;
  ordem: Ordem;
  aoOrdenar: (c: Coluna) => void;
  aberta: string | null;
  aoAbrir: (id: string) => void;
}) {
  const doP = periodos(hoje).find((p) => p.id === periodo)!;
  // A barra de cada um é contra quem MAIS entregou no período: a régua é a
  // própria equipe.
  const maxEntregues = Math.max(1, ...linhas.map((l) => l.entregues));
  // A faísca de todos na mesma escala (a do dia de mais entregas de alguém).
  const tetoFaisca = Math.max(1, ...linhas.flatMap((l) => l.r.porDia.map((b) => b.entregues)));
  const daEquipe = doPeriodo(equipe, periodo);
  const agoraEquipe = contarAgora(abertasEquipe, hoje);
  const chamadosSemDono = abertasEquipe.filter((a) => !a.responsavelId).length;

  return (
    <section
      aria-labelledby="titulo-pessoas"
      className="viz surge overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800"
      data-tom={TOM}
      style={{ animationDelay: "60ms" }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-4">
        <div className="min-w-0">
          <h2 id="titulo-pessoas" className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
            Desempenho por pessoa
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            {doP.titulo} ({doP.quando}) · em aberto e atrasadas são de agora · clique para ver a ficha
          </p>
        </div>
        <Segmentos
          rotulo="Período da tabela"
          valor={periodo}
          opcoes={periodos(hoje).map((p) => ({ valor: p.id, rotulo: p.curto }))}
          aoMudar={aoMudarPeriodo}
        />
      </header>

      {linhas.length === 0 ? (
        <p className="border-t border-zinc-100 px-5 py-10 text-center text-[12px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          Ninguém com o módulo Demandas ainda. Libere em Configurações › Acessos.
        </p>
      ) : (
        <>
          {/* Os títulos das colunas, que também ordenam — só na tabela larga. */}
          <div
            className={`hidden border-y border-zinc-100 bg-zinc-50/70 px-5 py-2 text-[11px] font-medium text-zinc-500 @3xl:grid dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400 ${GRADE}`}
          >
            <Ordenar coluna="nome" ordem={ordem} aoOrdenar={aoOrdenar}>
              Pessoa
            </Ordenar>
            <Ordenar coluna="entregues" ordem={ordem} aoOrdenar={aoOrdenar}>
              Entregues
            </Ordenar>
            <Ordenar coluna="geradas" ordem={ordem} aoOrdenar={aoOrdenar} direita>
              Geradas
            </Ordenar>
            <Ordenar coluna="abertas" ordem={ordem} aoOrdenar={aoOrdenar} direita>
              Em aberto
            </Ordenar>
            <Ordenar coluna="atrasadas" ordem={ordem} aoOrdenar={aoOrdenar} direita>
              Atrasadas
            </Ordenar>
            <span className="text-right">Entregas · 30 dias</span>
          </div>

          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 @3xl:border-t-0 dark:divide-zinc-800/80 dark:border-zinc-800">
            {linhas.map((l) => (
              <li key={l.pessoa.id}>
                <button
                  type="button"
                  onClick={() => aoAbrir(l.pessoa.id)}
                  aria-label={`${l.pessoa.nome}: ${l.entregues} entregues, ${l.geradas} geradas, ${l.abertas} em aberto, ${l.atrasadas} atrasadas. Abrir a ficha.`}
                  className={`group block w-full px-5 py-3 text-left outline-none transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 dark:hover:bg-zinc-900/60 dark:focus-visible:bg-zinc-900/60 ${
                    aberta === l.pessoa.id ? "bg-zinc-50 dark:bg-zinc-900/60" : ""
                  }`}
                >
                  {/* Larga: uma linha de tabela. */}
                  <div className={`hidden @3xl:grid ${GRADE}`}>
                    <Quem pessoa={l.pessoa} />
                    <Barra valor={l.entregues} max={maxEntregues} anterior={l.anterior.entregues} rotuloAnterior={doP.anterior} />
                    <Num valor={l.geradas} />
                    <Num valor={l.abertas} />
                    <Atrasadas n={l.atrasadas} />
                    <span className="flex justify-end">
                      <Faisca valores={l.r.porDia.map((b) => b.entregues)} teto={tetoFaisca} />
                    </span>
                  </div>

                  {/* Estreita: a pessoa e as entregas em cima, o resto embaixo. */}
                  <div className="@3xl:hidden">
                    <div className="flex items-center gap-3">
                      <Quem pessoa={l.pessoa} />
                      <span className="ml-auto text-right">
                        <span className="block text-[20px] font-semibold leading-none tabular-nums text-zinc-900 dark:text-zinc-50">
                          {l.entregues}
                        </span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">entregues</span>
                      </span>
                    </div>
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-[12px] tabular-nums text-zinc-500 dark:text-zinc-400">
                      <span>{l.geradas} geradas</span>
                      <span>{l.abertas} em aberto</span>
                      {l.atrasadas > 0 ? (
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {l.atrasadas} {l.atrasadas === 1 ? "atrasada" : "atrasadas"}
                        </span>
                      ) : (
                        <span>nada atrasado</span>
                      )}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* A equipe toda: o número do período é o da equipe (não a soma das
              linhas — o chamado entregue conta uma vez só), e "em aberto"
              inclui os chamados que ainda não têm dono. */}
          <div className="border-t border-zinc-200 bg-zinc-50/70 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className={`hidden @3xl:grid ${GRADE}`}>
              <span className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">Equipe toda</span>
              <span className="text-[15px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50" title={`${doP.anterior}: ${daEquipe.anterior.entregues}`}>
                {daEquipe.atual.entregues}
              </span>
              <Num valor={daEquipe.atual.geradas} forte />
              <span
                className="text-right text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50"
                title={chamadosSemDono ? `Inclui ${chamadosSemDono} ${chamadosSemDono === 1 ? "chamado" : "chamados"} do TI ainda sem dono` : undefined}
              >
                {agoraEquipe.abertas}
              </span>
              <Atrasadas n={agoraEquipe.atrasadas} />
              <span className="flex justify-end">
                <Faisca valores={equipe.porDia.map((b) => b.entregues)} teto={Math.max(1, ...equipe.porDia.map((b) => b.entregues))} />
              </span>
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums text-zinc-600 @3xl:hidden dark:text-zinc-300">
              <span className="font-semibold">Equipe toda</span>
              <span>{daEquipe.atual.entregues} entregues</span>
              <span>{daEquipe.atual.geradas} geradas</span>
              <span>{agoraEquipe.abertas} em aberto</span>
              {agoraEquipe.atrasadas > 0 && (
                <span className="font-semibold text-red-600 dark:text-red-400">{agoraEquipe.atrasadas} atrasadas</span>
              )}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function Ordenar({
  coluna,
  ordem,
  aoOrdenar,
  direita = false,
  children,
}: {
  coluna: Coluna;
  ordem: Ordem;
  aoOrdenar: (c: Coluna) => void;
  direita?: boolean;
  children: React.ReactNode;
}) {
  const ativa = ordem.coluna === coluna;
  const Seta = ordem.desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => aoOrdenar(coluna)}
      aria-label={`Ordenar por ${String(children).toLowerCase()}`}
      aria-pressed={ativa}
      className={`inline-flex items-center gap-1 rounded transition hover:text-zinc-900 dark:hover:text-zinc-50 ${direita ? "justify-self-end" : "justify-self-start"} ${
        ativa ? "text-zinc-900 dark:text-zinc-50" : ""
      }`}
    >
      {children}
      <Seta className={`size-3 ${ativa ? "" : "invisible"}`} aria-hidden="true" />
    </button>
  );
}

function Quem({ pessoa }: { pessoa: PessoaDasMetricas }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar nome={pessoa.nome} iniciais={pessoa.iniciais} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-zinc-900 group-hover:underline group-hover:decoration-zinc-300 group-hover:underline-offset-2 dark:text-zinc-50 dark:group-hover:decoration-zinc-600">
          {pessoa.nome}
        </span>
        {pessoa.departamento && (
          <span className="block truncate text-[11px] text-zinc-400 dark:text-zinc-500">{pessoa.departamento}</span>
        )}
      </span>
    </span>
  );
}

/** As entregas do período: o número e a barra contra quem mais entregou. */
function Barra({ valor, max, anterior, rotuloAnterior }: { valor: number; max: number; anterior: number; rotuloAnterior: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3" title={`${rotuloAnterior}: ${anterior}`}>
      <span className="w-7 shrink-0 text-right text-[15px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{valor}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${(valor / max) * 100}%`, background: COR_ENTREGUES }}
        />
      </span>
    </span>
  );
}

function Num({ valor, forte = false }: { valor: number; forte?: boolean }) {
  return (
    <span
      className={`text-right text-[13px] tabular-nums ${
        forte ? "font-semibold text-zinc-900 dark:text-zinc-50" : valor ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-600"
      }`}
    >
      {valor}
    </span>
  );
}

function Atrasadas({ n }: { n: number }) {
  return (
    <span className="flex justify-end">
      {n > 0 ? (
        <span className="min-w-[22px] rounded-full bg-red-500 px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums text-white">
          {n}
        </span>
      ) : (
        <span className="text-[13px] text-zinc-300 dark:text-zinc-600">0</span>
      )}
    </span>
  );
}
