import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { respostaErroMeta, ErroMeta } from "@/lib/meta";
import { carregarRelatorioAds, carregarSerieCampanha, consultaAds, serieAds } from "@/lib/meta-ads-relatorio";
import { acaoAds, executarAcaoAds, recursosAds } from "@/lib/meta-ads-gestao";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  try {
    if (req.nextUrl.searchParams.get("recursos") === "1") {
      const conta = req.nextUrl.searchParams.get("conta") ?? "";
      if (!/^act_\d+$/.test(conta)) throw new ErroMeta("Conta inválida.", undefined, 400);
      return Response.json(await recursosAds(conta));
    }
    const escopo = acesso.usuario.modulos.get("inicio");
    const crm = { permitido: Boolean(escopo), dono: escopo === "proprio" ? acesso.usuario.id : null };
    // A gaveta de uma campanha pede só a série dela: o relatório inteiro já
    // está na tela e recarregá-lo a cada clique custaria oito chamadas à Meta.
    if (req.nextUrl.searchParams.get("serie") === "1") {
      const s = serieAds.safeParse(Object.fromEntries(req.nextUrl.searchParams));
      if (!s.success) return Response.json({ erro: s.error.issues[0].message }, { status: 400 });
      return Response.json(await carregarSerieCampanha(s.data, crm));
    }
    const q = consultaAds.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!q.success) return Response.json({ erro: q.error.issues[0].message }, { status: 400 });
    return Response.json(await carregarRelatorioAds(q.data, crm));
  } catch (e) { return respostaErroMeta(e); }
}
export async function POST(req: NextRequest) {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  // Solicitações do navegador precisam vir da mesma origem.
  const origem = req.headers.get("origin");
  if (origem && origem !== req.nextUrl.origin) return Response.json({ erro: "Origem não autorizada." }, { status: 403 });
  try {
    const entrada = acaoAds.safeParse(await req.json());
    if (!entrada.success) return Response.json({ erro: entrada.error.issues[0].message }, { status: 400 });
    return Response.json(await executarAcaoAds(entrada.data));
  } catch (e) { return respostaErroMeta(e); }
}
