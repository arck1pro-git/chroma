"use client";

// O template aberto: o nome, a situação na Meta com o que fazer a seguir, a
// prévia e as propriedades. A orientação é uma linha só e muda com a situação
// — o rejeitado diz por quê, em português, e aponta o Duplicar, que é o caminho
// para corrigir (um template rejeitado não volta para análise com outro texto
// por aqui).
import { telefoneLegivel } from "@/lib/telefone";
import { ROTULO_CATEGORIA, semEnvioPeloCrm, variaveisDo, type TemplateWhatsApp } from "@/lib/templates-whatsapp";
import {
  CircleCheck,
  CircleX,
  Clock3,
  CopyPlus,
  PauseCircle,
  type TipoIcone,
} from "@/app/components/icones";
import { BOTAO_SECUNDARIO, BotaoCopiar, Propriedade, Propriedades } from "../components/gaveta";
import { Selo, type Tom } from "../contatos/pecas";
import { PreviaWhatsApp } from "./previa";

export type Grupo = "aprovados" | "analise" | "rejeitados" | "parados";

const ESTADO: Record<string, { rotulo: string; tom: Tom; grupo: Grupo }> = {
  APPROVED: { rotulo: "Aprovado", tom: "bom", grupo: "aprovados" },
  PENDING: { rotulo: "Em análise", tom: "aviso", grupo: "analise" },
  IN_APPEAL: { rotulo: "Em recurso", tom: "aviso", grupo: "analise" },
  REJECTED: { rotulo: "Rejeitado", tom: "ruim", grupo: "rejeitados" },
  PAUSED: { rotulo: "Pausado", tom: "aviso", grupo: "parados" },
  DISABLED: { rotulo: "Desativado", tom: "ruim", grupo: "parados" },
  LIMIT_EXCEEDED: { rotulo: "Acima do limite", tom: "ruim", grupo: "parados" },
  ARCHIVED: { rotulo: "Arquivado", tom: "neutro", grupo: "parados" },
  PENDING_DELETION: { rotulo: "Sendo apagado", tom: "neutro", grupo: "parados" },
  DELETED: { rotulo: "Apagado", tom: "neutro", grupo: "parados" },
};

export function estadoDe(status: string) {
  return ESTADO[status] ?? { rotulo: status.toLowerCase().replaceAll("_", " "), tom: "neutro" as Tom, grupo: "parados" as Grupo };
}

const IDIOMA: Record<string, string> = {
  pt_BR: "Português (BR)",
  pt_PT: "Português (PT)",
  en_US: "Inglês (EUA)",
  en: "Inglês",
  es: "Espanhol",
};

// Os códigos de rejected_reason da Graph API.
const MOTIVO: Record<string, string> = {
  ABUSIVE_CONTENT: "a Meta considerou o conteúdo abusivo",
  INCORRECT_CATEGORY: "a categoria não combina com o texto",
  INVALID_FORMAT: "formato inválido — variáveis, exemplos ou espaços fora do padrão",
  PROMOTIONAL: "o texto é promocional e a categoria não é Marketing",
  SCAM: "a Meta considerou o texto um possível golpe",
  TAG_CONTENT_MISMATCH: "o texto não combina com a categoria escolhida",
};

const QUALIDADE: Record<string, { rotulo: string; ponto: string }> = {
  GREEN: { rotulo: "Alta", ponto: "bg-emerald-500" },
  YELLOW: { rotulo: "Média", ponto: "bg-amber-400" },
  RED: { rotulo: "Baixa", ponto: "bg-red-500" },
};

const TOM_ORIENTACAO: Record<Tom, string> = {
  bom: "bg-emerald-50/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  aviso: "bg-amber-50/80 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  ruim: "bg-red-50/80 text-red-800 dark:bg-red-500/10 dark:text-red-300",
  neutro: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
};

function orientacao(t: TemplateWhatsApp, podeCriar: boolean): { Icone: TipoIcone; tom: Tom; texto: string } | null {
  const corrigir = podeCriar ? " Duplique, ajuste e envie de novo com outro nome." : "";
  switch (t.status) {
    case "APPROVED":
      return semEnvioPeloCrm(t)
        ? {
            Icone: CircleCheck,
            tom: "aviso",
            texto: "Aprovado, mas o CRM ainda não envia template com cabeçalho de mídia ou link variável — nem pelo chat, nem por campanha.",
          }
        : {
            Icone: CircleCheck,
            tom: "bom",
            texto: "Pronto para usar no chat, nas conversas da API oficial, e nas campanhas de WhatsApp. As variáveis podem levar dados do contato.",
          };
    case "PENDING":
    case "IN_APPEAL":
      return { Icone: Clock3, tom: "aviso", texto: "A Meta está analisando. Costuma levar alguns minutos — o botão de atualizar, no topo da lista, confere de novo." };
    case "REJECTED": {
      const motivo = t.motivoRejeicao ? (MOTIVO[t.motivoRejeicao] ?? t.motivoRejeicao.toLowerCase().replaceAll("_", " ")) : null;
      return { Icone: CircleX, tom: "ruim", texto: `Rejeitado pela Meta${motivo ? `: ${motivo}` : ""}.${corrigir}` };
    }
    case "PAUSED":
      return { Icone: PauseCircle, tom: "aviso", texto: "Pausado pela Meta porque contatos bloquearam ou denunciaram. Volta sozinho depois de algumas horas; vale revisar o texto." };
    case "DISABLED":
      return { Icone: CircleX, tom: "ruim", texto: `Desativado pela Meta depois de pausas seguidas por qualidade baixa.${corrigir}` };
    default:
      return null;
  }
}

function contagemVariaveis(t: TemplateWhatsApp): string {
  const corpo = variaveisDo(t.corpo).length;
  const cabecalho = variaveisDo(t.cabecalho?.texto ?? "").length;
  if (!corpo && !cabecalho) return "Nenhuma";
  return [corpo ? `${corpo} no texto` : "", cabecalho ? `${cabecalho} no cabeçalho` : ""].filter(Boolean).join(" · ");
}

export default function Detalhe({
  template: t,
  podeCriar,
  aoDuplicar,
}: {
  template: TemplateWhatsApp;
  podeCriar: boolean;
  aoDuplicar: () => void;
}) {
  const estado = estadoDe(t.status);
  const guia = orientacao(t, podeCriar);
  const qualidade = t.qualidade ? QUALIDADE[t.qualidade] : undefined;
  const destinos = t.botoes.filter((b) => b.destino);

  return (
    <article className="surge @container mx-auto w-full max-w-5xl px-8 py-7 tela-baixa:px-6 tela-baixa:py-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="truncate font-mono text-[19px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50" title={t.nome}>
              {t.nome}
            </h2>
            <BotaoCopiar texto={t.nome} rotulo="o nome do template" />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
            <Selo tom={estado.tom}>{estado.rotulo}</Selo>
            <span>{ROTULO_CATEGORIA[t.categoria] ?? t.categoria}</span>
            <span aria-hidden="true">·</span>
            <span>{IDIOMA[t.idioma] ?? t.idioma}</span>
          </p>
        </div>
        {podeCriar && (
          <button type="button" onClick={aoDuplicar} className={BOTAO_SECUNDARIO} title="Abre o editor com este template como ponto de partida">
            <CopyPlus className="size-3.5" aria-hidden="true" />
            Duplicar
          </button>
        )}
      </header>

      {guia && (
        <p className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px] leading-snug ${TOM_ORIENTACAO[guia.tom]}`}>
          <guia.Icone className="mt-px size-4 shrink-0" aria-hidden="true" />
          {guia.texto}
        </p>
      )}

      {/* A prévia tem a largura de um celular; ao lado dela cabem os detalhes
          a partir de ~608px de painel, o que já pega o tablet deitado. */}
      <div className="mt-6 grid gap-x-10 gap-y-6 @[38rem]:grid-cols-[20rem_minmax(0,1fr)]">
        <PreviaWhatsApp conteudo={t} />

        {/* Situação, categoria e idioma já estão no cabeçalho: aqui só o resto. */}
        <div className="min-w-0">
          <p className="mb-2 flex min-h-6 items-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
            Detalhes
          </p>
          <Propriedades>
            {t.status === "APPROVED" && (
              <Propriedade rotulo="Qualidade">
                {qualidade ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-1.5 rounded-full ${qualidade.ponto}`} aria-hidden="true" />
                    {qualidade.rotulo}
                  </span>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-500">Sem avaliação ainda</span>
                )}
              </Propriedade>
            )}
            <Propriedade rotulo="Variáveis">{contagemVariaveis(t)}</Propriedade>
            <Propriedade rotulo="Botões">{t.botoes.length || "Nenhum"}</Propriedade>
            <Propriedade rotulo="ID na Meta">
              <span className="truncate font-mono text-[12px]">{t.id}</span>
              <BotaoCopiar texto={t.id} rotulo="o ID" />
            </Propriedade>
          </Propriedades>

          {destinos.length > 0 && (
            <>
              <p className="mb-1.5 mt-5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                Para onde os botões levam
              </p>
              <ul className="flex flex-col gap-1.5">
                {destinos.map((b, i) => (
                  <li key={i} className="flex min-w-0 items-center gap-1 text-[12.5px]">
                    <span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-100">{b.texto}</span>
                    <span className="shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true">→</span>
                    <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400" title={b.destino ?? ""}>
                      {b.tipo === "PHONE_NUMBER" ? telefoneLegivel(b.destino) : b.destino}
                    </span>
                    <BotaoCopiar texto={b.destino ?? ""} rotulo={`o destino de ${b.texto}`} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
