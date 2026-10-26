import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import { tomDaEtapa } from "@/lib/cores-funil";
import { etapasComTom, fichaDoContato, listarContatos } from "@/lib/contatos-ficha";
import { buscarContatosNoBanco, totalDeContatos } from "@/lib/contatos-busca";
import type { CampoPersonalizado, Etapa, Funil } from "@/lib/entidades";
import type { Ia } from "@/lib/ia/catalogo";
import { ehUuid } from "@/lib/validacao";
import PainelContatos from "./painel";

export const metadata: Metadata = {
  title: "Contatos · AmaanOffice",
};

export const dynamic = "force-dynamic";

// O módulo Contatos (2026-10-06): a base inteira à esquerda e, à direita, a
// ficha completa do contato aberto — origem, oportunidades, conversas,
// reuniões, vídeos, automações, campanhas, tags, campos e histórico
// (lib/contatos-ficha.ts).
//
// A seleção mora na URL (?contato=<id>), como em /webhooks e /videos: o
// servidor já traz a ficha do contato aberto, e o link leva direto a ele.
//
// A LISTA É A BUSCA (?q=, 2026-10-15): contato só aparece quando é pesquisado
// por nome, telefone ou e-mail — pedido dele, com os ~27 mil leads do
// SprintHub. Sem termo, a lista fica vazia (e o que estiver aberto continua).
//
// Volta a existir como rota: em 2026-09-01 /contatos tinha saído e os contatos
// ficaram só na gaveta do Dashboard. A gaveta continua — é o atalho de quem
// está no quadro; aqui é a base, com a ficha que a gaveta não cabe.
export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ contato?: string; q?: string }>;
}) {
  const { usuario } = await exigirModulo("contatos");
  const { contato: escolhidoBruto, q } = await searchParams;
  const escolhido = typeof escolhidoBruto === "string" && ehUuid(escolhidoBruto) ? escolhidoBruto : null;
  const termo = typeof q === "string" ? q.slice(0, 120) : "";

  const achados = termo ? await buscarContatosNoBanco(termo) : [];
  const ids = [...new Set([...achados.map((c) => c.id), ...(escolhido ? [escolhido] : [])])];

  const [contatos, totalContatos, tons, tags, segmentos, campos, usuarios, ias, funis, etapas] = await Promise.all([
    listarContatos(ids),
    totalDeContatos(),
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

  // Só abre o que foi pedido na URL: "o mais recente da base" exigiria a base.
  const selecionadoId = contatos.find((c) => c.id === escolhido)?.id ?? null;
  // A ordem da busca (quem começa com o termo, depois o mais parecido) vale
  // mais que a de criação: a lista chega já nessa ordem.
  const posicao = new Map(achados.map((c, i) => [c.id, i]));
  contatos.sort((a, b) => (posicao.get(a.id) ?? -1) - (posicao.get(b.id) ?? -1));

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
      totalContatos={totalContatos}
      buscaInicial={termo}
      etapas={Object.fromEntries(tons)}
      etapasCompletas={etapasCompletas}
      funis={funis as unknown as Funil[]}
      ficha={ficha}
      tags={tags as unknown as { id: string; nome: string }[]}
      segmentos={segmentos as unknown as { id: string; nome: string }[]}
      camposContato={camposPersonalizados.filter((c) => c.entidade === "contato")}
      usuarios={usuarios as unknown as { id: string; nome: string; iniciais: string }[]}
      ias={ias as unknown as Ia[]}
      euId={usuario.id}
    />
  );
}
