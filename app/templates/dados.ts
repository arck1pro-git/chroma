import "server-only";
import { ErroMeta, permissoesMeta, templatesMeta, wabasMeta } from "@/lib/meta";
import { lerTemplate, type TemplateWhatsApp } from "@/lib/templates-whatsapp";

// A leitura da tela de Templates, no servidor. Até 2026-10-27 a tela pedia ao
// navegador o /api/meta/status, que é do módulo Campanhas (quem só tinha
// Templates levava 403) e buscava contas de anúncio, permissões, números e os
// templates de TODAS as contas só para usar o id da primeira. Aqui são duas
// leituras: as contas (guardadas em lib/meta.ts) e os templates da conta
// escolhida, sempre frescos, porque a situação da análise é o que se vem ver.

export type ContaWhatsApp = { id: string; nome: string };

export type DadosTemplates = {
  contas: ContaWhatsApp[];
  /** A conta mostrada; null quando nenhuma está acessível. */
  contaId: string | null;
  templates: TemplateWhatsApp[];
  /** O que impediu a leitura, já na frase que a tela mostra. */
  erro: string | null;
};

export async function carregarTemplates(pedida: string | undefined): Promise<DadosTemplates> {
  let contas: ContaWhatsApp[];
  try {
    contas = (await wabasMeta()).map((w) => ({ id: w.id, nome: w.name }));
  } catch (e) {
    return { contas: [], contaId: null, templates: [], erro: motivo(e) };
  }
  if (contas.length === 0) {
    return { contas, contaId: null, templates: [], erro: await semConta() };
  }

  // A conta vem da URL, mas só vale uma das que o token enxerga.
  const conta = contas.find((c) => c.id === pedida) ?? contas[0];
  try {
    const templates = (await templatesMeta(conta.id)).map(lerTemplate);
    return { contas, contaId: conta.id, templates, erro: null };
  } catch (e) {
    return { contas, contaId: conta.id, templates: [], erro: motivo(e) };
  }
}

// Sem conta à vista, a causa decide o conserto: falta permissão no token ou
// falta atribuir a conta ao usuário de sistema no Business Manager.
async function semConta(): Promise<string> {
  const permissoes = await permissoesMeta().catch(() => [] as string[]);
  return permissoes.includes("whatsapp_business_management")
    ? "Nenhuma conta do WhatsApp Business está atribuída ao usuário de sistema da Meta. No Business Manager, em Usuários do sistema, atribua a conta e o número a ele."
    : "O token da Meta não tem a permissão whatsapp_business_management, que lista e cria templates.";
}

function motivo(e: unknown): string {
  if (e instanceof ErroMeta) return e.message;
  console.error("[templates] falha ao consultar a Meta:", e);
  return "A Meta não respondeu agora. Tente atualizar em instantes.";
}
