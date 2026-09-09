// Renderiza a resposta da IA com a formatação que o prompt pede: negrito,
// títulos curtos, listas e trechos em `code`.
//
// POR QUE NÃO react-markdown: o subconjunto aqui é fechado — quem escreve o
// texto é o nosso próprio system prompt (app/api/ia/route.ts), que enumera
// exatamente estas marcas. Uma biblioteca de markdown completa traria tabelas,
// HTML embutido, links e imagens; nada disso é pedido, e HTML embutido num
// texto gerado é justamente o que não queremos renderizar.
//
// SEGURANÇA: nada de dangerouslySetInnerHTML. Tudo vira elemento React, então
// não existe caminho de injeção — mesmo que o modelo escreva `<script>`, ele
// sai como texto na tela. Isso importa mais aqui do que em outros lugares: a
// IA lê mensagens de WhatsApp escritas por terceiros (lib/ia/sanitizar.ts), e
// um texto de cliente pode acabar reproduzido na resposta.
//
// STREAMING: o texto chega pela metade, caractere a caractere. Toda regra
// abaixo precisa aguentar marca aberta e não fechada — um `**` solto no fim do
// que chegou até agora fica como texto literal e vira negrito sozinho quando o
// par chegar. É por isso que os padrões exigem o fechamento em vez de tratar a
// marca de abertura como gatilho.

import { Fragment, type ReactNode } from "react";

// Negrito e código na mesma passada. Os dois grupos são alternativos, então a
// ordem no regex decide o desempate quando um `**` aparece dentro de crase —
// código primeiro, para `**` dentro de `code` continuar literal.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;

function inline(texto: string, chave: string): ReactNode[] {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((m = INLINE.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));

    if (m[1]) {
      partes.push(
        <code
          key={`${chave}-c-${m.index}`}
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {m[1].slice(1, -1)}
        </code>,
      );
    } else {
      partes.push(
        <strong
          key={`${chave}-n-${m.index}`}
          className="font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {m[2].slice(2, -2)}
        </strong>,
      );
    }
    ultimo = m.index + m[0].length;
  }

  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

type Bloco =
  | { tipo: "titulo"; texto: string }
  | { tipo: "paragrafo"; texto: string }
  | { tipo: "lista"; ordenada: boolean; itens: string[] };

/**
 * Quebra o texto em blocos. Linha a linha, sem lookahead: é o que permite o
 * mesmo código servir para o texto completo e para o pedaço que chegou até
 * agora no stream.
 */
function blocos(texto: string): Bloco[] {
  const saida: Bloco[] = [];
  // Parágrafo e lista são acumuladores: linhas seguidas do mesmo tipo se
  // juntam, e qualquer outra coisa fecha o que estava aberto.
  let paragrafo: string[] = [];
  let lista: { ordenada: boolean; itens: string[] } | null = null;

  const fecharParagrafo = () => {
    if (paragrafo.length) {
      saida.push({ tipo: "paragrafo", texto: paragrafo.join(" ") });
      paragrafo = [];
    }
  };
  const fecharLista = () => {
    if (lista) {
      saida.push({ tipo: "lista", ...lista });
      lista = null;
    }
  };
  const fecharTudo = () => {
    fecharParagrafo();
    fecharLista();
  };

  for (const bruta of texto.split("\n")) {
    const linha = bruta.trim();

    if (!linha) {
      fecharTudo();
      continue;
    }

    // ## Título (aceita de # a ####; tudo vira o mesmo tamanho — hierarquia de
    // quatro níveis num painel de 26rem não se distingue e só polui).
    const titulo = /^#{1,4}\s+(.*)$/.exec(linha);
    if (titulo) {
      fecharTudo();
      saida.push({ tipo: "titulo", texto: titulo[1] });
      continue;
    }

    const marcador = /^[-*•]\s+(.*)$/.exec(linha);
    const numerada = /^(\d+)[.)]\s+(.*)$/.exec(linha);

    if (marcador || numerada) {
      fecharParagrafo();
      const ordenada = Boolean(numerada);
      const item = marcador ? marcador[1] : numerada![2];
      // Trocar de tipo de lista no meio fecha a anterior: "- a" seguido de
      // "1. b" são duas listas, não uma com itens de marcador misturado.
      if (!lista || lista.ordenada !== ordenada) {
        fecharLista();
        lista = { ordenada, itens: [] };
      }
      lista.itens.push(item);
      continue;
    }

    fecharLista();
    paragrafo.push(linha);
  }

  fecharTudo();
  return saida;
}

/**
 * O texto da IA, formatado.
 *
 * `cursor` acrescenta o traço piscante ao ÚLTIMO bloco — dentro dele, não
 * depois. Solto embaixo, o cursor pularia para uma linha própria a cada
 * parágrafo novo do stream.
 */
export default function TextoIa({
  texto,
  cursor = false,
}: {
  texto: string;
  cursor?: boolean;
}) {
  const partes = blocos(texto);

  return (
    <div className="flex min-w-0 flex-col gap-2.5 text-[14px] leading-[1.65] text-zinc-700 dark:text-zinc-200">
      {partes.map((b, i) => {
        const ultimo = i === partes.length - 1;
        const piscando = cursor && ultimo;

        if (b.tipo === "titulo") {
          return (
            <h3
              key={i}
              className="mt-1 text-[15px] font-semibold leading-snug text-zinc-900 first:mt-0 dark:text-zinc-50"
            >
              {inline(b.texto, `t${i}`)}
              {piscando && <span className="cursor-ia" aria-hidden="true" />}
            </h3>
          );
        }

        if (b.tipo === "lista") {
          const Lista = b.ordenada ? "ol" : "ul";
          return (
            <Lista
              key={i}
              className={`flex flex-col gap-1.5 pl-5 ${
                b.ordenada ? "list-decimal" : "list-disc"
              } marker:text-zinc-400 dark:marker:text-zinc-500`}
            >
              {b.itens.map((item, j) => (
                <li key={j} className="pl-0.5">
                  {inline(item, `l${i}-${j}`)}
                  {piscando && j === b.itens.length - 1 && (
                    <span className="cursor-ia" aria-hidden="true" />
                  )}
                </li>
              ))}
            </Lista>
          );
        }

        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            <Fragment>{inline(b.texto, `p${i}`)}</Fragment>
            {piscando && <span className="cursor-ia" aria-hidden="true" />}
          </p>
        );
      })}

      {/* Stream que ainda não produziu bloco nenhum (primeiro caractere a
          caminho): o cursor precisa de um lugar para existir. */}
      {cursor && partes.length === 0 && (
        <p>
          <span className="cursor-ia" aria-hidden="true" />
        </p>
      )}
    </div>
  );
}
