// As ferramentas de DEMANDAS do conector MCP (app/api/mcp/[segredo]): gerar
// demandas pelo Claude (pedido dele, 2026-10-16: "add no mcp a geração de
// demandas" e "deve ser possível enviar várias demandas para múltiplas pessoas").
//
// QUEM CRIA: o link do conector não tem login, e a demanda precisa de autor —
// é quem pode editar e excluir depois (lib/demandas.ts, a regra de "só quem
// criou"). O conector é do Fabrício, então é ele. As pessoas que recebem veem
// "Criada por Fabrício Arck" e ganham o aviso de demanda nova como sempre.
//
// PARA QUEM: as mesmas regras do módulo. Recebe quem está ativo, com login e
// com o módulo Demandas (pessoasParaDemanda); "todos" é uma cópia para cada
// um; "ti" é o chamado para o departamento TI. Várias pessoas na mesma demanda
// = uma cópia por pessoa, criadas juntas (o cartão agrupado de quem criou).
import "server-only";
import { z } from "zod";
import { listaUuid, sql } from "@/lib/db";
import { inserirChamado, inserirDemandasParaPessoas, inserirItens, pessoasParaDemanda } from "@/lib/demandas";
import { TETO_ITENS, TETO_TEXTO_ITEM } from "@/lib/demandas-tipos";
import { ErroDaFerramenta, type Ferramenta } from "@/lib/mcp/protocolo";

/** Fabrício Arck — o dono do conector, autor das demandas que entram por ele. */
const AUTOR = "79003fab-577d-467c-a71e-13f198d73a82";
const ENDERECO_DO_CRM = "https://amaanoffice.amaan.com.br";
const TETO_DEMANDAS_POR_CHAMADA = 20;

type Pessoa = { id: string; nome: string };

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Os nomes que vieram do modelo viram ids. Exato (sem acento e caixa) ganha;
 * senão, quem tem todas as palavras no nome. Nome que não acha ninguém, ou que
 * acha mais de um, é recusado com as opções — melhor que mandar para a pessoa
 * errada.
 */
function resolverPara(lista: string[], pessoas: Pessoa[]): { ids: string[]; chamado: boolean } {
  const ids = new Set<string>();
  let chamado = false;
  for (const bruto of lista) {
    const alvo = semAcento(bruto);
    if (alvo === "todos" || alvo === "todo mundo" || alvo === "equipe toda") {
      pessoas.forEach((p) => ids.add(p.id));
      continue;
    }
    if (alvo === "ti" || alvo === "chamado" || alvo.startsWith("chamado para o ti") || alvo === "departamento ti") {
      chamado = true;
      continue;
    }
    if (UUID.test(bruto.trim())) {
      const p = pessoas.find((x) => x.id === bruto.trim());
      if (!p) throw new ErroDaFerramenta(`O id ${bruto} não é de ninguém que recebe demanda.`);
      ids.add(p.id);
      continue;
    }
    const exato = pessoas.filter((p) => semAcento(p.nome) === alvo);
    const palavras = alvo.split(/\s+/).filter(Boolean);
    const candidatos = exato.length ? exato : pessoas.filter((p) => palavras.every((w) => semAcento(p.nome).includes(w)));
    if (candidatos.length === 1) {
      ids.add(candidatos[0].id);
      continue;
    }
    const todos = pessoas.map((p) => p.nome).join(", ");
    throw new ErroDaFerramenta(
      candidatos.length === 0
        ? `Não achei "${bruto}" entre quem recebe demanda: ${todos}.`
        : `"${bruto}" bate com ${candidatos.map((p) => p.nome).join(" e ")}: use o nome completo.`,
    );
  }
  return { ids: [...ids], chamado };
}

function prazoValido(prazo: string | undefined): string | null {
  if (!prazo) return null;
  const d = new Date(`${prazo}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== prazo) throw new ErroDaFerramenta(`Prazo inválido: ${prazo}.`);
  return prazo;
}

// ── Ferramentas ─────────────────────────────────────────────────────────────

async function pessoasDemanda() {
  const pessoas = await pessoasParaDemanda();
  return {
    pessoas: pessoas.map((p) => p.nome),
    tambem: ['"todos": uma cópia para cada pessoa da lista', '"ti": chamado para o departamento TI'],
  };
}

const umaDemanda = z.object({
  para: z
    .array(z.string().min(1))
    .min(1)
    .max(30)
    .describe('Quem recebe: nomes das pessoas (veja pessoas_demanda), "todos" ou "ti" (chamado para o TI). Com várias pessoas, cada uma recebe a sua cópia.'),
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().max(4000).optional(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD").optional().describe("Data limite, AAAA-MM-DD (horário de Brasília)."),
  prioridade: z.enum(["baixa", "normal", "alta"]).default("normal"),
  checklist: z
    .array(z.string().trim().min(1).max(TETO_TEXTO_ITEM))
    .max(TETO_ITENS)
    .optional()
    .describe("Passos da demanda, na ordem. Cada pessoa marca os dela."),
});

const entradaCriar = z.object({
  demandas: z.array(umaDemanda).min(1).max(TETO_DEMANDAS_POR_CHAMADA).describe("Uma ou várias demandas, cada uma com o seu para."),
});

async function criarDemandas({ demandas }: z.infer<typeof entradaCriar>) {
  const pessoas = await pessoasParaDemanda();
  // Tudo conferido ANTES de criar a primeira: um nome errado na terceira
  // demanda não pode deixar as duas primeiras criadas pela metade do pedido.
  const planos = demandas.map((d) => ({ d, para: resolverPara(d.para, pessoas), prazo: prazoValido(d.prazo) }));

  const criadas = [];
  for (const { d, para, prazo } of planos) {
    const campos = { titulo: d.titulo, descricao: d.descricao?.trim() || null, prazo, prioridade: d.prioridade };
    const linhas: Array<{ id: string; para: string }> = [];
    if (para.ids.length) {
      for (const l of await inserirDemandasParaPessoas(campos, para.ids, AUTOR)) linhas.push({ id: l.id, para: l.responsavel });
    }
    if (para.chamado) {
      const id = await inserirChamado(campos, AUTOR);
      if (!id) throw new ErroDaFerramenta("O departamento TI não existe no banco: o chamado não foi aberto.");
      linhas.push({ id, para: "TI (chamado)" });
    }
    await inserirItens(linhas.map((l) => l.id), d.checklist ?? []);
    criadas.push({
      titulo: d.titulo,
      para: linhas.map((l) => l.para),
      prazo: prazo ?? "sem prazo",
      prioridade: d.prioridade,
      ...(d.checklist?.length ? { passos: d.checklist.length } : {}),
      link: linhas[0] ? `${ENDERECO_DO_CRM}/demandas?abrir=${linhas[0].id}` : null,
    });
  }
  return {
    criadas: criadas.length,
    copias: criadas.reduce((n, c) => n + c.para.length, 0),
    criada_por: "Fabrício Arck",
    demandas: criadas,
  };
}

const entradaListar = z.object({
  para: z.string().min(1).optional().describe('Nome de quem recebe (ou "ti" para os chamados). Sem isto: de todo mundo.'),
  situacao: z.enum(["pendentes", "feitas", "todas"]).default("pendentes").describe("Feitas: dos últimos 90 dias."),
  limite: z.number().int().min(1).max(100).default(30),
});

async function listarDemandas({ para, situacao, limite }: z.infer<typeof entradaListar>) {
  const alvo = para ? resolverPara([para], await pessoasParaDemanda()) : null;
  const ids = alvo?.ids.length ? listaUuid(alvo.ids) : null;
  const soChamados = Boolean(alvo?.chamado && !alvo.ids.length);
  const linhas = await sql`
    SELECT d.id, d.titulo, to_char(d.prazo, 'YYYY-MM-DD') AS prazo, d.prioridade,
           COALESCE(r.nome, dep.nome) AS para, a.nome AS criada_por,
           CASE WHEN d.feita_em IS NOT NULL THEN 'feita'
                WHEN d.iniciada_em IS NOT NULL THEN 'em andamento'
                ELSE 'a fazer' END AS situacao,
           (d.feita_em IS NULL AND d.prazo < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS atrasada,
           (SELECT count(*) FROM demanda_itens i WHERE i.demanda_id = d.id)::int AS passos,
           (SELECT count(*) FROM demanda_itens i WHERE i.demanda_id = d.id AND i.feito_em IS NOT NULL)::int AS passos_feitos,
           to_char(d.data_criacao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS criada_em
      FROM demandas d
      LEFT JOIN usuarios r ON r.id = d.responsavel_id
      LEFT JOIN departamentos dep ON dep.id = d.departamento_id
      LEFT JOIN usuarios a ON a.id = d.criado_por
     WHERE (${situacao} = 'todas'
            OR (${situacao} = 'pendentes' AND d.feita_em IS NULL)
            OR (${situacao} = 'feitas' AND d.feita_em > now() - interval '90 days'))
       AND (${ids}::text IS NULL OR d.responsavel_id = ANY(string_to_array(${ids}, ',')::uuid[]))
       AND (NOT ${soChamados}::boolean OR d.departamento_id IS NOT NULL)
     ORDER BY d.feita_em IS NOT NULL, d.prazo NULLS LAST, d.data_criacao DESC
     LIMIT ${limite}`;
  return linhas.map((l) => ({
    titulo: l.titulo,
    para: l.para,
    situacao: l.situacao,
    ...(l.atrasada ? { atrasada: true } : {}),
    prazo: l.prazo ?? "sem prazo",
    prioridade: l.prioridade,
    ...(l.passos ? { checklist: `${l.passos_feitos}/${l.passos}` } : {}),
    criada_por: l.criada_por,
    criada_em: l.criada_em,
    link: `${ENDERECO_DO_CRM}/demandas?abrir=${l.id}`,
  }));
}

const ESCREVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const FERRAMENTAS_DEMANDAS: Ferramenta[] = [
  {
    nome: "pessoas_demanda",
    titulo: "Quem recebe demanda",
    descricao: "As pessoas que podem receber demanda (ativas e com o módulo Demandas), mais \"todos\" e \"ti\" (chamado). Use os nomes daqui no para de criar_demandas.",
    entrada: z.object({}),
    executar: pessoasDemanda,
  },
  {
    nome: "criar_demandas",
    titulo: "Criar demandas",
    descricao:
      "Cria uma ou várias demandas de uma vez (até 20). Cada demanda tem o seu para: uma pessoa, várias (cada uma recebe a sua cópia e marca os seus passos), \"todos\" ou \"ti\" (chamado). " +
      "Título obrigatório; descrição, prazo (AAAA-MM-DD), prioridade e checklist opcionais. A demanda sai como criada por Fabrício Arck, e quem recebe é avisado como no módulo. " +
      "Os nomes são conferidos antes de criar qualquer uma: nome desconhecido ou ambíguo recusa o pedido inteiro, com as opções. Confirme com a pessoa o que vai criar antes de chamar.",
    entrada: entradaCriar,
    executar: criarDemandas,
    anotacoes: ESCREVE,
  },
  {
    nome: "listar_demandas",
    titulo: "Listar demandas",
    descricao: "As demandas, de todo mundo ou de uma pessoa: situação (a fazer, em andamento, feita), atraso, prazo, prioridade, progresso do checklist, quem criou e o link para abrir no CRM.",
    entrada: entradaListar,
    executar: listarDemandas,
  },
];
