"use server";

// Mutações de departamento e permissão. Arquivo separado de ./actions.ts de
// propósito: aqui é a única porta que edita QUEM VÊ O QUÊ, e ela tem um guarda
// diferente do resto das Configurações.
//
// Toda ação abaixo começa com `exigirGerenciaAcessos()`. Não é zelo repetido:
// server action é ponto de entrada de rede — o navegador posta direto nela, sem
// passar pela tela que a chamou. Uma função destas sem a linha do guarda é um
// endpoint público que reescreve as permissões do CRM inteiro.
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { exigirGerenciaAcessos } from "@/lib/auth/dal";
import { ehChaveModulo, ehEscopo } from "@/lib/auth/modulos";

// A barra lateral muda de itens quando a permissão muda, e ela mora no layout
// raiz — daí o "layout" no revalidatePath da raiz, e não só o caminho literal.
function revalidar() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/", "layout");
}

// ── Departamentos ────────────────────────────────────────────────────────────

/**
 * Departamento novo nasce SEM NENHUM MÓDULO. É o mesmo princípio do proxy.ts,
 * que fecha por padrão: quem cria escolhe o que liberar, em vez de descobrir
 * depois o que veio junto sem querer.
 */
export async function criarDepartamento(
  nome: string,
  nivel: number,
): Promise<string> {
  await exigirGerenciaAcessos();

  const n = nome.trim();
  if (!n) throw new Error("Nome do departamento é obrigatório");

  // slug derivado do nome: sem acento, sem espaço. É o que consultas manuais e
  // scripts usam pra achar o departamento sem depender do uuid sorteado.
  const slug = n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("Nome precisa ter ao menos uma letra ou número");

  const faixa = Math.min(99, Math.max(1, Math.round(nivel)));

  try {
    const [d] = await sql`
      INSERT INTO departamentos (nome, slug, nivel)
      VALUES (${n}, ${slug}, ${faixa})
      RETURNING id`;
    revalidar();
    return d.id;
  } catch (e) {
    // slug é UNIQUE — nome repetido vira recado, não 500 cru.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") {
      throw new Error(`Já existe um departamento chamado "${n}"`);
    }
    throw e;
  }
}

export async function renomearDepartamento(id: string, nome: string): Promise<void> {
  await exigirGerenciaAcessos();
  const n = nome.trim();
  if (!n) throw new Error("Nome do departamento é obrigatório");
  // O slug NÃO acompanha o nome: ele é a referência estável que o seed da
  // migração e as consultas manuais usam. Renomear "TI" para "Tecnologia" não
  // pode fazer o slug 'ti' sumir debaixo delas.
  await sql`UPDATE departamentos SET nome = ${n} WHERE id = ${id}`;
  revalidar();
}

export async function apagarDepartamento(id: string): Promise<void> {
  const usuario = await exigirGerenciaAcessos();

  const [alvo] = (await sql`
    SELECT d.sistema, d.gerencia_acessos,
           (SELECT count(*) FROM usuarios u WHERE u.departamento_id = d.id)::int AS pessoas
      FROM departamentos d
     WHERE d.id = ${id}
  `) as { sistema: boolean; gerencia_acessos: boolean; pessoas: number }[];

  if (!alvo) throw new Error("Departamento não encontrado");

  // Os três do pedido são a estrutura que o resto assume existir.
  if (alvo.sistema) {
    throw new Error("Comercial, Admin e TI não podem ser apagados");
  }
  // O ON DELETE do banco é RESTRICT e recusaria de qualquer jeito — mas com um
  // erro de driver na cara do usuário. Aqui a recusa explica o que fazer.
  if (alvo.pessoas > 0) {
    throw new Error(
      `Ainda há ${alvo.pessoas} pessoa(s) neste departamento. Mova-as antes de apagar.`,
    );
  }
  if (id === usuario.departamento?.id) {
    throw new Error("Você não pode apagar o seu próprio departamento");
  }

  await sql`DELETE FROM departamentos WHERE id = ${id}`;
  revalidar();
}

/**
 * Liga/desliga a chave da própria portaria.
 *
 * DUAS TRAVAS, e as duas existem por causa do mesmo acidente: alguém se tranca
 * do lado de fora e não há mais ninguém que possa abrir. Sem tabela de sessão e
 * sem tela de recuperação, o conserto seria um UPDATE manual no banco.
 */
export async function definirGerenciaAcessos(
  id: string,
  ligado: boolean,
): Promise<void> {
  const usuario = await exigirGerenciaAcessos();

  if (!ligado) {
    // 1ª trava: não desligue de si mesmo.
    if (id === usuario.departamento?.id) {
      throw new Error(
        "Você não pode tirar essa permissão do seu próprio departamento — ficaria sem como voltar aqui",
      );
    }
    // 2ª trava: tem que sobrar alguém.
    const [{ restantes }] = (await sql`
      SELECT count(*)::int AS restantes
        FROM departamentos
       WHERE gerencia_acessos = true AND id <> ${id}
    `) as { restantes: number }[];
    if (restantes === 0) {
      throw new Error("Ao menos um departamento precisa administrar os acessos");
    }
  }

  await sql`
    UPDATE departamentos SET gerencia_acessos = ${ligado} WHERE id = ${id}`;
  revalidar();
}

// ── Módulos do departamento ──────────────────────────────────────────────────

/**
 * Liga ou desliga um módulo. LIGAR é INSERT, DESLIGAR é DELETE — não existe
 * linha "negado" na tabela: ausência de linha É a negação (ver
 * migration-departamentos.sql).
 */
export async function definirModulo(
  departamentoId: string,
  modulo: string,
  ligado: boolean,
): Promise<void> {
  await exigirGerenciaAcessos();

  // A chave vem do navegador. Sem esta linha dava pra gravar qualquer string em
  // `departamento_modulos` — a coluna não tem CHECK, de propósito —, e a tabela
  // viraria lixo que nenhuma tela lê e ninguém entende depois.
  if (!ehChaveModulo(modulo)) throw new Error(`Módulo desconhecido: ${modulo}`);

  if (ligado) {
    await sql`
      INSERT INTO departamento_modulos (departamento_id, modulo)
      VALUES (${departamentoId}, ${modulo})
      ON CONFLICT (departamento_id, modulo) DO NOTHING`;
  } else {
    await sql`
      DELETE FROM departamento_modulos
       WHERE departamento_id = ${departamentoId} AND modulo = ${modulo}`;
  }

  revalidar();
}

/**
 * Troca o escopo de um módulo já ligado: 'proprio' (só as linhas de quem olha)
 * ou 'todos'. É o que separa "o comercial vê as métricas dele" de "o admin vê
 * as de todos" sem que isso seja um `if` em TypeScript.
 */
export async function definirEscopoDoModulo(
  departamentoId: string,
  modulo: string,
  escopo: string,
): Promise<void> {
  await exigirGerenciaAcessos();
  if (!ehChaveModulo(modulo)) throw new Error(`Módulo desconhecido: ${modulo}`);
  if (!ehEscopo(escopo)) throw new Error(`Escopo inválido: ${escopo}`);

  await sql`
    UPDATE departamento_modulos SET escopo = ${escopo}
     WHERE departamento_id = ${departamentoId} AND modulo = ${modulo}`;
  revalidar();
}

// ── Participantes ────────────────────────────────────────────────────────────

/**
 * Move a pessoa de departamento. `departamentoId` nulo a deixa sem nenhum — e
 * sem nenhum é sem acesso a nada, que é um estado legítimo (conta nova, pessoa
 * que saiu do time mas cujo histórico fica).
 */
export async function moverParticipante(
  usuarioId: string,
  departamentoId: string | null,
): Promise<void> {
  const usuario = await exigirGerenciaAcessos();

  // A mesma trava do desligar, pelo mesmo motivo: mover a si mesmo pra um
  // departamento que não administra é se trancar do lado de fora. Mover OUTRA
  // pessoa pra fora é decisão administrativa legítima e passa.
  if (usuarioId === usuario.id) {
    if (!departamentoId) {
      throw new Error("Você não pode se deixar sem departamento");
    }
    const [destino] = (await sql`
      SELECT gerencia_acessos FROM departamentos WHERE id = ${departamentoId}
    `) as { gerencia_acessos: boolean }[];
    if (!destino) throw new Error("Departamento não encontrado");
    if (!destino.gerencia_acessos) {
      throw new Error(
        "Esse departamento não administra acessos — você perderia esta tela. Peça a outra pessoa que administre para te mover",
      );
    }
  }

  await sql`
    UPDATE usuarios SET departamento_id = ${departamentoId} WHERE id = ${usuarioId}`;
  revalidar();
}
