"use client";

// O pagamento de um colaborador, na ficha dele (aba Ponto, ?pessoa=<id>): o
// cadastro (setor, atividade principal, por hora ou fixo, valor hora, valor
// mês, PIX) e o adicional e os descontos do mês aberto. A conta ao lado muda
// enquanto se digita, pela mesma `contaDoMes` que o servidor usa
// (lib/financeiro-tipos.ts). Sem a permissão de editar, os campos ficam só
// para ler.
//
// Valores em reais como se escreve no Brasil ("1.500,00", "25,5" ou "25.50"),
// lidos por lerReais (lib/financeiro-tipos.ts).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  contaDoMes,
  lerReais,
  paraCampo,
  reais,
  type CadastroPagamento,
  type LancamentoMes,
  type TipoPagamento,
} from "@/lib/financeiro-tipos";
import { Check, Copy, Loader2 } from "@/app/components/icones";
import { salvarLinhaDaFolha } from "./acoes";

const campo =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";
const rotulo = "mb-1 block text-[12px] font-medium text-zinc-600 dark:text-zinc-400";

/** O PIX com o botão de copiar, para quem vai pagar. */
export function CopiarPix({ pix }: { pix: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(pix).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        });
      }}
      className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      title="Copiar a chave PIX"
    >
      {copiado ? <Check className="size-3 shrink-0 text-emerald-500" aria-hidden="true" /> : <Copy className="size-3 shrink-0" aria-hidden="true" />}
      <span className="truncate">PIX {pix}</span>
    </button>
  );
}

export default function EditarFolha({
  mes,
  mesNome,
  pessoaId,
  minutos,
  horasTexto,
  cadastro,
  lancamento,
  setores,
  podeEditar,
}: {
  mes: string;
  mesNome: string;
  pessoaId: string;
  minutos: number;
  horasTexto: string;
  cadastro: CadastroPagamento | null;
  lancamento: LancamentoMes;
  setores: string[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [setor, setSetor] = useState(cadastro?.setor ?? "");
  const [atividade, setAtividade] = useState(cadastro?.atividade ?? "");
  const [tipo, setTipo] = useState<TipoPagamento>(cadastro?.tipo ?? "hora");
  const [valorHora, setValorHora] = useState(paraCampo(cadastro?.valorHora ?? null));
  const [valorMes, setValorMes] = useState(paraCampo(cadastro?.valorMes ?? null));
  const [pix, setPix] = useState(cadastro?.pix ?? "");
  const [adicional, setAdicional] = useState(lancamento.adicional ? paraCampo(lancamento.adicional) : "");
  const [descontos, setDescontos] = useState(lancamento.descontos ? paraCampo(lancamento.descontos) : "");

  const vh = lerReais(valorHora);
  const vm = lerReais(valorMes);
  const ad = lerReais(adicional);
  const de = lerReais(descontos);
  const invalido = [vh, vm, ad, de].some((v) => v === undefined);
  const conta = contaDoMes({ tipo, valorHora: vh ?? null, valorMes: vm ?? null }, minutos, { adicional: ad ?? 0, descontos: de ?? 0 });

  function salvar() {
    setErro(null);
    setSalvo(false);
    if (invalido) return setErro("Algum valor não é um número em reais (ex.: 1.500,00).");
    iniciar(async () => {
      const r = await salvarLinhaDaFolha({
        mes,
        pessoaId,
        setor,
        atividade,
        tipo,
        valorHora: vh,
        valorMes: vm,
        pix,
        adicional: ad,
        descontos: de,
      });
      if (!r.ok) return setErro(r.erro);
      setSalvo(true);
      router.refresh();
    });
  }

  const botaoTipo = (valor: TipoPagamento, texto: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={tipo === valor}
      disabled={!podeEditar}
      onClick={() => setTipo(valor)}
      className={`flex-1 rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition ${
        tipo === valor
          ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-zinc-800 dark:text-zinc-50 dark:shadow-none"
          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {texto}
    </button>
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-[13px] font-semibold text-zinc-900 dark:text-zinc-50">
        Pagamento
        {!podeEditar && <span className="font-normal text-zinc-400 dark:text-zinc-500"> · só para ver (editar pede a permissão no módulo)</span>}
      </h2>
      <fieldset disabled={!podeEditar} className="contents">

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={rotulo}>Setor</span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} list="setores-folha" maxLength={80} placeholder="Ex.: Marketing" className={campo} />
            <datalist id="setores-folha">
              {setores.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            <span className={rotulo}>Atividade principal</span>
            <input value={atividade} onChange={(e) => setAtividade(e.target.value)} maxLength={120} placeholder="Ex.: Editor de vídeo" className={campo} />
          </label>
          <div className="sm:col-span-2">
            <span className={rotulo}>Como recebe</span>
            <div role="radiogroup" aria-label="Como recebe" className="flex max-w-xs gap-0.5 rounded-[10px] bg-zinc-100 p-[3px] ring-1 ring-inset ring-zinc-200/80 dark:bg-zinc-950 dark:ring-zinc-800">
              {botaoTipo("hora", "Por hora")}
              {botaoTipo("fixo", "Fixo")}
            </div>
          </div>
          <label>
            <span className={rotulo}>Valor hora {tipo === "hora" && <span className="font-normal text-zinc-400">· usado na conta</span>}</span>
            <input value={valorHora} onChange={(e) => setValorHora(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${campo} tabular-nums`} />
          </label>
          <label>
            <span className={rotulo}>Valor mês {tipo === "fixo" && <span className="font-normal text-zinc-400">· usado na conta</span>}</span>
            <input value={valorMes} onChange={(e) => setValorMes(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${campo} tabular-nums`} />
          </label>
          <label className="sm:col-span-2">
            <span className={rotulo}>Chave PIX</span>
            <input value={pix} onChange={(e) => setPix(e.target.value)} maxLength={140} placeholder="CPF, e-mail, celular ou chave aleatória" className={campo} />
          </label>
          <p className="text-[12px] font-semibold text-zinc-900 sm:col-span-2 dark:text-zinc-50">Lançamentos de {mesNome.toLowerCase()}</p>
          <label>
            <span className={rotulo}>Adicional (deslocamento ou ajuda de custo)</span>
            <input value={adicional} onChange={(e) => setAdicional(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${campo} tabular-nums`} />
          </label>
          <label>
            <span className={rotulo}>Descontos</span>
            <input value={descontos} onChange={(e) => setDescontos(e.target.value)} inputMode="decimal" placeholder="0,00" className={`${campo} tabular-nums`} />
          </label>
        </div>

        <aside className="flex flex-col gap-1.5 rounded-xl bg-zinc-50 p-4 text-[13px] dark:bg-zinc-950">
          <p className="mb-1 text-[12px] font-semibold text-zinc-900 dark:text-zinc-50">A conta de {mesNome.toLowerCase()}</p>
          <p className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
            <span>Referência</span>
            <span className="tabular-nums">{horasTexto}</span>
          </p>
          <p className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
            <span>{tipo === "hora" ? "Horas × valor hora" : "Valor fixo do mês"}</span>
            <span className="tabular-nums">{conta.base === null ? "—" : reais(conta.base)}</span>
          </p>
          <p className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
            <span>+ Adicional</span>
            <span className="tabular-nums">{reais(conta.adicional)}</span>
          </p>
          <p className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
            <span>− Descontos</span>
            <span className="tabular-nums">{reais(conta.descontos)}</span>
          </p>
          <p className="mt-1 flex justify-between gap-2 border-t border-zinc-200 pt-2 font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
            <span>Total do profissional</span>
            <span className="tabular-nums">{conta.total === null ? "—" : reais(conta.total)}</span>
          </p>
          {erro && (
            <p role="alert" className="mt-2 text-[12px] text-red-600 dark:text-red-400">
              {erro}
            </p>
          )}
          {podeEditar && (
            <div className="mt-auto flex items-center gap-2 pt-3">
              <button
                type="button"
                onClick={salvar}
                disabled={salvando}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {salvando && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                Salvar
              </button>
              {salvo && !salvando && (
                <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400">
                  <Check className="size-3" aria-hidden="true" />
                  Salvo
                </span>
              )}
            </div>
          )}
        </aside>
      </div>
      </fieldset>
    </section>
  );
}
