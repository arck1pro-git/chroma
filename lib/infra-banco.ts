// Módulo Infra: o banco de dados (Neon) e o armazenamento de arquivos (Supabase
// Storage). Tudo lido daqui, sem chave de gestão:
//   · o limite de tamanho do banco vem do próprio Neon (neon.max_cluster_size,
//     o teto do plano); fora do Neon, o tamanho aparece sem barra;
//   · o Storage não tem leitura de uso sem o token de gestão do Supabase. O total
//     do CRM sai das próprias tabelas (o tamanho de cada documento, mídia e vídeo
//     que o CRM guardou), e o estado do serviço, de uma chamada leve que mostra a
//     suspensão por cota (402).
import "server-only";
import { sql } from "@/lib/db";
import { situacaoDoStorage } from "@/lib/armazenamento";
import { tamanhoArquivo } from "@/lib/formato";
import { estadoPorUso, piorEstado, type CartaoInfra, type MedidaInfra } from "@/lib/infra-tipos";

const UNIDADES: Record<string, number> = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

/** "5GB", "512MB" (neon.max_cluster_size) em bytes; null fora do Neon ou sem teto. */
function bytesDoNeon(valor: string | null): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(kB|MB|GB|TB)$/i.exec(valor?.trim() ?? "");
  return m ? Number(m[1]) * UNIDADES[m[2].toLowerCase()] : null;
}

const pct = (uso: number) => `${Math.round(uso * 100)}%`;

export async function cartaoBanco(): Promise<CartaoInfra> {
  const [l] = await sql`
    SELECT pg_database_size(current_database())::bigint AS bytes,
           current_setting('neon.max_cluster_size', true) AS limite,
           current_setting('max_connections')::int AS max_conexoes,
           (SELECT count(*)::int FROM pg_stat_activity) AS conexoes`;
  const tabelas = await sql`
    SELECT c.relname AS nome, pg_total_relation_size(c.oid)::bigint AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY 2 DESC
     LIMIT 3`;

  const bytes = Number(l.bytes);
  const limite = bytesDoNeon(l.limite as string | null);
  const usoTamanho = limite ? bytes / limite : undefined;
  const usoConexoes = Number(l.conexoes) / Number(l.max_conexoes);
  const medidas: MedidaInfra[] = [
    {
      rotulo: "Tamanho do banco",
      valor: tamanhoArquivo(bytes),
      limite: limite ? `de ${tamanhoArquivo(limite)} do plano` : "sem teto lido",
      uso: usoTamanho,
      estado: usoTamanho === undefined ? undefined : estadoPorUso(usoTamanho),
    },
    {
      rotulo: "Conexões abertas",
      valor: String(l.conexoes),
      limite: `de ${l.max_conexoes}`,
      uso: usoConexoes,
      estado: estadoPorUso(usoConexoes),
    },
    ...tabelas.map((t) => ({ rotulo: `Maior tabela: ${t.nome}`, valor: tamanhoArquivo(Number(t.bytes)) })),
  ];
  const avisos: string[] = [];
  if (usoTamanho !== undefined && usoTamanho >= 0.75) {
    avisos.push(`O banco está em ${pct(usoTamanho)} do teto do plano do Neon: sem espaço, gravar falha.`);
  }
  if (usoConexoes >= 0.75) avisos.push(`As conexões estão em ${pct(usoConexoes)} do máximo.`);
  return {
    chave: "banco",
    titulo: "Banco de dados",
    subtitulo: "Neon · Postgres",
    estado: piorEstado(...medidas.map((m) => m.estado)),
    medidas,
    avisos,
    lidoEm: new Date().toISOString(),
  };
}

/** O motivo da suspensão em português, com o que fazer. */
function motivoDaSuspensao(mensagem: string | null): string {
  const m = (mensagem ?? "").toLowerCase();
  if (m.includes("egress")) return "o projeto passou da cota de tráfego de saída (egress) do plano";
  if (m.includes("storage") || m.includes("size")) return "o projeto passou do espaço do plano";
  return mensagem ? `"${mensagem}"` : "motivo não informado";
}

export async function cartaoArmazenamento(): Promise<CartaoInfra> {
  const [s] = await sql`
    SELECT (SELECT coalesce(sum(tamanho), 0) FROM documentos)::bigint AS documentos,
           (SELECT coalesce(sum(midia_tamanho), 0) FROM mensagens WHERE midia_caminho IS NOT NULL)::bigint AS midias,
           (SELECT coalesce(sum(tamanho), 0) FROM videos)::bigint AS videos`;
  const situacao = await situacaoDoStorage().catch(() => null);
  const total = Number(s.documentos) + Number(s.midias) + Number(s.videos);

  const avisos: string[] = [];
  let servico: MedidaInfra;
  if (!situacao) {
    servico = { rotulo: "Serviço", valor: "Sem resposta", estado: "desconhecido" };
    avisos.push("O Supabase não respondeu agora.");
  } else if (situacao.status === 402) {
    servico = { rotulo: "Serviço", valor: "Suspenso", estado: "critico" };
    avisos.push(
      `O Supabase suspendeu o Storage: ${motivoDaSuspensao(situacao.mensagem)}. Documentos, anexos, mídias do chat e vídeos não sobem nem abrem até subir o plano ou tirar o teto de gasto no painel do Supabase.`,
    );
  } else if (situacao.status >= 400) {
    servico = { rotulo: "Serviço", valor: `Erro ${situacao.status}`, estado: "atencao" };
    avisos.push(`O Storage respondeu ${situacao.status}${situacao.mensagem ? `: ${situacao.mensagem}` : ""}.`);
  } else {
    servico = { rotulo: "Serviço", valor: "No ar", estado: "ok" };
  }

  return {
    chave: "armazenamento",
    titulo: "Arquivos",
    subtitulo: "Supabase Storage · documentos, mídias e vídeos",
    estado: piorEstado(servico.estado),
    medidas: [
      servico,
      { rotulo: "Guardado pelo CRM", valor: tamanhoArquivo(total), limite: "o projeto é dividido com outros usos da empresa" },
      { rotulo: "Documentos", valor: tamanhoArquivo(Number(s.documentos)) },
      { rotulo: "Mídias do chat", valor: tamanhoArquivo(Number(s.midias)) },
      { rotulo: "Vídeos", valor: tamanhoArquivo(Number(s.videos)) },
    ],
    avisos,
    lidoEm: new Date().toISOString(),
  };
}
