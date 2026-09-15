// Leitura das Configurações direto do Supabase. Só é importado pelos page.tsx
// de cada seção.
//
// Uma função por seção, e não um `carregarTudo`: cada entidade virou uma rota
// (ver ./layout.tsx), então abrir Tags não tem por que consultar funis, etapas,
// usuários, campos e instâncias junto. O que sobrou de Promise.all é só o que
// uma mesma tela precisa de fato.
import { sql } from "@/lib/db";
import type { Etapa, Funil, Segmento, Tag, Usuario } from "../data";

// Nasce da conexão com a uazapi (GET /instance/status), não de digitação livre
// — ver conectarInstancia em ./actions.ts. token NUNCA sai daqui inteiro: só
// os 4 últimos dígitos, pra tela conseguir mostrar "qual token é esse" sem
// devolver o segredo pro navegador a cada carga da página.
export type InstanciaUazapi = {
  id: string;
  nome: string;
  base_url: string;
  numero: string | null;
  token_mascarado: string;
  data_criacao: string;
};

// `chave` é como o valor é gravado no jsonb de contatos/oportunidades; `rotulo`
// é o que aparece na tela. Ver migration-campos-personalizados.sql.
export type CampoPersonalizado = {
  id: string;
  entidade: "contato" | "oportunidade";
  chave: string;
  rotulo: string;
  tipo: "texto" | "numero" | "data" | "opcao";
  opcoes: string[];
  ordem: number;
};

export type DadosFunis = {
  funis: Funil[];
  etapasPorFunil: Map<string, Etapa[]>;
};

// Funis e etapas vêm juntos porque são a MESMA tela: o card do funil só existe
// com as colunas dele dentro.
export async function carregarFunis(): Promise<DadosFunis> {
  const [funis, etapas] = await Promise.all([
    sql`SELECT id, nome, descricao, cor FROM funis ORDER BY data_criacao`,
    sql`SELECT id, nome, funil_id, ordem, cor FROM etapas ORDER BY funil_id, ordem`,
  ]);

  const etapasPorFunil = new Map<string, Etapa[]>();
  for (const e of etapas as Etapa[]) {
    const atual = etapasPorFunil.get(e.funil_id) ?? [];
    atual.push(e);
    etapasPorFunil.set(e.funil_id, atual);
  }

  return { funis: funis as Funil[], etapasPorFunil };
}

export async function carregarTags(): Promise<Tag[]> {
  const tags = await sql`SELECT id, nome FROM tags ORDER BY nome`;
  return tags as unknown as Tag[];
}

export async function carregarSegmentos(): Promise<Segmento[]> {
  const segmentos = await sql`SELECT id, nome FROM segmentos ORDER BY nome`;
  return segmentos as unknown as Segmento[];
}

export async function carregarUsuarios(): Promise<Usuario[]> {
  const usuarios = await sql`SELECT id, nome, iniciais FROM usuarios ORDER BY nome`;
  return usuarios as unknown as Usuario[];
}

export async function carregarCampos(): Promise<CampoPersonalizado[]> {
  // opcoes sai como jsonb, não como text[]: com fetch_types:false (exigido
  // pelo pooler) o driver não desserializa array nativo de forma confiável.
  const campos = await sql`
    SELECT id, entidade, chave, rotulo, tipo, ordem,
           COALESCE(to_jsonb(opcoes), '[]'::jsonb) AS opcoes
    FROM campos_personalizados
    ORDER BY entidade, ordem, rotulo`;
  return campos as unknown as CampoPersonalizado[];
}

export async function carregarInstancias(): Promise<InstanciaUazapi[]> {
  const instancias = await sql`
    SELECT id, nome, base_url, numero,
           '••••' || right(token, 4) AS token_mascarado,
           to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
    FROM instancias_uazapi ORDER BY data_criacao`;
  return instancias as unknown as InstanciaUazapi[];
}
