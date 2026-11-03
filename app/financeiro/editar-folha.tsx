"use client";

// A linha de um colaborador na Folha, para editar: o cadastro de pagamento
// (setor, atividade principal, tipo, valor hora, valor mês, PIX) e o adicional
// e os descontos do mês aberto. A conta ao lado muda enquanto se digita, pela
// mesma `contaDoMes` que o servidor usa (lib/financeiro-tipos.ts).
//
// Valores em reais como se escreve no Brasil: "1.500,00", "25,5" ou "25.50".
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { contaDoMes, reais, type CadastroPagamento, type LancamentoMes, type TipoPagamento } from "@/lib/financeiro-tipos";
import { Check, Copy, Loader2, X } from "@/app/components/icones";
import { salvarLinhaDaFolha } from "./acoes";

const campo =
  "w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";
const rotulo = "mb-1 block text-[12px] font-medium text-zinc-600 dark:text-zinc-400";

/** 25.5 → "25,50" (para o campo). */
function paraCampo(v: number | null): string {
  return v === null ? "" : v.toFixed(2).replace(".", ",");
}

/** O valor digitado em reais: número, null (vazio) ou undefined (não é um valor). */
function lerReais(texto: string): number | null | undefined {
  const s = texto.replace(/[R$\s]/g, "");
  if (!s) return null;
  // Com vírgula, ela é o decimal e os pontos são milhar; sem vírgula, um ponto com até dois dígitos depois é decimal.
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d+\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, "");
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

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
  pessoa,
  minutos,
  horasTexto,
  cadastro,
  lancamento,
  setores,
  fecharHref,
}: {
  mes: string;
  mesNome: string;
  pessoa: { id: string; nome: string; email: string };
  minutos: number;
  horasTexto: string;
  cadastro: CadastroPagamento | null;
  lancamento: LancamentoMes;
  setores: string[];
  fecharHref: string;
}) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
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
    if (invalido) return setErro("Algum valor não é um número em reais (ex.: 1.500,00).");
    iniciar(async () => {
      const r = await salvarLinhaDaFolha({
        mes,
        pessoaId: pessoa.id,
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
      router.push(fecharHref);
      router.refresh();
    });
  }

  const botaoTipo = (valor: TipoPagamento, texto: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={tipo === valor}
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
    <section className="rounded-2xl border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{pessoa.nome}</h2>
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{pessoa.email}</p>
        </div>
        <Link href={fecharHref} className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800" aria-label="Fechar">
          <X className="size-4" aria-hidden="true" />
        </Link>
      </header>

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
          <div className="mt-auto flex gap-2 pt-3">
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {salvando && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Salvar
            </button>
            <Link
              href={fecharHref}
              className="inline-flex items-center rounded-lg border border-zinc-300 px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancelar
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
