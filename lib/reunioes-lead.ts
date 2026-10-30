// O LEAD DA REUNIÃO para o assistente de reuniões (extensão do Chrome em
// extensao-reunioes/, pedido dele em 2026-10-28: "entender o lead e, quando
// surgir objeção, propor uma condução da reunião").
//
// Três perguntas, nesta ordem:
//   1. quem está nesta sala? No Meet, o código da sala (abc-defg-hij) casa com o
//      link do evento do Google que o CRM criou (agenda_reunioes.google_evento_id
//      → hangoutLink). No Zoom, e quando o evento não foi criado pelo CRM, a
//      tela lista as reuniões de hoje e a busca; o clique pede confirmação
//      antes de anexar a gravação ao lead (pedido dele, 2026-10-28).
//   2. o que quem chamou pode ver? A regra da gaveta de contatos
//      (app/contatos/actions.ts, dadosDoContato), revista pela auditoria de
//      2026-10-28: o contato é de quem tem Dashboard ou Contatos (contato não tem
//      escopo); as oportunidades seguem o escopo "próprio"; o texto da conversa
//      do WhatsApp é do módulo Chat e só entra para quem o tem.
//   3. o que a IA precisa saber dele? A ficha curta, que fica no servidor: à
//      extensão vão só nome e resumo. Tudo é texto de terceiro e vai ao modelo
//      por comoDado (lib/ia/reuniao.ts).
import "server-only";
import { sql } from "@/lib/db";
import { eventoPorId } from "@/lib/agenda";
import { buscarContatosNoBanco } from "@/lib/contatos-busca";
import type { UsuarioLogado } from "@/lib/auth/dal";
import type { Escopo } from "@/lib/auth/modulos";
import { brl } from "@/lib/formato";
import { soDigitos } from "@/lib/telefone";
import { ehUuid } from "@/lib/validacao";
import { MARCA_ANOTACAO_IA } from "@/lib/ia/atendente";

/**
 * Um lead que a pessoa pode escolher na extensão. `inicio` (ISO, desde 2026-10-30)
 * deixa o painel mostrar a hora e marcar a reunião de agora.
 */
export type CandidatoReuniao = { contatoId: string; nome: string; detalhe: string; inicio?: string };

/** A ficha do lead: o que a tela mostra e o que a IA lê. */
export type FichaLead = {
  contatoId: string;
  nome: string;
  /** Linhas curtas para a tela (funil e etapa, valor, local). */
  resumo: string[];
  /** O mesmo e mais um pouco, só para o modelo. */
  contexto: {
    cidade: string | null;
    oportunidade: { nome: string; funil: string; etapa: string; valor: number } | null;
    formulario: Record<string, string>;
    whatsapp: { quem: "lead" | "equipe" | "ia"; texto: string }[];
    objecoes: string[];
    anotacoes: string[];
  };
  /** A IA de WhatsApp do funil do lead: é dela o conhecimento do produto. */
  iaId: string | null;
};

// O link do Meet só é conferido nas reuniões perto de agora: cada uma é uma
// leitura no Google, e a janela cobre quem atrasou e quem entrou antes.
const JANELA_MS = 3 * 60 * 60 * 1000;
// A sala aberta vem como /abc-defg-hij ou, desde que o Meet passou a redirecionar
// (visto em 2026-10-30), /meet/abc-defg-hij; o link do evento no Google, no antigo.
const CODIGO_MEET = /^https:\/\/meet\.google\.com\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/i;

// Campos do formulário que não dizem nada do lead (UTM, ids da Meta, cliques).
const CAMPO_TECNICO = /^(utm_|campaign|adset|ad_|ad$|fbclid|gclid|_fb|form_?(id|name)?$|(lead|leadgen)_?id$|platform$|is_organic$|created_time$|page_?(id|name)$|instagram_|id_origem|responsavel_origem)/i;

/**
 * O escopo com que a pessoa vê leads: o do Dashboard, senão o de Contatos (a
 * mesma ordem de exigirAlgumModulo("inicio", "contatos")). null = não vê lead.
 */
export function escopoDoLead(usuario: UsuarioLogado): Escopo | null {
  return usuario.modulos.get("inicio") ?? usuario.modulos.get("contatos") ?? null;
}

/**
 * As reuniões do CRM de hoje (dia de Brasília), a mais perto de agora primeiro,
 * e qual delas é a desta sala, quando o link do Meet bate. Quem não vê lead não
 * recebe nada.
 */
export async function leadDaSala(usuario: UsuarioLogado, sala: string): Promise<{ contatoId: string | null; candidatos: CandidatoReuniao[] }> {
  if (!escopoDoLead(usuario)) return { contatoId: null, candidatos: [] };
  const agora = Date.now();
  const reunioes = (await sql`
    SELECT r.google_evento_id, r.contato_id, r.inicio, c.nome
      FROM agenda_reunioes r JOIN contatos c ON c.id = r.contato_id
     WHERE r.inicio >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
       AND r.inicio <  (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo'
     ORDER BY abs(extract(epoch FROM r.inicio - now()))
     LIMIT 20`) as unknown as { google_evento_id: string; contato_id: string; inicio: Date; nome: string }[];

  const candidatos = reunioes.map((r) => ({
    contatoId: r.contato_id,
    nome: r.nome,
    inicio: new Date(r.inicio).toISOString(),
    detalhe: `reunião às ${new Date(r.inicio).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`,
  }));

  const codigo = CODIGO_MEET.exec(sala)?.[1]?.toLowerCase();
  if (!codigo) return { contatoId: null, candidatos };
  for (const r of reunioes) {
    if (Math.abs(new Date(r.inicio).getTime() - agora) > JANELA_MS) break;
    try {
      const evento = await eventoPorId(r.google_evento_id);
      if (evento?.meet && CODIGO_MEET.exec(evento.meet)?.[1]?.toLowerCase() === codigo) return { contatoId: r.contato_id, candidatos };
    } catch (e) {
      // Google fora do ar ou desconectado: a escolha fica com a pessoa.
      console.error("[reunioes] não leu o evento", r.google_evento_id, e instanceof Error ? e.message : e);
      break;
    }
  }
  return { contatoId: null, candidatos };
}

/** A busca da extensão: nome, telefone mascarado e cidade; nada de e-mail ou número inteiro. */
export async function buscarLeadsDaReuniao(termo: string): Promise<CandidatoReuniao[]> {
  const achados = await buscarContatosNoBanco(termo);
  return achados.slice(0, 15).map((c) => {
    const fim = soDigitos(c.whatsapp ?? "").slice(-4);
    return { contatoId: c.id, nome: c.nome, detalhe: [fim ? `tel. …${fim}` : "", c.cidade].filter(Boolean).join(" · ") };
  });
}

/**
 * A ficha do lead, ou null se o contato não existe. Quem chama já conferiu
 * escopoDoLead; aqui entram o filtro de responsável ("próprio") e o do Chat.
 */
export async function fichaDoLead(
  contatoId: string,
  acesso: { soDoResponsavel: string | null; comConversa: boolean },
): Promise<FichaLead | null> {
  const [c] = await sql`
    SELECT id, nome, nullif(cidade, '') AS cidade, nullif(estado, '') AS estado,
           COALESCE(campos, '{}'::jsonb) AS campos, ia_id
      FROM contatos WHERE id = ${contatoId}`;
  if (!c) return null;

  // A oportunidade aberta mais recente que a pessoa pode ver; sem aberta, a
  // mais recente de todas.
  const dono = acesso.soDoResponsavel;
  const [o] = await sql`
    SELECT o.nome, o.valor, o.status, COALESCE(o.campos, '{}'::jsonb) AS campos, f.nome AS funil, e.nome AS etapa,
           (SELECT x.ia_id FROM etapas x WHERE x.funil_id = o.funil_id AND x.ia_id IS NOT NULL ORDER BY x.ordem LIMIT 1) AS ia_do_funil
      FROM oportunidades o JOIN funis f ON f.id = o.funil_id JOIN etapas e ON e.id = o.etapa_id
     WHERE o.contato_id = ${contatoId}
       AND (${dono}::uuid IS NULL OR o.responsavel_id = ${dono}::uuid)
     ORDER BY (o.status = 'aberta') DESC, o.data_criacao DESC
     LIMIT 1`;

  const [whatsapp, objecoes, anotacoes] = await Promise.all([
    acesso.comConversa
      ? sql`
          SELECT m.origem, m.enviada_por, m.texto
            FROM mensagens m JOIN atendimentos a ON a.id = m.atendimento_id
           WHERE a.contato_id = ${contatoId} AND m.texto <> ''
           ORDER BY m.data_criacao DESC
           LIMIT 40`
      : Promise.resolve([]),
    sql`
      SELECT descricao FROM historico
       WHERE contato_id = ${contatoId} AND descricao LIKE 'Objeção registrada pela IA%'
       ORDER BY data_criacao DESC LIMIT 10`,
    sql`SELECT texto FROM anotacoes WHERE contato_id = ${contatoId} ORDER BY data_criacao DESC LIMIT 5`,
  ]);

  const formulario: Record<string, string> = {};
  for (const fonte of [c.campos, o?.campos ?? {}] as Record<string, unknown>[]) {
    for (const [chave, valor] of Object.entries(fonte)) {
      if (CAMPO_TECNICO.test(chave) || valor === null || valor === "" || typeof valor === "object") continue;
      formulario[chave] = String(valor).slice(0, 200);
    }
  }

  // numeric chega como texto (fetch_types:false, lib/db.ts).
  const valor = Number(o?.valor ?? 0);
  const oportunidade = o ? { nome: o.nome as string, funil: o.funil as string, etapa: o.etapa as string, valor } : null;
  const local = [c.cidade, c.estado].filter(Boolean).join("/") || null;
  const resumo = [
    ...(oportunidade ? [`${oportunidade.funil} · ${oportunidade.etapa}${o?.status !== "aberta" ? ` (${o?.status})` : ""}`] : []),
    ...(valor > 0 ? [`Valor: ${brl(valor)}`] : formulario.valor_inicial ? [`Formulário: ${formulario.valor_inicial}`] : []),
    ...(local ? [local] : []),
    ...(objecoes.length ? [`${objecoes.length} objeção(ões) registrada(s) no WhatsApp`] : []),
  ];

  return {
    contatoId,
    nome: c.nome as string,
    resumo,
    contexto: {
      cidade: local,
      oportunidade,
      formulario,
      whatsapp: [...whatsapp].reverse().map((m) => ({
        quem: m.origem === "contato" ? ("lead" as const) : m.enviada_por === "ia" ? ("ia" as const) : ("equipe" as const),
        texto: String(m.texto).slice(0, 500),
      })),
      objecoes: objecoes.map((h) => String(h.descricao)),
      anotacoes: anotacoes.map((a) => String(a.texto).slice(0, 800)),
    },
    iaId: (o?.ia_do_funil as string | null) ?? (c.ia_id as string | null) ?? null,
  };
}

/** O acesso à ficha que a pessoa tem: o filtro de responsável e o do Chat. */
export function acessoAFicha(usuario: UsuarioLogado, escopo: Escopo) {
  return { soDoResponsavel: escopo === "proprio" ? usuario.id : null, comConversa: usuario.modulos.has("chat") };
}

/**
 * A ficha pelo id que veio da extensão, com o que o acesso da pessoa deixa ver.
 * null quando ela não vê lead, o id não é uuid ou o contato não existe: a rota
 * responde 404 nos três casos.
 */
export async function fichaVisivel(usuario: UsuarioLogado, idBruto: unknown): Promise<FichaLead | null> {
  const escopo = escopoDoLead(usuario);
  const id = String(idBruto ?? "");
  if (!escopo || !ehUuid(id)) return null;
  return fichaDoLead(id, acessoAFicha(usuario, escopo));
}

const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const diaHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

/**
 * O resumo revisado vira UMA anotação no contato, com a marca de texto gerado
 * por IA e quem declarou ter avisado os participantes da gravação, e a que
 * horas. O id da sessão vai no texto, e o INSERT só grava se nenhuma anotação
 * do contato tiver esse id: clique repetido ou nova tentativa não duplicam. A
 * trava do par contato+sessão (como em lib/agenda.ts) faz o segundo pedido
 * simultâneo esperar o primeiro e enxergar a anotação dele.
 */
export async function salvarResumoNaFicha(dados: {
  contatoId: string;
  autor: { id: string; nome: string };
  resumo: string;
  sessao: string;
  consentimentoEm: Date;
}): Promise<"salvo" | "ja-salvo" | "sem-contato"> {
  const marcaSessao = `Sessão ${dados.sessao}`;
  const texto = [
    `${MARCA_ANOTACAO_IA} Resumo da reunião (assistente de reuniões), ${diaHora.format(new Date())}`,
    `Aviso de gravação aos participantes declarado por ${dados.autor.nome} às ${hora.format(dados.consentimentoEm)}.`,
    "",
    dados.resumo,
    "",
    marcaSessao,
  ].join("\n");

  return sql.begin(async (tx: typeof sql) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`chroma:resumo-reuniao:${dados.contatoId}:${dados.sessao}`}))`;
    const gravadas = await tx`
      INSERT INTO anotacoes (contato_id, texto, autor_id)
      SELECT c.id, ${texto}, ${dados.autor.id}::uuid
        FROM contatos c
       WHERE c.id = ${dados.contatoId}::uuid
         AND NOT EXISTS (SELECT 1 FROM anotacoes a WHERE a.contato_id = c.id AND a.texto LIKE ${`%${marcaSessao}`})
      RETURNING id`;
    if (gravadas.length) return "salvo" as const;
    const [existe] = await tx`SELECT 1 FROM contatos WHERE id = ${dados.contatoId}::uuid`;
    return existe ? ("ja-salvo" as const) : ("sem-contato" as const);
  });
}
