import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { campanhasDeAnuncios, detalhesCampanhaAds, estruturaCampanhaAds, respostaErroMeta } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  try {
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
