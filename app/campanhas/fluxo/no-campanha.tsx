"use client";

// Os cartões do canvas da campanha: o início (os segmentos) e um por bloco.
// Entrada à esquerda, saída à direita — o fluxo se lê da esquerda para a
// direita. No "Aguardar resposta" cada saída é uma linha com o próprio rótulo
// e a própria alça (um botão do template, uma palavra, "Outra resposta", "Sem
// resposta"); nos demais, uma alça só, na altura do título.
//
// Redesenho de 2026-10-28 (pedido dele: "melhora os blocos"):
//   · O envio mostra a MENSAGEM como um balão do WhatsApp — cabeçalho, corpo
//     com as variáveis trocadas como na revisão, rodapé e os botões em chips
//     com o ícone do tipo —, cortado no máximo de linhas para o cartão ter
//     altura previsível (organizarFluxo, em ./grafo.ts, estima por ela).
//   · Cor só no quadradinho do ícone; o balão e os chips ficam em zinc.
//   · A pendência é uma faixa âmbar no pé do cartão com a frase (no tablet não
//     há title para ler). Quando a frase é a do resumo ("Escolha a tag"), o
//     resumo fica âmbar e a faixa não repete.
//   · As alças têm área de clique maior que o desenho (o ::after), crescem no
//     hover da linha e, arrastando uma ligação, o alvo válido se destaca.
import { memo, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { CATALOGO_CAMPANHA, NO_INICIO, type TipoBloco } from "@/lib/campanhas-fluxo";
import { DADOS_DO_CONTATO } from "@/lib/templates-whatsapp";
import {
  ExternalLink,
  FileText,
  Hourglass,
  Image as ImagemIcone,
  LogIn,
  MapPin,
  MessageCircle,
  Phone,
  Reply,
  TriangleAlert,
  Type,
  Video,
  type TipoIcone,
} from "@/app/components/icones";
import { COR_DO_GRUPO, ICONE_DO_BLOCO } from "./aparencia";
import { ALCA_DO_TITULO, type BalaoDaMensagem } from "./grafo";

/** `fim`: só com métricas — quantos tomaram esta saída sem destino e terminaram ali. */
export type SaidaDoNo = { id: string; rotulo: string; ligada: boolean; fim: number | null };

/** A primeira pendência do bloco. `noResumo`: a frase é a do resumo, que já aparece em âmbar. */
export type PendenciaDoNo = { texto: string; noResumo: boolean };

// `type` e não `interface`: o React Flow exige que os dados do nó satisfaçam
// Record<string, unknown>, e só type alias ganha a index signature implícita.
export type DadosDoBloco = {
  tipo: TipoBloco;
  /** Uma linha do que o bloco faz; null quando o balão já diz tudo (texto livre). */
  resumo: string | null;
  /** A mensagem que sai (template ou texto livre). */
  mensagem: BalaoDaMensagem | null;
  saidas: SaidaDoNo[];
  problema: PendenciaDoNo | null;
  metrica: { agora: number; passaram: number } | null;
};
export type NoDoBloco = Node<DadosDoBloco, "bloco">;

export type DadosDoInicio = { resumo: string; detalhe: string; ligado: boolean; problema: PendenciaDoNo | null };
export type NoDoInicio = Node<DadosDoInicio, typeof NO_INICIO>;


// O desenho da alça é 12px; a área de clique, 32px (o ::after faz parte da
// alça para o mouse e para o toque).
const AREA_DA_ALCA = "after:absolute after:-inset-2.5 after:rounded-full after:content-['']";

const alvo = `${AREA_DA_ALCA} !size-3 !border-2 !border-white !bg-zinc-400 transition-[scale,background-color] dark:!border-zinc-950 dark:!bg-zinc-500 [&.connectingto.valid]:!scale-150 [&.connectingto.valid]:!bg-zinc-900 dark:[&.connectingto.valid]:!bg-zinc-50`;

// Saída sem ligação fica vazada: dá para ver de longe o que ainda encerra o fluxo.
const alca = (ligada: boolean) =>
  `${AREA_DA_ALCA} !size-3 !border-2 transition-[scale,background-color,border-color] hover:!scale-125 group-hover/saida:!scale-125 ${
    ligada
      ? "!border-white !bg-zinc-500 hover:!bg-zinc-900 dark:!border-zinc-950 dark:!bg-zinc-400 dark:hover:!bg-zinc-50"
      : "!border-zinc-400 !bg-white hover:!border-zinc-900 dark:!border-zinc-500 dark:!bg-zinc-950 dark:hover:!border-zinc-50"
  }`;

function moldura(selecionado: boolean, pendente: boolean) {
  if (selecionado) return "border-zinc-900 shadow-md ring-4 ring-zinc-900/10 dark:border-zinc-100 dark:ring-zinc-100/15";
  if (pendente) return "border-amber-300 hover:border-amber-400 dark:border-amber-500/50 dark:hover:border-amber-500/80";
  return "border-zinc-200 hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:hover:border-zinc-700";
}

function iconeDaSaida(id: string): TipoIcone {
  if (id.startsWith("botao:")) return Reply;
  if (id.startsWith("palavra:")) return Type;
  return id === "sem_resposta" ? Hourglass : MessageCircle;
}

const ICONE_DO_BOTAO: Record<string, TipoIcone> = { QUICK_REPLY: Reply, URL: ExternalLink, PHONE_NUMBER: Phone };
const ICONE_DA_MIDIA: Record<string, { Icone: TipoIcone; rotulo: string }> = {
  IMAGE: { Icone: ImagemIcone, rotulo: "Imagem" },
  VIDEO: { Icone: Video, rotulo: "Vídeo" },
  DOCUMENT: { Icone: FileText, rotulo: "Documento" },
  LOCATION: { Icone: MapPin, rotulo: "Localização" },
};

// O que a revisão escreve no lugar de um dado do contato ("[Primeiro nome do
// contato]", textoParaRevisao): no balão aparece marcado, como na prévia.
const DADO_NA_REVISAO = new RegExp(`(\\[(?:${DADOS_DO_CONTATO.map((d) => d.rotulo).join("|")}) do contato\\])`);

function comDadosMarcados(texto: string) {
  return texto.split(DADO_NA_REVISAO).map((parte, i) =>
    i % 2 ? (
      <span key={i} className="rounded-sm bg-zinc-100 px-0.5 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
        {parte.slice(1, -1).replace(/ do contato$/, "")}
      </span>
    ) : (
      parte
    ),
  );
}

/** Até três chips; o resto vira "+N", como o WhatsApp esconde o que passa de três. */
const CHIPS = 3;

function Balao({ mensagem }: { mensagem: BalaoDaMensagem }) {
  const midia = mensagem.midia ? (ICONE_DA_MIDIA[mensagem.midia] ?? ICONE_DA_MIDIA.IMAGE) : null;
  const vistos = mensagem.botoes.length > CHIPS ? mensagem.botoes.slice(0, CHIPS - 1) : mensagem.botoes;
  return (
    <div className="mx-3 mb-2.5 rounded-lg bg-zinc-100 p-1.5 dark:bg-zinc-900">
      <div className="rounded-md rounded-tl-none bg-white px-2 py-1.5 text-zinc-800 shadow-[0_1px_0.5px_rgba(0,0,0,0.12)] dark:bg-zinc-800 dark:text-zinc-100">
        {midia && (
          <p className="mb-1 flex items-center gap-1 text-[10.5px] text-zinc-400 dark:text-zinc-500">
            <midia.Icone className="size-3" aria-hidden="true" />
            {midia.rotulo} no cabeçalho
          </p>
        )}
        {mensagem.cabecalho && <p className="truncate text-[11.5px] font-semibold leading-snug">{comDadosMarcados(mensagem.cabecalho)}</p>}
        <p className="line-clamp-4 whitespace-pre-line break-words text-[11.5px] leading-[1.4]">{comDadosMarcados(mensagem.corpo)}</p>
        {mensagem.rodape && <p className="mt-0.5 truncate text-[10.5px] leading-snug text-zinc-400 dark:text-zinc-500">{mensagem.rodape}</p>}
      </div>
      {mensagem.botoes.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1" aria-label="Botões">
          {vistos.map((b, i) => {
            const Icone = ICONE_DO_BOTAO[b.tipo] ?? Reply;
            return (
              <li
                key={i}
                className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-600 shadow-[0_1px_0.5px_rgba(0,0,0,0.12)] dark:bg-zinc-800 dark:text-zinc-300"
              >
                <Icone className="size-2.5 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
                <span className="truncate">{b.texto}</span>
              </li>
            );
          })}
          {mensagem.botoes.length > CHIPS && (
            <li className="rounded-md px-1 py-0.5 text-[10.5px] font-medium text-zinc-500 dark:text-zinc-400">
              +{mensagem.botoes.length - vistos.length}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function FaixaDePendencia({ texto }: { texto: string }) {
  return (
    <p className="flex gap-1.5 rounded-b-xl border-t border-amber-200/80 bg-amber-50/80 px-3 py-1.5 text-[11px] leading-snug text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
      <span className="line-clamp-2 min-w-0">{texto}</span>
    </p>
  );
}

function Cabeca({
  Icone,
  cor,
  rotulo,
  resumo,
  detalhe,
  resumoPendente,
}: {
  Icone: TipoIcone;
  cor: string;
  rotulo: string;
  resumo: string | null;
  detalhe?: string;
  resumoPendente: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 pb-2.5 pt-2.5">
      <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${cor}`}>
        <Icone className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium leading-tight text-zinc-500 dark:text-zinc-400">{rotulo}</p>
        {resumo && (
          <p
            className={`mt-0.5 line-clamp-2 break-words text-[12.5px] font-medium leading-snug ${
              resumoPendente ? "text-amber-700 dark:text-amber-300" : "text-zinc-900 dark:text-zinc-50"
            }`}
            title={resumo}
          >
            {resumo}
          </p>
        )}
        {detalhe && <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{detalhe}</p>}
      </div>
    </div>
  );
}

function NoBloco({ id, data, selected }: NodeProps<NoDoBloco>) {
  // As alças mudam sem o cartão mudar de tamanho (trocar o template troca os
  // botões): sem avisar o React Flow, a ligação de um botão novo não acharia a
  // alça e sumiria calada.
  const atualizarInternos = useUpdateNodeInternals();
  const chaveDasSaidas = data.saidas.map((s) => s.id).join("\n");
  useEffect(() => {
    atualizarInternos(id);
  }, [id, chaveDasSaidas, atualizarInternos]);

  const catalogo = CATALOGO_CAMPANHA[data.tipo];
  const emLinhas = data.tipo === "aguardar_resposta";
  const unica = emLinhas ? null : data.saidas[0];

  return (
    <div className={`relative w-64 rounded-xl border bg-white shadow-sm transition-[border-color,box-shadow] dark:bg-zinc-950 ${moldura(selected, !!data.problema)}`}>
      <Handle type="target" position={Position.Left} style={{ top: ALCA_DO_TITULO }} className={alvo} />
      <Cabeca
        Icone={ICONE_DO_BLOCO[data.tipo]}
        cor={`ring-1 ring-inset ${COR_DO_GRUPO[catalogo.grupo]}`}
        rotulo={catalogo.rotulo}
        resumo={data.resumo}
        resumoPendente={!!data.problema?.noResumo}
      />
      {data.mensagem && <Balao mensagem={data.mensagem} />}

      {emLinhas && (
        <ul className="border-t border-zinc-100 py-1 dark:border-zinc-800/80">
          {data.saidas.map((s) => {
            const IconeSaida = iconeDaSaida(s.id);
            return (
              <li
                key={s.id}
                className={`group/saida relative flex h-7 items-center gap-1.5 pl-3 pr-4 text-[11.5px] text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900 ${
                  s.id === "sem_resposta" ? "mt-1 border-t border-dashed border-zinc-200 dark:border-zinc-800" : ""
                }`}
              >
                <IconeSaida className="size-3 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={s.rotulo}>
                  {s.rotulo}
                </span>
                {s.fim !== null && (
                  <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">fim · {s.fim.toLocaleString("pt-BR")}</span>
                )}
                <Handle type="source" position={Position.Right} id={s.id} className={alca(s.ligada)} />
              </li>
            );
          })}
        </ul>
      )}
      {unica && <Handle type="source" position={Position.Right} id={unica.id} style={{ top: ALCA_DO_TITULO }} className={alca(unica.ligada)} />}

      {data.metrica && (
        <dl className="flex gap-3 border-t border-zinc-100 px-3 py-1.5 text-[11px] dark:border-zinc-800/80">
          <div className="flex gap-1">
            <dt className="text-zinc-400 dark:text-zinc-500">Agora</dt>
            <dd className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{data.metrica.agora.toLocaleString("pt-BR")}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-zinc-400 dark:text-zinc-500">Passaram</dt>
            <dd className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{data.metrica.passaram.toLocaleString("pt-BR")}</dd>
          </div>
        </dl>
      )}
      {data.problema && !data.problema.noResumo && <FaixaDePendencia texto={data.problema.texto} />}
    </div>
  );
}

function NoInicio({ data, selected }: NodeProps<NoDoInicio>) {
  return (
    <div className={`relative w-56 rounded-xl border bg-white shadow-sm transition-[border-color,box-shadow] dark:bg-zinc-950 ${moldura(selected, !!data.problema)}`}>
      <Cabeca
        Icone={LogIn}
        cor="bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
        rotulo="Início · segmentos"
        resumo={data.resumo}
        detalhe={data.detalhe}
        resumoPendente={!!data.problema?.noResumo}
      />
      <Handle type="source" position={Position.Right} id="proximo" style={{ top: ALCA_DO_TITULO }} className={alca(data.ligado)} />
      {data.problema && !data.problema.noResumo && <FaixaDePendencia texto={data.problema.texto} />}
    </div>
  );
}

// Fora do componente: recriar este objeto a cada render faz o React Flow
// remontar todos os nós.
export const TIPOS_DE_NO: NodeTypes = { bloco: memo(NoBloco), [NO_INICIO]: memo(NoInicio) };
