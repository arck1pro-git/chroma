import type { Metadata } from "next";
import { listarDocumentos } from "@/lib/documentos";
import { exigirModulo } from "@/lib/auth/dal";
import PainelDocumentos from "./painel";

export const metadata: Metadata = {
  title: "Documentos · Chroma",
};

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("documentos");

  // Arquivados vêm juntos: a tela tem o filtro, e uma segunda ida ao banco só
  // para mostrá-los custaria mais que trazer as linhas (que são poucas — é
  // acervo, não histórico).
  let documentos;
  try {
    documentos = await listarDocumentos(true);
  } catch (e) {
    // 42P01 = undefined_table: migration-documentos.sql ainda não rodou. A tela
    // sabe desenhar isso; derrubar a página inteira esconderia justamente a
    // instrução de como resolver.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01") {
      return <PainelDocumentos documentos={[]} faltaMigration />;
    }
    throw e;
  }

  return <PainelDocumentos documentos={documentos} faltaMigration={false} />;
}
