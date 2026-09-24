import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { sql } from "@/lib/db";
import PainelCampanhasMeta from "./painel-meta";

export const metadata: Metadata = { title: "Campanhas · Chroma" };

export const dynamic = "force-dynamic";

export default async function Page() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("campanhas");
  const [segmentos, tags, funis, etapas] = await Promise.all([sql`
    SELECT s.id, s.nome, count(c.whatsapp)::int AS contatos
      FROM segmentos s
      LEFT JOIN contato_segmentos cs ON cs.segmento_id = s.id
      LEFT JOIN contatos c ON c.id = cs.contato_id AND c.whatsapp IS NOT NULL
     GROUP BY s.id, s.nome ORDER BY s.nome`, sql`SELECT id,nome FROM tags ORDER BY nome`, sql`SELECT id,nome FROM funis ORDER BY nome`, sql`SELECT id,nome,funil_id FROM etapas ORDER BY nome`]) as unknown as [Array<{
       id: string; nome: string; contatos: number;
     }>, Array<{id:string;nome:string}>, Array<{id:string;nome:string}>, Array<{id:string;nome:string;funil_id:string}>];
  return <PainelCampanhasMeta segmentos={segmentos} tags={tags} funis={funis} etapas={etapas} />;
}
