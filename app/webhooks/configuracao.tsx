"use client";

// A configuração de uma webhook, atrás do botão Editar: duas etapas, uma de
// cada vez —
//
//   1. Campos — o que ela aceita receber
//   2. Ações  — o que fazer com o lead que chegou
//
// É só isso que é contrato. Nome e descrição são rótulo e ficam no cabeçalho;
// endereço, segredo e prompt são o que se COPIA, e ficam na visão geral.
//
// AS ETAPAS USAM AS ABAS DO PAINEL DE AUTOMAÇÕES — a mesma <nav> de sublinhado,
// no mesmo lugar do cabeçalho. O que as torna etapas, e não abas soltas, é o
// número na frente, o check quando estão prontas e o rodapé com Voltar e
// Continuar. Inventar um componente de trilha só para esta tela deixaria duas
// gramáticas de navegação dentro do mesmo painel.
//
// Campos antes de Ações não é enfeite: as ações agem sobre o contato que os
// campos formam — escolher "inscrever na automação" antes de declarar de onde
// sai o WhatsApp é escolher mandar mensagem para ninguém. Mesmo assim nenhuma
// etapa trava a outra: bloquear "Continuar" faria de quem só veio corrigir uma
// tag refém do formulário inteiro.
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Check,
  ListTree,
  Plus,
  SlidersHorizontal,
  Tag as TagIcon,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Alvos, DetalheWebhook } from "./dados";
import {
  adicionarAcao,
  configurarCriarLead,
  criarCampo,
  editarCampo,
  excluirAcao,
  excluirCampo,
} from "./acoes";
import {
  avisoAmbar,
  botao,
  botaoFraco,
  campoTexto,
  cartao,
  rotuloCampo,
} from "./estilos";
import {
  type CampoDoCrm,
  lerValorDeDestino,
  opcoesDeDestino,
  rotuloDoDestino,
  valorDeDestino,
  type DestinoCampo,
  type OpcaoDestino,
  type TipoCampo,
  type WebhookCampo,
} from "@/lib/webhooks";

// ── As etapas ───────────────────────────────────────────────────────────────
export type ChavePasso = "campos" | "acoes";

export const PASSOS: {
  chave: ChavePasso;
  rotulo: string;
  Icone: LucideIcon;
  titulo: string;
  descricao: string;
}[] = [
  {
    chave: "campos",
    rotulo: "Campos",
    Icone: SlidersHorizontal,
    titulo: "O que ela recebe",
    descricao:
      "As chaves que o JSON pode trazer e para onde cada valor vai no CRM. Chave que não estiver declarada aqui é descartada em silêncio.",
  },
  {
    chave: "acoes",
    rotulo: "Ações",
    Icone: ListTree,
    titulo: "O que fazer com o lead",
    descricao:
      "O contato é sempre criado ou reaproveitado. O resto acontece na ordem abaixo — a automação fica por último, porque é a única que manda mensagem de verdade.",
  },
];

/**
 * O que falta em cada etapa, em uma frase — ou `null` quando está pronta.
 *
 * É a única fonte do check nas abas e do contador no botão Editar. Tudo sai do
 * estado salvo, nunca de "o usuário passou por aqui": um check que mente é pior
 * do que check nenhum.
 */
export function calcularPendencias(
  detalhe: DetalheWebhook,
): Record<ChavePasso, string | null> {
  const criarLead = detalhe.acoes.find((a) => a.tipo === "criar_lead");
  // Sem nenhum campo apontando para nome/whatsapp/e-mail, o lead entra como
  // "Sem nome" e sem forma de contato. É o erro de configuração mais provável
  // e o mais caro.
  const temIdentidade = detalhe.campos.some((c) =>
    ["contato.nome", "contato.whatsapp", "contato.email"].includes(c.destino),
  );

  return {
    campos:
      detalhe.campos.length === 0
        ? "Nenhum campo declarado: tudo que chegar vai ser descartado."
        : temIdentidade
          ? null
          : "Nenhum campo aponta para nome, WhatsApp ou e-mail — o lead entra sem como ser respondido.",
    acoes:
      criarLead?.criar_oportunidade && !criarLead.etapa_id
        ? "O card no funil está ligado, mas sem etapa de entrada."
        : null,
  };
}

/**
 * As abas, no cabeçalho do painel — por isso moram fora do corpo e são
 * exportadas à parte. Mesmas classes das abas de /automacoes.
 */
export function AbasDaConfiguracao({
  atual,
  pendentes,
  aoIr,
}: {
  atual: ChavePasso;
  pendentes: Record<ChavePasso, string | null>;
  aoIr: (chave: ChavePasso) => void;
}) {
  return (
    <nav className="flex gap-1 px-3 pt-2" aria-label="Etapas da configuração">
      {PASSOS.map(({ chave, rotulo, Icone }, i) => {
        const feito = !pendentes[chave];
        const ativo = chave === atual;
        return (
          <button
            key={chave}
            type="button"
            onClick={() => aoIr(chave)}
            aria-current={ativo ? "page" : undefined}
            title={feito ? `${rotulo} — pronto` : pendentes[chave]!}
            className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
              ativo
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            <Icone className="size-3.5" aria-hidden="true" />
            {i + 1}. {rotulo}
            {feito ? (
              <Check
                className="size-3 text-emerald-600 dark:text-emerald-400"
                aria-label="pronto"
              />
            ) : (
              <span
                aria-label="tem pendência"
                className="size-1.5 rounded-full bg-amber-400"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ── O corpo ─────────────────────────────────────────────────────────────────
export default function Configuracao({
  webhookId,
  detalhe,
  alvos,
  etapa,
  aoIr,
  aoConcluir,
}: {
  webhookId: string;
  detalhe: DetalheWebhook;
  alvos: Alvos;
  etapa: ChavePasso;
  aoIr: (chave: ChavePasso) => void;
  aoConcluir: () => void;
}) {
  const indice = PASSOS.findIndex((p) => p.chave === etapa);
  const passo = PASSOS[indice];

  const corpo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    corpo.current?.scrollTo({ top: 0 });
  }, [etapa]);

  return (
    <>
      <div ref={corpo} className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* A key força a animação de entrada a cada troca de etapa — é o que
            faz a navegação parecer avanço, e não a mesma página piscando. */}
        <section key={etapa} className="surge flex flex-col gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
              {passo.titulo}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {passo.descricao}
            </p>
          </div>

          {etapa === "campos" ? (
            <PassoCampos
              webhookId={webhookId}
              campos={detalhe.campos}
              camposCrm={alvos.camposCrm}
            />
          ) : (
            <PassoAcoes webhookId={webhookId} detalhe={detalhe} alvos={alvos} />
          )}
        </section>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => aoIr(PASSOS[indice - 1].chave)}
          disabled={indice === 0}
          className={botaoFraco}
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Voltar
        </button>

        <span className="min-w-0 flex-1" />

        {indice < PASSOS.length - 1 ? (
          <button
            type="button"
            onClick={() => aoIr(PASSOS[indice + 1].chave)}
            className={botao}
          >
            Continuar
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" onClick={aoConcluir} className={botao}>
            <Check className="size-3.5" aria-hidden="true" />
            Concluir
          </button>
        )}
      </footer>
    </>
  );
}

// ── 1. Campos ───────────────────────────────────────────────────────────────
const TIPOS: { valor: TipoCampo; rotulo: string }[] = [
  { valor: "texto", rotulo: "Texto" },
  { valor: "numero", rotulo: "Número" },
  { valor: "data", rotulo: "Data" },
  { valor: "booleano", rotulo: "Sim/Não" },
];

/**
 * O seletor "Vira o quê no CRM", igual no formulário de cima e na linha em
 * edição. Uma peça só porque as duas listas TÊM que ser a mesma: se divergirem,
 * um destino escolhido ao criar some ao editar.
 */
function SeletorDestino({
  opcoes,
  destino,
  destinoChave,
  aoMudar,
  rotuloAcessivel,
  className,
}: {
  opcoes: OpcaoDestino[];
  destino: DestinoCampo;
  destinoChave: string;
  aoMudar: (destino: DestinoCampo, destinoChave: string) => void;
  rotuloAcessivel?: string;
  className?: string;
}) {
  return (
    <select
      value={valorDeDestino(destino, destinoChave || null)}
      onChange={(e) => {
        const lido = lerValorDeDestino(e.target.value);
        aoMudar(lido.destino, lido.destinoChave);
      }}
      aria-label={rotuloAcessivel}
      className={className ?? campoTexto}
    >
      {["Contato", "Oportunidade", "Outros"].map((grupo) => {
        const doGrupo = opcoes.filter((o) => o.grupo === grupo);
        if (doGrupo.length === 0) return null;
        return (
          <optgroup key={grupo} label={grupo}>
            {doGrupo.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function PassoCampos({
  webhookId,
  campos,
  camposCrm,
}: {
  webhookId: string;
  campos: WebhookCampo[];
  camposCrm: CampoDoCrm[];
}) {
  const [chave, setChave] = useState("");
  const [rotulo, setRotulo] = useState("");
  const [tipo, setTipo] = useState<TipoCampo>("texto");
  const [destino, setDestino] = useState<DestinoCampo>("contato.nome");
  const [destinoChave, setDestinoChave] = useState("");
  const [obrigatorio, setObrigatorio] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  // A lista inclui os campos personalizados que ESTA webhook já usa, mesmo que
  // algum tenha sido apagado do cadastro depois — ver opcoesDeDestino.
  const opcoes = opcoesDeDestino(camposCrm, campos);

  function adicionar() {
    if (!chave.trim()) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarCampo(webhookId, chave, rotulo, tipo, obrigatorio, destino, destinoChave);
        setChave("");
        setRotulo("");
        setDestinoChave("");
        setObrigatorio(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar campo");
      }
    });
  }

  const temIdentidade = campos.some((c) =>
    ["contato.nome", "contato.whatsapp", "contato.email"].includes(c.destino),
  );

  return (
    <>
      <div className={cartao}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={rotuloCampo}>Chave no JSON</span>
            <input
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && adicionar()}
              placeholder="email"
              className={`${campoTexto} font-mono`}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={rotuloCampo}>Rótulo</span>
            <input
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && adicionar()}
              placeholder="E-mail do lead"
              className={campoTexto}
            />
          </label>
        </div>

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={rotuloCampo}>Vira o quê no CRM</span>
            <SeletorDestino
              opcoes={opcoes}
              destino={destino}
              destinoChave={destinoChave}
              aoMudar={(d, c) => {
                setDestino(d);
                setDestinoChave(c);
              }}
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1.5 sm:w-28">
            <span className={rotuloCampo}>Tipo</span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoCampo)}
              className={campoTexto}
            >
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="flex shrink-0 items-center gap-1.5 pb-1.5 text-[12px] text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={obrigatorio}
              onChange={(e) => setObrigatorio(e.target.checked)}
              className="size-3.5 rounded border-zinc-300 dark:border-zinc-700"
            />
            Obrigatório
          </label>

          <button
            type="button"
            onClick={adicionar}
            disabled={!chave.trim() || salvando}
            className={botao}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Campo
          </button>
        </div>

        {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}

        {campos.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhum campo declarado ainda.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {campos.map((c) => (
              <LinhaCampo key={c.id} campo={c} opcoes={opcoes} />
            ))}
          </ul>
        )}
      </div>

      {/* Só depois do primeiro campo: num formulário ainda vazio o aviso seria
          repreensão pelo que ninguém teve chance de fazer. */}
      {campos.length > 0 && !temIdentidade && (
        <p className={avisoAmbar}>
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Nenhum campo aponta para nome, WhatsApp ou e-mail. O lead vai entrar
            como “Sem nome” e sem como ser respondido.
          </span>
        </p>
      )}
    </>
  );
}

function LinhaCampo({
  campo,
  opcoes,
}: {
  campo: WebhookCampo;
  opcoes: OpcaoDestino[];
}) {
  const [editando, setEditando] = useState(false);
  const [rotulo, setRotulo] = useState(campo.rotulo);
  const [tipo, setTipo] = useState<TipoCampo>(campo.tipo);
  const [destino, setDestino] = useState<DestinoCampo>(campo.destino);
  const [destinoChave, setDestinoChave] = useState(campo.destino_chave ?? "");
  const [obrigatorio, setObrigatorio] = useState(campo.obrigatorio);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    iniciar(async () => {
      await editarCampo(campo.id, rotulo, tipo, obrigatorio, destino, destinoChave);
      setEditando(false);
    });
  }

  function cancelar() {
    setRotulo(campo.rotulo);
    setTipo(campo.tipo);
    setDestino(campo.destino);
    setDestinoChave(campo.destino_chave ?? "");
    setObrigatorio(campo.obrigatorio);
    setEditando(false);
  }

  if (editando) {
    return (
      <li className="flex flex-col gap-2 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
              if (e.key === "Escape") cancelar();
            }}
            autoFocus
            aria-label="Rótulo"
            className={campoTexto}
          />
          <SeletorDestino
            opcoes={opcoes}
            destino={destino}
            destinoChave={destinoChave}
            aoMudar={(d, c) => {
              setDestino(d);
              setDestinoChave(c);
            }}
            rotuloAcessivel="Destino"
          />
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoCampo)}
            aria-label="Tipo"
            className={`${campoTexto} sm:w-28`}
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={obrigatorio}
              onChange={(e) => setObrigatorio(e.target.checked)}
              className="size-3.5 rounded border-zinc-300 dark:border-zinc-700"
            />
            Obrigatório
          </label>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            aria-label="Salvar"
            className="shrink-0 text-zinc-400 transition hover:text-emerald-600"
          >
            <Check className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={cancelar}
            aria-label="Cancelar"
            className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          {campo.rotulo}
          {campo.obrigatorio && (
            <span className="ml-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              obrigatório
            </span>
          )}
        </p>
        {/* A chave é o contrato com o outro lado — é por ela que o valor é
            encontrado no payload, e renomear quebra o envio em silêncio. */}
        <p className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          {campo.chave}
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {rotuloDoDestino(campo)}
      </span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${campo.rotulo}`}
        className="shrink-0 text-zinc-400 transition hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => iniciar(() => void excluirCampo(campo.id))}
        disabled={salvando}
        aria-label={`Remover campo ${campo.chave}`}
        className="shrink-0 text-zinc-400 transition hover:text-red-500"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

// ── 2. Ações ────────────────────────────────────────────────────────────────
function PassoAcoes({
  webhookId,
  detalhe,
  alvos,
}: {
  webhookId: string;
  detalhe: DetalheWebhook;
  alvos: Alvos;
}) {
  const criarLead = detalhe.acoes.find((a) => a.tipo === "criar_lead");
  const outras = detalhe.acoes.filter((a) => a.tipo !== "criar_lead");

  return (
    <>
      {criarLead && (
        <CriarLead webhookId={webhookId} acao={criarLead} alvos={alvos} />
      )}

      <div className={cartao}>
        <NovaAcao
          webhookId={webhookId}
          alvos={alvos}
          temOportunidade={!!criarLead?.criar_oportunidade}
        />

        {outras.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Nenhuma ação além de criar o lead.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {outras.map((a) => (
              <LinhaAcao key={a.id} acao={a} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function CriarLead({
  webhookId,
  acao,
  alvos,
}: {
  webhookId: string;
  acao: DetalheWebhook["acoes"][number];
  alvos: Alvos;
}) {
  const [ligado, setLigado] = useState(acao.criar_oportunidade);
  const [funilId, setFunilId] = useState(acao.funil_id ?? alvos.funis[0]?.id ?? "");
  const [etapaId, setEtapaId] = useState(acao.etapa_id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const etapasDoFunil = alvos.etapas.filter((e) => e.funil_id === funilId);

  function salvar(novoLigado: boolean, novoFunil: string, novaEtapa: string) {
    setErro(null);
    iniciar(async () => {
      try {
        await configurarCriarLead(webhookId, novoLigado, novoFunil, novaEtapa);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  return (
    <div className={cartao}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <Plus className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
            Criar lead
          </p>
          <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Contato com os campos recebidos. Já existindo (mesmo WhatsApp ou
            e-mail), o existente é reaproveitado e só o que estava vazio é
            preenchido.
          </p>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px] text-zinc-700 dark:text-zinc-200">
        <input
          type="checkbox"
          checked={ligado}
          onChange={(e) => {
            const v = e.target.checked;
            setLigado(v);
            // Ligar sem etapa escolhida não salva ainda: o CHECK da tabela
            // recusaria. Salva quando a etapa for escolhida, logo abaixo.
            if (!v || (funilId && etapaId)) salvar(v, funilId, etapaId);
          }}
          className="size-3.5 rounded border-zinc-300 dark:border-zinc-700"
        />
        Abrir também um card no funil
      </label>

      {ligado && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={rotuloCampo}>Funil</span>
            <select
              value={funilId}
              onChange={(e) => {
                setFunilId(e.target.value);
                setEtapaId("");
              }}
              className={campoTexto}
            >
              <option value="">Escolha…</option>
              {alvos.funis.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={rotuloCampo}>Etapa de entrada</span>
            <select
              value={etapaId}
              onChange={(e) => {
                setEtapaId(e.target.value);
                if (e.target.value) salvar(true, funilId, e.target.value);
              }}
              disabled={!funilId || salvando}
              className={campoTexto}
            >
              <option value="">Escolha…</option>
              {etapasDoFunil.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}
    </div>
  );
}

const ICONE_ACAO = {
  adicionar_tag: TagIcon,
  adicionar_segmento: Blocks,
  inscrever_fluxo: Workflow,
} as const;

function LinhaAcao({ acao }: { acao: DetalheWebhook["acoes"][number] }) {
  const [salvando, iniciar] = useTransition();
  const Icone = ICONE_ACAO[acao.tipo as keyof typeof ICONE_ACAO] ?? Blocks;

  const rotulo =
    acao.tipo === "adicionar_tag"
      ? "Adicionar tag"
      : acao.tipo === "adicionar_segmento"
        ? "Adicionar ao segmento"
        : "Inscrever na automação";

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        <Icone className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
          {acao.alvo_nome ?? "—"}
        </p>
        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {rotulo}
        </p>
      </div>
      <button
        type="button"
        onClick={() => iniciar(() => void excluirAcao(acao.id))}
        disabled={salvando}
        aria-label={`Remover ação ${rotulo}`}
        className="shrink-0 text-zinc-400 transition hover:text-red-500"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

function NovaAcao({
  webhookId,
  alvos,
  temOportunidade,
}: {
  webhookId: string;
  alvos: Alvos;
  temOportunidade: boolean;
}) {
  const [tipo, setTipo] = useState<
    "adicionar_tag" | "adicionar_segmento" | "inscrever_fluxo"
  >("adicionar_tag");
  const [alvoId, setAlvoId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const opcoes =
    tipo === "adicionar_tag"
      ? alvos.tags
      : tipo === "adicionar_segmento"
        ? alvos.segmentos
        : alvos.fluxos;

  // Fluxo de oportunidade só funciona se a webhook criar oportunidade — senão
  // não há o que inscrever. Dizer isso na hora de escolher é melhor que
  // descobrir no log do primeiro lead.
  const fluxoEscolhido = alvos.fluxos.find((f) => f.id === alvoId);
  const incompativel =
    tipo === "inscrever_fluxo" &&
    fluxoEscolhido?.entidade_alvo === "oportunidade" &&
    !temOportunidade;

  function adicionar() {
    if (!alvoId) return;
    setErro(null);
    iniciar(async () => {
      try {
        await adicionarAcao(webhookId, tipo, alvoId);
        setAlvoId("");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao adicionar ação");
      }
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={rotuloCampo}>Depois de criar o lead</span>
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as typeof tipo);
              setAlvoId("");
            }}
            className={campoTexto}
          >
            <option value="adicionar_tag">Adicionar tag</option>
            <option value="adicionar_segmento">Adicionar ao segmento</option>
            <option value="inscrever_fluxo">Inscrever na automação</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={rotuloCampo}>Qual</span>
          <select
            value={alvoId}
            onChange={(e) => setAlvoId(e.target.value)}
            className={campoTexto}
          >
            <option value="">
              {opcoes.length === 0
                ? tipo === "inscrever_fluxo"
                  ? "Nenhuma automação publicada"
                  : "Nenhum cadastrado"
                : "Escolha…"}
            </option>
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={adicionar}
          disabled={!alvoId || salvando || incompativel}
          className={botao}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Ação
        </button>
      </div>

      {incompativel && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Essa automação é de oportunidade. Ligue “abrir também um card no
          funil” acima, senão não há o que inscrever.
        </p>
      )}
      {erro && <p className="mt-2 text-xs text-red-500">{erro}</p>}
    </>
  );
}
