import { NextRequest } from "next/server";
import { exigirModuloApi } from "@/lib/auth/dal";
import { criarTemplateMeta, respostaErroMeta, templatesMeta } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const acesso = await exigirModuloApi("templates");
  if (acesso instanceof Response) return acesso;
  try {
    return Response.json({ templates: await templatesMeta(req.nextUrl.searchParams.get("waba") ?? "") });
  } catch (e) { return respostaErroMeta(e); }
}

export async function POST(req: NextRequest) {
  const acesso = await exigirModuloApi("templates");
  if (acesso instanceof Response) return acesso;
  try {
    const b = await req.json() as Record<string, unknown>;
    const nome = typeof b.nome === "string" ? b.nome.trim().toLowerCase() : "";
    const corpo = typeof b.corpo === "string" ? b.corpo.trim() : "";
    const categoria = b.categoria === "UTILITY" ? "UTILITY" : "MARKETING";
    const idioma = typeof b.idioma === "string" ? b.idioma : "pt_BR";
    const waba = typeof b.waba === "string" ? b.waba : "";
    if (!/^[a-z0-9_]{1,512}$/.test(nome)) return Response.json({ erro: "Use apenas letras minúsculas, números e _ no nome." }, { status: 400 });
    if (!corpo || corpo.length > 1024) return Response.json({ erro: "O corpo deve ter entre 1 e 1.024 caracteres." }, { status: 400 });
    const components: Array<Record<string, unknown>> = [{ type: "BODY", text: corpo }];
    if (typeof b.rodape === "string" && b.rodape.trim()) components.push({ type: "FOOTER", text: b.rodape.trim().slice(0, 60) });
    const resultado = await criarTemplateMeta(waba, { name: nome, language: idioma, category: categoria, components });
    return Response.json({ ok: true, resultado }, { status: 201 });
  } catch (e) { return respostaErroMeta(e); }
}
