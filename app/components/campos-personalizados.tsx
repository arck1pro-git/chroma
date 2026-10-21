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
import type { CampoPersonalizado, ValoresPersonalizados } from "@/lib/entidades";
import { Propriedade, Propriedades, Secao } from "./gaveta";
import { camposDoContato } from "../funil/actions";
import { dataCurta } from "@/lib/formato";

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

  // Rótulo à esquerda, valor à direita — as mesmas Propriedades do resto da
  // gaveta. Valor longo (resumo do SDR, por exemplo) quebra em vez de estourar.
  return (
    <Secao titulo={titulo} contagem={preenchidos.length}>
      <Propriedades>
        {preenchidos.map((d) => (
          <Propriedade key={d.id} rotulo={d.rotulo}>
            <span className="min-w-0">{formatar(String(valores?.[d.chave] ?? ""), d.tipo)}</span>
          </Propriedade>
        ))}
      </Propriedades>
    </Secao>
  );
}

export function CamposDoContato({
  contatoId,
  definicoes,
}: {
  contatoId: string;
  definicoes: CampoPersonalizado[];
}) {
  // Os valores guardam DE QUEM são. Trocar de contato não precisa zerar nada no
  // efeito: o que ficou é de outro contatoId e simplesmente deixa de valer —
  // sem o reset síncrono, que pintava um quadro a mais antes da busca.
  const [carregado, setCarregado] = useState<{
    contatoId: string;
    valores: ValoresPersonalizados;
  } | null>(null);

  useEffect(() => {
    let vivo = true;
    camposDoContato(contatoId)
      .then((v) => vivo && setCarregado({ contatoId, valores: v }))
      // Falhou? Trata como "sem campos" — a ficha inteira não pode quebrar por
      // causa de um bloco complementar.
      .catch(() => vivo && setCarregado({ contatoId, valores: {} }));
    return () => {
      vivo = false;
    };
  }, [contatoId]);

  const valores = carregado?.contatoId === contatoId ? carregado.valores : null;
  if (valores === null) return null;
  return <ListaCampos definicoes={definicoes} valores={valores} />;
}
