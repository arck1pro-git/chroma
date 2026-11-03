"use client";

// Uma linha da folha do mês (./folha.tsx) com o pagamento editável ali mesmo
// (pedido dele, 2026-11-03: "nessa aba de folha possa colocar esses dados de
// pix, valor hora, tipo e valor referência"): o tipo, o valor hora, o valor mês
// (a referência do fixo) e o PIX. O total da linha muda enquanto se digita,
// pela mesma conta do servidor (lib/financeiro-tipos.ts), e o "Salvar" aparece
// quando algo mudou. Setor, atividade, adicional e descontos continuam na ficha
// do colaborador (clicar no nome).
//
// Sem a permissão de editar, a linha é só para ler. Os totais do setor e o
// geral são do servidor: atualizam depois de salvar.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { contaDoMes, lerReais, paraCampo, reais, type CadastroPagamento, type LancamentoMes, type TipoPagamento } from "@/lib/financeiro-tipos";
import { Check, Loader2 } from "@/app/components/icones";
import { salvarPagamentoDaLinha } from "./acoes";
import { endereco, horas } from "./comum";
import { CopiarPix } from "./editar-folha";

export type DadosDaLinha = {
  pessoa: { id: string; nome: string };
  cadastro: CadastroPagamento | null;
  lancamento: LancamentoMes;
  minutos: number;
  pendencias: number;
};

const campo =
  "rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-[12px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-zinc-100/10";

export default function LinhaDaFolha({ mes, linha, ativa, podeEditar }: { mes: string; linha: DadosDaLinha; ativa: boolean; podeEditar: boolean }) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const c = linha.cadastro;
  // O "inicial" sai das props a cada render: depois de salvar, o refresh traz o cadastro novo e o Salvar apaga sozinho.
  const inicial: { tipo: TipoPagamento | ""; valorHora: string; valorMes: string; pix: string } = {
    tipo: c?.tipo ?? "",
    valorHora: paraCampo(c?.valorHora ?? null),
    valorMes: paraCampo(c?.valorMes ?? null),
    pix: c?.pix ?? "",
  };
  const [tipo, setTipo] = useState<TipoPagamento | "">(inicial.tipo);
  const [valorHora, setValorHora] = useState(inicial.valorHora);
  const [valorMes, setValorMes] = useState(inicial.valorMes);
  const [pix, setPix] = useState(inicial.pix);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const vh = lerReais(valorHora);
  const vm = lerReais(valorMes);
  const mudou = tipo !== inicial.tipo || valorHora !== inicial.valorHora || valorMes !== inicial.valorMes || pix !== inicial.pix;
  const conta = contaDoMes(tipo ? { tipo, valorHora: vh ?? null, valorMes: vm ?? null } : null, linha.minutos, linha.lancamento);

  function salvar() {
    setErro(null);
    setSalvo(false);
    if (!tipo) return setErro("Escolha por hora ou fixo.");
    if (vh === undefined || vm === undefined) return setErro("Valor em reais inválido (ex.: 1.500,00).");
    iniciar(async () => {
      const r = await salvarPagamentoDaLinha({ pessoaId: linha.pessoa.id, tipo, valorHora: vh, valorMes: vm, pix });
      if (!r.ok) return setErro(r.erro);
      setSalvo(true);
      router.refresh();
    });
  }

  const apagado = "text-zinc-400 dark:text-zinc-500";
  const ler = (v: number | null, esmaecer: boolean) => <span className={esmaecer ? apagado : undefined}>{v === null || v === 0 ? "—" : reais(v)}</span>;

  return (
    <tr className={`align-top ${ativa ? "bg-zinc-50 dark:bg-zinc-800/60" : ""}`}>
      <td className="px-4 py-2">
        <Link href={endereco(mes, linha.pessoa.id)} className="block font-medium text-zinc-900 hover:underline dark:text-zinc-100" title="Abrir a ficha: setor, atividade, adicional e descontos">
          {linha.pessoa.nome}
        </Link>
        {c?.atividade && <span className="block text-[12px] text-zinc-600 dark:text-zinc-400">{c.atividade}</span>}
        {podeEditar ? (
          <input value={pix} onChange={(e) => setPix(e.target.value)} maxLength={140} placeholder="Chave PIX" aria-label={`PIX de ${linha.pessoa.nome}`} className={`${campo} mt-1 w-36`} />
        ) : c?.pix ? (
          <CopiarPix pix={c.pix} />
        ) : (
          <span className={`block text-[11px] ${apagado}`}>sem PIX</span>
        )}
      </td>
      <td className="px-1.5 py-2">
        {podeEditar ? (
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoPagamento | "")} aria-label={`Tipo de ${linha.pessoa.nome}`} className={`${campo} w-20`}>
            <option value="">—</option>
            <option value="hora">Por hora</option>
            <option value="fixo">Fixo</option>
          </select>
        ) : (
          <span className="whitespace-nowrap text-zinc-700 dark:text-zinc-300">
            {c ? (c.tipo === "hora" ? "Por hora" : "Fixo") : <span className="text-amber-700 dark:text-amber-400">Sem cadastro</span>}
          </span>
        )}
      </td>
      <td className="px-1.5 py-2 text-right">
        {podeEditar ? (
          <input
            value={valorHora}
            onChange={(e) => setValorHora(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            aria-label={`Valor hora de ${linha.pessoa.nome}`}
            className={`${campo} w-[4.5rem] text-right tabular-nums ${tipo === "fixo" ? apagado : ""}`}
          />
        ) : (
          <span className="whitespace-nowrap tabular-nums text-zinc-700 dark:text-zinc-300">{ler(c?.valorHora ?? null, c?.tipo === "fixo")}</span>
        )}
      </td>
      <td className="px-1.5 py-2 text-right">
        {podeEditar ? (
          <input
            value={valorMes}
            onChange={(e) => setValorMes(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            aria-label={`Valor mês de ${linha.pessoa.nome}`}
            className={`${campo} w-20 text-right tabular-nums ${tipo === "hora" ? apagado : ""}`}
          />
        ) : (
          <span className="whitespace-nowrap tabular-nums text-zinc-700 dark:text-zinc-300">{ler(c?.valorMes ?? null, c?.tipo === "hora")}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {horas(linha.minutos)}
        {linha.pendencias > 0 && (
          <span className="block text-[11px] text-amber-700 dark:text-amber-400" title="Dias com batida faltando: as horas deles não entram">
            {linha.pendencias} {linha.pendencias === 1 ? "pendência" : "pendências"}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{ler(linha.lancamento.adicional, false)}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {linha.lancamento.descontos ? `− ${reais(linha.lancamento.descontos)}` : "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
        <span className="block font-semibold text-zinc-900 dark:text-zinc-50">{conta.total === null ? <span className={`font-normal ${apagado}`}>sem valor</span> : reais(conta.total)}</span>
        {podeEditar && mudou && (
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {salvando && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
            Salvar
          </button>
        )}
        {salvo && !mudou && (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <Check className="size-3" aria-hidden="true" />
            Salvo
          </span>
        )}
        {erro && (
          <span role="alert" className="mt-1 block max-w-40 whitespace-normal text-[11px] text-red-600 dark:text-red-400">
            {erro}
          </span>
        )}
      </td>
    </tr>
  );
}
