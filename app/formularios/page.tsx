import type { Metadata } from "next";
import { headers } from "next/headers";
import { exigirModulo } from "@/lib/auth/dal";
import { enderecoDoCrm } from "@/lib/endereco";
import {
  formularioComPerguntas,
  formulariosDaMeta,
  type FormularioMeta,
  type PerguntaMeta,
} from "@/lib/meta-leads";
import mock from "../mock/formularios-meta.json";
import { carregarAlvos } from "../webhooks/dados";
import { configDoFormulario, resumoDasConfigs } from "./dados";
import TelaFormularios from "./tela";

export const metadata: Metadata = {
  title: "Formulários Meta · Chroma",
};

export const dynamic = "force-dynamic";

const mockFormularios = mock.formularios as Array<FormularioMeta & { perguntas: PerguntaMeta[] }>;

// Formulários Meta: escolher o formulário instantâneo, dizer o que cada
// pergunta vira no lead e para onde ele vai (etapa, segmento). Pedido dele em
// 2026-10-08, "um módulo à parte". O motor é lib/meta-leads.ts.
//
// A seleção mora na URL (?form=<id>), como em /webhooks e /automacoes: o
// servidor lê as perguntas de UM formulário na Meta, e o link fica
// compartilhável. A lista de formulários vem da Meta a cada abertura — é ela
// que sabe dos formulários novos; o CRM só guarda a configuração.
export default async function FormulariosPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string; demo?: string }>;
}) {
  // Checagem POR PÁGINA, e não no layout (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("formularios");
  const { form, demo: pedidoDemo } = await searchParams;
  const formId = form && /^\d+$/.test(form) ? form : null;
  // ?demo=1 — formulários fictícios (app/mock/formularios-meta.json), só em
  // desenvolvimento, para ver a tela enquanto a página não tem formulário.
  const demo = pedidoDemo === "1" && process.env.NODE_ENV !== "production";

  const [lista, resumo, alvos, cabecalhos, selecionado, config] = await Promise.all([
    demo
      ? Promise.resolve({ formularios: mockFormularios as FormularioMeta[], erro: null as string | null })
      : formulariosDaMeta()
          .then((formularios) => ({ formularios, erro: null as string | null }))
          .catch((e) => ({
            formularios: [] as FormularioMeta[],
            erro: e instanceof Error ? e.message : "Não consegui ler os formulários na Meta.",
          })),
    resumoDasConfigs(),
    carregarAlvos(),
    headers(),
    !formId
      ? Promise.resolve(null)
      : demo
        ? Promise.resolve(mockFormularios.find((f) => f.id === formId) ?? null)
        : formularioComPerguntas(formId).catch(() => null),
    formId ? configDoFormulario(formId) : Promise.resolve(null),
  ]);
  const base = enderecoDoCrm(cabecalhos);

  return (
    <TelaFormularios
      demo={demo}
      formularios={lista.formularios}
      erroMeta={lista.erro}
      resumo={resumo}
      selecionado={selecionado}
      config={config}
      alvos={{
        funis: alvos.funis,
        etapas: alvos.etapas,
        segmentos: alvos.segmentos,
        usuarios: alvos.usuarios,
        camposCrm: alvos.camposCrm,
      }}
      baseUrlPublica={base.publico}
    />
  );
}
