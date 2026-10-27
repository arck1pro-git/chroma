// Liga o recebimento do Instagram no app da Meta (2026-10-26).
// É ação externa no app compartilhado com o WhatsApp Cloud e os
// leads, e só roda com o OK dele (CLAUDE.md, seção 6). Nenhuma tela chama isto.
//
// Duas peças, idempotentes (rodar de novo só refaz o que faltar):
//   1. a assinatura do APP no objeto "instagram", campos messages e comments,
//      com o callback FIXO de produção (ENDERECO_DO_CRM, nunca o host do
//      request nem um preview) e o META_WEBHOOK_VERIFY_TOKEN. Antes, lê a
//      assinatura que existe: se ela aponta para OUTRO endereço, recusa (pode
//      ser de outro sistema; mesma trava de ligarRecebimento em
//      lib/meta-leads.ts). Os campos que já existirem são mantidos;
//   2. a assinatura de CADA CONTA do Instagram em subscribed_apps. Conferir
//      só a instalação na página era insuficiente: podia haver apenas leadgen.
//      Os campos da conta são preservados. As páginas são apenas conferidas:
//      não alteramos seus eventos de leads nem assinaturas de outros apps.
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

type AppInscrito = { id?: string; app_id?: string; subscribed_fields?: string[] };

/** Sempre recebe; quem decide responder é a regra ligada, nunca a inscrição. */
export async function inscreverContaInstagram(contaId: string, appId: string, token: string): Promise<boolean> {
  // Não aceitar ids arbitrários, mesmo em scripts operacionais.
  if (!PERFIS.some((p) => p.instagramId === contaId)) throw new ErroMeta("Conta do Instagram inválida.");
  const ler = () => requisicao<{ data: AppInscrito[] }>(`${contaId}/subscribed_apps`, { accessToken: token });
  const antes = await ler();
  const campos = antes.data.find((a) => (a.app_id ?? a.id) === appId)?.subscribed_fields ?? [];
  if (CAMPOS_INSTAGRAM.every((c) => campos.includes(c))) return false;
  await requisicao(`${contaId}/subscribed_apps`, {
    method: "POST", accessToken: token,
    params: { subscribed_fields: [...new Set([...campos, ...CAMPOS_INSTAGRAM])].join(",") },
  });
  const depois = await ler();
  const gravados = depois.data.find((a) => (a.app_id ?? a.id) === appId)?.subscribed_fields ?? [];
  if (!CAMPOS_INSTAGRAM.every((c) => gravados.includes(c))) {
    throw new ErroMeta("A Meta não confirmou a assinatura de mensagens e comentários nesta conta.");
  }
  return true;
}

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
    if (await inscreverContaInstagram(p.instagramId, appId, token)) {
      feito.push(`recebimento automático de mensagens e comentários ativado: ${p.nome}`);
    }
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
