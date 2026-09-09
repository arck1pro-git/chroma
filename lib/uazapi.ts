// Wrapper da uazapi (uazapiGO). Contrato confirmado direto na instância:
//   POST {BASE}/send/text
//   header  token: <TOKEN>        (não é Bearer)
//   body    { number, text }
//   200 →   { messageid, id, status: "Pending", chatid, ... }
//
// É o `messageid` que guardamos em mensagens.id_externo — os webhooks de
// entrega/leitura (messages_update) casam por ele depois.
//
// MULTI-INSTÂNCIA: o .env aponta UMA instância, e por muito tempo isso bastou.
// Não basta mais: as instâncias registradas em Configurações (tabela
// instancias_uazapi) são as que a automação escolhe por bloco — a cadência de
// uma etapa pode sair de um número e a de outra, de outro. Por isso o envio
// passou a receber a instância; sem ela, cai no .env, que é o que o /chat
// continua fazendo.
import { sql } from "@/lib/db";
import { soDigitos } from "@/lib/telefone";

export type Instancia = {
  // null = a do .env, que não está na tabela.
  id: string | null;
  nome: string;
  baseUrl: string;
  token: string;
  // Número pareado, quando conhecido. É o que carimba atendimentos.numero_instancia.
  numero: string | null;
};

export type RetornoEnvio = {
  messageid: string;
  id: string;
  status: string;
  chatid: string;
};

// A ÚNICA fonte de instância é a tabela `instancias_uazapi`, alimentada por
// Configurações. O fallback para UAZAPI_BASE_URL/UAZAPI_TOKEN do .env foi
// removido, e é uma remoção com consequência boa: aquele caminho mandava
// mensagem por um número que não estava cadastrado em lugar nenhum, então o
// CRM não sabia de qual número a mensagem tinha saído — `numero` vinha null e
// o atendimento nascia sem `numero_instancia`. Agora todo envio tem número
// conhecido.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function daLinha(linha: any): Instancia {
  return {
    id: linha.id as string,
    nome: linha.nome as string,
    baseUrl: linha.base_url as string,
    token: linha.token as string,
    numero: (linha.numero as string | null) ?? null,
  };
}

/**
 * A instância a usar quando ninguém escolheu uma.
 *
 * Com VÁRIAS cadastradas isto FALHA em vez de escolher a mais antiga: enviar
 * pelo número errado é irreversível — a mensagem chega ao cliente por um número
 * que não é o dele —, e um palpite silencioso é a pior forma de errar isso.
 * Quem tem mais de uma instância escolhe: o bloco da automação tem o seletor, e
 * o /chat responde pelo número que recebeu a conversa.
 */
export async function instanciaPadrao(): Promise<Instancia> {
  const linhas = await sql`
    SELECT id, nome, base_url, token, numero
    FROM instancias_uazapi ORDER BY data_criacao`;

  if (linhas.length === 0) {
    throw new Error(
      "Nenhuma instância de WhatsApp cadastrada. Conecte uma em Configurações.",
    );
  }
  if (linhas.length > 1) {
    throw new Error(
      `Há ${linhas.length} instâncias de WhatsApp cadastradas e nenhuma foi escolhida para este envio. Escolha a instância no bloco da automação.`,
    );
  }
  return daLinha(linhas[0]);
}

/**
 * Resolve a instância que um envio deve usar.
 *
 * O token sai do banco e fica só no servidor — nenhuma tela recebe esta função
 * (as Configurações leem a versão mascarada, ver app/configuracoes/dados.ts).
 */
export async function instanciaPorId(id: string | null): Promise<Instancia> {
  if (!id) return instanciaPadrao();

  const [linha] = await sql`
    SELECT id, nome, base_url, token, numero
    FROM instancias_uazapi WHERE id = ${id}`;

  // Instância apagada em Configurações depois de o fluxo ter sido publicado:
  // falhar aqui é melhor que escolher outra em silêncio e a mensagem sair pelo
  // número errado — que, no nosso caso, é o número compartilhado com o
  // SprintHub.
  if (!linha) {
    throw new Error(
      "A instância de WhatsApp escolhida nesta automação não existe mais em Configurações",
    );
  }

  return daLinha(linha);
}

/**
 * A instância dona de um número nosso — é assim que o /chat responde PELO MESMO
 * número em que a conversa entrou.
 *
 * Casa pelos últimos 8 dígitos, como o resto do app (lib/telefone.ts): o que o
 * webhook carimba em `atendimentos.numero_instancia` e o que a uazapi devolve
 * em `numero` nem sempre concordam sobre o nono dígito e o código do país.
 */
export async function instanciaPorNumero(
  numero: string | null,
): Promise<Instancia> {
  if (!numero) return instanciaPadrao();

  const fim8 = soDigitos(numero).slice(-8);
  const [linha] = await sql`
    SELECT id, nome, base_url, token, numero
    FROM instancias_uazapi
    WHERE regexp_replace(numero, '\\D', '', 'g') LIKE ${"%" + fim8}
    LIMIT 1`;

  // Sem casar, cai na padrão: o atendimento pode ter sido criado quando aquela
  // instância ainda existia. Melhor mandar pela conhecida do que recusar.
  return linha ? daLinha(linha) : instanciaPadrao();
}

export async function enviarTexto(
  number: string,
  text: string,
  instancia?: Instancia,
): Promise<RetornoEnvio> {
  const { baseUrl, token } = instancia ?? (await instanciaPadrao());

  const res = await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number, text }),
    // Sem cache: é mutação, cada chamada tem que ir na rede.
    cache: "no-store",
    // A uazapi é externa e o envio roda dentro de um request do motor: sem teto,
    // uma instância pendurada segura o bloco até o timeout do motor.
    signal: AbortSignal.timeout(20_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A uazapi devolve { error } no 400; outros status podem vir sem corpo.
    throw new Error(data?.error ?? `uazapi respondeu ${res.status}`);
  }
  return data as RetornoEnvio;
}
