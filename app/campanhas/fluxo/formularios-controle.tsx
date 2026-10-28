"use client";

// Os formulários dos blocos de 2026-10-28 que decidem POR ONDE e QUANDO o
// contato segue (pedido dele: "crie mais blocos"): Condição (tag, segmento,
// etapa ou campo do contato; saídas Sim e Não), Horário de envio (dias e
// faixa de horas, em Brasília) e Permissão de passagem (N contatos a cada
// intervalo). O formato e os limites são do contrato (lib/campanhas-fluxo.ts:
// RegraCondicao, LIMITES_FLUXO.passagem*); quem aponta valor fora do limite é
// a validação, como nos outros blocos. Fora de ./painel-bloco.tsx para ele não
// passar de 300 linhas.
import type { BlocoCampanha, RegraCondicao } from "@/lib/campanhas-fluxo";
import { campoAds } from "../pecas";
import { Ajuda, Alternar, Campo, Escolha, FunilEEtapa, Grupo, Numero, QuantidadeComUnidade, UNIDADES_EM_SEGUNDOS } from "./campos";
import type { OpcoesFluxo } from "./grafo";
import { DIAS_DA_SEMANA } from "./tempo";

type Bloco<T extends BlocoCampanha["tipo"]> = Extract<BlocoCampanha, { tipo: T }>;
type TipoDaRegra = RegraCondicao["tipo"];
type Operador = Extract<RegraCondicao, { tipo: "campo" }>["operador"];

const PERGUNTAS: Array<[TipoDaRegra, string]> = [
  ["tem_tag", "Tem a tag"],
  ["no_segmento", "Está no segmento"],
  ["na_etapa", "Está na etapa"],
  ["campo", "Campo do contato"],
];

/** Trocar a pergunta começa a regra do zero: a tag escolhida não vira etapa. */
function regraNova(tipo: TipoDaRegra): RegraCondicao {
  switch (tipo) {
    case "tem_tag":
      return { tipo, tagId: "" };
    case "no_segmento":
      return { tipo, segmentoId: "" };
    case "na_etapa":
      return { tipo, funilId: "", etapaId: "" };
    case "campo":
      return { tipo, chave: "", operador: "preenchido", valor: "" };
  }
}

export function FormularioCondicao({ bloco: b, opcoes: o, mudar }: { bloco: Bloco<"condicao">; opcoes: OpcoesFluxo; mudar: (b: BlocoCampanha) => void }) {
  const r = b.regra;
  const regra = (nova: RegraCondicao) => mudar({ ...b, regra: nova });
  return (
    <div className="space-y-3">
      <Campo rotulo="Pergunta" dica="Conferida quando o contato chega aqui. Sim e Não são as duas saídas.">
        <select className={campoAds} value={r.tipo} onChange={(e) => regra(regraNova(e.target.value as TipoDaRegra))}>
          {PERGUNTAS.map(([tipo, rotulo]) => (
            <option key={tipo} value={tipo}>
              {rotulo}
            </option>
          ))}
        </select>
      </Campo>
      {r.tipo === "tem_tag" && <Escolha rotulo="Tag" valor={r.tagId} opcoes={o.tags} vazio="Escolha a tag" mudar={(tagId) => regra({ ...r, tagId })} />}
      {r.tipo === "no_segmento" && (
        <Escolha rotulo="Segmento" valor={r.segmentoId} opcoes={o.segmentos} vazio="Escolha o segmento" mudar={(segmentoId) => regra({ ...r, segmentoId })} />
      )}
      {r.tipo === "na_etapa" && (
        <FunilEEtapa
          funis={o.funis}
          etapas={o.etapas}
          funilId={r.funilId}
          etapaId={r.etapaId}
          dica="Vale a oportunidade aberta mais recente do contato neste funil."
          mudar={(funilId, etapaId) => regra({ ...r, funilId, etapaId })}
        />
      )}
      {r.tipo === "campo" && (
        <>
          <Escolha
            rotulo="Campo"
            valor={r.chave}
            opcoes={o.camposContato.map((c) => ({ id: c.chave, nome: c.rotulo }))}
            vazio="Escolha o campo"
            mudar={(chave) => regra({ ...r, chave })}
          />
          {!o.camposContato.length && <Ajuda>Nenhum campo personalizado.</Ajuda>}
          <Alternar<Operador>
            rotulo="Como comparar"
            valor={r.operador}
            opcoes={[
              ["preenchido", "Preenchido"],
              ["igual", "É igual a"],
              ["contem", "Contém"],
            ]}
            mudar={(operador) => regra({ ...r, operador, valor: operador === "preenchido" ? "" : r.valor })}
          />
          {r.operador !== "preenchido" && (
            <Campo rotulo="Valor" dica="Maiúscula e acento não contam.">
              <input className={campoAds} value={r.valor} maxLength={200} onChange={(e) => regra({ ...r, valor: e.target.value })} />
            </Campo>
          )}
        </>
      )}
    </div>
  );
}

export function FormularioHorario({ bloco: b, mudar }: { bloco: Bloco<"horario">; mudar: (b: BlocoCampanha) => void }) {
  return (
    <div className="space-y-3">
      <Grupo rotulo="Dias" dica="Fora do horário, o contato espera a próxima abertura. Horário de Brasília.">
        <div className="flex flex-wrap gap-1">
          {DIAS_DA_SEMANA.map(({ dia, rotulo }) => {
            const marcado = b.dias.includes(dia);
            return (
              <button
                key={dia}
                type="button"
                aria-pressed={marcado}
                onClick={() => mudar({ ...b, dias: (marcado ? b.dias.filter((d) => d !== dia) : [...b.dias, dia]).sort((x, y) => x - y) })}
                className={`min-w-10 rounded-md border px-2 py-1 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:opacity-60 dark:focus-visible:ring-zinc-100/20 ${
                  marcado
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {rotulo}
              </button>
            );
          })}
        </div>
      </Grupo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Das">
          {/* Campo apagado não grava: "" quebraria a faixa no meio da edição. */}
          <input type="time" className={campoAds} value={b.das} onChange={(e) => e.target.value && mudar({ ...b, das: e.target.value })} />
        </Campo>
        <Campo rotulo="Até">
          <input type="time" className={campoAds} value={b.ate} onChange={(e) => e.target.value && mudar({ ...b, ate: e.target.value })} />
        </Campo>
      </div>
    </div>
  );
}

export function FormularioPassagem({ bloco: b, mudar }: { bloco: Bloco<"limitar_passagem">; mudar: (b: BlocoCampanha) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-zinc-700 dark:text-zinc-200">
        Deixar passar
        <Numero rotulo="Quantos contatos" valor={b.quantidade} className="w-20" mudar={(quantidade) => mudar({ ...b, quantidade })} />
        contatos a cada
        <QuantidadeComUnidade rotulo="Intervalo" valor={b.janela_segundos} unidades={UNIDADES_EM_SEGUNDOS} mudar={(janela_segundos) => mudar({ ...b, janela_segundos })} />
      </p>
      <Ajuda>O motor confere a cada minuto.</Ajuda>
    </div>
  );
}
