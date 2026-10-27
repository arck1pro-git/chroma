// A IA que responde a quem COMENTA nas postagens do Instagram (2026-10-26).
//
// Decisão dele: resposta curta em público + abre o direct, onde a IA de
// atendimento (lib/ia/atendente.ts) segue. Só roda com REGRA LIGADA por Admin
// ou TI (instagram_ia_regras): sem regra, nenhuma IA responde comentário. Já
// existe outro robô nessas contas; nada aqui liga IA sozinho.
//
// TRAVAS (revisão de segurança, 2026-10-26, todas aqui ou na migration):
//   1. TEXTO PÚBLICO NUNCA É LIVRE: sai de FRASES, a lista aprovada abaixo. O
//      modelo só ESCOLHE uma pela intenção (enum) ou "nao_responder". A
//      abertura do direct ele escreve, mas passa por aberturaSegura (sem link,
//      sem @ além do autor, sem 3+ dígitos, sem e-mail, até 300 caracteres);
//      reprovou, vai ABERTURA_FIXA. O modelo recebe só o comentário, a legenda
//      e o @, como dado (lib/ia/sanitizar.ts); sem base externa, sem
//      dado do CRM e sem outra ferramenta. Modelo barato, sem thinking.
//   2. SEM LAÇO: só comentário RAIZ, de terceiro (nenhuma das três contas),
//      sem link, sem menção a outra conta, não só emoji, não oculto pela Meta.
//      Uma resposta pública da IA por autor por postagem (índice único). A
//      regra da conta (todas as postagens) não vale em anúncio (AD).
//   3. ATÔMICO E RECENTE: quem chama só passa comentário que o INSERT acabou
//      de gravar, e ele tem de ter até 10 min (pelo evento e, depois, pela hora
//      do comentário na Meta). A RESERVA (linha 'pendente', com os índices
//      únicos) é gravada ANTES de ir à Meta e ao modelo, sob a trava da conta e
//      o teto por hora (que conta toda reserva, descartada inclusive): só quem
//      a ganhou lê o comentário na Meta, chama o modelo e envia.
//   4. IA NO CONTATO: só no contato nascido do direct aberto aqui (sem
//      WhatsApp, sem oportunidade aberta) e só com ia IS NULL.
//   5. GENTE PRIMEIRO (jaTemGente, antes da reserva): IA desligada à mão no
//      contato, conversa do direct com dono ou com alguém da equipe (ou o outro
//      robô) na última hora, ou comentário já respondido por uma das nossas
//      contas: a IA não entra.
//   Fora da produção, a frase pública nunca sai (lib/instagram.ts): o direct
//   vai só para INSTAGRAM_SO_PARA e a reserva termina em 'erro'.
//
// ORDEM: o direct sai ANTES da resposta pública. "Te chamei no direct" em
// público com o direct falhado seria mentira; o direct sem a frase pública,
// não. Se a pessoa já foi chamada no direct por esta postagem, a frase pública
// continua verdadeira e sai.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { comoDado, REGRA_DADO_NAO_CONFIAVEL } from "@/lib/ia/sanitizar";
import { gravarIaDoContato } from "@/lib/ia/contato-ia";
import { PERFIS } from "@/lib/social/perfis";
import {
  COMENTARIO_RECENTE_MS,
  ehContaNossa,
  ehIdMeta,
  legendaDaPostagem,
  lerComentario,
  motivoDoErro,
  perfilDaConta,
  responderEmPublico,
  temLink,
  usuarioValido,
} from "@/lib/instagram";
import {
  abrirDirectDoComentario,
  confirmarRespostaPublica,
  linhaDoComentario,
  marcarErroDaResposta,
} from "@/lib/instagram-comentarios";

/**
 * Reservas da IA por conta por hora, em QUALQUER estado (inclusive as
 * descartadas): cada uma é uma ida à Meta e, quase sempre, uma chamada ao
 * modelo. Acima disto, fica para a equipe.
 */
const TETO_POR_HORA = 20;

/**
 * AS FRASES APROVADAS para a resposta pública. O modelo escolhe a chave; o
 * texto é este, com o @ de quem comentou. Mudar uma frase é mudar aqui.
 */
export const FRASES = {
  chamei_no_direct: {
    quando: "interesse, pedido para saber mais, \"eu\", \"quero\", comentário genérico positivo",
    texto: (u: string | null) => `Oi${u ? ` @${u}` : ""}, te chamei no direct! 😉`,
  },
  detalhes_no_direct: {
    quando: "pergunta sobre o produto ou a postagem (como funciona, valores, onde fica, prazo, como participar)",
    texto: (u: string | null) => `Oi${u ? ` @${u}` : ""}! Te mandei os detalhes no direct.`,
  },
  obrigado_e_direct: {
    quando: "elogio, parabéns ou reação de quem gostou",
    texto: (u: string | null) => `${u ? `@${u}, obrigado` : "Obrigado"} pelo comentário! Te chamei no direct 😊`,
  },
} as const;
export type ChaveFrase = keyof typeof FRASES;
const NAO_RESPONDER = "nao_responder";

/** A abertura do direct quando a do modelo não passa no filtro. */
export const ABERTURA_FIXA = "Oi! Vi seu comentário na nossa publicação e te chamei aqui pra conversar melhor. Como posso te ajudar?";

/** Três ou mais dígitos, colados ou entremeados por espaço, ponto ou traço ("47 9 9999-0000", "100.000"). */
const TEM_NUMERO = /\d(?:[\s.\-]*\d){2,}/;

function mencoes(texto: string): string[] {
  return [...texto.matchAll(/@([A-Za-z0-9._]+)/g)].map((m) => m[1].replace(/\.+$/, "").toLowerCase());
}

/** Por que a IA não responde a este TEXTO de comentário (null = pode). */
export function motivoNoTexto(bruto: string): string | null {
  const texto = bruto.trim();
  if (!texto) return "comentário vazio";
  if (!/[\p{L}\p{N}]/u.test(texto)) return "só emoji ou símbolo";
  if (temLink(texto)) return "comentário com link";
  const nossas = new Set(PERFIS.map((p) => p.instagram.toLowerCase()));
  if (mencoes(texto).some((m) => !nossas.has(m))) return "menciona outra conta";
  return null;
}

/** O filtro de saída da abertura do direct escrita pelo modelo. Reprovou: o texto fixo. */
export function aberturaSegura(bruto: string, usuario: string | null): string {
  const texto = bruto.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (!texto || texto.length > 300) return ABERTURA_FIXA;
  // Controle e formatação invisível (largura zero, direção de texto).
  if (/[\p{Cc}\p{Cf}]/u.test(texto)) return ABERTURA_FIXA;
  if (temLink(texto) || TEM_NUMERO.test(texto) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(texto)) return ABERTURA_FIXA;
  const autor = usuario?.toLowerCase() ?? null;
  if (mencoes(texto).some((m) => m !== autor)) return ABERTURA_FIXA;
  return texto;
}

type Regra = { midia_id: string | null; ia_id: string; ligada: boolean };

/**
 * A regra que vale para o comentário: a da postagem vence a da conta (ligada
 * ou desligada). A da conta não vale em anúncio, nem quando a Meta não disse o
 * tipo da postagem (na dúvida, pode ser anúncio).
 */
export function regraQueVale(regras: Regra[], midiaId: string, midiaTipo: string | null): { iaId: string } | null {
  const daPostagem = regras.find((r) => r.midia_id === midiaId);
  if (daPostagem) return daPostagem.ligada ? { iaId: daPostagem.ia_id } : null;
  const daConta = regras.find((r) => r.midia_id === null);
  if (!daConta?.ligada) return null;
  if (!midiaTipo || midiaTipo.toUpperCase() === "AD") return null;
  return { iaId: daConta.ia_id };
}

// ── O modelo ────────────────────────────────────────────────────────────────

const SISTEMA = `Você ajuda a equipe de uma empresa a responder comentários nas postagens do Instagram dela. Para cada comentário você faz só duas coisas, pela ferramenta responder_comentario:
1. Escolhe UMA das respostas públicas prontas, pela intenção do comentário, ou "${NAO_RESPONDER}".
2. Escreve a primeira mensagem do direct que vai para quem comentou.

Escolha "${NAO_RESPONDER}" para crítica, reclamação, ofensa, spam, piada, marcação de amigos, comentário sem relação com a postagem, ou quando tiver dúvida se vale responder.

A mensagem do direct: uma ou duas frases curtas e cordiais, em português do Brasil, convidando a pessoa a contar o que procura. Sem preço, valor, taxa, número, prazo, link, e-mail, telefone ou @ de outra conta, e sem prometer nada. Pode chamar a pessoa pelo @ dela. Até 300 caracteres.

${REGRA_DADO_NAO_CONFIAVEL}`;

const FERRAMENTA: Anthropic.Tool = {
  name: "responder_comentario",
  description: "Escolhe a resposta pública pronta (ou não responder) e escreve a abertura do direct.",
  input_schema: {
    type: "object",
    properties: {
      frase: {
        type: "string",
        enum: [...(Object.keys(FRASES) as ChaveFrase[]), NAO_RESPONDER],
        description: [
          ...(Object.entries(FRASES) as Array<[ChaveFrase, (typeof FRASES)[ChaveFrase]]>).map(
            ([chave, f]) => `${chave}: ${f.quando}`,
          ),
          `${NAO_RESPONDER}: crítica, reclamação, ofensa, spam, piada, marcação de amigos, sem relação, ou dúvida`,
        ].join(". "),
      },
      abertura_do_direct: {
        type: "string",
        description: "A primeira mensagem do direct para quem comentou (vazia se não responder).",
      },
    },
    required: ["frase", "abertura_do_direct"],
    additionalProperties: false,
  },
};

type Decisao = { frase: ChaveFrase | null; abertura: string };

async function decidir(e: { texto: string; legenda: string; usuario: string | null }): Promise<Decisao> {
  const cliente = new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const r = await cliente.messages.create({
    model: process.env.IA_COMENTARIOS_MODELO?.trim() || "claude-haiku-4-5",
    max_tokens: 400,
    system: SISTEMA,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: FERRAMENTA.name },
    messages: [
      {
        role: "user",
        content: [
          `Legenda da postagem: ${comoDado(e.legenda.slice(0, 1000))}`,
          `Quem comentou: ${comoDado(e.usuario ? `@${e.usuario}` : "(sem @)")}`,
          `Comentário: ${comoDado(e.texto.slice(0, 1000))}`,
        ].join("\n"),
      },
    ],
  });
  const uso = r.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === FERRAMENTA.name);
  if (!uso || r.stop_reason === "max_tokens") return { frase: null, abertura: "" };
  const entrada = uso.input as { frase?: unknown; abertura_do_direct?: unknown };
  // O enum é conferido de novo aqui: o que não for uma das chaves é "não responder".
  const frase = typeof entrada.frase === "string" && Object.hasOwn(FRASES, entrada.frase) ? (entrada.frase as ChaveFrase) : null;
  return { frase, abertura: typeof entrada.abertura_do_direct === "string" ? entrada.abertura_do_direct : "" };
}

// ── O fluxo ─────────────────────────────────────────────────────────────────

/**
 * Responde (ou não) ao comentário `linhaId`, que o webhook ACABOU de gravar.
 * Nunca lança: roda depois da resposta ao webhook. Toda desistência vai para o
 * log com o motivo (sem o texto do comentário).
 */
export async function responderComentarioComIa(linhaId: string): Promise<void> {
  const nao = (porque: string) => console.info(`[ia comentários] não respondeu ${linhaId}: ${porque}`);
  try {
    const linha = await linhaDoComentario(linhaId);
    if (!linha) return nao("comentário não existe");
    const perfil = perfilDaConta(linha.conta_id);
    if (!perfil) return nao("conta fora das contas do CRM");
    if (linha.da_conta || ehContaNossa(linha.autor_id)) return nao("comentário de uma das nossas contas");
    if (linha.pai_id) return nao("é resposta, não comentário raiz");
    if (!ehIdMeta(linha.comentario_id) || !ehIdMeta(linha.autor_id)) return nao("sem id do comentário ou do autor");
    if (Date.now() - new Date(linha.data_criacao).getTime() > COMENTARIO_RECENTE_MS) return nao("comentário antigo");

    const regras = (await sql`
      SELECT midia_id, ia_id, ligada FROM instagram_ia_regras
       WHERE conta_id = ${linha.conta_id} AND (midia_id = ${linha.midia_id} OR midia_id IS NULL)`) as unknown as Regra[];
    const regra = regraQueVale(regras, linha.midia_id, linha.midia_tipo);
    if (!regra) return nao("sem regra ligada para esta postagem");

    const noTexto = motivoNoTexto(linha.texto);
    if (noTexto) return nao(noTexto);

    // Gente (ou outro robô) já está com essa pessoa: a IA não entra no meio.
    const ocupado = await jaTemGente(linha.conta_id, linha.comentario_id, linha.autor_id);
    if (ocupado) return nao(ocupado);

    const reserva = await reservar(linha.conta_id, linha.midia_id, linha.midia_tipo, linha.comentario_id, linha.autor_id, perfil.instagram);
    if ("porque" in reserva) return nao(reserva.porque);
    const reservaId = reserva.id;

    // Como a Meta vê o comentário agora, DEPOIS da reserva (a ida à Meta conta
    // no teto): oculto (palavras ocultas, filtro de ofensa) não recebe resposta;
    // sem conseguir ler, também não. A hora é a do comentário na Meta, não a do
    // evento: reentrega depois de uma falha chega com `time` novo para
    // comentário de horas atrás.
    const naMeta = await lerComentario(linha.comentario_id).catch(() => null);
    const naoNaMeta = !naMeta
      ? "não consegui ler o comentário na Meta"
      : !naMeta.quando || Date.now() - Date.parse(naMeta.quando) > COMENTARIO_RECENTE_MS
        ? "comentário antigo na Meta"
        : naMeta.oculto
          ? "comentário oculto pela Meta"
          : naMeta.paiId
            ? "a Meta diz que é resposta"
            : null;
    if (naoNaMeta) {
      await descartar(reservaId, naoNaMeta);
      return nao(naoNaMeta);
    }

    const usuario = usuarioValido(linha.autor_usuario);
    let decisao: Decisao;
    try {
      decisao = await decidir({ texto: linha.texto, legenda: await legendaDaPostagem(perfil, linha.midia_id), usuario });
    } catch (e) {
      await marcarErroDaResposta(reservaId, new Error(`o modelo falhou: ${motivoDoErro(e)}`));
      return;
    }
    if (!decisao.frase) {
      await descartar(reservaId, "a IA decidiu não responder");
      return nao("a IA decidiu não responder");
    }

    // 1. O direct.
    const direct = await abrirDirectDoComentario(linha, aberturaSegura(decisao.abertura, usuario), { quem: "ia", usuarioId: null });
    if (!direct.ok && !direct.jaTinha) {
      await marcarErroDaResposta(reservaId, new Error(`o direct não saiu: ${direct.erro}`));
      return;
    }
    if (direct.ok) await ligarIaNoContato(direct.contatoId, regra.iaId);

    // 2. A frase pública.
    const frase = FRASES[decisao.frase].texto(usuario);
    await sql`UPDATE instagram_comentarios SET texto = ${frase} WHERE id = ${reservaId}`;
    try {
      const r = await responderEmPublico(perfil, linha.comentario_id, linha.autor_id, frase);
      await confirmarRespostaPublica(reservaId, r.id);
    } catch (e) {
      await marcarErroDaResposta(reservaId, e);
    }
  } catch (e) {
    console.error("[ia comentários] falhou:", linhaId, motivoDoErro(e));
  }
}

/**
 * Alguém já está com essa pessoa? Devolve o motivo, ou null. Conferido ANTES da
 * reserva, sem modelo e sem envio (revisão de segurança, 2026-10-26):
 *   · o contato desse IGSID está com a IA desligada à mão (ia = false);
 *   · a conversa do Instagram dele com ESTA conta tem dono, ou alguém falou
 *     nela pelo CRM ou pelo celular (ou outro robô, que chega como 'aparelho')
 *     na última hora — a mesma janela do "humano recente" de lib/ia/atendente.ts;
 *   · já há resposta de uma das nossas contas a este comentário (a equipe ou o
 *     outro robô que atende essas contas).
 */
async function jaTemGente(contaId: string, comentarioId: string, autorId: string): Promise<string | null> {
  const [r] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM contatos c
         WHERE c.campos ? 'instagram_id' AND c.campos->>'instagram_id' = ${autorId} AND c.ia = false
      ) AS ia_desligada,
      EXISTS (
        SELECT 1 FROM atendimentos a JOIN contatos c ON c.id = a.contato_id
         WHERE c.campos ? 'instagram_id' AND c.campos->>'instagram_id' = ${autorId}
           AND a.canal = 'instagram' AND a.numero_instancia = ${contaId}
           AND (a.responsavel_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM mensagens m
                            WHERE m.atendimento_id = a.id AND m.enviada_por IN ('crm', 'aparelho')
                              AND m.data_criacao > now() - interval '1 hour'))
      ) AS com_gente,
      EXISTS (
        SELECT 1 FROM instagram_comentarios x WHERE x.da_conta AND x.pai_id = ${comentarioId}
      ) AS ja_respondido`;
  if (r?.ia_desligada) return "IA desligada à mão para este contato";
  if (r?.com_gente) return "a conversa do direct tem dono ou alguém da equipe falou na última hora";
  if (r?.ja_respondido) return "uma das nossas contas já respondeu a este comentário";
  return null;
}

/** A reserva sem resposta: 'descartado' com o motivo (não ocupa a vaga do autor; conta no teto). */
async function descartar(reservaId: string, porque: string): Promise<void> {
  await sql`
    UPDATE instagram_comentarios SET envio = 'descartado', erro = ${porque}, data_registro = now()
     WHERE id = ${reservaId}`;
}

/**
 * A reserva: sob a trava da conta (uma reserva por vez por conta, para o teto
 * valer), confere o teto da última hora e grava a linha 'pendente'. Os índices
 * únicos (um por comentário, um por autor por postagem) fazem o resto: o
 * INSERT que bate neles não grava nada. Devolve o id da reserva, ou o motivo.
 */
async function reservar(
  contaId: string,
  midiaId: string,
  midiaTipo: string | null,
  comentarioId: string,
  autorId: string,
  nossoUsuario: string,
): Promise<{ id: string } | { porque: string }> {
  return sql.begin(async (tx: typeof sql) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`ig-ia:${contaId}`}))`;
    // Todas as reservas da hora, descartadas inclusive. data_registro anda
    // quando o envio muda de estado (nunca para trás), então conta um pouco a
    // mais, nunca a menos, e usa o índice ix_ig_ia_por_hora.
    const [n] = await tx`
      SELECT count(*)::int AS n FROM instagram_comentarios
       WHERE conta_id = ${contaId} AND enviada_por = 'ia'
         AND data_registro > now() - interval '1 hour'`;
    if ((n?.n as number) >= TETO_POR_HORA) return { porque: `teto de ${TETO_POR_HORA} reservas por hora na conta` };
    const [r] = await tx`
      INSERT INTO instagram_comentarios
        (conta_id, midia_id, midia_tipo, pai_id, autor_id, autor_usuario, texto, da_conta,
         enviada_por, envio, para_autor_id, lido_em)
      VALUES
        (${contaId}, ${midiaId}, ${midiaTipo}, ${comentarioId}, ${contaId}, ${nossoUsuario}, '', true,
         'ia', 'pendente', ${autorId}, now())
      ON CONFLICT DO NOTHING
      RETURNING id`;
    return r?.id
      ? { id: r.id as string }
      : { porque: "outra chamada já reservou este comentário, ou a pessoa já teve resposta da IA nesta postagem" };
  });
}

/**
 * A IA da regra fica no contato para a IA de atendimento seguir no direct. Só
 * em contato nascido do Instagram (sem WhatsApp, sem oportunidade aberta) e só
 * se ninguém definiu a IA dele (ia IS NULL, conferido na mesma instrução).
 */
async function ligarIaNoContato(contatoId: string, iaId: string): Promise<void> {
  try {
    const [c] = await sql`
      SELECT ia, whatsapp,
             EXISTS (SELECT 1 FROM oportunidades o WHERE o.contato_id = contatos.id AND o.status = 'aberta') AS tem_op
        FROM contatos WHERE id = ${contatoId}`;
    if (!c || c.ia !== null || c.whatsapp || c.tem_op) return;
    await gravarIaDoContato(contatoId, true, iaId, null, "pela IA de comentários do Instagram", { soSeNaoDefinida: true });
  } catch (e) {
    console.error("[ia comentários] não liguei a IA no contato", contatoId, motivoDoErro(e));
  }
}
