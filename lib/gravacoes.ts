// As gravações do Google Meet dentro do CRM (pedido dele, 2026-10-20: "onde
// vejo no crm? quero ver o vídeo/gravação/transcrição").
//
// A FONTE é a pasta "Meet Recordings" do Meu Drive do meet@arck1pro.com — onde
// o Meet guarda, para cada reunião que essa conta organiza, o vídeo
// ("… - Recording"), as anotações do Gemini ("… - Anotações do Gemini") e o
// chat. Ele compartilhou a pasta com a conta de serviço do CRM como Leitor
// (2026-10-20), e é por ela que lemos (lib/google-drive.ts, drive.readonly).
// Nada é copiado: a lista e o texto das anotações vêm do Drive na hora, e o
// vídeo toca no player do próprio Google.
//
// Transcrição completa o Meet só grava com "Transcrição" ligada na reunião;
// hoje não há nenhuma na pasta. Se passar a haver ("… - Transcrição" /
// "… - Transcript"), ela aparece aqui sem mudar nada.
import "server-only";
import { baixarDoDrive, exportarDoc, listarPasta, type ItemDaPasta } from "@/lib/google-drive";

/** A pasta "Meet Recordings" do meet@arck1pro.com (compartilhada com a conta de serviço). */
export const PASTA_MEET = "1nHKus_kZ_z1iplutVEaH8MI_Fe5RJREr";

export type Gravacao = {
  /** Estável: o id do vídeo, ou o das anotações quando não houve vídeo. */
  id: string;
  /** O nome da reunião no Calendar; "" quando o Meet não tinha nome (sala avulsa). */
  titulo: string;
  /** Quando a gravação começou (ISO). */
  inicio: string;
  videoId: string | null;
  duracaoMin: number | null;
  notasId: string | null;
  transcricaoId: string | null;
  chatId: string | null;
};

type Tipo = "video" | "notas" | "transcricao" | "chat";
type Peca = { tipo: Tipo; id: string; titulo: string; inicio: string; duracaoMs: number | null };

const DOC = "application/vnd.google-apps.document";

// "AGENDA MARCO - LEAD ROGER - 2026/05/23 10:00 GMT-03:00 - Recording"
const COM_NOME = /^(.*?)\s+-\s+(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}) GMT([+-])(\d{1,2}):?(\d{2})?\s+-\s+(.+)$/;
// "Reunião iniciada às 2026/04/16 15:23 GMT-03:00 - Anotações do Gemini"
const SEM_NOME = /^Reuni[ãa]o iniciada [àa]s (\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}) GMT([+-])(\d{1,2}):?(\d{2})?\s+-\s+(.+)$/i;
// "khn-zgfq-mxx (2026-04-16 15:23 GMT-3)" e "… (…) - Transcrição do chat"
const SALA = /^(.*?)\s*\((\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) GMT([+-])(\d{1,2}):?(\d{2})?\)\s*(?:-\s*(.+))?$/;

function iso(a: string, m: string, d: string, h: string, min: string, sinal: string, oh: string, om?: string) {
  return `${a}-${m}-${d}T${h}:${min}:00${sinal}${oh.padStart(2, "0")}:${om ?? "00"}`;
}

/** O tipo da peça pelo sufixo e pelo formato do arquivo. null = não é peça de reunião. */
function tipoDa(sufixo: string, mime: string): Tipo | null {
  const s = sufixo.toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (/chat/.test(s)) return "chat";
  if (mime === DOC && /(gemini|anota|notes|observa)/.test(s)) return "notas";
  if (mime === DOC && /transcri/.test(s)) return "transcricao";
  return null;
}

function pecaDo(item: ItemDaPasta): Peca | null {
  const duracaoMs = item.duracaoMs;
  let m = COM_NOME.exec(item.nome);
  if (m) {
    const tipo = tipoDa(m[10], item.mime);
    return tipo && { tipo, id: item.id, titulo: m[1].trim(), inicio: iso(m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9]), duracaoMs };
  }
  m = SEM_NOME.exec(item.nome);
  if (m) {
    const tipo = tipoDa(m[9], item.mime);
    return tipo && { tipo, id: item.id, titulo: "", inicio: iso(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]), duracaoMs };
  }
  m = SALA.exec(item.nome);
  if (m) {
    // O código da sala ("khn-zgfq-mxx") não é nome de reunião.
    const tipo = tipoDa(m[10] ?? "", item.mime);
    return tipo && { tipo, id: item.id, titulo: "", inicio: iso(m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9]), duracaoMs };
  }
  return null;
}

const minutos = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 60_000;

/**
 * Junta as peças de cada reunião. O Meet dá a todas o mesmo nome e o mesmo
 * minuto de início — exceto quando as anotações começam um minuto antes da
 * gravação, ou quando uma é da sala sem nome e a outra não. Daí a segunda
 * passada: grupos que se completam (um sem vídeo, outro sem anotações), com o
 * mesmo nome ou um deles sem nome, a até 20 minutos um do outro, viram um só.
 */
function agrupar(pecas: Peca[]): Gravacao[] {
  type Grupo = { titulo: string; inicio: string; pecas: Partial<Record<Tipo, Peca>> };
  const grupos: Grupo[] = [];
  for (const p of [...pecas].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    const casa = grupos.find(
      (g) =>
        !g.pecas[p.tipo] &&
        minutos(g.inicio, p.inicio) <= (g.inicio === p.inicio ? 0 : 20) + 0.5 &&
        (g.titulo === p.titulo || !g.titulo || !p.titulo),
    );
    if (casa) {
      casa.pecas[p.tipo] = p;
      if (!casa.titulo && p.titulo) casa.titulo = p.titulo;
    } else grupos.push({ titulo: p.titulo, inicio: p.inicio, pecas: { [p.tipo]: p } });
  }
  return grupos
    .filter((g) => g.pecas.video || g.pecas.notas || g.pecas.transcricao)
    .map((g) => {
      const v = g.pecas.video;
      return {
        id: (v ?? g.pecas.notas ?? g.pecas.transcricao)!.id,
        titulo: g.titulo,
        inicio: (v ?? g.pecas.notas ?? g.pecas.transcricao)!.inicio,
        videoId: v?.id ?? null,
        duracaoMin: v?.duracaoMs ? Math.max(1, Math.round(v.duracaoMs / 60_000)) : null,
        notasId: g.pecas.notas?.id ?? null,
        transcricaoId: g.pecas.transcricao?.id ?? null,
        chatId: g.pecas.chat?.id ?? null,
      };
    })
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
}

// Cinco minutos na memória da instância: a ficha abre muitas vezes seguidas e
// a pasta só muda quando uma reunião termina. Ver custo-vercel-leve.
const VALIDADE_MS = 5 * 60_000;
let guardada: { em: number; lista: Gravacao[] } | null = null;

export async function gravacoesDoMeet(): Promise<Gravacao[]> {
  if (guardada && Date.now() - guardada.em < VALIDADE_MS) return guardada.lista;
  const itens = await listarPasta(PASTA_MEET);
  const lista = agrupar(itens.map(pecaDo).filter((p): p is Peca => p !== null));
  guardada = { em: Date.now(), lista };
  return lista;
}

// ── Casar com o CRM ─────────────────────────────────────────────────────────

/**
 * A gravação de uma reunião que o CRM marcou: a que começou entre 30 minutos
 * antes e 90 depois do horário marcado (gente entra atrasada, e o vídeo só
 * começa quando alguém aperta Gravar). Havendo mais de uma, a mais perto.
 */
export function gravacaoDaReuniao(lista: Gravacao[], inicio: string): Gravacao | null {
  const alvo = Date.parse(inicio);
  let melhor: Gravacao | null = null;
  for (const g of lista) {
    const delta = (Date.parse(g.inicio) - alvo) / 60_000;
    if (delta < -30 || delta > 90) continue;
    if (!melhor || Math.abs(delta) < Math.abs((Date.parse(melhor.inicio) - alvo) / 60_000)) melhor = g;
  }
  return melhor;
}

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * As gravações cujo nome traz o nome do contato ("Reunião ARI - Valter Renato
 * Gomes", "Agenda Marco - Rosiel Corrêa"). Só com nome e sobrenome: "Lucas"
 * sozinho casaria com todo Lucas da pasta. Cada palavra do nome (sem "de",
 * "da"…) tem de aparecer inteira no título.
 */
export function gravacoesDoNome(lista: Gravacao[], nome: string): Gravacao[] {
  const partes = normalizar(nome)
    .split(" ")
    .filter((p) => p.length >= 2 && !PARTICULAS.has(p));
  if (partes.length < 2) return [];
  return lista.filter((g) => {
    const palavras = new Set(normalizar(g.titulo).split(" "));
    return partes.every((p) => palavras.has(p));
  });
}

// ── O conteúdo ──────────────────────────────────────────────────────────────

/**
 * As anotações do Gemini sem o que é do Google e não da reunião: o cabeçalho
 * (data, convidados, anexos, o link da gravação — que a tela já tem), as
 * pesquisas de satisfação e os avisos do rodapé. Os links viram só o texto, e
 * o título em negrito de cada bloco ganha linha própria.
 */
export function limparNotas(md: string): string {
  const linhas = md.replace(/\r/g, "").split("\n");
  const inicio = linhas.findIndex((l) => /^#{1,4}\s*(Resumo|Summary)\b/i.test(l.trim()));
  const corpo = (inicio >= 0 ? linhas.slice(inicio) : linhas)
    .filter((l) => !/(qualtrics|Revise as anota|Como est[áa] a qualidade|O que achou deste resumo|Confira dicas)/i.test(l))
    .filter((l) => !/^\s*(convidado|Anexos|Registros da reuni)/i.test(l))
    .map((l) =>
      l
        // "- [ ] tarefa": a caixinha do Docs não vira nada clicável aqui.
        .replace(/^(\s*[-*])\s*\[[ xX]?\]\s*/, "$1 ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\\([[\]()*_#-])/g, "$1")
        .replace(/\s+$/g, ""),
    )
    .flatMap((l) => (/^\*\*[^*]+\*\*$/.test(l.trim()) ? ["", l.trim(), ""] : [l]));
  // Itens de lista separados por linha em branco viravam uma lista por item.
  let texto = corpo.join("\n").replace(/\n{3,}/g, "\n\n");
  for (let antes = ""; antes !== texto; ) {
    antes = texto;
    texto = texto.replace(/(\n\s*[-*] [^\n]*)\n\n(?=\s*[-*] )/g, "$1\n");
  }
  return texto.trim();
}

export type ConteudoDaGravacao = { notas: string | null; transcricao: string | null; chat: string | null };

export async function conteudoDaGravacao(g: Gravacao): Promise<ConteudoDaGravacao> {
  const [notas, transcricao, chat] = await Promise.all([
    g.notasId ? exportarDoc(g.notasId).then(limparNotas) : null,
    g.transcricaoId ? exportarDoc(g.transcricaoId) : null,
    g.chatId ? baixarDoDrive(g.chatId).then((r) => r.text()) : null,
  ]);
  return { notas, transcricao, chat };
}
