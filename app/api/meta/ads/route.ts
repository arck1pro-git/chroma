import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { campanhasDeAnuncios, contasDeAnuncios, detalhesCampanhaAds, estruturaCampanhaAds, respostaErroMeta } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  try {
    // As contas de anúncio, e só elas: é o que as pílulas de campanha do
    // Dashboard precisam para começar. Antes vinham do /api/meta/status, que
    // consulta também WhatsApp e templates — 4 s que o Dashboard esperava à toa.
    if (req.nextUrl.searchParams.get("contas") === "1") {
      const contas = await contasDeAnuncios();
      return Response.json({ contasAds: contas.map(({ id, name }) => ({ id, name })) });
    }
    const estrutura = req.nextUrl.searchParams.get("estrutura");
    if (estrutura) return Response.json(await estruturaCampanhaAds(estrutura));
    const campanha = req.nextUrl.searchParams.get("campanha");
    if (campanha) return Response.json(await detalhesCampanhaAds(campanha));
    const conta = req.nextUrl.searchParams.get("conta") ?? "";
    return Response.json({ campanhas: await campanhasDeAnuncios(conta) });
  } catch (e) {
    return respostaErroMeta(e);
  }
}
