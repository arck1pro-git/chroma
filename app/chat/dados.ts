// Leitura do chat direto do Neon. Só é importado por page.tsx (server component);
// chama isto e passa o resultado como props pro Chat.
//
// Timestamps saem já em ISO "…Z": o front faz new Date(x) e compara como texto,
// e o formato do Postgres ("2026-07-15 09:40:00+00", com espaço) nem sempre
// parseia. to_char em UTC devolve "2026-07-15T09:40:00Z", igual aos seeds.
// O format é constante (não é input), então vai literal no SQL, sem parâmetro.
import { sql } from "@/lib/db";
import type {
  Atendimento,
  Contato,
  Etapa,
  Funil,
  Mensagem,
  Oportunidade,
  Usuario,
} from "../data";

// Só o que o seletor de canal precisa mostrar — não a ficha inteira da
// instância (token nem existe nesta query).
export type InstanciaChat = {
  id: string;
  nome: string;
  numero: string | null;
};

export type DadosChat = {
  atendimentos: Atendimento[];
  mensagens: Mensagem[];
  usuarios: Usuario[];
  contatos: Contato[];
  // Para o atalho "criar oportunidade" e mostrar as do contato no atendimento.
  funis: Funil[];
  etapas: Etapa[];
  oportunidadesPorContato: Map<string, Oportunidade[]>;
  // Seletor de canal: cada instância conectada em Configurações vira uma opção
  // (por numero_instancia, não por id — é o que atendimentos.numero_instancia
  // guarda, ver migration-webhook-instancia.sql).
  instancias: InstanciaChat[];
};

export async function carregarChat(): Promise<DadosChat> {
  const [atendimentos, mensagens, usuarios, contatos, funis, etapas, oportunidades, instancias] =
    await Promise.all([
    // nao_lidas é derivado (não é coluna): mensagens do contato mais novas que
    // o lido_em do atendimento. NULL em lido_em = nunca lido = tudo conta.
    sql`
      SELECT a.id, a.contato_id, a.responsavel_id, a.status, a.canal,
             a.numero_instancia, a.oportunidade_id,
             to_char(a.data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao,
             (SELECT count(*)::int FROM mensagens m
                WHERE m.atendimento_id = a.id AND m.origem = 'contato'
                  AND (a.lido_em IS NULL OR m.data_criacao > a.lido_em)) AS nao_lidas
      FROM atendimentos a`,
    sql`
      SELECT id, atendimento_id, origem, autor_id, texto, status, id_externo,
             tipo, midia_estado, midia_mime, midia_nome, midia_tamanho,
             midia_duracao, midia_erro,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM mensagens
      ORDER BY data_criacao`,
    sql`SELECT id, nome, iniciais FROM usuarios`,
    sql`
      SELECT id, nome, whatsapp, email, cidade, estado, pais,
             to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
      FROM contatos
      ORDER BY nome`,
    sql`SELECT id, nome FROM funis ORDER BY data_criacao`,
    sql`SELECT id, nome, funil_id, ordem, cor FROM etapas ORDER BY funil_id, ordem`,
    sql`
      SELECT id, nome, contato_id, valor::float8 AS valor, responsavel_id, status, funil_id, etapa_id
      FROM oportunidades ORDER BY data_criacao DESC`,
    sql`SELECT id, nome, numero FROM instancias_uazapi ORDER BY nome`,
  ]);

  const oportunidadesPorContato = new Map<string, Oportunidade[]>();
  for (const o of oportunidades as unknown as Oportunidade[]) {
    const atual = oportunidadesPorContato.get(o.contato_id) ?? [];
    atual.push(o);
    oportunidadesPorContato.set(o.contato_id, atual);
  }

  return {
    atendimentos: atendimentos as Atendimento[],
    mensagens: mensagens as Mensagem[],
    usuarios: usuarios as Usuario[],
    contatos: contatos as Contato[],
    funis: funis as Funil[],
    etapas: etapas as Etapa[],
    oportunidadesPorContato,
    instancias: instancias as unknown as InstanciaChat[],
  };
}
