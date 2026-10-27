// Liga o recebimento do Instagram no app da Meta (2026-10-26). PRONTA E NÃO
// EXECUTADA: é ação externa no app compartilhado com o WhatsApp Cloud e os
// leads, e só roda com o OK dele (CLAUDE.md, seção 6). Nenhuma tela chama isto.
//
// Duas peças, idempotentes (rodar de novo só refaz o que faltar):
//   1. a assinatura do APP no objeto "instagram", campos messages e comments,
//      com o callback FIXO de produção (ENDERECO_DO_CRM, nunca o host do
//      request nem um preview) e o META_WEBHOOK_VERIFY_TOKEN. Antes, lê a
//      assinatura que existe: se ela aponta para OUTRO endereço, recusa (pode
//      ser de outro sistema; mesma trava de ligarRecebimento em
//      lib/meta-leads.ts). Os campos que já existirem são mantidos;
//   2. a CONFERÊNCIA de que o app está instalado em cada uma das três PÁGINAS
//      (subscribed_apps): sem isso a Meta não entrega evento do Instagram
//      ligado à página. Só lê: página sem o app entra no relatório como
//      "instalar à mão" (revisão de segurança, 2026-10-26). Instalar mexeria nos
//      eventos de página que o app já recebe (leads), e isso é decisão dele.
// Nada é mexido no objeto "page" nem no "whatsapp_business_account" do app.
//
// Fora da Meta, o que falta para o direct funcionar: na conta do Instagram,
// "Permitir acesso a mensagens" (Configurações → Mensagens → Ferramentas
// conectadas), e o app com as permissões instagram_manage_messages e
// instagram_manage_comments aprovadas.
import "server-only";
import { ErroMeta, requisicao } from "@/lib/meta";
import { appDoToken, tokenDoApp } from "@/lib/meta-leads";
import { ENDERECO_DO_CRM } from "@/lib/link-do-crm";
import { PERFIS } from "@/lib/social/perfis";
import { tokenDaPaginaDoPerfil } from "@/lib/social/meta-publicar";

const CAMPOS_INSTAGRAM = ["messages", "comments"];

type AssinaturaApp = { object: string; callback_url: string; active: boolean; fields: Array<{ name: string }> };

export const CALLBACK_INSTAGRAM = `${ENDERECO_DO_CRM}/api/meta/instagram/webhook`;

/**
 * Devolve o que foi feito e o que falta fazer à mão, em frases curtas. Lança
 * ErroMeta quando não pode seguir.
 */
export async function inscreverInstagramNoApp(): Promise<string[]> {
  const feito: string[] = [];
  const appId = await appDoToken();
  if (!appId) throw new ErroMeta("Não achei o app da Meta do token do CRM.");
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!verifyToken) throw new ErroMeta("META_WEBHOOK_VERIFY_TOKEN não configurado.", undefined, 503);

  const assinaturas = await requisicao<{ data: AssinaturaApp[] }>(`${appId}/subscriptions`, { accessToken: tokenDoApp(appId) });
  const atual = assinaturas.data.find((s) => s.object === "instagram") ?? null;
  if (atual && atual.callback_url !== CALLBACK_INSTAGRAM) {
    throw new ErroMeta(
      `O app já recebe eventos do Instagram em outro endereço (${atual.callback_url}). Não troquei para não derrubar quem usa esse.`,
      undefined,
      409,
    );
  }
  const existentes = (atual?.fields ?? []).map((f) => f.name);
  if (!atual?.active || CAMPOS_INSTAGRAM.some((c) => !existentes.includes(c))) {
    await requisicao(`${appId}/subscriptions`, {
      method: "POST",
      accessToken: tokenDoApp(appId),
      params: {
        object: "instagram",
        callback_url: CALLBACK_INSTAGRAM,
        fields: [...new Set([...existentes, ...CAMPOS_INSTAGRAM])].join(","),
        verify_token: verifyToken,
        include_values: "true",
      },
    });
    feito.push("Instagram (messages, comments) assinado no app da Meta");
  }

  for (const p of PERFIS) {
    const token = await tokenDaPaginaDoPerfil(p.paginaId);
    const apps = await requisicao<{ data: Array<{ id: string; subscribed_fields?: string[] }> }>(
      `${p.paginaId}/subscribed_apps`,
      { accessToken: token },
    );
    if (apps.data.some((a) => a.id === appId)) continue;
    // Só relata: nada de POST em subscribed_apps.
    feito.push(`instalar à mão: o app não está na página de ${p.nome} (${p.paginaId})`);
  }
  return feito;
}
