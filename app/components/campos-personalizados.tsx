"use client";

// Exibição dos campos personalizados numa ficha. Duas portas de entrada:
//
//   <ListaCampos>            — já tenho os valores (oportunidade: vêm com a
//                              lista, são 173 linhas)
//   <CamposDoContato>        — busco ao abrir (contato: são 17,8 mil linhas e
//                              carregar o jsonb de todas engordaria a tela que
//                              já demora)
//
// Só mostra campo COM valor: uma ficha com 29 rótulos vazios é ruído, não
// informação. A ordem é a definida em Configurações.
import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { CampoPersonalizado, ValoresPersonalizados } from "../data";
import { camposDoContato } from "../funil/actions";
import { dataCurta } from "../formato";

// Datas chegam em formatos diferentes conforme a origem do dado (ISO do
// SprintHub, "dd/MM/aaaa hh:mm" do export de oportunidades). Formata o que
// reconhece e devolve o texto cru quando não reconhece — melhor mostrar o
// valor original do que "Invalid Date".
function formatar(valor: string, tipo: CampoPersonalizado["tipo"]) {
  if (tipo !== "data") return valor;
  if (/^\d{4}-\d{2}-\d{2}/.test(valor)) return dataCurta(valor);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(valor);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  return valor;
}

export function ListaCampos({
  definicoes,
  valores,
  titulo = "Campos personalizados",
}: {
  definicoes: CampoPersonalizado[];
  valores: ValoresPersonalizados | undefined;
  titulo?: string;
}) {
  const preenchidos = definicoes.filter((d) => {
    const v = valores?.[d.chave];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });

  if (preenchidos.length === 0) return null;

  return (
    <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        {titulo}
        <span className="tabular-nums text-zinc-300 dark:text-zinc-600">
          {preenchidos.length}
        </span>
      </h3>

      {/* dl em duas colunas: rótulo à esquerda, valor à direita. Valor longo
          (resumo do SDR, por exemplo) quebra em vez de estourar a gaveta. */}
      <dl className="flex flex-col gap-2">
        {preenchidos.map((d) => (
          <div key={d.id} className="flex gap-3 text-[12px]">
            <dt className="w-2/5 shrink-0 text-zinc-500 dark:text-zinc-400">
              {d.rotulo}
            </dt>
            <dd className="min-w-0 flex-1 break-words text-zinc-800 dark:text-zinc-200">
              {formatar(String(valores?.[d.chave] ?? ""), d.tipo)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function CamposDoContato({
  contatoId,
  definicoes,
}: {
  contatoId: string;
  definicoes: CampoPersonalizado[];
}) {
  const [valores, setValores] = useState<ValoresPersonalizados | null>(null);

  useEffect(() => {
    let vivo = true;
    setValores(null);
    camposDoContato(contatoId)
      .then((v) => vivo && setValores(v))
      // Falhou? Trata como "sem campos" — a ficha inteira não pode quebrar por
      // causa de um bloco complementar.
      .catch(() => vivo && setValores({}));
    return () => {
      vivo = false;
    };
  }, [contatoId]);

  if (valores === null) return null;
  return <ListaCampos definicoes={definicoes} valores={valores} />;
}
