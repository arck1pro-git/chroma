"use client";

import Link from "next/link";
import { Camera, ChevronRight, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import type {
  Anotacao,
  Atendimento,
  CampoPersonalizado,
  Contato,
  Etapa,
  Funil,
  Historico,
  Oportunidade,
  Segmento,
  Tag,
  Usuario,
} from "@/lib/entidades";
import { brl, brlCurto, dataDoInstante, localizacao } from "@/lib/formato";
import { telefoneLegivel } from "@/lib/telefone";
import { AnotacoesContato } from "../components/anotacoes-contato";
import { CamposDoContato } from "../components/campos-personalizados";
import {
  BotaoCopiar,
  Chips,
  IconeLinha,
  LINHA,
  LINHA_FIXA,
  ListaHistorico,
  ObjecoesDoHistorico,
  Propriedade,
  Propriedades,
  Secao,
  Vazio,
} from "../components/gaveta";
import { haQuanto, Selo, type Tom } from "./pecas";

// Partes da ficha do contato que as duas gavetas da tela inicial mostram — a
// de contatos e a aba Cliente da ficha da oportunidade —, montadas com o kit
// de app/components/gaveta.tsx. Tudo aqui é leitura, menos anotar, que mora em
// AnotacoesContato, junto da lista de anotações.

/**
 * Os dados de cadastro, só os preenchidos: "@ —" e "📍 —" eram três linhas de
 * nada. O que o cabeçalho de quem chama já mostra fica de fora (semTelefone,
 * semLocal), para nada aparecer duas vezes na mesma gaveta.
 */
export function CamposContato({
  contato,
  segmentos = [],
  tags = [],
  semTelefone = false,
  semLocal = false,
}: {
  contato: Contato;
  segmentos?: Segmento[];
  tags?: Tag[];
  semTelefone?: boolean;
  semLocal?: boolean;
}) {
  const telefone = telefoneLegivel(contato.whatsapp);
  const lugar = localizacao(contato, true);
  return (
    <Secao titulo="Contato">
      <Propriedades>
        {!semTelefone && (
          <Propriedade rotulo="WhatsApp">
            {telefone ? (
              <>
                <span className="truncate tabular-nums">{telefone}</span>
                <BotaoCopiar texto={contato.whatsapp.replace(/\D/g, "")} rotulo="número" />
              </>
            ) : (
              <span className="text-zinc-400 dark:text-zinc-500">Sem número</span>
            )}
          </Propriedade>
        )}
        {contato.email && (
          <Propriedade rotulo="E-mail">
            <a href={`mailto:${contato.email}`} className="truncate underline-offset-4 hover:underline">
              {contato.email}
            </a>
            <BotaoCopiar texto={contato.email} rotulo="e-mail" />
          </Propriedade>
        )}
        {!semLocal && lugar && <Propriedade rotulo="Local">{lugar}</Propriedade>}
        {!semLocal && (
          <Propriedade rotulo="No CRM">
            <span>
              {haQuanto(contato.data_criacao)}
              <span className="text-zinc-400 dark:text-zinc-500"> · {dataDoInstante(contato.data_criacao)}</span>
            </span>
          </Propriedade>
        )}
        {(segmentos.length > 0 || tags.length > 0) && (
          <Propriedade rotulo="Tags">
            <span className="py-0.5">
              <Chips segmentos={segmentos} tags={tags} />
            </span>
          </Propriedade>
        )}
      </Propriedades>
    </Secao>
  );
}

const CANAL: Record<Atendimento["canal"], { rotulo: string; Icone: LucideIcon }> = {
  whatsapp: { rotulo: "WhatsApp", Icone: MessageCircle },
  whatsapp_oficial: { rotulo: "WhatsApp API", Icone: MessageCircle },
  instagram: { rotulo: "Instagram", Icone: Camera },
  email: { rotulo: "E-mail", Icone: Mail },
};

const STATUS_ATENDIMENTO: Record<Atendimento["status"], { rotulo: string; tom: Tom }> = {
  aberto: { rotulo: "Aberto", tom: "bom" },
  na_fila: { rotulo: "Na fila", tom: "aviso" },
  encerrado: { rotulo: "Encerrado", tom: "neutro" },
};

const STATUS_NEGOCIO: Record<string, Tom> = { ganha: "bom", perdida: "ruim" };

/**
 * O que a gaveta conta do relacionamento: oportunidades, conversas, anotações,
 * objeções, campos e histórico — nessa ordem, do que se usa ao que se consulta.
 *
 * `aoAbrirOportunidade` é opcional: onde o host sabe abrir a ficha da
 * oportunidade (a tela inicial), cada linha vira botão; onde não sabe, vira
 * texto. `oportunidadeAtualId` é a ficha que já está aberta: ela sai da lista,
 * que vira "Outras oportunidades" (e some quando não há outra).
 */
export function SecoesContato({
  contato,
  oportunidades,
  anotacoes,
  historico,
  atendimentos,
  camposContato,
  oportunidadeAtualId,
  etapaPorId,
  funilPorId,
  usuarioPorId,
  euId,
  aoAbrirOportunidade,
}: {
  contato: Contato;
  oportunidades: Oportunidade[];
  anotacoes: Anotacao[];
  historico: Historico[];
  /** Quem está logado: só as anotações dele podem ser apagadas. */
  euId: string;
  /** Só a ficha da oportunidade tem as conversas na mão; sem elas, a seção some. */
  atendimentos?: Atendimento[];
  camposContato: CampoPersonalizado[];
  oportunidadeAtualId?: string;
  etapaPorId: Map<string, Etapa>;
  funilPorId: Map<string, Funil>;
  usuarioPorId: Map<string, Usuario>;
  aoAbrirOportunidade?: (id: string) => void;
}) {
  const lista = oportunidadeAtualId ? oportunidades.filter((o) => o.id !== oportunidadeAtualId) : oportunidades;

  return (
    <>
      {(lista.length > 0 || !oportunidadeAtualId) && (
        <Secao titulo={oportunidadeAtualId ? "Outras oportunidades" : "Oportunidades"} contagem={lista.length}>
          {lista.length === 0 ? (
            <Vazio>Nenhuma oportunidade para este contato</Vazio>
          ) : (
            <ul className="flex flex-col">
              {lista.map((o) => {
                const etapa = etapaPorId.get(o.etapa_id);
                const funil = funilPorId.get(o.funil_id);
                const conteudo = (
                  <>
                    <span className={`size-2 shrink-0 rounded-full ${etapa?.cor ?? "bg-zinc-300"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{o.nome}</span>
                      <span className="block truncate text-[11.5px] text-zinc-500 dark:text-zinc-400">
                        {[funil?.nome, etapa?.nome].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="text-[13px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-50" title={brl(o.valor)}>
                        {o.valor > 0 ? brlCurto(o.valor) : <span className="font-normal text-zinc-400">—</span>}
                      </span>
                      {o.status !== "aberta" && <Selo tom={STATUS_NEGOCIO[o.status] ?? "neutro"}>{o.status}</Selo>}
                    </span>
                    {aoAbrirOportunidade && (
                      <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                    )}
                  </>
                );
                return (
                  <li key={o.id}>
                    {aoAbrirOportunidade ? (
                      <button type="button" onClick={() => aoAbrirOportunidade(o.id)} className={LINHA}>
                        {conteudo}
                      </button>
                    ) : (
                      <div className={LINHA_FIXA}>{conteudo}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>
      )}

      {atendimentos && (
        <Secao titulo="Conversas" contagem={atendimentos.length}>
          {atendimentos.length === 0 ? (
            <Vazio>Nenhuma conversa com este contato</Vazio>
          ) : (
            <ul className="flex flex-col">
              {/* A conversa é do CONTATO, não da oportunidade: não há o que
                  anexar (o botão saiu em 2026-10-06). Qual trecho dela é deste
                  negócio a IA decide pela data. */}
              {atendimentos.map((a) => {
                const { rotulo, Icone } = CANAL[a.canal];
                const status = STATUS_ATENDIMENTO[a.status];
                const numero = telefoneLegivel(a.numero_instancia);
                return (
                  <li key={a.id}>
                    <Link href={`/chat?atendimento=${a.id}`} className={LINHA}>
                      <IconeLinha Icone={Icone} tom={a.status === "aberto" ? "ativo" : "neutro"} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{rotulo}</span>
                        <span className="block truncate text-[11.5px] tabular-nums text-zinc-500 dark:text-zinc-400">
                          {numero ? `pelo ${numero} · ` : ""}desde {dataDoInstante(a.data_criacao)}
                        </span>
                      </span>
                      {a.nao_lidas > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10.5px] font-semibold tabular-nums text-white">
                          {a.nao_lidas}
                        </span>
                      )}
                      <Selo tom={status.tom}>{status.rotulo}</Selo>
                      <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>
      )}

      <AnotacoesContato
        key={contato.id}
        contatoId={contato.id}
        nome={contato.nome}
        anotacoes={anotacoes}
        usuarioPorId={usuarioPorId}
        euId={euId}
      />

      <ObjecoesDoHistorico historico={historico} />

      <CamposDoContato contatoId={contato.id} definicoes={camposContato} />

      <ListaHistorico historico={historico} usuarioPorId={usuarioPorId} />
    </>
  );
}
