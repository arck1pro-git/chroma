"use client";

// O template como o contato lê no WhatsApp: balão recebido à esquerda, com a
// pontinha, cabeçalho em negrito, rodapé apagado e os botões soltos embaixo do
// balão. Serve à tela (o template aberto) e ao editor (o rascunho, ao vivo).
//
// As variáveis aparecem preenchidas com os exemplos, marcadas, porque é assim
// que a Meta analisa; o seletor do canto mostra os {{n}} crus. Com mais de três
// botões o WhatsApp mostra dois e esconde o resto em "Ver todas as opções" — a
// prévia faz o mesmo, para não prometer uma tela que o contato não vê.
import { Fragment, useState, type ReactNode } from "react";
import type { ConteudoTemplate } from "@/lib/templates-whatsapp";
import {
  Copy,
  ExternalLink,
  FileText,
  Image as ImagemIcone,
  List,
  MapPin,
  MousePointerClick,
  Phone,
  Reply,
  Video,
  type TipoIcone,
} from "@/app/components/icones";

const ICONE_BOTAO: Record<string, TipoIcone> = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  COPY_CODE: Copy,
  OTP: Copy,
};

// A mídia do cabeçalho só existe no disparo (cada envio manda a sua): a prévia
// mostra o lugar dela, não um arquivo.
const MIDIA: Record<string, { Icone: TipoIcone; rotulo: string }> = {
  IMAGE: { Icone: ImagemIcone, rotulo: "Imagem enviada no disparo" },
  VIDEO: { Icone: Video, rotulo: "Vídeo enviado no disparo" },
  DOCUMENT: { Icone: FileText, rotulo: "Documento enviado no disparo" },
  LOCATION: { Icone: MapPin, rotulo: "Localização enviada no disparo" },
};

// O vocabulário do WhatsApp: link, *negrito*, _itálico_ e ~riscado~. Mais
// estrito que o TOKEN do chat (app/chat/ui.tsx): a marca precisa encostar no
// texto, porque "*palavra *" chega ao contato com os asteriscos, e a prévia
// existe justamente para não mostrar formatado o que não vai chegar assim.
const FORMATO =
  /(https?:\/\/[^\s]+)|\*(\S(?:[^*\n]*\S)?)\*|_(\S(?:[^_\n]*\S)?)_|~(\S(?:[^~\n]*\S)?)~/g;
// Qualquer coisa entre chaves duplas aparece marcada; só {{n}} ganha exemplo.
const VARIAVEL = /\{\{([^{}\n]*)\}\}/g;

type Variaveis = { exemplos: string[]; comExemplos: boolean };

function comVariaveis(texto: string, v: Variaveis): ReactNode[] {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(VARIAVEL)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
    const valor = v.comExemplos && /^\d+$/.test(m[1]) ? v.exemplos[Number(m[1]) - 1]?.trim() : "";
    partes.push(
      valor ? (
        <mark key={inicio} className="rounded-sm bg-sky-100 px-0.5 text-inherit dark:bg-sky-400/20">
          {valor}
        </mark>
      ) : (
        <span
          key={inicio}
          className="rounded bg-zinc-200/80 px-1 py-px font-mono text-[0.85em] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
        >
          {m[0]}
        </span>
      ),
    );
    ultimo = inicio + m[0].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

function TextoFormatado({ texto, v }: { texto: string; v: Variaveis }) {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  let k = 0;
  for (const m of texto.matchAll(FORMATO)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) partes.push(<Fragment key={k++}>{comVariaveis(texto.slice(ultimo, inicio), v)}</Fragment>);
    const dentro = comVariaveis(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "", v);
    if (m[1]) {
      partes.push(
        <span key={k++} className="break-all text-sky-600 underline underline-offset-2 dark:text-sky-400">
          {dentro}
        </span>,
      );
    } else if (m[2]) partes.push(<strong key={k++} className="font-semibold">{dentro}</strong>);
    else if (m[3]) partes.push(<em key={k++}>{dentro}</em>);
    else partes.push(<s key={k++}>{dentro}</s>);
    ultimo = inicio + m[0].length;
  }
  if (ultimo < texto.length) partes.push(<Fragment key={k++}>{comVariaveis(texto.slice(ultimo), v)}</Fragment>);
  return <>{partes}</>;
}

export function PreviaWhatsApp({ conteudo }: { conteudo: ConteudoTemplate }) {
  const [comExemplos, setComExemplos] = useState(true);
  const { cabecalho, corpo, rodape, botoes } = conteudo;
  const temVariaveis = /\{\{\d+\}\}/.test(`${cabecalho?.texto ?? ""} ${corpo}`);
  // A pontinha do balão é a do WhatsApp; o horário é enfeite, sempre o mesmo.
  const midia = cabecalho && cabecalho.formato !== "TEXT" ? (MIDIA[cabecalho.formato] ?? MIDIA.IMAGE) : null;
  const vistos = botoes.length > 3 ? botoes.slice(0, 2) : botoes;

  return (
    <figure className="min-w-0 max-w-md">
      <figcaption className="mb-2 flex min-h-6 items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
          Como o contato lê
        </span>
        {temVariaveis && (
          <span className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900" role="group" aria-label="Mostrar variáveis">
            {[
              { valor: true, rotulo: "Exemplos" },
              { valor: false, rotulo: "{{n}}" },
            ].map((o) => (
              <button
                key={o.rotulo}
                type="button"
                onClick={() => setComExemplos(o.valor)}
                aria-pressed={comExemplos === o.valor}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                  comExemplos === o.valor
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                } ${o.valor ? "" : "font-mono"}`}
              >
                {o.rotulo}
              </button>
            ))}
          </span>
        )}
      </figcaption>

      {/* O papel de parede: pontilhado discreto, nos dois temas. */}
      <div className="rounded-2xl bg-zinc-100 bg-[radial-gradient(circle,var(--color-zinc-300)_1px,transparent_1.5px)] bg-size-[18px_18px] px-5 py-6 ring-1 ring-zinc-200/70 dark:bg-zinc-900 dark:bg-[radial-gradient(circle,var(--color-zinc-800)_1px,transparent_1.5px)] dark:ring-zinc-800">
        <div className="w-full max-w-[20rem] pl-2">
          <div className="relative rounded-lg rounded-tl-none bg-white p-1 text-zinc-900 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] before:absolute before:-left-2 before:top-0 before:size-0 before:border-l-8 before:border-t-8 before:border-l-transparent before:border-t-white dark:bg-zinc-800 dark:text-zinc-100 dark:before:border-t-zinc-800">
            {midia && (
              <div className="flex aspect-[1.91/1] flex-col items-center justify-center gap-1.5 rounded-md bg-zinc-100 text-zinc-400 dark:bg-zinc-700/60 dark:text-zinc-500">
                <midia.Icone className="size-6" aria-hidden="true" />
                <span className="text-[11px]">{midia.rotulo}</span>
              </div>
            )}
            <div className="px-2 pb-1 pt-1.5">
              {cabecalho?.formato === "TEXT" && cabecalho.texto && (
                <p className="mb-1 break-words text-[14px] font-semibold leading-snug">
                  {comVariaveis(cabecalho.texto, { exemplos: conteudo.exemplosCabecalho, comExemplos })}
                </p>
              )}
              {corpo.trim() ? (
                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.45]">
                  <TextoFormatado texto={corpo} v={{ exemplos: conteudo.exemplosCorpo, comExemplos }} />
                </p>
              ) : (
                <p className="text-[13.5px] italic leading-[1.45] text-zinc-400 dark:text-zinc-500">O texto da mensagem aparece aqui.</p>
              )}
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="min-w-0 break-words text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{rodape}</p>
                <span className="shrink-0 text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500" aria-hidden="true">
                  09:41
                </span>
              </div>
            </div>
          </div>

          {botoes.length > 0 && (
            <ul className="mt-[3px] flex flex-col gap-[3px]">
              {vistos.map((b, i) => {
                const Icone = ICONE_BOTAO[b.tipo] ?? MousePointerClick;
                return (
                  <li
                    key={i}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-sky-600 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] dark:bg-zinc-800 dark:text-sky-400"
                  >
                    <Icone className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{b.texto.trim() || "Texto do botão"}</span>
                  </li>
                );
              })}
              {botoes.length > 3 && (
                <li className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-sky-600 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] dark:bg-zinc-800 dark:text-sky-400">
                  <List className="size-3.5 shrink-0" aria-hidden="true" />
                  Ver todas as opções
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </figure>
  );
}
