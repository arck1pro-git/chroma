import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { tomDaEtapa } from "@/lib/cores-funil";
import { etapasComTom, fichaDoContato, listarContatos } from "@/lib/contatos-ficha";
import type { CampoPersonalizado, Etapa, Funil } from "../data";
import type { Ia } from "@/lib/ia/catalogo";
import PainelContatos from "./painel";

export const metadata: Metadata = {
  title: "Contatos · Chroma",
};

export const dynamic = "force-dynamic";

// O módulo Contatos (2026-10-06): a base inteira à esquerda e, à direita, a
// ficha completa do contato aberto — origem, oportunidades, conversas,
// reuniões, vídeos, automações, campanhas, tags, campos e histórico
// (lib/contatos-ficha.ts).
//
// A seleção mora na URL (?contato=<id>), como em /webhooks e /videos: o
// servidor já traz a ficha do contato aberto, e o link leva direto a ele. Sem
// seleção, abre o contato com atividade mais recente.
//
// Volta a existir como rota: em 2026-09-01 /contatos tinha saído e os contatos
// ficaram só na gaveta do Dashboard. A gaveta continua — é o atalho de quem
// está no quadro; aqui é a base inteira, com a ficha que a gaveta não cabe.
export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ contato?: string }>;
}) {
  await exigirModulo("contatos");
  const { contato: escolhido } = await searchParams;

  const [contatos, tons, tags, segmentos, campos, usuarios, ias, funis, etapas] = await Promise.all([
    listarContatos(),
    etapasComTom(),
    sql`SELECT id, nome FROM tags ORDER BY nome`,
    sql`SELECT id, nome FROM segmentos ORDER BY nome`,
    sql`SELECT id, entidade, chave, rotulo, tipo, opcoes, ordem
          FROM campos_personalizados ORDER BY entidade, ordem, rotulo`,
    sql`SELECT id, nome, iniciais FROM usuarios ORDER BY nome`,
    sql`SELECT id, nome, prompt, to_jsonb(acoes) AS acoes, palavra_chave,
               to_jsonb(retomar_apos) AS retomar_apos, retomar_das, retomar_ate,
               to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
          FROM ias ORDER BY data_criacao`,
    sql`SELECT id, nome, descricao, cor,
               to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
          FROM funis ORDER BY data_criacao`,
    sql`SELECT id, nome, funil_id, ordem, ia_id,
               to_char(data_criacao AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data_criacao
          FROM etapas ORDER BY funil_id, ordem`,
  ]);

  const selecionadoId =
    contatos.find((c) => c.id === escolhido)?.id ??
    [...contatos].sort((a, b) => (a.ultimaAtividade < b.ultimaAtividade ? 1 : -1))[0]?.id ??
    null;

  const camposPersonalizados = campos as unknown as CampoPersonalizado[];
  const chavesPersonalizadas = new Set(camposPersonalizados.map((c) => c.chave));
  const ficha = selecionadoId ? await fichaDoContato(selecionadoId, chavesPersonalizadas) : null;

  // As etapas no formato do tipo Etapa, com a cor da posição e o tom do funil
  // (é o que a IA do contato usa para saber qual IA a etapa liga).
  const corPorFunil = new Map(funis.map((f) => [f.id as string, f.cor as string]));
  const etapasCompletas: Etapa[] = etapas.map((e) => {
    const doFunil = etapas.filter((x) => x.funil_id === e.funil_id);
    return {
      id: e.id as string,
      nome: e.nome as string,
      funil_id: e.funil_id as string,
      data_criacao: e.data_criacao as string,
      ordem: Number(e.ordem),
      cor: tomDaEtapa(corPorFunil.get(e.funil_id as string) ?? "", doFunil.indexOf(e), doFunil.length),
      ia_id: (e.ia_id as string | null) ?? null,
      tom_funil: corPorFunil.get(e.funil_id as string) ?? "",
    };
  });

  return (
    <PainelContatos
      contatos={contatos}
      etapas={Object.fromEntries(tons)}
      etapasCompletas={etapasCompletas}
      funis={funis as unknown as Funil[]}
      ficha={ficha}
      tags={tags as unknown as { id: string; nome: string }[]}
      segmentos={segmentos as unknown as { id: string; nome: string }[]}
      camposContato={camposPersonalizados.filter((c) => c.entidade === "contato")}
      usuarios={usuarios as unknown as { id: string; nome: string; iniciais: string }[]}
      ias={ias as unknown as Ia[]}
    />
  );
}
