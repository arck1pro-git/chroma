"use client";

// Uma linha da folha do mês (./tabela-da-folha.tsx), com o tipo, o valor hora,
// o valor mês (a referência do fixo) e o PIX editáveis ali mesmo (pedido dele,
// 2026-11-03). Os campos não têm borda até passar o mouse ou focar, e o que
// muda é salvo sozinho (./campos.tsx, useSalvarSozinho): um instante depois da
// última tecla, ou quando o foco sai da linha. O que está digitado sobe para a
// tabela na hora, e os totais acompanham.
//
// Grava a foto do mês aberto (lib/financeiro-pagamentos.ts, salvarLinha). A
// taxa de deslocamento vai junto, como estava: ela se muda na ficha.
//
// Sem a permissão de editar, ou com a ficha da pessoa aberta em cima (para não
// haver dois lugares editando o mesmo), a linha é só para ler.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { lerReais, paraCampo, reais, type TipoPagamento, type ValoresPagamento, type contaDoMes } from "@/lib/financeiro-tipos";
import { salvarPagamentoDaLinha } from "./acoes";
import { AlternarTipo, CampoReais, CopiarPix, IndicadorSalvamento, useSalvarSozinho } from "./campos";
import { endereco, horas } from "./comum";
import type { LinhaFolha } from "./tabela-da-folha";

type Campos = { tipo: TipoPagamento | ""; valorHora: string; valorMes: string; pix: string };

function camposDe(l: LinhaFolha): Campos {
  return { tipo: l.valores?.tipo ?? "", valorHora: paraCampo(l.valores?.valorHora ?? null), valorMes: paraCampo(l.valores?.valorMes ?? null), pix: l.pix ?? "" };
}

const apagado = "text-zinc-400 dark:text-zinc-500";

export default function LinhaDaFolha({
  mes,
  linha,
  conta,
  ativa,
  podeEditar,
  aoMudar,
}: {
  mes: string;
  linha: LinhaFolha;
  conta: ReturnType<typeof contaDoMes>;
  ativa: boolean;
  podeEditar: boolean;
  aoMudar: (id: string, v: ValoresPagamento | null) => void;
}) {
  const editavel = podeEditar && !ativa;
  const [campos, setCampos] = useState<Campos>(() => camposDe(linha));
  const [salvos, setSalvos] = useState<Campos>(() => camposDe(linha));
  // Os últimos valores gravados: é o que fica na conta enquanto a linha está incompleta.
  const [vigentes, setVigentes] = useState<ValoresPagamento | null>(linha.valores);
  const muda = (parcial: Partial<Campos>) => setCampos((c) => ({ ...c, ...parcial }));

  const vh = lerReais(campos.valorHora);
  const vm = lerReais(campos.valorMes);
  const taxa = linha.valores?.taxaDeslocamento ?? null;
  // O que vale agora na tela, se está completo; senão, o que estava salvo continua na conta.
  const valores = useMemo<ValoresPagamento | null>(() => {
    if (!campos.tipo || vh === undefined || vm === undefined) return null;
    if (campos.tipo === "hora" && vh === null) return null;
    if (campos.tipo === "fixo" && vm === null) return null;
    return { tipo: campos.tipo, valorHora: vh, valorMes: vm, taxaDeslocamento: taxa };
  }, [campos.tipo, vh, vm, taxa]);
  const falta = !campos.tipo
    ? "escolha hora ou fixo"
    : vh === undefined || vm === undefined
      ? "valor inválido"
      : campos.tipo === "hora" && vh === null
        ? "falta o valor hora"
        : campos.tipo === "fixo" && vm === null
          ? "falta o valor mês"
          : null;
  const mudou = campos.tipo !== salvos.tipo || campos.valorHora !== salvos.valorHora || campos.valorMes !== salvos.valorMes || campos.pix !== salvos.pix;

  const { id } = linha.pessoa;
  useEffect(() => {
    if (editavel) aoMudar(id, valores ?? vigentes);
  }, [editavel, id, valores, vigentes, aoMudar]);

  const { estado, erro, agora } = useSalvarSozinho({
    pronto: editavel && mudou && valores !== null,
    assinatura: JSON.stringify(campos),
    gravar: async () => {
      const enviado = campos;
      const valoresEnviados = valores;
      const r = await salvarPagamentoDaLinha({ mes, pessoaId: id, tipo: enviado.tipo, valorHora: vh, valorMes: vm, taxaDeslocamento: taxa, pix: enviado.pix });
      if (r.ok) {
        setSalvos(enviado);
        setVigentes(valoresEnviados);
      }
      return r;
    },
  });

  const adicionais = conta.deslocamento + conta.adicional;

  return (
    <tr
      className={`align-top transition-colors ${ativa ? "bg-sky-50/60 dark:bg-sky-500/5" : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30"}`}
      onBlur={(e) => {
        // O foco saiu da linha (não só pulou de um campo para outro dela): salva já.
        if (editavel && !e.currentTarget.contains(e.relatedTarget as Node | null)) void agora();
      }}
      onKeyDown={(e) => {
        if (editavel && e.key === "Enter") void agora();
      }}
    >
      <td className="max-w-44 py-2 pl-4 pr-2">
        <Link href={endereco(mes, id)} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100" title="Abrir a ficha: setor, deslocamento e lançamentos do mês">
          {linha.pessoa.nome}
        </Link>
        {linha.atividade && <span className="block text-[11.5px] text-zinc-500 dark:text-zinc-400">{linha.atividade}</span>}
        {editavel ? (
          <input
            value={campos.pix}
            onChange={(e) => muda({ pix: e.target.value })}
            maxLength={140}
            placeholder="+ chave PIX"
            aria-label={`PIX de ${linha.pessoa.nome}`}
            className="-ml-1.5 mt-0.5 block w-32 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[11.5px] text-zinc-600 outline-none transition placeholder:text-zinc-400 hover:border-zinc-200 hover:bg-white focus:border-zinc-300 focus:bg-white dark:text-zinc-300 dark:placeholder:text-zinc-600 dark:hover:border-zinc-700 dark:hover:bg-zinc-950 dark:focus:border-zinc-600 dark:focus:bg-zinc-950"
          />
        ) : linha.pix ? (
          <CopiarPix pix={linha.pix} />
        ) : (
          <span className={`block text-[11px] ${apagado}`}>sem PIX</span>
        )}
        {ativa && podeEditar && <span className="mt-0.5 block text-[11px] text-sky-700 dark:text-sky-400">editando na ficha acima</span>}
      </td>
      <td className="px-1.5 py-2">
        {editavel ? (
          <AlternarTipo compacto valor={campos.tipo} aoMudar={(t) => muda({ tipo: t })} rotulo={`Tipo de ${linha.pessoa.nome}`} />
        ) : (
          <span className="whitespace-nowrap text-zinc-700 dark:text-zinc-300">
            {linha.valores ? (linha.valores.tipo === "hora" ? "Por hora" : "Fixo") : <span className="text-amber-700 dark:text-amber-400">Sem cadastro</span>}
          </span>
        )}
      </td>
      <td className="px-1.5 py-2 text-right">
        {editavel ? (
          <CampoReais fantasma largura="w-20" valor={campos.valorHora} aoMudar={(v) => muda({ valorHora: v })} rotulo={`Valor hora de ${linha.pessoa.nome}`} apagado={campos.tipo === "fixo"} />
        ) : (
          <span className={`whitespace-nowrap tabular-nums ${linha.valores?.tipo === "fixo" ? apagado : "text-zinc-700 dark:text-zinc-300"}`}>
            {linha.valores?.valorHora ? reais(linha.valores.valorHora) : "—"}
          </span>
        )}
      </td>
      <td className="px-1.5 py-2 text-right">
        {editavel ? (
          <CampoReais fantasma largura="w-[5.5rem]" valor={campos.valorMes} aoMudar={(v) => muda({ valorMes: v })} rotulo={`Valor mês de ${linha.pessoa.nome}`} apagado={campos.tipo === "hora"} />
        ) : (
          <span className={`whitespace-nowrap tabular-nums ${linha.valores?.tipo === "hora" ? apagado : "text-zinc-700 dark:text-zinc-300"}`}>
            {linha.valores?.valorMes ? reais(linha.valores.valorMes) : "—"}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-1.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {horas(linha.minutos)}
        {linha.pendencias > 0 && (
          <span className="block text-[11px] text-amber-700 dark:text-amber-400" title="Dias com batida faltando: as horas deles não entram">
            {linha.pendencias} {linha.pendencias === 1 ? "pendência" : "pendências"}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-1.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
        {adicionais ? reais(adicionais) : "—"}
        {conta.deslocamento > 0 && (
          <span className={`block text-[11px] ${apagado}`} title={`Deslocamento: ${linha.presencial} dias presenciais × ${reais(taxa ?? 0)}`}>
            desloc. {reais(conta.deslocamento)}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-1.5 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{linha.descontos ? `− ${reais(linha.descontos)}` : "—"}</td>
      <td className="whitespace-nowrap py-2 pl-1.5 pr-4 text-right tabular-nums">
        <span className="block font-semibold text-zinc-900 dark:text-zinc-50">{conta.total === null ? <span className={`font-normal ${apagado}`}>sem valor</span> : reais(conta.total)}</span>
        {editavel && <IndicadorSalvamento estado={estado} erro={erro} falta={mudou ? falta : null} />}
      </td>
    </tr>
  );
}
