// A sessão: um JWT HS256 assinado, guardado num cookie httpOnly.
//
// SEM TABELA DE SESSÃO, e isso é uma escolha com preço. O que se ganha: nenhuma
// consulta ao banco pra saber quem é quem no proxy, que roda em TODA requisição
// (inclusive nos prefetch do <Link>) — uma consulta ali seria uma por link que
// aparece na tela. O que se paga: não dá pra revogar um token específico antes
// dele expirar. O contrapeso é a DAL (lib/auth/dal.ts), que confere `ativo` no
// banco a cada render de página — desligar o usuário lá corta o acesso no
// próximo carregamento, mesmo com o cookie ainda válido.
//
// O payload leva SÓ o id, e mais nada: o cookie vai e volta em toda requisição,
// e é ASSINADO, não cifrado — qualquer um lê o conteúdo. Nome, email e telefone
// ficam de fora por isso.
//
// O `papel` saiu daqui em migration-departamentos.sql, e a razão não é tamanho:
// permissão agora é o departamento, que o TI muda na tela a qualquer momento.
// Uma cópia dela no cookie ficaria velha por até 7 dias — alguém rebaixado
// continuaria entrando onde não devia até o cookie expirar. Quem responde
// "o que essa pessoa pode ver" é a DAL, que vai ao banco a cada render.
//
// Cookie antigo (com a claim `papel`) continua valendo: a claim a mais é
// simplesmente ignorada na verificação, então a virada não desloga ninguém.
import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const COOKIE_SESSAO = "chroma_sessao";

const DURACAO_DIAS = 7;
const DURACAO_MS = DURACAO_DIAS * 24 * 60 * 60 * 1000;

export type Sessao = { usuarioId: string };

// Leitura PREGUIÇOSA da chave, igual lib/db.ts faz com a DATABASE_URL: ler no
// import faria `next build` quebrar em máquina sem .env.
function chave(): Uint8Array {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) {
    throw new Error(
      "SESSION_SECRET não definida. Sem ela não há como assinar sessão — gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  // Recusa chave curta em vez de assinar mal: HS256 com segredo de 8 caracteres
  // é quebrável por força bruta offline, e quem tiver a chave forja a sessão de
  // qualquer um, inclusive a do admin.
  if (segredo.length < 32) {
    throw new Error("SESSION_SECRET curta demais (mínimo 32 caracteres).");
  }
  return new TextEncoder().encode(segredo);
}

export async function assinar(sessao: Sessao, expiraEm: Date): Promise<string> {
  return new SignJWT({ ...sessao })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiraEm)
    .sign(chave());
}

/**
 * Verifica assinatura e validade. Devolve null pra qualquer problema — token
 * ausente, expirado, assinado com outra chave, ou com payload fora do formato.
 *
 * `algorithms: ["HS256"]` não é decoração: sem essa trava, um token com
 * `alg: none` no header passaria pela verificação sem assinatura nenhuma.
 */
export async function verificar(token: string | undefined): Promise<Sessao | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, chave(), {
      algorithms: ["HS256"],
    });
    const usuarioId = payload.usuarioId;
    if (typeof usuarioId !== "string" || !usuarioId) return null;
    // A claim `papel` dos cookies emitidos antes dos departamentos cai aqui,
    // ignorada — é o que faz a virada não deslogar quem já estava dentro.
    return { usuarioId };
  } catch {
    return null;
  }
}

export async function criarSessao(sessao: Sessao): Promise<void> {
  const expira = new Date(Date.now() + DURACAO_MS);
  const token = await assinar(sessao, expira);
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_SESSAO, token, {
    // Fora do alcance de document.cookie: um XSS em qualquer tela do CRM
    // roubaria a sessão sem isto.
    httpOnly: true,
    // Em desenvolvimento o CRM roda em http://localhost, e um cookie `secure`
    // simplesmente não é gravado ali — ninguém conseguiria logar.
    secure: process.env.NODE_ENV === "production",
    // `lax` e não `strict`: com strict, chegar no CRM por um link de fora
    // (o link da ficha que o time manda no WhatsApp) cairia sempre no login.
    // lax já barra o POST cross-site, que é o que o CSRF precisa.
    sameSite: "lax",
    expires: expira,
    path: "/",
  });
}

export async function lerSessao(): Promise<Sessao | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  return verificar(token);
}

export async function destruirSessao(): Promise<void> {
  (await cookies()).delete(COOKIE_SESSAO);
}
