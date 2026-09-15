"use client";

// A visão geral de uma webhook: o endereço, os números e quem passou por ela.
//
// A FORMA É A DA VISÃO GERAL DE UMA AUTOMAÇÃO (app/automacoes/painel-lateral.tsx):
// blocos empilhados com gap-4, uma fileira de KPIs em cima, gráfico no meio e a
// lista embaixo. Duas telas irmãs com gramáticas diferentes leriam como dois
// aplicativos.
//
// A ORDEM É A DA PERGUNTA: "para onde mando?" (endereço), "está entrando?"
// (KPIs e gráfico), "quem entrou?" (a lista). O payload cru fica a um clique
// dentro da lista, porque ele só interessa quando a resposta da terceira
// pergunta é "ninguém".
import { useMemo, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Inbox,
  Link2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { DetalheWebhook } from "./dados";
import { RecebimentosPorDia } from "./graficos";
import { girarSegredo } from "./acoes";
import {
  botaoFraco,
  cabecalhoTabela,
  celulaTabela,
  SELO_RECEBIMENTO,
  vazio,
} from "./estilos";
import {
  promptDeImplementacao,
  urlDaWebhook,
  type Recebimento,
  type Webhook,
  type WebhookCampo,
} from "@/lib/webhooks";
import { dataCurta, dataHora } from "../formato";

/** Um payload sempre deveria ser objeto, mas o que chega é do outro lado. */
function objeto(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

// Valor de uma chave como texto de célula. Objeto e array viram JSON em vez de
// "[object Object]" — é raro, mas quando acontece é exatamente o que se quer ver.
function celula(valor: unknown): string {
  if (valor === undefined || valor === null || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

// ── As peças, iguais às da visão geral de uma automação ─────────────────────
function Kpi({
  rotulo,
  valor,
  detalhe,
  atencao,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  atencao?: boolean;
}) {
  return (
    <div className="surge rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {rotulo}
      </p>
      {/* Figura proporcional, não tabular: em tamanho grande o tabular deixa
          números como 121 com espaçamento frouxo. */}
      <p
        className={`mt-1 text-xl font-semibold tracking-tight ${
          atencao
            ? "text-rose-600 dark:text-rose-400"
            : "text-zinc-900 dark:text-zinc-50"
        }`}
      >
        {valor}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {detalhe}
      </p>
    </div>
  );
}

function Bloco({
  titulo,
  Icone,
  contagem,
  plano,
  children,
}: {
  titulo: string;
  Icone: LucideIcon;
  contagem?: number;
  /** Sem respiro interno: para a tabela, que desenha as próprias células. */
  plano?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <h2
        className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 ${
          plano ? "px-4 pb-2.5 pt-3" : "px-4 pb-3 pt-4"
        }`}
      >
        <Icone className="size-3.5" aria-hidden="true" />
        {titulo}
        {contagem !== undefined && (
          <span className="tabular-nums text-zinc-300 dark:text-zinc-600">
            {contagem}
          </span>
        )}
      </h2>
      <div className={plano ? "" : "px-4 pb-4"}>{children}</div>
    </section>
  );
}

// ── A tela ──────────────────────────────────────────────────────────────────
export default function VisaoGeral({
  webhook,
  detalhe,
  baseUrl,
  baseUrlPublica,
  aoEditarCampos,
}: {
  webhook: Webhook;
  detalhe: DetalheWebhook;
  baseUrl: string;
  baseUrlPublica: boolean;
  aoEditarCampos: () => void;
}) {
  const m = detalhe.metricas;
  const naoEntraram = m.recusado + m.erro;
  const taxa = m.total > 0 ? Math.round((m.ok / m.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <Endereco
        webhook={webhook}
        campos={detalhe.campos}
        baseUrl={baseUrl}
        baseUrlPublica={baseUrlPublica}
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          rotulo="Recebidos"
          valor={m.total.toLocaleString("pt-BR")}
          detalhe={m.primeiro ? `Desde ${dataCurta(m.primeiro)}` : "Nenhum ainda"}
        />
        <Kpi
          rotulo="Viraram lead"
          valor={m.ok.toLocaleString("pt-BR")}
          detalhe={m.total > 0 ? `${taxa}% do total` : "—"}
        />
        <Kpi
          rotulo="Não entraram"
          valor={naoEntraram.toLocaleString("pt-BR")}
          detalhe={`${m.recusado} recusados · ${m.erro} com erro`}
          atencao={naoEntraram > 0}
        />
        {/* Dez recebimentos do mesmo lead viram um contato só (a recepção
            reaproveita — ver migration-webhooks.sql §2), e a distância entre os
            dois números é o que denuncia formulário sendo reenviado. */}
        <Kpi
          rotulo="Contatos"
          valor={m.contatos.toLocaleString("pt-BR")}
          detalhe={
            m.ok > m.contatos
              ? `${m.ok - m.contatos} caíram em contato repetido`
              : "Distintos, sem repetição"
          }
        />
      </div>

      <Bloco titulo="Recebimentos por dia" Icone={TrendingUp}>
        <RecebimentosPorDia dados={m.porDia} />
      </Bloco>

      <QuemPassou
        campos={detalhe.campos}
        recebimentos={detalhe.recebimentos}
        aoEditarCampos={aoEditarCampos}
      />
    </div>
  );
}

// ── O endereço: é o que se vem copiar ───────────────────────────────────────
function Endereco({
  webhook,
  campos,
  baseUrl,
  baseUrlPublica,
}: {
  webhook: Webhook;
  campos: WebhookCampo[];
  baseUrl: string;
  baseUrlPublica: boolean;
}) {
  const [revelado, setRevelado] = useState(false);
  const [verPrompt, setVerPrompt] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [girando, iniciar] = useTransition();

  const url = urlDaWebhook(baseUrl, webhook.slug, webhook.segredo);
  // Mesma URL com o segredo escondido — é o que a tela mostra por padrão, para
  // o segredo não vazar num print ou numa tela compartilhada.
  const urlMascarada = urlDaWebhook(baseUrl, webhook.slug, "•".repeat(12));

  // Função pura, recalculada a cada campo que muda: gerar no servidor obrigaria
  // um ida-e-volta por edição para o texto copiado não sair desatualizado — que
  // é o pior jeito de errar num botão de copiar.
  const prompt = useMemo(
    () => promptDeImplementacao(webhook, campos, baseUrl),
    [webhook, campos, baseUrl],
  );

  async function copiar(chave: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1800);
    } catch {
      /* navegador bloqueou a cópia — a URL está visível para copiar à mão */
    }
  }

  function girar() {
    if (
      !window.confirm(
        "Gerar um segredo novo? A URL continua a mesma, mas quem já estiver enviando com o segredo atual passa a receber 401 até ser atualizado.",
      )
    )
      return;
    iniciar(() => void girarSegredo(webhook.id));
  }

  return (
    <Bloco titulo="Endereço de envio" Icone={Link2}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {revelado ? url : urlMascarada}
        </code>
        <button
          type="button"
          onClick={() => setRevelado((v) => !v)}
          aria-label={revelado ? "Esconder segredo" : "Mostrar segredo"}
          className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          {revelado ? (
            <EyeOff className="size-3.5" aria-hidden="true" />
          ) : (
            <Eye className="size-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => girar()}
          disabled={girando}
          title="Gerar um segredo novo — quem já envia com o atual passa a receber 401"
          aria-label="Gerar novo segredo"
          className="shrink-0 text-zinc-400 transition hover:text-zinc-900 disabled:opacity-40 dark:hover:text-zinc-50"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => copiar("url", url)}
          className={botaoFraco}
        >
          {copiado === "url" ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copiado === "url" ? "Copiado" : "URL"}
        </button>
        {/* O botão que o módulo existe para ter: o prompt já sai com a URL, os
            campos declarados e as respostas possíveis, pronto para colar numa
            IA que esteja no código de quem vai enviar. */}
        <button
          type="button"
          onClick={() => copiar("prompt", prompt)}
          className={botaoFraco}
        >
          {copiado === "prompt" ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          {copiado === "prompt" ? "Copiado" : "Prompt"}
        </button>
        <button
          type="button"
          onClick={() => setVerPrompt((v) => !v)}
          aria-label={verPrompt ? "Ocultar prompt" : "Ver prompt"}
          aria-expanded={verPrompt}
          className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${verPrompt ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        O segredo vai na própria URL — trate-a como senha e chame de um servidor,
        nunca de JavaScript de página pública.
      </p>

      {verPrompt && (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {prompt}
        </pre>
      )}

      {/* Normalmente a URL sai do domínio em que você está — em produção não há
          nada a avisar. Este aviso só aparece no caso local, que é o único em
          que o endereço da tela não serve para ninguém de fora. */}
      {!baseUrlPublica && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Endereço local: essa URL só funciona desta máquina. Abra o CRM pelo
            domínio de produção e copie de lá.
          </span>
        </p>
      )}
    </Bloco>
  );
}

// ── Quem passou pela webhook ────────────────────────────────────────────────
// Uma coluna por campo declarado, com o valor já extraído do payload: é a
// leitura que responde "quem entrou e com quê" sem abrir JSON nenhum. O payload
// cru fica a um clique, porque é ele que responde "por que este não entrou".
function QuemPassou({
  campos,
  recebimentos,
  aoEditarCampos,
}: {
  campos: WebhookCampo[];
  recebimentos: Recebimento[];
  aoEditarCampos: () => void;
}) {
  const [aberto, setAberto] = useState<string | null>(null);

  // Chave que chega no payload e não está declarada é descartada em silêncio —
  // é o erro nº 1 da integração ("e-mail" onde se declarou "email"). Sai de
  // graça destes mesmos payloads, então fica dito numa linha em vez de exigir
  // que alguém abra 30 JSONs para desconfiar.
  const descartadas = useMemo(() => {
    const declaradas = new Set(campos.map((c) => c.chave));
    const vistas = new Set<string>();
    for (const r of recebimentos) {
      for (const k of Object.keys(objeto(r.payload))) {
        if (!declaradas.has(k)) vistas.add(k);
      }
    }
    return [...vistas];
  }, [campos, recebimentos]);

  if (recebimentos.length === 0) {
    return (
      <Bloco titulo="Quem passou por aqui" Icone={Inbox}>
        <p className={vazio}>Nenhuma chamada chegou nesta webhook ainda</p>
      </Bloco>
    );
  }

  // O campo de nome não vira coluna: ele já é a primeira, "Contato".
  const colunas = campos.filter(
    (c) => c.destino !== "ignorar" && c.destino !== "contato.nome",
  );
  const campoNome = campos.find((c) => c.destino === "contato.nome");
  const largura = colunas.length + 4; // contato + colunas + estado + resumo + quando

  return (
    <Bloco
      titulo="Quem passou por aqui"
      Icone={Inbox}
      contagem={recebimentos.length}
      plano
    >
      {descartadas.length > 0 && (
        <p className="mx-4 mb-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Chegou e foi descartado, por não estar declarado:{" "}
            {descartadas.map((k, i) => (
              <span key={k}>
                {i > 0 && ", "}
                <code className="font-mono">{k}</code>
              </span>
            ))}
          </span>
          <button
            type="button"
            onClick={aoEditarCampos}
            className="font-medium underline underline-offset-2"
          >
            declarar
          </button>
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th scope="col" className={cabecalhoTabela}>
                Contato
              </th>
              {colunas.map((c) => (
                <th key={c.id} scope="col" className={cabecalhoTabela}>
                  {c.rotulo}
                </th>
              ))}
              <th scope="col" className={cabecalhoTabela}>
                Estado
              </th>
              <th scope="col" className={cabecalhoTabela}>
                O que aconteceu
              </th>
              <th scope="col" className={`${cabecalhoTabela} text-right`}>
                Quando
              </th>
            </tr>
          </thead>
          <tbody>
            {recebimentos.map((r, i) => {
              const dados = objeto(r.payload);
              const expandido = aberto === r.id;
              // Recusado não chegou a virar contato, mas o nome veio no
              // payload — mostrar quem tentou é metade do diagnóstico.
              const quem =
                r.contato_nome ??
                (campoNome ? celula(dados[campoNome.chave]) : "—");

              return [
                <tr
                  key={r.id}
                  onClick={() => setAberto((a) => (a === r.id ? null : r.id))}
                  aria-expanded={expandido}
                  style={{ animationDelay: `${Math.min(i, 6) * 14}ms` }}
                  className="surge-suave cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                >
                  <td className={celulaTabela}>
                    <p className="max-w-56 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
                      {quem}
                    </p>
                  </td>
                  {colunas.map((c) => (
                    <td key={c.id} className={celulaTabela}>
                      <p
                        className="max-w-48 truncate text-[13px] text-zinc-600 dark:text-zinc-300"
                        title={celula(dados[c.chave])}
                      >
                        {celula(dados[c.chave])}
                      </p>
                    </td>
                  ))}
                  <td className={`${celulaTabela} whitespace-nowrap`}>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SELO_RECEBIMENTO[r.estado]}`}
                    >
                      {r.estado}
                    </span>
                  </td>
                  <td className={celulaTabela}>
                    <p className="max-w-64 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {r.erro ?? r.resumo ?? "—"}
                    </p>
                  </td>
                  <td className={`${celulaTabela} whitespace-nowrap text-right`}>
                    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                      {dataHora(r.data_criacao)}
                      <ChevronDown
                        className={`size-3 transition-transform ${expandido ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </span>
                  </td>
                </tr>,
                expandido && (
                  <tr key={`${r.id}-payload`}>
                    {/* Sem as classes de célula: o <pre> desenha o próprio
                        respiro, e aqui só interessa a borda de baixo. */}
                    <td
                      colSpan={largura}
                      className="border-b border-zinc-200 p-0 dark:border-zinc-800/70"
                    >
                      <pre className="max-h-56 overflow-auto bg-zinc-50 p-4 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}
