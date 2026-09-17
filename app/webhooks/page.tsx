import type { Metadata } from "next";
import { headers } from "next/headers";
import { enderecoDoCrm } from "@/lib/endereco";
import ListaWebhooks from "./lista";
import PainelWebhook from "./painel";
import IaWebhooks from "./ia";
import { exigirModulo } from "@/lib/auth/dal";
import {
  buscarWebhook,
  carregarAlvos,
  detalheDoWebhook,
  listarWebhooks,
} from "./dados";

export const metadata: Metadata = {
  title: "Webhooks · Chroma",
};

export const dynamic = "force-dynamic";

// A seleção mora na URL (?webhook=<id>), como em /automacoes: o servidor
// carrega o detalhe de UMA e o link fica compartilhável.
//
// O painel vai com `key` no id: "está editando?" e a etapa atual são estado
// local dele, e trocar de webhook sem remontar abriria a próxima na tela em
// que a anterior parou, em vez de nas métricas dela.
//
// O endereço da webhook sai do domínio deste request (lib/endereco.ts): aberto
// pelo domínio de produção, a URL já nasce certa sem nada configurado. No
// localhost ela só serve para testar com curl — e a tela diz isso em amarelo.
export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ webhook?: string; ia?: string }>;
}) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("webhooks");
  const { webhook: selecionadoId, ia: conversaInicial } = await searchParams;
  const [webhooks, cabecalhos] = await Promise.all([listarWebhooks(), headers()]);
  const base = enderecoDoCrm(cabecalhos);

  const selecionado = selecionadoId ? await buscarWebhook(selecionadoId) : null;
  const [detalhe, alvos] = selecionado
    ? await Promise.all([detalheDoWebhook(selecionado.id), carregarAlvos()])
    : [null, null];

  return (
    <div className="flex h-screen overflow-hidden bg-conteudo">
      <ListaWebhooks
        webhooks={webhooks}
        selecionadoId={selecionado?.id ?? null}
      />
      {selecionado && detalhe && alvos ? (
        <PainelWebhook
          key={selecionado.id}
          webhook={selecionado}
          detalhe={detalhe}
          alvos={alvos}
          baseUrl={base.url}
          baseUrlPublica={base.publico}
        />
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center p-8 lg:flex">
          <p className="max-w-xs text-center text-xs text-zinc-400 dark:text-zinc-500">
            Selecione uma webhook à esquerda para ver quanto ela está trazendo,
            quem passou por ela e copiar o endereço de envio.
          </p>
        </div>
      )}

      {/* A IA que MONTA captação: cria a webhook, declara os campos e liga as
          ações (app/api/ia/webhooks). Fica na tela inteira, e não dentro do
          painel, porque o caso principal é criar uma captação que ainda não
          existe — dentro do painel ela só alcançaria a que já está aberta. */}
      <IaWebhooks
        webhookAberta={selecionado?.nome ?? null}
        conversaInicial={conversaInicial ?? null}
      />
    </div>
  );
}
