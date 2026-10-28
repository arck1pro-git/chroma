import type { Contato, Oportunidade, Tag, Usuario } from "@/lib/entidades";
import { brl, localizacao } from "@/lib/formato";
import { Bot, Clock, Hand, User } from "@/app/components/icones";

// Cartão de oportunidade do kanban. Arquivo próprio porque dois lugares montam
// o mesmo cartão — o quadro da tela inicial e as colunas do painel de
// subetapas —, e eles têm que mostrar o card idêntico.
//
// Recebe contato/responsável/tags já resolvidos em vez dos Maps: quem sabe de
// onde vêm é quem monta o quadro.
export default function CartaoOportunidade({
  oportunidade,
  contato,
  responsavel,
  tags,
  arrastando = false,
  ia = null,
  pediuAtendimento = false,
}: {
  oportunidade: Oportunidade;
  contato?: Contato;
  responsavel?: Usuario;
  tags: Tag[];
  arrastando?: boolean;
  /** A IA atende este lead: a classe de cor do robô (a do funil). null = não atende. Ver ./ia.ts. */
  ia?: string | null;
  /** O lead foi para o atendimento humano e ninguém da equipe respondeu ainda (lib/funil.ts). */
  pediuAtendimento?: boolean;
}) {
  // tela-baixa: (app/globals.css) — no tablet deitado o cartão perde respiro,
  // não conteúdo. Com p-3 e os vãos menores cabe quase um cartão a mais por
  // coluna, e é isso que a tela baixa precisa.
  return (
    <div
      className={`rounded-xl border bg-white p-4 tela-baixa:p-3 dark:bg-zinc-900 ${
        arrastando
          ? "border-zinc-300 shadow-lg dark:border-zinc-600"
          : "border-zinc-200 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
      }`}
    >
      {/* pr-6: o canto direito da primeira linha é da caixa de marcar do
          quadro (app/inicio/inicio.tsx) — sem a folga, nome longo corre por
          baixo dela. */}
      <h3 className="pr-6 text-sm font-semibold leading-5 text-zinc-900 dark:text-zinc-50">
        {/* Bolinha vermelha = oportunidade perdida. Só aparece com o botão
            "Perdidos" do topo ligado: fora dele, perdida não vai ao quadro. */}
        {oportunidade.status === "perdida" && (
          <span
            role="img"
            aria-label="Perdida"
            title="Oportunidade perdida"
            className="mr-1.5 inline-block size-2 rounded-full bg-red-500 align-[1px]"
          />
        )}
        {oportunidade.nome}
      </h3>

      {/* Logo abaixo do nome: é o que a equipe precisa ver primeiro descendo a
          coluna. Acende quando a IA passa o lead para a equipe ou a cadência o
          põe no atendimento humano, e some quando alguém da equipe responde. */}
      {pediuAtendimento && (
        <p className="mt-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30"
            title="Lead no atendimento humano: ninguém da equipe respondeu ainda"
          >
            <Hand className="size-3" aria-hidden="true" />
            Atendimento humano
          </span>
        </p>
      )}

      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <User className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {contato?.nome}
          {localizacao(contato) && (
            <span className="text-zinc-400 dark:text-zinc-500">
              {" · "}
              {localizacao(contato)}
            </span>
          )}
        </span>
      </p>

      <p className="mt-3 text-base font-semibold tabular-nums tracking-tight text-zinc-900 tela-baixa:mt-2 dark:text-zinc-50">
        {brl(oportunidade.valor)}
      </p>

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {tags.slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:text-zinc-400 dark:ring-zinc-700"
            >
              {t.nome}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="px-1 py-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
              +{tags.length - 2}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 tela-baixa:mt-2 tela-baixa:pt-2 dark:border-zinc-800">
        <span className="inline-flex items-center gap-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          {oportunidade.dias_na_etapa}{" "}
          {oportunidade.dias_na_etapa === 1 ? "dia" : "dias"} na etapa
        </span>
        <span className="flex items-center gap-1.5">
          {/* O robô diz, de relance, que quem responde este lead no WhatsApp
              é a IA — na cor do funil, para não competir com a lombada. */}
          {ia && (
            <span title="Atendido pela IA no WhatsApp" aria-label="Atendido pela IA" role="img">
              <Bot className={`size-4 ${ia}`} aria-hidden="true" />
            </span>
          )}
          <span
            className="flex size-6 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            title={`Responsável: ${responsavel?.nome ?? "sem responsável"}`}
          >
            {responsavel?.iniciais ?? "—"}
          </span>
        </span>
      </div>
    </div>
  );
}
