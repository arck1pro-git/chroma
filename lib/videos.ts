// Vídeos com link rastreável: o acervo, a abertura do link e os sinais do
// player. As tabelas e o porquê de cada coluna estão em migration-videos.sql.
//
// O CAMINHO DE UMA VISUALIZAÇÃO, de ponta a ponta:
//   1. o lead abre /v/<slug>?w=<whatsapp> (app/v/[slug]) — página pública;
//   2. o player chama /api/v/abrir → `abrirVisualizacao` cria a linha, casa o
//      WhatsApp com um contato e devolve um token daquela linha;
//   3. a cada poucos segundos, e ao pausar ou sair, o player manda o que tocou
//      para /api/v/sinal → `registrarSinal` atualiza a MESMA linha.
//
// O TOKEN existe porque as duas rotas são públicas: sem ele, qualquer um que
// soubesse o id de uma visualização poderia inflar o tempo dela. Ele é um HMAC
// do id com o SESSION_SECRET — nada a guardar no banco, e só quem recebeu o id
// do próprio servidor tem o token que bate.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { chaveTelefone, soDigitos } from "@/lib/telefone";

export const BUCKET_VIDEOS = process.env.SUPABASE_BUCKET_VIDEOS ?? "crm-videos";

export type Video = {
  id: string;
  slug: string;
  nome: string;
  caminho: string;
  capa: string | null;
  mime: string;
  tamanho: number;
  duracao: number | null;
  largura: number | null;
  altura: number | null;
  autor: string | null;
  dataCriacao: string;
  aberturas: number;
  pessoas: number;
  ultimaAbertura: string | null;
};

/** Uma pessoa que abriu o vídeo, juntando todas as vezes que ela abriu. */
export type PessoaDoVideo = {
  /** contato_id, ou o WhatsApp, ou o id da abertura quando o link veio sem número. */
  chave: string;
  contatoId: string | null;
  nome: string | null;
  whatsapp: string | null;
  aberturas: number;
  /**
   * Segundos DIFERENTES do vídeo que a pessoa viu, somando todas as aberturas:
   * viu a 1ª metade num dia e a 2ª no outro = o vídeo inteiro. É o "quanto do
   * vídeo ela viu" — reassistir não aumenta.
   */
  cobertura: number;
  /** Soma do que tocou em cada abertura — aqui reassistir conta. */
  assistido: number;
  posicaoMax: number;
  naPagina: number;
  primeira: string;
  ultima: string;
};

type Trecho = [number, number];

// Função e não constante: um sql`` no topo do módulo abriria a conexão já na
// importação — inclusive no build, onde não há banco.
const colunasDoVideo = () => sql`
  v.id, v.slug, v.nome, v.caminho, v.capa, v.mime, v.tamanho, v.duracao,
  v.largura, v.altura, v.data_criacao, u.nome AS autor`;

function paraVideo(l: Record<string, unknown>): Video {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: l.id as string,
    slug: l.slug as string,
    nome: l.nome as string,
    caminho: l.caminho as string,
    capa: (l.capa as string | null) ?? null,
    mime: l.mime as string,
    tamanho: Number(l.tamanho),
    duracao: num(l.duracao),
    largura: num(l.largura),
    altura: num(l.altura),
    autor: (l.autor as string | null) ?? null,
    dataCriacao: new Date(l.data_criacao as string).toISOString(),
    aberturas: Number(l.aberturas ?? 0),
    pessoas: Number(l.pessoas ?? 0),
    ultimaAbertura: l.ultima_abertura ? new Date(l.ultima_abertura as string).toISOString() : null,
  };
}

/** O acervo, do mais novo para o mais antigo, com o resumo de quem abriu. */
export async function listarVideos(): Promise<Video[]> {
  const linhas = await sql`
    SELECT ${colunasDoVideo()},
           count(vv.id)::int AS aberturas,
           count(DISTINCT coalesce(vv.contato_id::text, vv.whatsapp, vv.id::text))::int AS pessoas,
           max(vv.data_criacao) AS ultima_abertura
      FROM videos v
      LEFT JOIN usuarios u ON u.id = v.autor_id
      LEFT JOIN video_visualizacoes vv ON vv.video_id = v.id
     GROUP BY v.id, u.nome
     ORDER BY v.data_criacao DESC`;
  return linhas.map(paraVideo);
}

export async function buscarVideo(id: string): Promise<Video | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [l] = await sql`
    SELECT ${colunasDoVideo()} FROM videos v LEFT JOIN usuarios u ON u.id = v.autor_id
     WHERE v.id = ${id}`;
  return l ? paraVideo(l) : null;
}

export async function buscarVideoPorSlug(slug: string): Promise<Video | null> {
  if (!/^[a-z0-9]{6,16}$/.test(slug)) return null;
  const [l] = await sql`
    SELECT ${colunasDoVideo()} FROM videos v LEFT JOIN usuarios u ON u.id = v.autor_id
     WHERE v.slug = ${slug}`;
  return l ? paraVideo(l) : null;
}

// ── Acervo ──────────────────────────────────────────────────────────────────

const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Texto sorteado em [a-z0-9]. 8 letras = 36^8 ≈ 2,8 trilhões de links. */
function sortear(tamanho: number) {
  const bytes = randomBytes(tamanho);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
}

/** Extensão do arquivo pelo nome; sem nome útil, pelo tipo. */
function extensao(nomeArquivo: string, mime: string) {
  const doNome = /\.([a-z0-9]{1,5})$/i.exec(nomeArquivo)?.[1]?.toLowerCase();
  if (doNome) return doNome;
  return { "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv" }[mime] ?? "mp4";
}

/**
 * Onde o arquivo vai morar no bucket: AAAA/MM/<sorteio>.<ext>. A capa é o
 * mesmo nome com "-capa.jpg" — derivada aqui, e não escolhida pelo navegador,
 * para ninguém registrar como capa um objeto qualquer do bucket.
 */
export function novoCaminho(nomeArquivo: string, mime: string) {
  const agora = new Date();
  const pasta = `${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${pasta}/${sortear(16)}.${extensao(nomeArquivo, mime)}`;
}

export const CAMINHO_VALIDO = /^\d{4}\/\d{2}\/[a-z0-9]{16}\.[a-z0-9]{1,5}$/;

export function caminhoDaCapa(caminho: string) {
  return caminho.replace(/\.[a-z0-9]+$/, "-capa.jpg");
}

export async function criarVideo(dados: {
  nome: string;
  caminho: string;
  capa: string | null;
  mime: string;
  tamanho: number;
  duracao: number | null;
  largura: number | null;
  altura: number | null;
  autorId: string;
}): Promise<string> {
  // O slug é UNIQUE: colisão em 36^8 é improvável, mas se vier, sorteia de novo
  // em vez de devolver erro para quem só queria subir um vídeo.
  for (let tentativa = 0; ; tentativa++) {
    try {
      const [l] = await sql`
        INSERT INTO videos (slug, nome, caminho, capa, mime, tamanho, duracao, largura, altura, autor_id)
        VALUES (${sortear(8)}, ${dados.nome}, ${dados.caminho}, ${dados.capa}, ${dados.mime},
                ${dados.tamanho}, ${dados.duracao}, ${dados.largura}, ${dados.altura}, ${dados.autorId})
        RETURNING id`;
      return l.id as string;
    } catch (e) {
      if (tentativa < 3 && /videos_slug_key/.test(String(e))) continue;
      throw e;
    }
  }
}

export async function renomearVideo(id: string, nome: string) {
  await sql`UPDATE videos SET nome = ${nome} WHERE id = ${id}`;
}

/** Apaga a linha (e as visualizações, em cascata) e devolve o que limpar no Storage. */
export async function excluirVideo(id: string): Promise<{ caminho: string; capa: string | null } | null> {
  const [l] = await sql`DELETE FROM videos WHERE id = ${id} RETURNING caminho, capa`;
  return l ? { caminho: l.caminho as string, capa: (l.capa as string | null) ?? null } : null;
}

// ── Quem assistiu ───────────────────────────────────────────────────────────

/** Ordena e funde trechos que se tocam: [[0,10],[5,20],[30,40]] → [[0,20],[30,40]]. */
export function unirTrechos(trechos: Trecho[]): Trecho[] {
  const ordenados = [...trechos].sort((a, b) => a[0] - b[0]);
  const saida: Trecho[] = [];
  for (const [a, b] of ordenados) {
    const ultimo = saida[saida.length - 1];
    // 0,5 s de folga: o navegador fecha um trecho a cada seek, e dois pedaços
    // separados por um quadro são o mesmo trecho visto.
    if (ultimo && a <= ultimo[1] + 0.5) ultimo[1] = Math.max(ultimo[1], b);
    else saida.push([a, b]);
  }
  return saida;
}

const somar = (trechos: Trecho[]) => trechos.reduce((s, [a, b]) => s + (b - a), 0);

/**
 * Quem abriu o vídeo, uma linha por PESSOA (contato; sem contato, o número;
 * sem número, cada abertura vale por si). As 2000 aberturas mais recentes
 * bastam para a tela — é acompanhamento, não arquivo.
 */
export async function pessoasDoVideo(videoId: string): Promise<PessoaDoVideo[]> {
  const linhas = await sql`
    SELECT vv.id, vv.contato_id, vv.whatsapp, vv.trechos, vv.segundos_assistidos,
           vv.posicao_max, vv.segundos_na_pagina, vv.data_criacao, vv.data_atualizacao,
           c.nome AS contato_nome
      FROM video_visualizacoes vv
      LEFT JOIN contatos c ON c.id = vv.contato_id
     WHERE vv.video_id = ${videoId}
     ORDER BY vv.data_criacao DESC
     LIMIT 2000`;

  const porPessoa = new Map<string, PessoaDoVideo & { _trechos: Trecho[] }>();
  for (const l of linhas) {
    const chave = (l.contato_id as string | null) ?? (l.whatsapp as string | null) ?? (l.id as string);
    const abriu = new Date(l.data_criacao as string).toISOString();
    const viuPorUltimo = new Date(l.data_atualizacao as string).toISOString();
    const p =
      porPessoa.get(chave) ??
      {
        chave,
        contatoId: (l.contato_id as string | null) ?? null,
        nome: (l.contato_nome as string | null) ?? null,
        whatsapp: (l.whatsapp as string | null) ?? null,
        aberturas: 0,
        cobertura: 0,
        assistido: 0,
        posicaoMax: 0,
        naPagina: 0,
        primeira: abriu,
        ultima: viuPorUltimo,
        _trechos: [],
      };
    p.aberturas += 1;
    p.assistido += Number(l.segundos_assistidos);
    p.posicaoMax = Math.max(p.posicaoMax, Number(l.posicao_max));
    p.naPagina += Number(l.segundos_na_pagina);
    if (abriu < p.primeira) p.primeira = abriu;
    if (viuPorUltimo > p.ultima) p.ultima = viuPorUltimo;
    p._trechos.push(...((l.trechos as Trecho[] | null) ?? []));
    porPessoa.set(chave, p);
  }

  return [...porPessoa.values()]
    .map(({ _trechos, ...p }) => ({ ...p, cobertura: somar(unirTrechos(_trechos)) }))
    .sort((a, b) => (a.ultima < b.ultima ? 1 : -1));
}

// ── O link público ──────────────────────────────────────────────────────────

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET não definida no ambiente");
  return s;
}

/** O token que autoriza os sinais de UMA visualização (ver o cabeçalho). */
export function tokenDaVisualizacao(id: string) {
  return createHmac("sha256", segredo())
    .update(`video-visualizacao:${id}`)
    .digest("base64url")
    .slice(0, 32);
}

function tokenConfere(id: string, token: string) {
  const esperado = Buffer.from(tokenDaVisualizacao(id));
  const veio = Buffer.from(token);
  return veio.length === esperado.length && timingSafeEqual(veio, esperado);
}

/** Contato pelo WhatsApp: últimos 8 dígitos, como o webhook (lib/telefone.ts). */
async function contatoPorWhatsapp(digitos: string): Promise<{ id: string; nome: string } | null> {
  const fim8 = chaveTelefone(digitos).slice(-8);
  if (fim8.length !== 8) return null;
  const [c] = await sql`
    SELECT id, nome FROM contatos
     WHERE regexp_replace(whatsapp, '\D', '', 'g') LIKE ${"%" + fim8}
     ORDER BY data_criacao
     LIMIT 1`;
  return c ? { id: c.id as string, nome: c.nome as string } : null;
}

/**
 * Registra que alguém abriu o link. Devolve o id da visualização e o token
 * dos sinais, ou null se o vídeo não existe.
 *
 * A PRIMEIRA vez que um contato abre um vídeo vira linha no histórico dele: é
 * o que faz a ficha mostrar "abriu o vídeo X" para quem atende. As seguintes
 * não — cinco aberturas não são cinco acontecimentos para o vendedor.
 */
export async function abrirVisualizacao(
  slug: string,
  w: unknown,
  userAgent: string | null,
): Promise<{ id: string; token: string } | null> {
  const video = await buscarVideoPorSlug(slug);
  if (!video) return null;

  const digitos = typeof w === "string" ? soDigitos(w).slice(0, 20) : "";
  // 10 a 15 dígitos: com ou sem 55, com ou sem o nono dígito. Fora disso o
  // parâmetro não é um telefone (o {{numero}} que não foi trocado, por exemplo)
  // e a abertura fica sem número em vez de inventar um.
  const whatsapp = digitos.length >= 10 && digitos.length <= 15 ? digitos : null;
  const contato = whatsapp ? await contatoPorWhatsapp(whatsapp) : null;

  const [anterior] = contato
    ? await sql`
        SELECT 1 FROM video_visualizacoes
         WHERE video_id = ${video.id} AND contato_id = ${contato.id} LIMIT 1`
    : [];

  const [l] = await sql`
    INSERT INTO video_visualizacoes (video_id, whatsapp, contato_id, user_agent)
    VALUES (${video.id}, ${whatsapp}, ${contato?.id ?? null}, ${userAgent?.slice(0, 400) ?? null})
    RETURNING id`;

  if (contato && !anterior) {
    await sql`
      INSERT INTO historico (contato_id, descricao)
      VALUES (${contato.id}, ${`Abriu o vídeo "${video.nome}" pelo link`})`;
  }

  const id = l.id as string;
  return { id, token: tokenDaVisualizacao(id) };
}

const arred = (n: number) => Math.round(n * 100) / 100;

/** Os trechos que vieram do navegador, limpos: números válidos, dentro do vídeo, unidos. */
function normalizarTrechos(bruto: unknown, teto: number): Trecho[] {
  if (!Array.isArray(bruto)) return [];
  const validos: Trecho[] = [];
  for (const t of bruto.slice(0, 500)) {
    if (!Array.isArray(t) || t.length !== 2) continue;
    const [a, b] = t;
    if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const ini = Math.min(Math.max(a, 0), teto);
    const fim = Math.min(Math.max(b, 0), teto);
    if (fim > ini) validos.push([arred(ini), arred(fim)]);
  }
  return unirTrechos(validos);
}

/**
 * Um sinal do player: o estado ACUMULADO daquela abertura (o `video.played`
 * inteiro, não só o que tocou desde o último sinal). Por isso o UPDATE usa
 * GREATEST — um sinal atrasado, chegando depois de um mais novo, não pode
 * fazer o número andar para trás.
 *
 * Só aceita sinal até 24 h depois da abertura: aba esquecida aberta não fica
 * mexendo no número para sempre.
 */
export async function registrarSinal(dados: unknown): Promise<boolean> {
  if (!dados || typeof dados !== "object") return false;
  const { id, token, trechos, naPagina, duracao } = dados as Record<string, unknown>;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  if (typeof token !== "string" || !tokenConfere(id, token)) return false;

  const [v] = await sql`
    SELECT vv.video_id, v.duracao
      FROM video_visualizacoes vv
      JOIN videos v ON v.id = vv.video_id
     WHERE vv.id = ${id} AND vv.data_criacao > now() - interval '24 hours'`;
  if (!v) return false;

  const informada =
    typeof duracao === "number" && Number.isFinite(duracao) && duracao > 0 && duracao < 86400
      ? arred(duracao)
      : null;
  const doVideo = v.duracao === null ? informada : Number(v.duracao);

  const lista = normalizarTrechos(trechos, doVideo ?? 86400);
  const assistido = arred(somar(lista));
  const posicao = lista.length ? lista[lista.length - 1][1] : 0;
  const pagina =
    typeof naPagina === "number" && Number.isFinite(naPagina)
      ? Math.min(Math.max(Math.round(naPagina), 0), 86400)
      : 0;

  await sql`
    UPDATE video_visualizacoes SET
      trechos = CASE WHEN ${assistido}::numeric >= segundos_assistidos
                     THEN ${sql.json(lista as never)} ELSE trechos END,
      segundos_assistidos = GREATEST(segundos_assistidos, ${assistido}::numeric),
      posicao_max = GREATEST(posicao_max, ${posicao}::numeric),
      segundos_na_pagina = GREATEST(segundos_na_pagina, ${pagina}::int),
      data_atualizacao = now()
    WHERE id = ${id}`;

  // O navegador de quem subiu não leu a duração (codec que ele não toca)? O
  // primeiro player que tocar diz.
  if (v.duracao === null && informada) {
    await sql`UPDATE videos SET duracao = ${informada} WHERE id = ${v.video_id} AND duracao IS NULL`;
  }
  return true;
}
