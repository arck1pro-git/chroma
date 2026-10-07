"use client";

// A coluna da direita da ficha: o que se consulta, não o que se lê em ordem.
//
// Sem cartões com moldura: grupos separados por uma linha fina, cada um com o
// título pequeno. Nove caixas iguais (a primeira versão) davam o mesmo peso a
// tudo; aqui o peso vem do conteúdo — o valor do negócio é o maior número da
// coluna porque é a primeira coisa que se procura.
//
// Grupo vazio não aparece. "Nenhuma automação" ocupando uma faixa inteira era
// o que mais fazia a ficha parecer formulário.
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarCheck2 } from "lucide-react";
import type { EtapaComTom, FichaContato } from "@/lib/contatos-ficha";
import type { Ia } from "@/lib/ia/catalogo";
import type { CampoPersonalizado, Contato, Etapa, Funil, Oportunidade } from "../data";
import { CamposDoContato } from "../components/campos-personalizados";
import IaDoContato from "../inicio/ia-contato";
import { dataCurta, dinheiro, hora, lerObjecao, ReguaDoFunil, Selo, tempo, TituloDeGrupo, type Tom } from "./pecas";

const ESTADO_EXECUCAO: Record<string, { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: "na fila", tom: "neutro" },
  rodando: { rotulo: "rodando", tom: "aviso" },
  esperando: { rotulo: "esperando", tom: "aviso" },
  pausada: { rotulo: "pausada", tom: "neutro" },
  sucesso: { rotulo: "concluída", tom: "bom" },
  erro: { rotulo: "erro", tom: "ruim" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
  perdida: { rotulo: "perdida", tom: "ruim" },
};

const linkSutil =
  "inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-50";

function Grupo({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="py-5 first:pt-0">
      <TituloDeGrupo acao={acao}>{titulo}</TituloDeGrupo>
      {children}
    </section>
  );
}

export default function Lateral({
  ficha,
  etapas,
  etapasCompletas,
  funis,
  camposContato,
  ias,
}: {
  ficha: FichaContato;
  etapas: Record<string, EtapaComTom>;
  etapasCompletas: Etapa[];
  funis: Funil[];
  camposContato: CampoPersonalizado[];
  ias: Ia[];
}) {
  const [verParametros, setVerParametros] = useState(false);
  const { contato, oportunidades, reunioes, conversas, videos, automacoes, origem, historico } = ficha;

  const agora = new Date().toISOString();
  const futuras = reunioes.filter((r) => r.inicio > agora).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const passadas = reunioes.filter((r) => r.inicio <= agora);
  const objecoes = historico.map((h) => ({ h, o: lerObjecao(h.descricao) })).filter((x) => x.o);

  const dele = conversas.reduce((s, c) => s + c.recebidas, 0);
  const ia = conversas.reduce((s, c) => s + c.pelaIa, 0);
  const equipe = conversas.reduce((s, c) => s + c.pelaEquipe, 0);
  const total = dele + ia + equipe;

  // As formas que a IA do contato (peça da gaveta do Dashboard) espera.
  const etapaPorId = new Map(etapasCompletas.map((e) => [e.id, e]));
  const funilPorId = new Map(funis.map((f) => [f.id, f]));
  const contatoTipo: Contato = {
    id: contato.id,
    nome: contato.nome,
    whatsapp: contato.whatsapp,
    email: contato.email,
    cidade: contato.cidade,
    estado: contato.estado,
    pais: contato.pais,
    data_criacao: contato.dataCriacao,
    ia: contato.ia,
    ia_id: contato.iaId,
  };
  const oportunidadesTipo: Oportunidade[] = oportunidades.map((o) => ({
    id: o.id,
    nome: o.nome,
    contato_id: contato.id,
    valor: o.valor,
    responsavel_id: "",
    status: o.status,
    funil_id: etapaPorId.get(o.etapaId)?.funil_id ?? "",
    etapa_id: o.etapaId,
    data_criacao: o.dataCriacao,
    dias_na_etapa: 0,
  }));

  const atribuicao = [
    ["Campanha", origem.campanha],
    ["Conjunto", origem.conjunto],
    ["Anúncio", origem.anuncio],
    ["Fonte", [origem.fonte, origem.meio].filter(Boolean).join(" / ") || null],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <aside aria-label="Resumo do contato" className="min-w-0 divide-y divide-zinc-100 dark:divide-zinc-800/80">
      {oportunidades.length > 0 && (
        <Grupo titulo={oportunidades.length === 1 ? "Negócio" : `Negócios · ${oportunidades.length}`}>
          <ul className="space-y-4">
            {oportunidades.map((o) => {
              const etapa = etapas[o.etapaId];
              return (
                <li key={o.id}>
                  <div className="flex items-baseline gap-2">
                    {o.valor > 0 ? (
                      <p className="text-xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">{dinheiro(o.valor)}</p>
                    ) : (
                      <p className="text-[15px] font-medium text-zinc-400 dark:text-zinc-500">Sem valor</p>
                    )}
                    <Selo tom={o.status === "ganha" ? "bom" : o.status === "perdida" ? "ruim" : "neutro"}>{o.status}</Selo>
                    <Link href={`/?op=${o.id}`} className={`${linkSutil} ml-auto`}>
                      no quadro <ArrowUpRight className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-zinc-600 dark:text-zinc-300">{o.nome}</p>
                  {etapa && (
                    <div className="mt-2 flex items-center gap-2">
                      <ReguaDoFunil etapaId={o.etapaId} etapas={etapas} largura="w-24" />
                      <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{etapa.nome}</span>
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {o.responsavel ?? "sem responsável"} · desde {dataCurta(o.dataCriacao)}
                  </p>
                  {o.eventosMeta.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-1">
                      {o.eventosMeta.slice(0, 4).map((e, i) => (
                        <Selo key={i} tom={e.status === "erro" ? "ruim" : "neutro"}>
                          pixel: {e.evento}
                        </Selo>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Grupo>
      )}

      {reunioes.length > 0 && (
        <Grupo titulo={futuras.length ? "Próxima reunião" : "Reuniões"}>
          {futuras[0] ? (
            <div className="flex items-start gap-3">
              <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-zinc-200 py-1 dark:border-zinc-700">
                <span className="text-[9px] font-semibold uppercase text-red-600 dark:text-red-400">
                  {new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).format(new Date(futuras[0].inicio)).replace(".", "")}
                </span>
                <span className="text-base font-semibold leading-tight tabular-nums text-zinc-900 dark:text-zinc-50">
                  {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(futuras[0].inicio))}
                </span>
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">às {hora(futuras[0].inicio)}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  marcada {futuras[0].pelaIa ? "pela IA" : `por ${futuras[0].autor ?? "alguém da equipe"}`}
                </p>
              </div>
            </div>
          ) : null}
          {passadas.length > 0 && (
            <ul className={`space-y-1 ${futuras[0] ? "mt-3" : ""}`}>
              {passadas.slice(0, 3).map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
                  <CalendarCheck2 className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                  {dataCurta(r.inicio)}, {hora(r.inicio)}
                  <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{r.pelaIa ? "· pela IA" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Grupo>
      )}

      {objecoes.length > 0 && (
        <Grupo titulo={`Objeções · ${objecoes.length}`}>
          <ul className="space-y-2.5">
            {objecoes.slice(0, 5).map(({ h, o }) => (
              <li key={h.id}>
                <Selo tom="aviso">{o!.tema}</Selo>
                <p className="mt-1 line-clamp-2 text-[12px] italic leading-snug text-zinc-700 dark:text-zinc-200">“{o!.fala}”</p>
                {o!.motivo && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">por trás: {o!.motivo}</p>
                )}
              </li>
            ))}
          </ul>
        </Grupo>
      )}

      {(total > 0 || videos.length > 0) && (
        <Grupo titulo="Engajamento">
          {total > 0 && (
            <div>
              <div className="flex items-baseline justify-between">
                <p className="text-[12px] text-zinc-600 dark:text-zinc-300">
                  <span className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{total}</span> mensagens
                </p>
                <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{Math.round((dele / total) * 100)}% dele</span>
              </div>
              {/* Quem falou: tons de cinza em ordem (ele, IA, equipe) com a
                  legenda ao lado — identidade pelo texto, não pela cor. */}
              <div className="mt-1.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${dele} dele, ${ia} da IA, ${equipe} da equipe`}>
                {dele > 0 && <span className="rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ flex: dele }} />}
                {ia > 0 && <span className="rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ flex: ia }} />}
                {equipe > 0 && <span className="rounded-full bg-zinc-200 dark:bg-zinc-700" style={{ flex: equipe }} />}
              </div>
              <p className="mt-1.5 flex gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                {[
                  { n: dele, rotulo: "dele", cor: "bg-zinc-900 dark:bg-zinc-100" },
                  { n: ia, rotulo: "IA", cor: "bg-zinc-400 dark:bg-zinc-500" },
                  { n: equipe, rotulo: "equipe", cor: "bg-zinc-200 dark:bg-zinc-700" },
                ]
                  .filter((p) => p.n > 0)
                  .map((p) => (
                    <span key={p.rotulo} className="flex items-center gap-1">
                      <span className={`size-1.5 rounded-full ${p.cor}`} />
                      {p.n} {p.rotulo}
                    </span>
                  ))}
              </p>
            </div>
          )}
          {videos.length > 0 && (
            <ul className={`space-y-2.5 ${total > 0 ? "mt-4" : ""}`}>
              {videos.map((v) => {
                const fracao = v.duracao ? Math.min(1, v.cobertura / v.duracao) : null;
                return (
                  <li key={v.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/videos?video=${v.id}`} className="min-w-0 truncate text-[12px] text-zinc-700 hover:underline dark:text-zinc-300">
                        {v.nome}
                      </Link>
                      <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                        {fracao === null ? tempo(v.cobertura) : `${Math.round(fracao * 100)}%`}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${fracao === null ? 0 : Math.max(fracao * 100, 3)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Grupo>
      )}

      <Grupo titulo="Origem">
        <p className="text-[12px] leading-snug text-zinc-800 dark:text-zinc-200">{origem.comoChegou}</p>
        {atribuicao.length > 0 && (
          <dl className="mt-2.5 space-y-1.5 text-[12px]">
            {atribuicao.map(([rotulo, valor]) => (
              <div key={rotulo} className="grid grid-cols-[4.25rem_1fr] gap-2">
                <dt className="text-zinc-400 dark:text-zinc-500">{rotulo}</dt>
                <dd className="min-w-0 break-words text-zinc-800 dark:text-zinc-200">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
        {origem.parametros.length > 0 && (
          <div className="mt-2.5">
            <button
              type="button"
              onClick={() => setVerParametros((v) => !v)}
              aria-expanded={verParametros}
              className="text-[11px] font-medium text-zinc-400 transition hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-50"
            >
              {verParametros ? "Esconder" : "Ver"} {origem.parametros.length} parâmetros
            </button>
            {verParametros && (
              <dl className="mt-2 space-y-1.5 rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-900">
                {origem.parametros.map((p) => (
                  <div key={`${p.chave}${p.de}`}>
                    <dt className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {p.rotulo}
                      {p.de !== "contato" ? ` · ${p.de}` : ""}
                    </dt>
                    <dd className="break-all font-mono text-[11px] text-zinc-800 dark:text-zinc-200">{p.valor}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </Grupo>

      {automacoes.length > 0 && (
        <Grupo titulo="Automações">
          <ul className="space-y-2">
            {automacoes.slice(0, 6).map((a) => {
              const estado = ESTADO_EXECUCAO[a.estado] ?? { rotulo: a.estado, tom: "neutro" as Tom };
              return (
                <li key={a.id} className="flex items-center gap-2">
                  <Link
                    href={a.etapa ? `/?cadencia=${a.fluxoId}` : `/automacoes/${a.fluxoId}`}
                    className="min-w-0 flex-1 truncate text-[12px] text-zinc-700 hover:underline dark:text-zinc-300"
                    title={a.erro ?? undefined}
                  >
                    {a.fluxo}
                  </Link>
                  <Selo tom={estado.tom}>{estado.rotulo}</Selo>
                </li>
              );
            })}
          </ul>
        </Grupo>
      )}

      <section className="py-5 [&>section]:border-t-0 [&>section]:px-0 [&>section]:py-0">
        <IaDoContato contato={contatoTipo} oportunidades={oportunidadesTipo} etapaPorId={etapaPorId} funilPorId={funilPorId} ias={ias} />
      </section>

      {camposContato.length > 0 && (
        <section className="py-5 [&>section]:border-t-0 [&>section]:px-0 [&>section]:py-0">
          <CamposDoContato contatoId={contato.id} definicoes={camposContato} />
        </section>
      )}

    </aside>
  );
}
