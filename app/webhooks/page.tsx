import type { Metadata } from "next";
import { headers } from "next/headers";
import { enderecoDoCrm } from "@/lib/endereco";
import ListaWebhooks from "./lista";
import PainelWebhook from "./painel";
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
  searchParams: Promise<{ webhook?: string }>;
}) {
  const { webhook: selecionadoId } = await searchParams;
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
    </div>
  );
}
