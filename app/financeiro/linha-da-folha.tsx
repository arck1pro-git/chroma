"use client";

// Uma linha da folha do mês (./tabela-da-folha.tsx), só para ler: tipo, valor
// hora, valor mês, referência (horas do ponto), adicionais (deslocamento +
// adicional), descontos e o total. Editar não mexe na linha: abre a gaveta do
// pagamento por cima (./gaveta-pagamento.tsx, 2026-11-04, "onde for para
// editar algo ao clicar abre toggle por cima"). O nome também abre a gaveta.
//
// Sem a permissão de editar, não há o botão, e o nome leva ao ponto da pessoa.
// Quem entrou por uma conta do AmaanOffice leva o selo e "sem ponto" na
// referência (2026-11-04).
import Link from "next/link";
import { reais, type contaDoMes } from "@/lib/financeiro-tipos";
import { Check, Lock, Pencil } from "@/app/components/icones";
import { CopiarPix } from "./campos";
import { endereco, horas } from "./comum";
import type { LinhaFolha } from "./tabela-da-folha";

const apagado = "text-zinc-400 dark:text-zinc-500";

/** Quem entrou na folha por uma conta do AmaanOffice e não bate ponto. */
export function SeloAmaanOffice() {
  return (
    <span className="ml-1.5 inline-flex rounded-full bg-zinc-100 px-1.5 py-px align-[1px] text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title="Conta do AmaanOffice, sem ponto">
      AmaanOffice
    </span>
  );
}
const celula = "whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300";

export default function LinhaDaFolha({
  mes,
  mesNome,
  linha,
  conta,
  salva,
  podeEditar,
  aoEditar,
}: {
  mes: string;
  mesNome: string;
  linha: LinhaFolha;
  conta: ReturnType<typeof contaDoMes>;
  /** Acabou de ser salva na gaveta: mostra "Salvo" por um instante. */
  salva: boolean;
  podeEditar: boolean;
  aoEditar: (pessoaId: string) => void;
}) {
  const { id, nome } = linha.pessoa;
  const v = linha.valores;
  const adicionais = conta.deslocamento + conta.adicional;
  const doAmaanOffice = linha.origem === "amaanoffice";

  return (
    <tr className="align-top transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30">
      <td className="max-w-64 py-2.5 pl-4 pr-2">
        {podeEditar ? (
          <button type="button" onClick={() => aoEditar(id)} className="text-left font-medium text-zinc-900 hover:underline dark:text-zinc-100" title="Editar o pagamento">
            {nome}
          </button>
        ) : doAmaanOffice ? (
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{nome}</span>
        ) : (
          <Link href={`${endereco(mes, id)}#ponto`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100" title="Ver o ponto">
            {nome}
          </Link>
        )}
        {doAmaanOffice && <SeloAmaanOffice />}
        {linha.atividade && <span className="block text-[11.5px] text-zinc-500 dark:text-zinc-400">{linha.atividade}</span>}
        {linha.pix ? (
          <span className="block">
            <CopiarPix pix={linha.pix} />
          </span>
        ) : (
          <span className={`block text-[11px] ${apagado}`}>sem PIX</span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-zinc-700 dark:text-zinc-300">
        {v ? (v.tipo === "hora" ? "Por hora" : "Fixo") : <span className="text-amber-700 dark:text-amber-400">Sem cadastro</span>}
        {v && linha.daFoto && (
          <span className={`mt-0.5 flex items-center gap-1 text-[10.5px] ${apagado}`} title={`Valores gravados em ${mesNome.toLowerCase()}`}>
            <Lock className="size-2.5" aria-hidden="true" />
            lançado
          </span>
        )}
      </td>
      <td className={`${celula} ${v?.tipo === "fixo" ? apagado : ""}`}>{v?.valorHora ? reais(v.valorHora) : "—"}</td>
      <td className={`${celula} ${v?.tipo === "hora" ? apagado : ""}`}>{v?.valorMes ? reais(v.valorMes) : "—"}</td>
      <td className={celula}>
        {doAmaanOffice ? <span className={apagado}>sem ponto</span> : horas(linha.minutos)}
        {linha.pendencias > 0 && (
          <span className="block text-[11px] text-amber-700 dark:text-amber-400" title="Dias com batida faltando: as horas deles não entram">
            {linha.pendencias} {linha.pendencias === 1 ? "pendência" : "pendências"}
          </span>
        )}
      </td>
      <td className={celula}>
        {adicionais ? reais(adicionais) : "—"}
        {conta.deslocamento > 0 && (
          <span className={`block text-[11px] ${apagado}`} title={`Deslocamento: ${linha.presencial} dias presenciais × ${reais(v?.taxaDeslocamento ?? 0)}`}>
            desloc. {reais(conta.deslocamento)}
          </span>
        )}
      </td>
      <td className={celula}>{linha.descontos ? `− ${reais(linha.descontos)}` : "—"}</td>
      <td className="whitespace-nowrap py-2.5 pl-2 pr-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {conta.total === null ? <span className={`font-normal ${apagado}`}>sem valor</span> : reais(conta.total)}
        {salva && (
          <span role="status" className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
            <Check className="size-3" aria-hidden="true" />
            Salvo
          </span>
        )}
      </td>
      {podeEditar && (
        <td className="py-2 pl-1 pr-4 text-right">
          <button
            type="button"
            onClick={() => aoEditar(id)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11.5px] font-medium text-zinc-600 shadow-[0_1px_1px_rgba(0,0,0,0.03)] transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
          >
            <Pencil className="size-2.5" aria-hidden="true" />
            Editar
          </button>
        </td>
      )}
    </tr>
  );
}
