// Camada de acesso (DAL): o ÚNICO lugar que responde "quem está falando" e
// "o que essa pessoa pode ver".
//
// O proxy (proxy.ts) já barra quem não tem cookie, mas ele é uma checagem
// OTIMISTA: lê o cookie e acredita. Isso basta pra redirecionar, e não basta
// pra liberar dado. Quem libera dado é aqui, e aqui confere no banco.
//
// A diferença aparece em três casos reais: usuário desativado em Configurações
// (o cookie dele continua valendo por até 7 dias), usuário apagado, e — desde
// migration-departamentos.sql — usuário que MUDOU DE DEPARTAMENTO. Nos três, o
// proxy deixa passar e esta função corta.
//
// POR QUE O MÓDULO NÃO É CONFERIDO NO PROXY: permissão mora no banco, e o proxy
// roda em toda requisição, inclusive nos prefetch que o <Link> dispara ao
// aparecer na tela — uma consulta ali seria uma por link visível. A regra do
// guia de autenticação do Next vale inteira aqui: checagem otimista na borda,
// checagem de verdade junto do dado.
//
// `cache` do React memoriza por render: uma página que chama exigirModulo() no
// page.tsx e usuarioAtual() no layout faz UMA consulta, não duas.
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { lerSessao } from "./sessao";
import {
  MODULOS,
  ehChaveModulo,
  ehEscopo,
  type ChaveModulo,
  type Escopo,
} from "./modulos";

export type DepartamentoDoUsuario = {
  id: string;
  nome: string;
  slug: string;
  nivel: number;
  /** Abre /configuracoes/acessos — ver a coluna homônima na migração. */
  gerenciaAcessos: boolean;
};

export type UsuarioLogado = {
  id: string;
  nome: string;
  iniciais: string;
  email: string;
  // null = usuário sem departamento. Não é erro: é o cadastro que existe só pra
  // aparecer como responsável (sem e-mail/senha) e a conta nova que ninguém
  // classificou ainda. Os dois veem zero módulos, que é o certo.
  departamento: DepartamentoDoUsuario | null;
  /** chave do módulo → até onde ela enxerga dentro dele. */
  modulos: Map<ChaveModulo, Escopo>;
};

type LinhaUsuario = {
  id: string;
  nome: string;
  iniciais: string;
  email: string;
  departamento_id: string | null;
  departamento_nome: string | null;
  departamento_slug: string | null;
  departamento_nivel: number | null;
  gerencia_acessos: boolean | null;
  modulos: Record<string, string>;
};

/**
 * Quem está logado, ou null. Não redireciona — serve pra barra lateral, que
 * muda de cara conforme os módulos, e pro /login saber que já tem sessão.
 */
export const usuarioAtual = cache(async (): Promise<UsuarioLogado | null> => {
  const sessao = await lerSessao();
  if (!sessao) return null;

  // Identidade e permissão numa consulta só: são lidas SEMPRE juntas (toda
  // página chama exigirModulo), e duas idas ao banco por render não pagariam o
  // arquivo a mais.
  //
  // jsonb_object_agg e não array de linhas: com `fetch_types:false` (exigido
  // pelo pooler, ver lib/db.ts) o driver não desserializa array nativo de forma
  // confiável — jsonb volta como objeto e pronto. Mesmo motivo do
  // `to_jsonb(opcoes)` em app/configuracoes/dados.ts.
  const linhas = (await sql`
    SELECT u.id, u.nome, u.iniciais, u.email,
           d.id               AS departamento_id,
           d.nome             AS departamento_nome,
           d.slug             AS departamento_slug,
           d.nivel            AS departamento_nivel,
           d.gerencia_acessos AS gerencia_acessos,
           COALESCE(
             jsonb_object_agg(dm.modulo, dm.escopo)
               FILTER (WHERE dm.modulo IS NOT NULL),
             '{}'::jsonb
           ) AS modulos
      FROM usuarios u
      LEFT JOIN departamentos d
        ON d.id = u.departamento_id
      LEFT JOIN departamento_modulos dm
        ON dm.departamento_id = d.id
     WHERE u.id = ${sessao.usuarioId}
       AND u.ativo = true
       AND u.email IS NOT NULL
     GROUP BY u.id, u.nome, u.iniciais, u.email,
              d.id, d.nome, d.slug, d.nivel, d.gerencia_acessos
     LIMIT 1
  `) as LinhaUsuario[];

  const linha = linhas[0];
  if (!linha) return null;

  // Peneira o que veio do banco contra o catálogo do código. `modulo` não tem
  // CHECK na tabela de propósito (a lista muda por deploy, ver a migração), e a
  // consequência é esta: módulo removido do código deixa linha órfã, e essa
  // linha é ignorada em silêncio em vez de virar erro na cara de quem abriu a
  // tela.
  const modulos = new Map<ChaveModulo, Escopo>();
  for (const [chave, escopo] of Object.entries(linha.modulos ?? {})) {
    if (!ehChaveModulo(chave)) continue;
    modulos.set(chave, ehEscopo(escopo) ? escopo : "proprio");
  }

  return {
    id: linha.id,
    nome: linha.nome,
    iniciais: linha.iniciais,
    email: linha.email,
    departamento: linha.departamento_id
      ? {
          id: linha.departamento_id,
          nome: linha.departamento_nome ?? "",
          slug: linha.departamento_slug ?? "",
          nivel: linha.departamento_nivel ?? 1,
          gerenciaAcessos: linha.gerencia_acessos ?? false,
        }
      : null,
    modulos,
  };
});

/**
 * Exige sessão válida. Em Server Component ou Server Action, manda pro /login
 * quando não houver. NÃO serve em Route Handler — lá o redirect vira resposta
 * 307 pra um endpoint que devolve HTML; use `exigirLoginApi`.
 */
export async function exigirLogin(): Promise<UsuarioLogado> {
  const usuario = await usuarioAtual();
  if (!usuario) redirect("/login");
  return usuario;
}

/**
 * Pra onde mandar alguém que bateu numa porta fechada: o primeiro módulo que
 * ela PODE ver, na ordem da barra lateral.
 *
 * Nunca devolve uma rota que a pessoa não alcança — é isso que impede o laço de
 * redirecionamento. Sem nenhum módulo, vai pra /sem-acesso, que só exige login.
 */
function destinoPossivel(usuario: UsuarioLogado): string {
  const primeiro = MODULOS.find((m) => usuario.modulos.has(m.chave));
  return primeiro?.href ?? "/sem-acesso";
}

export type AcessoAoModulo = {
  usuario: UsuarioLogado;
  /**
   * 'proprio' → a tela filtra pelas linhas em que o usuário é responsável.
   * 'todos'   → sem filtro de dono.
   *
   * Quem consome TEM que usar isto na consulta. O escopo não é decoração de
   * interface: esconder linha no React deixa o dado viajar pro navegador do
   * mesmo jeito, e aí basta abrir o DevTools pra ler o número do colega.
   */
  escopo: Escopo;
};

/**
 * Exige acesso ao módulo. É a linha que vai no topo de CADA page.tsx e de cada
 * server action — não no layout: com Partial Rendering o layout não
 * re-renderiza a cada navegação, então a checagem lá deixaria de rodar
 * justamente quando a pessoa troca de tela.
 */
export async function exigirModulo(
  chave: ChaveModulo,
): Promise<AcessoAoModulo> {
  const usuario = await exigirLogin();
  const escopo = usuario.modulos.get(chave);
  // Manda pro que ela pode ver, não pro /login: a pessoa ESTÁ autenticada, só
  // não tem o módulo. Reapresentar o login sugeriria que entrar de novo
  // resolveria.
  if (!escopo) redirect(destinoPossivel(usuario));
  return { usuario, escopo };
}

/**
 * A portaria da própria portaria: só o departamento marcado com
 * `gerencia_acessos` edita departamentos e permissões.
 *
 * NÃO é o módulo 'configuracoes'. Se fosse, quem tivesse Configurações poderia
 * se dar qualquer módulo — inclusive os três que o pedido tirou do Admin. Ver o
 * comentário da coluna em migration-departamentos.sql.
 */
export async function exigirGerenciaAcessos(): Promise<UsuarioLogado> {
  const usuario = await exigirLogin();
  if (!usuario.departamento?.gerenciaAcessos) {
    redirect(destinoPossivel(usuario));
  }
  return usuario;
}

/**
 * Versão pra Route Handler. Devolve o usuário, ou a Response pronta —
 * quem chama decide, com `if (resposta instanceof Response) return resposta`.
 */
export async function exigirLoginApi(): Promise<UsuarioLogado | Response> {
  const usuario = await usuarioAtual();
  if (!usuario) {
    return Response.json({ erro: "não autenticado" }, { status: 401 });
  }
  return usuario;
}

/**
 * Idem, com módulo. 403 e não 401: 401 quer dizer "identifique-se" e faria a
 * interface mandar a pessoa pro login — quando o problema é que ela já está
 * identificada e não tem esse módulo. Entrar de novo não mudaria nada.
 */
export async function exigirModuloApi(
  chave: ChaveModulo,
): Promise<AcessoAoModulo | Response> {
  const usuario = await usuarioAtual();
  if (!usuario) {
    return Response.json({ erro: "não autenticado" }, { status: 401 });
  }
  const escopo = usuario.modulos.get(chave);
  if (!escopo) {
    return Response.json({ erro: "sem acesso ao módulo" }, { status: 403 });
  }
  return { usuario, escopo };
}
