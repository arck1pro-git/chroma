import { exigirModuloApi } from "@/lib/auth/dal";
import { contasDeAnuncios, permissoesMeta, respostaErroMeta, telefonesMeta, templatesMeta, wabasMeta } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET() {
  const acesso = await exigirModuloApi("campanhas");
  if (acesso instanceof Response) return acesso;
  try {
    const [permissoes, contasAds] = await Promise.all([permissoesMeta(), contasDeAnuncios()]);
    let wabas = [] as Awaited<ReturnType<typeof wabasMeta>>;
    let telefones: Awaited<ReturnType<typeof telefonesMeta>> = [];
    let templates: Awaited<ReturnType<typeof templatesMeta>> = [];
    let erroWhatsApp: string | null = null;
    try {
      wabas = await wabasMeta();
      telefones = (await Promise.all(wabas.map((w) => telefonesMeta(w.id)))).flat();
      templates = (await Promise.all(wabas.map((w) => templatesMeta(w.id)))).flat();
      if (wabas.length === 0) {
        erroWhatsApp =
          permissoes.includes("whatsapp_business_management") &&
          permissoes.includes("whatsapp_business_messaging")
            ? "As permissões foram concedidas, mas nenhuma conta do WhatsApp Business foi atribuída a este usuário de sistema."
            : "O token não possui as permissões de gerenciamento e envio do WhatsApp Business.";
      } else if (telefones.length === 0) {
        erroWhatsApp = "A conta do WhatsApp Business está acessível, mas não possui número atribuído.";
      }
    } catch (e) {
      erroWhatsApp = e instanceof Error ? e.message : "WhatsApp não disponível.";
    }
    return Response.json({ permissoes, contasAds, wabas, telefones, templates, erroWhatsApp });
  } catch (e) {
    return respostaErroMeta(e);
  }
}
