// Leitura das cadências para a raiz. Só importado por page.tsx (server).
//
// Uma consulta por assunto e um Promise.all: a raiz já faz ~13 consultas em
// paralelo (app/funil/dados.ts) e o pool está dimensionado para isso
// (max:12 em lib/db.ts) — ver o comentário de lá antes de acrescentar mais.

import { lerCadencia } from "@/lib/automacoes/cadencia";
import {
  fluxosDeEtapas,
  oportunidadesEmCadencia,
  posicaoNaCadencia,
} from "@/lib/automacoes/repositorio";
import { sql } from "@/lib/db";
import type { Subetapa } from "@/lib/automacoes/cadencia";

// Instância de WhatsApp como a TELA a vê: sem token, sem base_url. O painel só
// precisa saber qual escolher; quem resolve o segredo é o executor, no
// servidor (lib/uazapi.ts).
export type InstanciaEscolhivel = {
  id: string;
  nome: string;
  numero: string | null;
};

export type CadenciaDaEtapa = {
  fluxoId: string;
  nome: string;
  estado: "rascunho" | "publicado" | "pausado" | "arquivado";
  numeroVersao: number | null;
  subetapas: Subetapa[];
  // false quando o fluxo ganhou desvio no builder e não cabe mais em colunas.
  linear: boolean;
  rascunhoPendente: boolean;
  publicadoAlgumaVez: boolean;
  // quantas oportunidades estão dentro do fluxo agora
  noFluxo: number;
  erros14d: number;
  // oportunidade_id → id do bloco em que ela ESTÁ (o último que o motor
  // executou para ela). Quem não aparece aqui nunca entrou no fluxo, e a
  // coluna dele sai da régua de dias — ver `distribuir` em ./subetapas.ts.
  posicao: Map<string, string>;
};

export type DadosCadencias = {
  porEtapa: Map<string, CadenciaDaEtapa>;
  instancias: InstanciaEscolhivel[];
  // ids de oportunidades dentro de alguma cadência agora
  emCadencia: Set<string>;
};

const VAZIO: DadosCadencias = {
  porEtapa: new Map(),
  instancias: [],
  emCadencia: new Set(),
};

// 42703 = undefined_column. É o que o Postgres devolve enquanto o
// migration-cadencia-etapa.sql não foi rodado: `fluxos.etapa_id` não existe.
//
// Degradar em vez de estourar porque a raiz é a ÚNICA tela do CRM: derrubar o
// funil inteiro por causa de um recurso que ainda não foi ligado seria trocar
// um aviso por uma tela branca. Qualquer outro erro sobe normalmente — este
// catch é para uma condição nomeada, não um `catch {}` que engole tudo.
function faltaMigration(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "42703"
  );
}

export async function carregarCadencias(): Promise<DadosCadencias> {
  let fluxos, posicoes, dentro, instancias;
  try {
    [fluxos, posicoes, dentro, instancias] = await Promise.all([
      fluxosDeEtapas(),
      posicaoNaCadencia(),
      oportunidadesEmCadencia(),
      sql`
        SELECT id, nome, numero FROM instancias_uazapi
        ORDER BY data_criacao`,
    ]);
  } catch (e) {
    if (!faltaMigration(e)) throw e;
    console.warn(
      "[cadencias] migration-cadencia-etapa.sql ainda não foi aplicada — o quadro abre sem cadências.",
    );
    return VAZIO;
  }

  // fluxo → (oportunidade → bloco em que ela está)
  const posicaoPorFluxo = new Map<string, Map<string, string>>();
  for (const p of posicoes) {
    const porOp = posicaoPorFluxo.get(p.fluxo_id) ?? new Map<string, string>();
    porOp.set(p.entidade_id, p.no_id);
    posicaoPorFluxo.set(p.fluxo_id, porOp);
  }

  const porEtapa = new Map<string, CadenciaDaEtapa>();
  for (const f of fluxos) {
    const { subetapas, linear } = f.definicao
      ? lerCadencia(f.definicao)
      : { subetapas: [], linear: true };

    porEtapa.set(f.etapa_id, {
      fluxoId: f.id,
      nome: f.nome,
      estado: f.estado,
      numeroVersao: f.numero_versao,
      subetapas,
      linear,
      rascunhoPendente: f.rascunho_pendente,
      publicadoAlgumaVez: f.publicado_alguma_vez,
      noFluxo: f.no_fluxo,
      erros14d: f.erros_14d,
      posicao: posicaoPorFluxo.get(f.id) ?? new Map(),
    });
  }

  return {
    porEtapa,
    instancias: instancias as unknown as InstanciaEscolhivel[],
    emCadencia: new Set(dentro.map((d) => d.entidade_id)),
  };
}
