import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { exigirModuloApi } from "@/lib/auth/dal";
import { criarZip } from "@/lib/zip";

// O .zip da extensão de reuniões (pasta extensao-reunioes/), para instalar pelo
// CRM (pedido dele em 2026-10-30): o menu da conta, na barra lateral, baixa
// este arquivo e mostra como carregar no Chrome
// (app/components/modal-extensao-reunioes.tsx). O Chrome não instala extensão a
// partir de um site; com ela publicada na Chrome Web Store, o botão passa a
// abrir a loja e esta rota vira o plano B.
//
// Só os arquivos da extensão entram no pacote (ARQUIVO_DA_EXTENSAO): a pasta
// pode ter outras coisas no computador de quem desenvolve (uma planilha de
// leads já esteve lá), e nada disso sai por aqui. O deploy leva os mesmos
// arquivos (outputFileTracingIncludes, em next.config.ts).
//
// Exige o módulo Agenda, que é o que libera o assistente de reuniões
// (lib/reunioes-extensao.ts): quem não pode usar a extensão não a baixa.

export const dynamic = "force-dynamic";

const PASTA = "extensao-reunioes";
const ARQUIVO_DA_EXTENSAO = /^(?:[a-z0-9-]+\.(?:js|html|css)|manifest\.json|LEIAME\.md)$/;
// A pasta dentro do .zip: é ela que se escolhe em "Carregar sem compactação".
const PASTA_NO_ZIP = "amaanoffice-reunioes";

export async function GET() {
  const acesso = await exigirModuloApi("agenda");
  if (acesso instanceof Response) return acesso;

  const raiz = path.join(process.cwd(), PASTA);
  const nomes = (await readdir(raiz).catch(() => [] as string[])).filter((n) => ARQUIVO_DA_EXTENSAO.test(n)).sort();
  if (!nomes.includes("manifest.json")) {
    return Response.json({ erro: "A extensão não está disponível neste servidor." }, { status: 404 });
  }
  const arquivos = await Promise.all(
    nomes.map(async (n) => ({ nome: `${PASTA_NO_ZIP}/${n}`, bytes: new Uint8Array(await readFile(path.join(raiz, n))) })),
  );
  const manifesto = JSON.parse(new TextDecoder().decode(arquivos.find((a) => a.nome.endsWith("/manifest.json"))!.bytes));
  const versao = /^[0-9.]+$/.test(String(manifesto.version ?? "")) ? `-${manifesto.version}` : "";

  return new Response(criarZip(arquivos), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${PASTA_NO_ZIP}${versao}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
