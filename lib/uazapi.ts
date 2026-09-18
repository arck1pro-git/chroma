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
// Configurações. Não existe instância no .env, e não existe envio sem instância:
// `enviarTexto` exige uma, e quem chama diz qual. O que o .env guarda hoje é o
// SERVIDOR uazapi e o token de admin — para criar e listar instância, nunca
// para enviar.

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
 * Todas as instâncias cadastradas, pelo id. É o que a publicação usa para
 * montar um nó de envio por instância: cada mensagem da cadência pode sair de
 * um número diferente, e quem resolve isso é o compilador, no servidor.
 *
 * O TOKEN VEM JUNTO e não pode vazar para tela nenhuma — quem chama isto grava
 * o segredo no cofre do n8n e descarta. Ver `credenciaisDaUazapi` em
 * app/automacoes/acoes.ts.
 */
export async function instanciasPorId(): Promise<Map<string, Instancia>> {
  const linhas = await sql`
    SELECT id, nome, base_url, token, numero
    FROM instancias_uazapi ORDER BY data_criacao`;
  return new Map(linhas.map((l) => [l.id as string, daLinha(l)] as const));
}

/**
 * A instância daquele número — e SÓ dela. Sem casar, devolve `null`.
 *
 * É a irmã severa de `instanciaPorNumero`, e a diferença é o que está em jogo
 * em cada caso. No /chat, responder pela instância conhecida quando o número da
 * conversa sumiu é melhor que não responder. Numa automação não é: a mensagem
 * sai para um lead que não pediu nada agora, e sair pelo número ERRADO faz o
 * cliente ver um remetente que ele não conhece. Aí não mandar é o certo.
 */
export async function instanciaExataPorNumero(
  numero: string,
): Promise<Instancia | null> {
  const fim8 = soDigitos(numero).slice(-8);
  if (fim8.length < 8) return null;

  const [linha] = await sql`
    SELECT id, nome, base_url, token, numero
    FROM instancias_uazapi
    WHERE regexp_replace(numero, '\\D', '', 'g') LIKE ${"%" + fim8}
    LIMIT 1`;

  return linha ? daLinha(linha) : null;
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
  // OBRIGATÓRIA. Era opcional e caía na padrão — o jeito silencioso de mandar
  // pelo número errado. Quem chama já sabe de onde a mensagem sai: o /chat
  // responde pelo número que recebeu a conversa, a automação usa o número
  // escolhido na mensagem.
  instancia: Instancia,
): Promise<RetornoEnvio> {
  const { baseUrl, token } = instancia;

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

// ── Mídia ───────────────────────────────────────────────────────────────────
//
// Contrato CONFERIDO no OpenAPI da uazapi (docs.uazapi.com/openapi-bundled.json,
// POST /send/media) — não é deduzido como o do webhook:
//
//   obrigatórios  number, type, file
//   type          image | video | videoplay | document | audio | myaudio
//                 | ptt | ptv | sticker
//   file          "URL ou base64 do arquivo"
//   text          legenda
//   docName       "Nome do arquivo (apenas para documents)"
//   mimetype      opcional, "detectado automaticamente"
//   header        token: <TOKEN>, igual ao /send/text
//
// Dos nove tipos usamos quatro. Os outros cinco são variações de apresentação
// (`ptt` é áudio de voz, `ptv` é vídeo redondo, `sticker` exige quadrado com
// transparência) que a biblioteca não tem como inferir de um upload — e mandar
// um webp comum como `sticker` faz chegar cortado do outro lado.
const TIPO_UAZAPI: Record<string, string> = {
  imagem: "image",
  video: "video",
  audio: "audio",
  documento: "document",
};

/**
 * Manda um arquivo. `arquivo` é URL ou base64 puro (sem o prefixo `data:`).
 *
 * `docName` só vai em documento, que é o que a uazapi documenta ("apenas para
 * documents"). Em imagem e vídeo o nome não aparece para quem recebe — o que
 * aparece é a legenda, e é ela que `texto` carrega.
 */
export async function enviarMidia(
  number: string,
  arquivo: string,
  opcoes: {
    tipo: "imagem" | "video" | "audio" | "documento";
    /** Legenda. Vazia é legítimo: manda só o arquivo. */
    texto?: string;
    /** Nome que o lead vê no anexo. Só usado quando tipo = documento. */
    arquivoNome?: string;
    mime?: string;
  },
  instancia: Instancia,
): Promise<RetornoEnvio> {
  const { baseUrl, token } = instancia;

  const corpo: Record<string, unknown> = {
    number,
    type: TIPO_UAZAPI[opcoes.tipo] ?? "document",
    file: arquivo,
  };
  if (opcoes.texto) corpo.text = opcoes.texto;
  if (opcoes.mime) corpo.mimetype = opcoes.mime;
  if (opcoes.tipo === "documento" && opcoes.arquivoNome) {
    corpo.docName = opcoes.arquivoNome;
  }

  const res = await fetch(`${baseUrl}/send/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify(corpo),
    cache: "no-store",
    // 90s e não os 20s do texto: aqui sobe o arquivo inteiro em base64, e um
    // PDF de 20 MB por um link ruim não fecha em 20 segundos. O teto continua
    // existindo porque a uazapi é externa e pendurada segura o bloco até o
    // timeout do motor.
    signal: AbortSignal.timeout(90_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? `uazapi respondeu ${res.status}`);
  }
  return data as RetornoEnvio;
}
