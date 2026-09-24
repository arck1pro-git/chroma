// Credencial de serviço do Google: service account → access token OAuth2.
//
// POR QUE SERVICE ACCOUNT E NÃO API KEY: a Search Console API (e a do Calendar)
// leem dado PRIVADO de uma propriedade/conta. Elas exigem um principal — alguém
// identificável — e uma API key não é isso; ela só diz de qual projeto é a cota.
// Testado contra a API, a resposta é literal:
//
//     401 · "API keys are not supported by this API. Expected OAuth2 access
//            token or other authentication credentials that assert a principal."
//
// Não há configuração no Google Cloud que contorne. Por isso este módulo.
//
// POR QUE SERVICE ACCOUNT E NÃO OAUTH DE USUÁRIO: OAuth precisaria de tela de
// consentimento, refresh token por conta e — como `webmasters.readonly` é
// escopo sensível — verificação do app no Google para sair do modo de teste (no
// qual o refresh token morre em 7 dias). Com service account, cadastrar um
// cliente novo é o cliente adicionar UM e-mail como usuário no Search Console
// dele. É a operação que escala num CRM com vários clientes.
//
// SEM SDK: o fluxo é um JWT assinado trocado por um token. O `jose` já está no
// projeto assinando a sessão (lib/auth/sessao.ts) e faz RS256 — puxar o pacote
// `googleapis` (dezenas de MB, todas as APIs do Google) por 40 linhas seria caro
// no bundle e no tempo de cold start.
import "server-only";
import { SignJWT, importPKCS8 } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Leitura do Search Console. Só leitura: não há nada a escrever lá. */
export const ESCOPO_SEARCH_CONSOLE =
  "https://www.googleapis.com/auth/webmasters.readonly";

type Guardado = { token: string; expiraEm: number };

// Cache em memória, POR ESCOPO. O token vale 1 hora; sem cache, cada consulta
// ao Search Console viraria duas idas à rede (uma para o token, outra para o
// dado). Em memória e não no banco de propósito: é um segredo de vida curta, e
// o processo que o usa é o mesmo que o pediu. Reiniciar só custa um token novo.
const cache = new Map<string, Guardado>();

/**
 * O par (e-mail, chave privada) do JSON da service account.
 *
 * Leitura PREGUIÇOSA, como lib/db.ts faz com a DATABASE_URL: ler no import
 * quebraria `next build` em máquina sem .env.
 *
 * O `replace` das barras-n não é paranoia — é O erro desta integração. O campo
 * `private_key` do JSON vem com "\n" LITERAL (dois caracteres), e o .env não
 * aceita quebra de linha de verdade no meio do valor. Então a chave é colada
 * numa linha só, entre aspas, com os "\n" literais; sem desfazer isso aqui, o
 * importPKCS8 estoura com um "Invalid PEM" que não diz nada sobre a causa.
 */
function credencial(): { email: string; chave: string } {
  const email = process.env.GOOGLE_SA_EMAIL;
  const chave = process.env.GOOGLE_SA_PRIVATE_KEY;

  if (!email || !chave) {
    throw new Error(
      "GOOGLE_SA_EMAIL e GOOGLE_SA_PRIVATE_KEY não definidas. São os campos " +
        "client_email e private_key do JSON da service account. A chave vai " +
        'entre aspas, numa linha só, com os \n literais preservados.',
    );
  }

  return { email, chave: chave.replace(/\n/g, "\n") };
}

/**
 * Um access token válido para o escopo, do cache ou novo.
 *
 * O fluxo é o "JWT bearer" do Google: a gente assina um JWT com a chave privada
 * da service account dizendo quem é e o que quer, e troca esse JWT por um token
 * de acesso. A assinatura é a prova de posse da chave — nada de segredo
 * trafegando.
 */
export async function tokenDeAcesso(escopo: string): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);

  // 60s de folga: um token que vence entre a checagem e a chegada da requisição
  // no Google volta 401, e o erro não diria que foi por um segundo.
  const guardado = cache.get(escopo);
  if (guardado && guardado.expiraEm > agora + 60) return guardado.token;

  const { email, chave } = credencial();
  const privada = await importPKCS8(chave, "RS256");

  const assercao = await new SignJWT({ scope: escopo })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(email)
    // O destinatário é o endpoint de token, não a API que se quer usar. Trocar
    // isso pelo endereço do Search Console devolve "invalid_grant" seco.
    .setAudience(TOKEN_URL)
    .setIssuedAt(agora)
    .setExpirationTime(agora + 3600)
    .sign(privada);

  const resposta = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: assercao,
    }),
    cache: "no-store",
  });

  const corpo = (await resposta.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!resposta.ok || !corpo.access_token) {
    // A mensagem do Google vai inteira: "invalid_grant" sozinho tem três causas
    // comuns e indistinguíveis sem ela — relógio da máquina fora de hora,
    // chave de outra service account, ou conta apagada no projeto.
    throw new Error(
      `Google recusou a credencial de serviço (${resposta.status}): ` +
        `${corpo.error ?? "?"} — ${corpo.error_description ?? "sem detalhe"}`,
    );
  }

  cache.set(escopo, {
    token: corpo.access_token,
    expiraEm: agora + (corpo.expires_in ?? 3600),
  });
  return corpo.access_token;
}
