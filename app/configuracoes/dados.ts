// Leitura das Configurações direto do Neon/Supabase. Só é importado por page.tsx.
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

export type DadosConfig = {
  funis: Funil[];
  etapasPorFunil: Map<string, Etapa[]>;
  tags: Tag[];
  segmentos: Segmento[];
  usuarios: Usuario[];
  instancias: InstanciaUazapi[];
  campos: CampoPersonalizado[];
};

export async function carregarConfiguracoes(): Promise<DadosConfig> {
  const [funis, etapas, tags, segmentos, usuarios, instancias, campos] = await Promise.all([
    sql`SELECT id, nome, descricao FROM funis ORDER BY data_criacao`,
    sql`SELECT id, nome, funil_id, ordem, cor FROM etapas ORDER BY funil_id, ordem`,
    sql`SELECT id, nome FROM tags ORDER BY nome`,
    sql`SELECT id, nome FROM segmentos ORDER BY nome`,
    sql`SELECT id, nome, iniciais FROM usuarios ORDER BY nome`,
    sql`
      SELECT id, nome, base_url, numero,
             '••••' || right(token, 4) AS token_mascarado,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM instancias_uazapi ORDER BY data_criacao`,
    // opcoes sai como jsonb, não como text[]: com fetch_types:false (exigido
    // pelo pooler) o driver não desserializa array nativo de forma confiável.
    sql`
      SELECT id, entidade, chave, rotulo, tipo, ordem,
             COALESCE(to_jsonb(opcoes), '[]'::jsonb) AS opcoes
      FROM campos_personalizados
      ORDER BY entidade, ordem, rotulo`,
  ]);

  const etapasPorFunil = new Map<string, Etapa[]>();
  for (const e of etapas as Etapa[]) {
    const atual = etapasPorFunil.get(e.funil_id) ?? [];
    atual.push(e);
    etapasPorFunil.set(e.funil_id, atual);
  }

  return {
    funis: funis as Funil[],
    etapasPorFunil,
    tags: tags as unknown as Tag[],
    segmentos: segmentos as unknown as Segmento[],
    usuarios: usuarios as Usuario[],
    instancias: instancias as unknown as InstanciaUazapi[],
    campos: campos as unknown as CampoPersonalizado[],
  };
}
