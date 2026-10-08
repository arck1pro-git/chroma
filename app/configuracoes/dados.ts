// Leitura das Configurações direto do Supabase. Só é importado pelos page.tsx
// de cada seção.
//
// Uma função por seção, e não um `carregarTudo`: cada entidade virou uma rota
// (ver ./layout.tsx), então abrir Tags não tem por que consultar funis, etapas,
// usuários, campos e instâncias junto. O que sobrou de Promise.all é só o que
// uma mesma tela precisa de fato.
import { sql } from "@/lib/db";
import type { Etapa, Funil, Segmento, Tag, Usuario } from "../data";
import { ehChaveModulo, ehEscopo, type ChaveModulo, type Escopo } from "@/lib/auth/modulos";

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
  /** Quantas oportunidades estão em cada etapa agora — todas, como o quadro. */
  oportunidadesPorEtapa: Record<string, number>;
};

// Funis e etapas vêm juntos porque são a MESMA tela: o card do funil só existe
// com as colunas dele dentro.
export async function carregarFunis(): Promise<DadosFunis> {
  const [funis, etapas, contagens] = await Promise.all([
    sql`SELECT id, nome, descricao, cor FROM funis ORDER BY data_criacao`,
    sql`SELECT id, nome, funil_id, ordem, cor, meta_evento FROM etapas ORDER BY funil_id, ordem`,
    // Quantas oportunidades em cada etapa. É o número que diz se renomear ou
    // reordenar uma etapa mexe com alguém — e a tela não tinha nenhum.
    sql`SELECT etapa_id, count(*)::int AS n FROM oportunidades GROUP BY etapa_id`,
  ]);

  const etapasPorFunil = new Map<string, Etapa[]>();
  for (const e of etapas as Etapa[]) {
    const atual = etapasPorFunil.get(e.funil_id) ?? [];
    atual.push(e);
    etapasPorFunil.set(e.funil_id, atual);
  }

  const oportunidadesPorEtapa: Record<string, number> = {};
  for (const c of contagens) oportunidadesPorEtapa[c.etapa_id as string] = c.n as number;

  return { funis: funis as Funil[], etapasPorFunil, oportunidadesPorEtapa };
}

/** Tag ou segmento com quantos contatos o usam — o "sai de 12 contatos" de
 *  quem vai excluir. */
export type NomeComUso = (Tag | Segmento) & { contatos: number };

export async function carregarTags(): Promise<NomeComUso[]> {
  const tags = await sql`
    SELECT t.id, t.nome, count(ct.contato_id)::int AS contatos
      FROM tags t
      LEFT JOIN contato_tags ct ON ct.tag_id = t.id
     GROUP BY t.id, t.nome
     ORDER BY t.nome`;
  return tags as unknown as NomeComUso[];
}

export async function carregarSegmentos(): Promise<NomeComUso[]> {
  const segmentos = await sql`
    SELECT s.id, s.nome, count(cs.contato_id)::int AS contatos
      FROM segmentos s
      LEFT JOIN contato_segmentos cs ON cs.segmento_id = s.id
     GROUP BY s.id, s.nome
     ORDER BY s.nome`;
  return segmentos as unknown as NomeComUso[];
}

/**
 * Usuário como a tela de Configurações o vê: com o WhatsApp junto.
 *
 * Tipo PRÓPRIO, e não `Usuario` alargado: aquele viaja para o quadro, o chat e
 * cada card (app/data.ts), e todas as consultas que o produzem selecionam três
 * colunas. Acrescentar o telefone lá obrigaria a tocar em todas — e mandaria o
 * número de todo mundo para o navegador de quem só quer ver um avatar.
 */
export type UsuarioConfig = Usuario & {
  whatsapp: string | null;
  // O WhatsApp de onde a pessoa envia. Definido ao criar a instância (o
  // "Usuário responsável") e trocado em Configurações · WhatsApp.
  instancia_id: string | null;
};

/**
 * A pessoa como a tela de Usuários a vê: o de sempre e o LOGIN — e-mail e
 * departamento. A senha não sai daqui, nem o hash: a tela só troca, nunca lê.
 *
 * Tipo à parte, e não UsuarioConfig alargado: a seção de WhatsApp também lê
 * usuários e não tem por que receber o e-mail de ninguém.
 */
export type UsuarioComConta = UsuarioConfig & {
  /** null = sem login: só aparece como responsável e autor. */
  email: string | null;
  departamento_id: string | null;
  ativo: boolean;
};

export async function carregarUsuariosComConta(): Promise<UsuarioComConta[]> {
  const usuarios = await sql`
    SELECT id, nome, iniciais, whatsapp, instancia_id, email, departamento_id, ativo
      FROM usuarios
     ORDER BY nome`;
  return usuarios as unknown as UsuarioComConta[];
}

/** O que o seletor de departamento da conta oferece. */
export type DepartamentoDaConta = { id: string; nome: string; gerenciaAcessos: boolean };

export async function carregarDepartamentosDaConta(): Promise<DepartamentoDaConta[]> {
  const departamentos = await sql`
    SELECT id, nome, gerencia_acessos AS "gerenciaAcessos"
      FROM departamentos
     ORDER BY nivel, nome`;
  return departamentos as unknown as DepartamentoDaConta[];
}

export async function carregarUsuarios(): Promise<UsuarioConfig[]> {
  const usuarios = await sql`
    SELECT id, nome, iniciais, whatsapp, instancia_id FROM usuarios ORDER BY nome`;
  return usuarios as unknown as UsuarioConfig[];
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

// ── Acessos ──────────────────────────────────────────────────────────────────
// Departamentos, os módulos de cada um e quem está dentro. Lido só por
// /configuracoes/acessos, que é tela de quem administra (ver
// exigirGerenciaAcessos em lib/auth/dal.ts).

export type DepartamentoConfig = {
  id: string;
  nome: string;
  slug: string;
  nivel: number;
  /** Os três do seed (Comercial/Admin/TI) não se apagam. */
  sistema: boolean;
  gerenciaAcessos: boolean;
  /**
   * chave do módulo → escopo. Objeto e não Map: isto atravessa a fronteira
   * servidor→cliente, e objeto simples é o que não depende de serialização
   * especial pra chegar inteiro do outro lado.
   */
  modulos: Partial<Record<ChaveModulo, Escopo>>;
};

export type ParticipanteConfig = {
  id: string;
  nome: string;
  iniciais: string;
  email: string;
  departamentoId: string | null;
};

export type DadosAcessos = {
  departamentos: DepartamentoConfig[];
  participantes: ParticipanteConfig[];
};

export async function carregarAcessos(): Promise<DadosAcessos> {
  const [departamentos, participantes] = await Promise.all([
    // jsonb_object_agg pelo mesmo motivo da DAL: com `fetch_types:false`
    // (exigido pelo pooler, ver lib/db.ts) array nativo não volta confiável.
    sql`
      SELECT d.id, d.nome, d.slug, d.nivel, d.sistema,
             d.gerencia_acessos AS "gerenciaAcessos",
             COALESCE(
               jsonb_object_agg(dm.modulo, dm.escopo)
                 FILTER (WHERE dm.modulo IS NOT NULL),
               '{}'::jsonb
             ) AS modulos
        FROM departamentos d
        LEFT JOIN departamento_modulos dm ON dm.departamento_id = d.id
       GROUP BY d.id, d.nome, d.slug, d.nivel, d.sistema, d.gerencia_acessos
       ORDER BY d.nivel DESC, d.nome
    `,
    // Só quem TEM login. Usuário sem email existe só pra aparecer como
    // responsável no card e no balão (ver migration-front.sql) — dar
    // departamento a ele seria oferecer acesso a uma conta que não entra.
    sql`
      SELECT id, nome, iniciais, email, departamento_id AS "departamentoId"
        FROM usuarios
       WHERE email IS NOT NULL
         AND ativo = true
       ORDER BY nome
    `,
  ]);

  return {
    departamentos: (departamentos as DepartamentoConfig[]).map((d) => {
      // Peneira contra o catálogo do código: módulo removido de
      // lib/auth/modulos.ts deixa linha órfã na tabela (não há CHECK lá, de
      // propósito), e essa linha não pode virar caixinha fantasma na tela.
      const modulos: Partial<Record<ChaveModulo, Escopo>> = {};
      for (const [chave, escopo] of Object.entries(d.modulos ?? {})) {
        if (!ehChaveModulo(chave)) continue;
        modulos[chave] = ehEscopo(escopo as string) ? (escopo as Escopo) : "proprio";
      }
      return { ...d, modulos };
    }),
    participantes: participantes as unknown as ParticipanteConfig[],
  };
}
