"use server";

// Mutações de usuários e do login deles (Configurações › Usuários).
//
// Toda ação aqui é ponto de entrada de rede: o navegador posta direto nela, sem
// passar pela tela. Por isso cada uma começa pela guarda. Erro esperado volta
// como `ResultadoAcao` (lib/resultado-acao.ts), nunca como exceção: em produção
// a mensagem de um erro lançado não chega à tela.
//
// Era um trecho de ./actions.ts, que passou de 1.200 linhas e foi dividido por
// assunto em 2026-10-21 (o mesmo desenho de ./acoes-acessos.ts). O "layout" no
// revalidatePath("/configuracoes") vale para todas: cada seção é uma rota.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirGestaoDeUsuarios, type UsuarioLogado } from "@/lib/auth/dal";
import { gerarHash } from "@/lib/auth/senha";
import { sql } from "@/lib/db";
import { comoResultado, Recusa, type ResultadoAcao } from "@/lib/resultado-acao";
import { ehUuid } from "@/lib/validacao";

// ── Usuários ─────────────────────────────────────────────────────────────────
// Desde 2026-10-07 esta seção também cria e edita o LOGIN — e-mail, senha e
// departamento (pedido dele: "o admin pode criar e editar um usuário"). Antes
// só o scripts/criar-usuario.ts fazia isso. Quem abre a tela está em
// gereUsuarios (lib/auth/dal.ts); o que cada um pode mexer, no teto abaixo.

// Iniciais: sempre do nome (1ª letra das 2 primeiras palavras). Deixaram de ser
// campo do formulário em 2026-10-08 ("sem inicial").
function iniciaisDe(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

function revalidarUsuarios() {
  revalidatePath("/configuracoes", "layout");
  revalidatePath("/chat");
  revalidatePath("/");
}

/**
 * O WhatsApp de quem trabalha aqui, normalizado para o formato do banco: só
 * dígitos, com DDI. É por este número que a automação AVISA a pessoa (o bloco
 * "Enviar notificação"), então vazio é legítimo — a maioria não recebe aviso
 * nenhum, e exigir telefone travaria o cadastro de quem só existe para aparecer
 * como responsável.
 *
 * Número curto vira erro em vez de ser gravado torto: o CHECK da tabela recusa
 * de qualquer jeito, e o erro do Postgres não serve para ler.
 */
function whatsappOuNulo(bruto: string): string | null {
  const so = bruto.replace(/\D/g, "");
  if (!so) return null;
  // 10 = fixo com DDD sem DDI; 15 = teto do E.164. Fora disso é engano de
  // digitação, e um aviso indo para um número inexistente falha semanas depois.
  if (so.length < 10 || so.length > 15) {
    throw new Recusa(
      "WhatsApp inválido — use DDI, DDD e número (ex.: 5547921379 73)",
    );
  }
  return so;
}

// O e-mail como o login o lê (app/login/acoes.ts): sem espaço e minúsculo, e
// validado DEPOIS de normalizado. Gravado de outro jeito, a pessoa não entraria.
const EMAIL = z.string().trim().toLowerCase().pipe(z.email().max(200));

/** O mesmo mínimo do scripts/criar-usuario.ts, que era a porta até aqui. */
const SENHA_MINIMA = 12;

function emailOuNulo(bruto: string): string | null {
  if (!bruto.trim()) return null;
  const lido = EMAIL.safeParse(bruto);
  if (!lido.success) throw new Recusa("E-mail inválido");
  return lido.data;
}

/** null = não mexe na senha (o campo em branco da edição). */
function senhaOuNula(bruta: string): string | null {
  if (!bruta) return null;
  if (bruta.length < SENHA_MINIMA) {
    throw new Recusa(`A senha precisa de ao menos ${SENHA_MINIMA} caracteres`);
  }
  // O teto do login: senha maior que isto nunca conferiria lá.
  if (bruta.length > 200) throw new Recusa("Senha longa demais (máximo 200 caracteres)");
  return bruta;
}

type DepartamentoEscolhido = { id: string; nome: string; gerencia_acessos: boolean };

async function departamentoOuNulo(bruto: string): Promise<DepartamentoEscolhido | null> {
  const id = bruto.trim();
  if (!id) return null;
  if (!ehUuid(id)) throw new Recusa("Departamento inválido");
  const [d] = (await sql`
    SELECT id, nome, gerencia_acessos FROM departamentos WHERE id = ${id}
  `) as DepartamentoEscolhido[];
  if (!d) throw new Recusa("Esse departamento não existe mais");
  return d;
}

/**
 * O TETO DA PORTARIA: quem não administra acessos não põe ninguém num
 * departamento que administra. Sem ele, o Admin criaria uma conta no TI,
 * entraria por ela em Acessos e de lá se daria qualquer módulo — o desenho de
 * migration-departamentos.sql (gerencia_acessos separado de Configurações)
 * cairia por uma porta lateral.
 */
function conferirTeto(eu: UsuarioLogado, destino: DepartamentoEscolhido | null) {
  if (destino?.gerencia_acessos && !eu.departamento?.gerenciaAcessos) {
    throw new Recusa(`Só quem administra acessos põe alguém no ${destino.nome}`);
  }
}

/**
 * O formulário de usuário — o mesmo para criar e para editar.
 *
 * Sem o número de ENVIO (usuarios.instancia_id) desde 2026-10-08: ele é
 * definido ao criar a instância de WhatsApp (o "Usuário responsável") e trocado
 * em Configurações · WhatsApp. Salvar o usuário não toca nesse vínculo — senão
 * editar a senha de alguém apagaria o WhatsApp de onde ele envia.
 */
export type DadosUsuario = {
  nome: string;
  whatsapp: string;
  /** Vazio = sem login: a pessoa só aparece como responsável e autora. */
  email: string;
  /** Na edição, vazio mantém a senha atual. */
  senha: string;
  /** Vazio = sem departamento, que é não ver módulo nenhum. */
  departamentoId: string;
};

// O índice único de lower(email) (migration-auth.sql) é o único 23505 possível
// ao gravar usuário.
const EMAIL_REPETIDO = { duplicado: "Já existe uma conta com esse e-mail" };

export async function criarUsuario(dados: DadosUsuario): Promise<ResultadoAcao> {
  const eu = await exigirGestaoDeUsuarios();
  return comoResultado(async () => {
    const n = dados.nome.trim();
    if (!n) throw new Recusa("Nome é obrigatório");
    const ini = iniciaisDe(n);
    const email = emailOuNulo(dados.email);
    const senha = senhaOuNula(dados.senha);
    const departamento = await departamentoOuNulo(dados.departamentoId);

    if (email) {
      if (!senha) throw new Recusa("Defina a senha — é com ela e o e-mail que a pessoa entra");
      if (!departamento) throw new Recusa("Escolha o departamento — sem ele a pessoa entra e não vê nada");
    } else if (senha || departamento) {
      throw new Recusa("Senha e departamento são de quem entra no sistema: preencha o e-mail");
    }
    conferirTeto(eu, departamento);

    const whatsapp = whatsappOuNulo(dados.whatsapp);
    const hash = senha ? await gerarHash(senha) : null;
    await sql`
      INSERT INTO usuarios (nome, iniciais, whatsapp, email, senha_hash, departamento_id)
      VALUES (${n}, ${ini}, ${whatsapp}, ${email}, ${hash}, ${departamento?.id ?? null})`;
    revalidarUsuarios();
  }, EMAIL_REPETIDO);
}

export async function editarUsuario(id: string, dados: DadosUsuario): Promise<ResultadoAcao> {
  const eu = await exigirGestaoDeUsuarios();
  const administro = eu.departamento?.gerenciaAcessos ?? false;
  return comoResultado(async () => {
    if (!ehUuid(id)) throw new Recusa("Usuário inválido");
    const [alvo] = (await sql`
      SELECT u.email, u.departamento_id, COALESCE(d.gerencia_acessos, false) AS gerencia
        FROM usuarios u
        LEFT JOIN departamentos d ON d.id = u.departamento_id
       WHERE u.id = ${id}
    `) as { email: string | null; departamento_id: string | null; gerencia: boolean }[];
    if (!alvo) throw new Recusa("Esse usuário não existe mais");
    // O teto, do outro lado: a conta de quem administra acessos só quem
    // administra edita — trocar a senha dela seria entrar por ela.
    if (alvo.gerencia && !administro) {
      throw new Recusa("Esta conta é de quem administra acessos — só o TI a edita");
    }

    const n = dados.nome.trim();
    if (!n) throw new Recusa("Nome é obrigatório");
    const ini = iniciaisDe(n);
    const email = emailOuNulo(dados.email);
    const senha = senhaOuNula(dados.senha);
    const departamento = await departamentoOuNulo(dados.departamentoId);

    if (!email) {
      // Tirar o e-mail apagaria login e senha juntos. Para cortar o acesso sem
      // perder a conta existe "Sem departamento".
      if (alvo.email) {
        throw new Recusa('O e-mail é o login desta pessoa e não fica vazio — para tirar o acesso, escolha "Sem departamento"');
      }
      if (senha || departamento) {
        throw new Recusa("Senha e departamento são de quem entra no sistema: preencha o e-mail");
      }
    } else if (!alvo.email) {
      // Ganhando login agora: as mesmas exigências da conta nova.
      if (!senha) throw new Recusa("Defina a senha — é com ela e o e-mail que a pessoa vai entrar");
      if (!departamento) throw new Recusa("Escolha o departamento — sem ele a pessoa entra e não vê nada");
    }

    // O próprio departamento não muda aqui: seria se trancar fora desta tela
    // (ou, no TI, de Acessos). Quem muda é a tela de Acessos, com as travas
    // dela (ver moverParticipante em ./acoes-acessos.ts).
    if (id === eu.id && (departamento?.id ?? null) !== alvo.departamento_id) {
      throw new Recusa("O seu próprio departamento não muda aqui — peça a quem administra acessos");
    }
    conferirTeto(eu, departamento);

    const whatsapp = whatsappOuNulo(dados.whatsapp);
    const hash = senha ? await gerarHash(senha) : null;

    // O teto vai TAMBÉM no WHERE: entre a leitura acima e este UPDATE alguém
    // pode ter posto a pessoa num departamento que administra acessos.
    const feitos = await sql`
      UPDATE usuarios
         SET nome = ${n}, iniciais = ${ini}, whatsapp = ${whatsapp},
             email = ${email},
             senha_hash = COALESCE(${hash}::text, senha_hash),
             departamento_id = ${departamento?.id ?? null}
       WHERE id = ${id}
         AND (${administro}::boolean
              OR departamento_id IS NULL
              OR departamento_id NOT IN (SELECT id FROM departamentos WHERE gerencia_acessos))
      RETURNING id`;
    if (feitos.length === 0) {
      throw new Recusa("Esta conta mudou enquanto você editava — recarregue a página");
    }
    revalidarUsuarios();
  }, EMAIL_REPETIDO);
}
