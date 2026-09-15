// Leitura da matéria que origina o artigo.
//
// A REGRA QUE MANDA AQUI: nunca há fallback silencioso. Se a matéria não puder
// ser lida, a geração FALHA com mensagem clara. O contrário — escrever o artigo
// "por cima do título" quando o texto não veio — produz exatamente o que o
// módulo existe para evitar: artigo com número inventado, apresentado como se
// tivesse saído de uma fonte real.
//
// COMO LÊ: Jina Reader (r.jina.ai), que resolve a página (inclusive o que
// depende de JS e de redirect) e devolve texto limpo. É um serviço de fora, e
// por isso o timeout é curto e o erro é explícito: se ele cair, a tela diz para
// escolher outra pauta em vez de pendurar a requisição.

/** Corte do texto da matéria. Acima disso é custo de token sem ganho. */
const LIMITE_TEXTO = 8000;

/** Abaixo disso não é matéria: é paywall, captcha ou página de consentimento. */
const MINIMO_TEXTO = 400;

/**
 * Teto da leitura.
 *
 * Era 12s e ISSO FALHAVA NA PRÁTICA: medindo o Jina em matérias reais, o tempo
 * varia muito — 2s, 5s, 9s no mesmo minuto, e uma matéria que estava fria
 * estourou os 12s e derrubou a geração. Não é um leitor "rápido ou nada": é
 * rápido na mediana e com cauda longa.
 *
 * 30s dá 2,3x de margem sobre a pior medição e continua curto perto do orçamento
 * de quem chama (maxDuration de 300s, dos quais o modelo usa a maior parte).
 */
const TIMEOUT_MS = 30_000;

/** Links que escondem a URL real atrás de um redirecionador. */
const AGREGADORES = ["news.google.com"];

export type CodigoFalhaMateria = "BLOQUEADO" | "FALHA";

export class FalhaMateria extends Error {
  constructor(readonly codigo: CodigoFalhaMateria, mensagem: string) {
    super(mensagem);
    this.name = "FalhaMateria";
  }
}

export const MENSAGEM_FALHA: Record<CodigoFalhaMateria, string> = {
  BLOQUEADO:
    "Não foi possível ler a matéria: o site bloqueou o acesso ou exige login. Escolha outra pauta.",
  FALHA: "Falha ao acessar a matéria. Tente novamente ou escolha outra pauta.",
};

export interface Materia {
  /** A URL de verdade — já sem o agregador na frente. */
  url: string;
  texto: string;
}

function ehAgregador(link: string): boolean {
  try {
    return AGREGADORES.includes(new URL(link).hostname);
  } catch {
    return false;
  }
}

/**
 * Link de agregador → URL real, ANTES de ler.
 *
 * Sem isto, o que chega ao prompt é a página do agregador ("veja esta notícia
 * no Google Notícias"), não a matéria — e o artigo sairia sobre nada. O
 * caminho é seguir os redirects e ver onde a navegação parou; se parou no
 * próprio agregador, devolve o link original e deixa o Jina tentar resolver
 * (ele executa JS, que é como esses links costumam saltar hoje).
 */
export async function resolverLink(link: string): Promise<string> {
  if (!ehAgregador(link)) return link;

  const cancelar = AbortController ? new AbortController() : null;
  const relogio = setTimeout(() => cancelar?.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(link, {
      redirect: "follow",
      cache: "no-store",
      headers: { "user-agent": "Mozilla/5.0" },
      signal: cancelar?.signal,
    });
    return ehAgregador(r.url) ? link : r.url;
  } catch {
    return link; // resolver é otimização; falhar aqui não é motivo para parar
  } finally {
    clearTimeout(relogio);
  }
}

function normalizar(texto: string): string {
  return texto
    .replace(/[ \t]+\n/g, "\n") // espaço pendurado no fim da linha
    .replace(/\n{3,}/g, "\n\n") // buraco de 3+ quebras vira parágrafo
    .trim()
    .slice(0, LIMITE_TEXTO);
}

/**
 * Lê a matéria. Lança FalhaMateria — nunca devolve texto pela metade nem vazio.
 */
export async function lerMateria(link: string): Promise<Materia> {
  const url = await resolverLink(link);

  const cancelar = new AbortController();
  const relogio = setTimeout(() => cancelar.abort(), TIMEOUT_MS);

  let resposta: Response;
  try {
    resposta = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        accept: "text/plain",
        "x-return-format": "text",
        "user-agent": "Mozilla/5.0",
      },
      cache: "no-store",
      signal: cancelar.signal,
    });
  } catch {
    // Rede caiu, DNS falhou ou estourou o timeout: é problema nosso/do serviço,
    // não do site da matéria — daí FALHA e não BLOQUEADO.
    throw new FalhaMateria("FALHA", MENSAGEM_FALHA.FALHA);
  } finally {
    clearTimeout(relogio);
  }

  if (!resposta.ok) {
    // 401/403/451 e afins vêm de paywall e muro de consentimento; 5xx do
    // próprio leitor. Os dois acabam do mesmo jeito para quem está na tela:
    // esta pauta não dá, escolha outra.
    throw new FalhaMateria("BLOQUEADO", MENSAGEM_FALHA.BLOQUEADO);
  }

  const texto = normalizar(await resposta.text());

  if (texto.length < MINIMO_TEXTO) {
    throw new FalhaMateria("BLOQUEADO", MENSAGEM_FALHA.BLOQUEADO);
  }

  return { url, texto };
}
