// A conta Google da empresa, conectada por OAuth: consentimento → refresh token
// guardado (cifrado) em google_conexao → access token sob demanda.
//
// POR QUE OAUTH E NÃO A SERVICE ACCOUNT de lib/google-sa.ts: a agenda é de uma
// pessoa de verdade (o especialista), e a service account só enxerga calendário
// compartilhado com ela — e, sem Google Workspace com delegação, não convida
// participantes nem gera link do Meet. Marcar reunião com o lead exige as duas
// coisas. O Search Console continua na service account; são credenciais
// separadas.
//
// UMA CONTA SÓ (decisão dele, 2026-10-02): a tabela tem uma linha. Conectar de
// novo troca a conta; desconectar apaga a linha e revoga o token no Google.
//
// O app no Google Cloud precisa de:
//   · credencial OAuth "Aplicativo da Web" → GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET
//   · redirecionamento autorizado: <origem>/api/google/callback (prod e localhost)
//   · tela de consentimento PUBLICADA (ou Interna, no Workspace). Em modo Teste
//     o Google mata o refresh token em 7 dias e a agenda "desconecta sozinha".
import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Ler e criar eventos (inclusive com Meet), em qualquer agenda a que a conta tem acesso. */
export const ESCOPO_EVENTOS = "https://www.googleapis.com/auth/calendar.events";
/** Só a LISTA de agendas da conta (nome, cor) — é o que a Agenda mostra como filtro. */
export const ESCOPO_AGENDAS = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

// openid + email só para saber QUAL conta foi conectada — é o que a tela mostra.
// O de agendas é opcional: sem ele (conta conectada antes, ou caixa desmarcada
// no consentimento) a Agenda mostra só a principal.
export const ESCOPOS = ["openid", "email", ESCOPO_EVENTOS, ESCOPO_AGENDAS];

/** Caminho do retorno do consentimento. A URL inteira é o que vai no Google Cloud. */
export const CAMINHO_CALLBACK = "/api/google/callback";

/** Cookie que guarda o `state` entre a ida ao Google e a volta. */
export const COOKIE_ESTADO = "chroma_google_estado";

/** A conexão sem o segredo: o que a tela e o resto do código precisam. */
export type ConexaoGoogle = {
  contaEmail: string;
  calendarioId: string;
  conectadoEm: string;
  conectadoPor: string | null;
};

/** O Google recusou o refresh token: revogado, expirado ou a SESSION_SECRET mudou. */
export class GoogleDesconectado extends Error {
  constructor(detalhe: string) {
    super(`A conexão com o Google Calendar caiu (${detalhe}). Conecte de novo em Integrações.`);
    this.name = "GoogleDesconectado";
  }
}

function credenciais() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const segredo = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !segredo) {
    throw new Error("GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET não definidas (credencial OAuth do Google Cloud).");
  }
  return { id, segredo };
}

/** As duas variáveis existem? A tela usa para dizer o que falta antes do clique. */
export function googleConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

// ── O segredo em repouso ──────────────────────────────────────────────────────
//
// O refresh token vale até alguém revogar: quem lê o banco leria a agenda da
// empresa. AES-256-GCM com chave derivada (HKDF) da SESSION_SECRET — derivada e
// não a própria, para a mesma string não servir a dois propósitos. O preço:
// trocar a SESSION_SECRET torna o token ilegível, e a conexão cai com
// GoogleDesconectado (conectar de novo resolve).

function chaveDoToken(): Buffer {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET não definida (cifra o token do Google).");
  return Buffer.from(hkdfSync("sha256", segredo, "chroma", "google-refresh-token", 32));
}

function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chaveDoToken(), iv);
  const dado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), dado.toString("base64")].join(":");
}

function decifrar(guardado: string): string {
  const [versao, iv, tag, dado] = guardado.split(":");
  if (versao !== "v1" || !iv || !tag || !dado) throw new GoogleDesconectado("token em formato desconhecido");
  try {
    const d = createDecipheriv("aes-256-gcm", chaveDoToken(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(dado, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new GoogleDesconectado("token ilegível — a SESSION_SECRET mudou?");
  }
}

// ── Consentimento ─────────────────────────────────────────────────────────────

/**
 * A URL do consentimento. `prompt=consent` + `access_type=offline` sempre: sem
 * os dois, reconectar uma conta que já autorizou o app volta SEM refresh token,
 * e a conexão nasceria morta.
 */
export function urlDeConsentimento(redirectUri: string, estado: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: credenciais().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: ESCOPOS.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: estado,
  }).toString();
  return u.toString();
}

type RespostaToken = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function pedirToken(corpo: Record<string, string>): Promise<RespostaToken & { status: number }> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corpo),
    cache: "no-store",
  });
  return { ...((await r.json().catch(() => ({}))) as RespostaToken), status: r.status };
}

/**
 * O e-mail da conta, lido do id_token. Sem conferir a assinatura de propósito:
 * o token veio agora, por TLS, direto do endpoint do Google — não passou pela
 * mão de ninguém. É a exceção que a própria documentação do OpenID admite.
 */
function emailDoIdToken(idToken: string | undefined): string | null {
  const meio = idToken?.split(".")[1];
  if (!meio) return null;
  try {
    const dado = JSON.parse(Buffer.from(meio, "base64url").toString("utf8")) as { email?: unknown };
    return typeof dado.email === "string" ? dado.email : null;
  } catch {
    return null;
  }
}

/**
 * Troca o `code` da volta do consentimento pelos tokens e grava a conexão (a
 * única linha). Devolve o e-mail conectado.
 */
export async function concluirConexao(code: string, redirectUri: string, usuarioId: string): Promise<string> {
  const { id, segredo } = credenciais();
  const t = await pedirToken({
    grant_type: "authorization_code",
    code,
    client_id: id,
    client_secret: segredo,
    redirect_uri: redirectUri,
  });
  if (t.status !== 200 || !t.access_token) {
    throw new Error(`Google recusou o código (${t.status}): ${t.error ?? "?"} — ${t.error_description ?? "sem detalhe"}`);
  }
  if (!t.refresh_token) {
    throw new Error("O Google não devolveu o refresh token. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.");
  }
  // A pessoa pode desmarcar a caixa da agenda na tela de consentimento.
  if (!t.scope?.split(" ").includes(ESCOPO_EVENTOS)) {
    throw new Error("A permissão da agenda não foi concedida. Conecte de novo e deixe marcada a caixa do Google Calendar.");
  }
  const email = emailDoIdToken(t.id_token) ?? "conta Google";

  await sql`
    INSERT INTO google_conexao (unica, conta_email, refresh_token, calendario_id, conectado_por, conectado_em)
    VALUES (true, ${email}, ${cifrar(t.refresh_token)}, 'primary', ${usuarioId}, now())
    ON CONFLICT (unica) DO UPDATE
       SET conta_email = EXCLUDED.conta_email,
           refresh_token = EXCLUDED.refresh_token,
           calendario_id = EXCLUDED.calendario_id,
           conectado_por = EXCLUDED.conectado_por,
           conectado_em = EXCLUDED.conectado_em`;

  // O access token desta troca já vale: guarda e poupa a primeira renovação.
  cacheToken = { token: t.access_token, expiraEm: Date.now() + (t.expires_in ?? 3600) * 1000, de: email };
  return email;
}

/** A conexão atual, sem o segredo; null quando não há conta conectada. */
export async function conexaoGoogle(): Promise<ConexaoGoogle | null> {
  const [l] = await sql`
    SELECT conta_email, calendario_id, conectado_em, conectado_por FROM google_conexao WHERE unica`;
  if (!l) return null;
  return {
    contaEmail: l.conta_email as string,
    calendarioId: l.calendario_id as string,
    conectadoEm: new Date(l.conectado_em as string).toISOString(),
    conectadoPor: (l.conectado_por as string | null) ?? null,
  };
}

/**
 * Apaga a conexão e revoga o token no Google. A revogação é cortesia: se o
 * Google falhar, a linha some do mesmo jeito — o que importa é o Chroma parar
 * de usar a conta.
 */
export async function desconectarGoogle(): Promise<void> {
  const [l] = await sql`DELETE FROM google_conexao WHERE unica RETURNING refresh_token`;
  cacheToken = null;
  renovando = null;
  if (!l) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decifrar(l.refresh_token as string) }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[google] não revogou o token ao desconectar:", e);
  }
}

// ── Access token ──────────────────────────────────────────────────────────────

// Em memória, como em lib/google-sa.ts: vale 1 hora e é segredo de vida curta.
// `de` amarra o token à conta — trocar de conta não pode reaproveitar o da outra.
let cacheToken: { token: string; expiraEm: number; de: string } | null = null;

type LinhaConexao = { conta_email: string; refresh_token: string; calendario_id: string };

// A Agenda lê ~15 agendas ao mesmo tempo, e cada leitura pede o acesso. Sem
// isto eram ~15 consultas iguais ao banco na mesma fração de segundo. Aqui as
// chamadas SIMULTÂNEAS dividem uma consulta só; terminada, a próxima chamada lê
// de novo — não é cache com prazo, então desconectar ou trocar de conta vale
// na hora.
let lendoConexao: Promise<LinhaConexao | undefined> | null = null;

function linhaDaConexao(): Promise<LinhaConexao | undefined> {
  if (!lendoConexao) {
    lendoConexao = (async () => {
      const [l] = await sql`SELECT conta_email, refresh_token, calendario_id FROM google_conexao WHERE unica`;
      return l as LinhaConexao | undefined;
    })().finally(() => {
      lendoConexao = null;
    });
  }
  return lendoConexao;
}

/**
 * Um access token da conta conectada, com o calendário a usar. Lança
 * GoogleDesconectado quando não há conexão ou o Google recusa o refresh token.
 */
export async function acessoGoogle(): Promise<{ token: string; calendarioId: string; contaEmail: string }> {
  const l = await linhaDaConexao();
  if (!l) throw new GoogleDesconectado("nenhuma conta conectada");
  const contaEmail = l.conta_email;
  const calendarioId = l.calendario_id;

  // 60s de folga: token que vence no caminho volta 401 sem dizer por quê.
  if (cacheToken && cacheToken.de === contaEmail && cacheToken.expiraEm > Date.now() + 60_000) {
    return { token: cacheToken.token, calendarioId, contaEmail };
  }

  // Token vencido com 15 agendas sendo lidas: UMA renovação, que todas esperam.
  if (!renovando || renovando.de !== contaEmail) {
    const promessa = renovar(l).finally(() => {
      if (renovando?.promessa === promessa) renovando = null;
    });
    renovando = { de: contaEmail, promessa };
  }
  return { token: await renovando.promessa, calendarioId, contaEmail };
}

let renovando: { de: string; promessa: Promise<string> } | null = null;

/**
 * Descarta o access token guardado: o próximo acessoGoogle() renova. Para quem
 * recebeu 401 com um token que, pelo relógio, ainda valia — visto em
 * 2026-10-02: o servidor de dev ficou com um token recusado e a Agenda dizia
 * "conexão caiu" com o refresh token perfeito no banco.
 */
export function esquecerTokenGoogle(): void {
  cacheToken = null;
}

async function renovar(l: LinhaConexao): Promise<string> {
  const { id, segredo } = credenciais();
  const t = await pedirToken({
    grant_type: "refresh_token",
    refresh_token: decifrar(l.refresh_token),
    client_id: id,
    client_secret: segredo,
  });
  if (t.status !== 200 || !t.access_token) {
    // invalid_grant = revogado, expirado (app em modo Teste: 7 dias) ou senha
    // da conta trocada. Os outros erros são do app (client id/secret errados).
    if (t.error === "invalid_grant") throw new GoogleDesconectado(t.error_description ?? "invalid_grant");
    throw new Error(`Google recusou renovar o acesso (${t.status}): ${t.error ?? "?"} — ${t.error_description ?? "sem detalhe"}`);
  }
  cacheToken = { token: t.access_token, expiraEm: Date.now() + (t.expires_in ?? 3600) * 1000, de: l.conta_email };
  return t.access_token;
}
