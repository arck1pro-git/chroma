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
import { documentosEscolhiveis, type Documento } from "@/lib/documentos";
import type { AcaoCadencia, Subetapa } from "@/lib/automacoes/cadencia";

// Instância de WhatsApp como a TELA a vê: sem token, sem base_url. O painel só
// precisa saber qual escolher; quem resolve o segredo é o executor, no
// servidor (lib/uazapi.ts).
export type InstanciaEscolhivel = {
  id: string;
  nome: string;
  numero: string | null;
};

// Quem pode ser AVISADO pela cadência. Só quem tem WhatsApp cadastrado entra:
// oferecer na tela alguém sem número seria deixar escolher um aviso que a
// publicação recusa depois.
export type PessoaAvisavel = {
  id: string;
  nome: string;
};

export type CadenciaDaEtapa = {
  fluxoId: string;
  nome: string;
  estado: "rascunho" | "publicado" | "pausado" | "arquivado";
  numeroVersao: number | null;
  subetapas: Subetapa[];
  // O que roda depois da última mensagem. As ações ENTRE mensagens vão dentro
  // de cada subetapa; estas não têm coluna depois em que se pendurar.
  acoesFinais: AcaoCadencia[];
  // false quando o fluxo ganhou desvio no builder e não cabe mais em colunas.
  linear: boolean;
  rascunhoPendente: boolean;
  publicadoAlgumaVez: boolean;
  // Publicar pega quem já está na etapa, ou só quem entrar daqui pra frente?
  // Quem entra depois entra sozinho nos dois casos — ver
  // inscreverNaCadenciaDaEtapa.
  inscreverAtuais: boolean;
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
  // A biblioteca, para o seletor de anexo da coluna. Só os não arquivados:
  // a lista existe para escolher o que ainda vale mandar.
  documentos: Documento[];
  // Quem pode receber notificação — os que têm WhatsApp em Configurações.
  avisaveis: PessoaAvisavel[];
};

// Exportado desde os departamentos: a raiz usa este mesmo objeto quando quem
// abriu NÃO tem o módulo de Automações. A tela já sabe desenhar o estado vazio
// (era o caso da migração não aplicada), então não foi preciso inventar um
// segundo caminho de "sem cadência" pra permissão.
export const CADENCIAS_VAZIAS: DadosCadencias = {
  porEtapa: new Map(),
  instancias: [],
  emCadencia: new Set(),
  documentos: [],
  avisaveis: [],
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
  let fluxos, posicoes, dentro, instancias, documentos, avisaveis;
  try {
    [fluxos, posicoes, dentro, instancias, documentos, avisaveis] = await Promise.all([
      fluxosDeEtapas(),
      posicaoNaCadencia(),
      oportunidadesEmCadencia(),
      sql`
        SELECT id, nome, numero FROM instancias_uazapi
        ORDER BY data_criacao`,
      // A biblioteca pode não existir ainda (migration-documentos.sql). Sem
      // anexo a cadência funciona inteira, então uma tabela que falta vira
      // lista vazia em vez de derrubar o quadro — mesma postura do catch
      // de `faltaMigration` logo abaixo.
      documentosEscolhiveis().catch(() => []),
      // `usuarios.whatsapp` pode não existir ainda (migration-usuario-whatsapp).
      // Sem ela a cadência funciona inteira menos o aviso, então a falta vira
      // lista vazia em vez de derrubar o quadro.
      sql`SELECT id, nome FROM usuarios
           WHERE ativo AND whatsapp IS NOT NULL ORDER BY nome`.catch(() => []),
    ]);
  } catch (e) {
    if (!faltaMigration(e)) throw e;
    console.warn(
      "[cadencias] migration-cadencia-etapa.sql ainda não foi aplicada — o quadro abre sem cadências.",
    );
    return CADENCIAS_VAZIAS;
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
    const { subetapas, linear, acoesFinais } = f.definicao
      ? lerCadencia(f.definicao)
      : { subetapas: [], linear: true, acoesFinais: [] };

    porEtapa.set(f.etapa_id, {
      fluxoId: f.id,
      nome: f.nome,
      estado: f.estado,
      numeroVersao: f.numero_versao,
      subetapas,
      acoesFinais,
      linear,
      rascunhoPendente: f.rascunho_pendente,
      publicadoAlgumaVez: f.publicado_alguma_vez,
      inscreverAtuais: f.inscrever_atuais,
      noFluxo: f.no_fluxo,
      erros14d: f.erros_14d,
      posicao: posicaoPorFluxo.get(f.id) ?? new Map(),
    });
  }

  return {
    porEtapa,
    instancias: instancias as unknown as InstanciaEscolhivel[],
    emCadencia: new Set(dentro.map((d) => d.entidade_id)),
    documentos,
    avisaveis: avisaveis as unknown as PessoaAvisavel[],
  };
}
