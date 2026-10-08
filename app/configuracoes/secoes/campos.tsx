"use client";

// Campos personalizados da ficha de contato e da de oportunidade.
//
// A `chave` é derivada do rótulo e NUNCA muda: é ela que indexa o valor dentro
// do jsonb de cada registro (ver ../actions.ts). Por isso a tela só deixa
// editar o rótulo — renomear a chave orfanaria todo valor já gravado.
//
// O DESENHO (redesenho de 2026-10-08): as duas fichas viram abas com contagem,
// acima do painel; o tipo é escolhido em quatro botões com ícone (era um
// <select> de quatro opções, que escondia a escolha mais importante do campo);
// as opções de um campo "Opções" aparecem como etiquetas, que é como a ficha
// vai mostrá-las.
import { useState, useTransition } from "react";
import {
  Briefcase,
  CalendarDays,
  Check,
  Hash,
  ListChecks,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { CampoPersonalizado } from "../dados";
import {
  criarCampoPersonalizado,
  editarCampoPersonalizado,
  excluirCampoPersonalizado,
} from "../actions";
import { botao, botaoFantasma, campoTexto, rotuloCampo, textoAjuda } from "./ui";
import { BotaoIcone, Cabecalho, Erro, Painel, Vazio } from "./pecas";

const TIPOS_CAMPO: { valor: CampoPersonalizado["tipo"]; rotulo: string; Icone: LucideIcon }[] = [
  { valor: "texto", rotulo: "Texto", Icone: Type },
  { valor: "numero", rotulo: "Número", Icone: Hash },
  { valor: "data", rotulo: "Data", Icone: CalendarDays },
  { valor: "opcao", rotulo: "Opções", Icone: ListChecks },
];

function tipoDe(valor: string) {
  return TIPOS_CAMPO.find((t) => t.valor === valor) ?? TIPOS_CAMPO[0];
}

const FICHAS = [
  { chave: "contato", rotulo: "Contato", Icone: UserRound },
  { chave: "oportunidade", rotulo: "Oportunidade", Icone: Briefcase },
] as const;

/** As opções digitadas ("a, b, c") como a lista que vai para o banco. */
function separarOpcoes(texto: string) {
  return texto
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function CamposSection({ campos }: { campos: CampoPersonalizado[] }) {
  const [entidade, setEntidade] = useState<"contato" | "oportunidade">("contato");
  const daEntidade = campos.filter((c) => c.entidade === entidade);
  const ficha = FICHAS.find((f) => f.chave === entidade)!;

  return (
    <section className="flex flex-col gap-6">
      <Cabecalho
        Icone={SlidersHorizontal}
        titulo="Campos personalizados"
        contagem={campos.length}
        descricao="O que varia de lead para lead e não cabe numa coluna fixa — perguntas de formulário, faixa de investimento, qualificação. Cada ficha tem a sua lista."
      />

      {/* As duas fichas como abas: um campo de contato não aparece na
          oportunidade e vice-versa. */}
      <div
        role="tablist"
        aria-label="Ficha"
        className="flex w-fit gap-1 rounded-xl border border-zinc-200 bg-zinc-100/70 p-1 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {FICHAS.map(({ chave, rotulo, Icone }) => {
          const ativo = entidade === chave;
          const quantos = campos.filter((c) => c.entidade === chave).length;
          return (
            <button
              key={chave}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => setEntidade(chave)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${
                ativo
                  ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-50 dark:ring-zinc-700"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              <Icone className="size-3.5" aria-hidden="true" />
              {rotulo}
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  ativo
                    ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                    : "text-zinc-400"
                }`}
              >
                {quantos}
              </span>
            </button>
          );
        })}
      </div>

      <Painel className="overflow-hidden">
        {/* key pela ficha: trocar de aba limpa o rascunho do campo novo, que
            pertencia à outra ficha. */}
        <NovoCampo key={entidade} entidade={entidade} rotuloFicha={ficha.rotulo} />

        {daEntidade.length === 0 ? (
          <Vazio
            Icone={ficha.Icone}
            titulo={`A ficha de ${ficha.rotulo.toLowerCase()} ainda não tem campos`}
            texto="Crie o primeiro acima. Ele aparece na ficha logo em seguida, e a IA passa a enxergar o valor preenchido."
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {daEntidade.map((c) => (
              <CampoRow key={c.id} campo={c} />
            ))}
          </ul>
        )}
      </Painel>
    </section>
  );
}

// ── Escolha do tipo ─────────────────────────────────────────────────────────
function SeletorTipo({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (tipo: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Tipo do campo" className="grid grid-cols-4 gap-1.5">
      {TIPOS_CAMPO.map(({ valor: v, rotulo, Icone }) => {
        const ativo = v === valor;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => aoMudar(v)}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium transition ${
              ativo
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-50"
            }`}
          >
            <Icone className="size-3.5" aria-hidden="true" />
            {rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** As opções digitadas, já como etiquetas — o jeito que a ficha vai mostrar. */
function PreviaOpcoes({ texto }: { texto: string }) {
  const opcoes = separarOpcoes(texto);
  if (opcoes.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {opcoes.map((o, i) => (
        <span
          key={`${o}-${i}`}
          className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
        >
          {o}
        </span>
      ))}
    </div>
  );
}

// ── Criar ───────────────────────────────────────────────────────────────────
function NovoCampo({
  entidade,
  rotuloFicha,
}: {
  entidade: "contato" | "oportunidade";
  rotuloFicha: string;
}) {
  const [rotulo, setRotulo] = useState("");
  const [tipo, setTipo] = useState<string>("texto");
  const [opcoes, setOpcoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function criar() {
    const r = rotulo.trim();
    if (!r) return;
    setErro(null);
    iniciar(async () => {
      try {
        await criarCampoPersonalizado(entidade, r, tipo, opcoes);
        setRotulo("");
        setOpcoes("");
        setTipo("texto");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao criar campo");
      }
    });
  }

  return (
    <div className="@container border-b border-zinc-100 bg-zinc-50/50 p-5 dark:border-zinc-800/80 dark:bg-zinc-900/20">
      <p className="mb-3 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
        Novo campo na ficha de {rotuloFicha.toLowerCase()}
      </p>
      <div className="grid gap-3 @3xl:grid-cols-[1fr_auto_auto]">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={rotuloCampo}>Nome</span>
          <input
            type="text"
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder="Ex.: Faixa de investimento"
            className={campoTexto}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={rotuloCampo}>Tipo</span>
          <SeletorTipo valor={tipo} aoMudar={setTipo} />
        </div>
        <button
          type="button"
          onClick={criar}
          disabled={!rotulo.trim() || salvando}
          className={`${botao} self-end justify-self-end`}
        >
          <Plus className="size-4" aria-hidden="true" />
          {salvando ? "Criando…" : "Criar"}
        </button>
      </div>

      {tipo === "opcao" && (
        <label className="mt-3 flex flex-col gap-1.5">
          <span className={rotuloCampo}>
            Opções <span className="font-normal text-zinc-400">· separadas por vírgula</span>
          </span>
          <input
            type="text"
            value={opcoes}
            onChange={(e) => setOpcoes(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criar()}
            placeholder="até 50 mil, 50 a 100 mil, acima de 100 mil"
            className={campoTexto}
          />
          <PreviaOpcoes texto={opcoes} />
        </label>
      )}

      {erro && (
        <div className="mt-3">
          <Erro>{erro}</Erro>
        </div>
      )}
    </div>
  );
}

// ── Um campo ────────────────────────────────────────────────────────────────
function CampoRow({ campo }: { campo: CampoPersonalizado }) {
  const [editando, setEditando] = useState(false);
  const [rotulo, setRotulo] = useState(campo.rotulo);
  const [tipo, setTipo] = useState<string>(campo.tipo);
  const [opcoes, setOpcoes] = useState(campo.opcoes.join(", "));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const { Icone, rotulo: rotuloTipo } = tipoDe(campo.tipo);

  function salvar() {
    const r = rotulo.trim();
    if (!r) return;
    setErro(null);
    iniciar(async () => {
      try {
        await editarCampoPersonalizado(campo.id, r, tipo, opcoes);
        setEditando(false);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar");
      }
    });
  }

  function cancelar() {
    setRotulo(campo.rotulo);
    setTipo(campo.tipo);
    setOpcoes(campo.opcoes.join(", "));
    setErro(null);
    setEditando(false);
  }

  function remover() {
    if (
      !window.confirm(
        `Excluir o campo "${campo.rotulo}"? Ele some das fichas, mas os valores já preenchidos continuam guardados — recriar um campo com o mesmo nome traz tudo de volta.`,
      )
    )
      return;
    setErro(null);
    iniciar(async () => {
      try {
        await excluirCampoPersonalizado(campo.id);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao excluir");
      }
    });
  }

  if (editando) {
    return (
      <li className="@container bg-zinc-50/60 p-5 dark:bg-zinc-900/30">
        <div className="grid gap-3 @2xl:grid-cols-[1fr_auto]">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={rotuloCampo}>Nome</span>
            <input
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") cancelar();
              }}
              autoFocus
              className={campoTexto}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className={rotuloCampo}>Tipo</span>
            <SeletorTipo valor={tipo} aoMudar={setTipo} />
          </div>
        </div>
        {tipo === "opcao" && (
          <label className="mt-3 flex flex-col gap-1.5">
            <span className={rotuloCampo}>
              Opções <span className="font-normal text-zinc-400">· separadas por vírgula</span>
            </span>
            <input
              value={opcoes}
              onChange={(e) => setOpcoes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") cancelar();
              }}
              className={campoTexto}
            />
            <PreviaOpcoes texto={opcoes} />
          </label>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* A chave não acompanha o nome — dizer isso aqui, onde se renomeia,
              evita a surpresa de ver a chave antiga na IA e nas consultas. */}
          <p className={`${textoAjuda} mr-auto`}>
            A chave <code className="font-mono text-zinc-700 dark:text-zinc-300">{campo.chave}</code> não
            muda ao renomear — é ela que guarda os valores.
          </p>
          <button type="button" onClick={cancelar} className={botaoFantasma}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={salvando || !rotulo.trim()} className={botao}>
            <Check className="size-4" aria-hidden="true" />
            Salvar
          </button>
        </div>
        {erro && (
          <div className="mt-3">
            <Erro>{erro}</Erro>
          </div>
        )}
      </li>
    );
  }

  return (
    <li className="group px-5 py-3 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-400"
          title={rotuloTipo}
        >
          <Icone className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">
            {campo.rotulo}
          </p>
          {/* A chave é o que está gravado no banco — mostro porque ela não muda
              no rename, e é por ela que a IA e as consultas encontram o valor. */}
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            <code className="font-mono">{campo.chave}</code>
            <span aria-hidden="true">·</span>
            <span>{rotuloTipo}</span>
          </p>
          {campo.opcoes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {campo.opcoes.slice(0, 8).map((o) => (
                <span
                  key={o}
                  className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  {o}
                </span>
              ))}
              {campo.opcoes.length > 8 && (
                <span className="px-1 py-0.5 text-[11px] text-zinc-400">
                  +{campo.opcoes.length - 8}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <BotaoIcone rotulo={`Editar ${campo.rotulo}`} onClick={() => setEditando(true)}>
            <Pencil className="size-3.5" aria-hidden="true" />
          </BotaoIcone>
          <BotaoIcone rotulo={`Excluir ${campo.rotulo}`} onClick={remover} disabled={salvando} perigo>
            <Trash2 className="size-3.5" aria-hidden="true" />
          </BotaoIcone>
        </div>
      </div>
      {erro && (
        <div className="mt-2 pl-11">
          <Erro>{erro}</Erro>
        </div>
      )}
    </li>
  );
}
