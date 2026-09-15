"use client";

// O painel da webhook selecionada. É a tela irmã de app/automacoes/painel-lateral.tsx
// e segue a mesma forma: cabeçalho com nome, ações e (quando editando) as abas;
// corpo rolável com p-4; blocos empilhados com gap-4.
//
// Abrir uma webhook cai na VISÃO GERAL: quem vem aqui vem ver se está entrando
// lead. A configuração fica atrás do botão Editar — mesmo lugar e mesmo peso
// que o Editar das Automações —, porque é o que se mexe uma vez e depois não se
// olha mais.
//
// O que é cabeçalho e o que é configuração:
//
// · Nome e descrição ficam no cabeçalho, editáveis no lugar. São rótulo, não
//   contrato — escondê-los atrás de Editar obrigaria a abrir a configuração
//   para corrigir uma letra.
// · Ligar/desligar e excluir também: agem sobre a webhook inteira.
// · Editar abre só o que é contrato — campos e ações.
//
// O endereço e o prompt ficam no primeiro bloco da visão geral: são o que se
// vem COPIAR, não o que se ajusta.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Power, PowerOff, Trash2, Webhook as WebhookIcon } from "lucide-react";
import type { Alvos, DetalheWebhook } from "./dados";
import Configuracao, {
  AbasDaConfiguracao,
  calcularPendencias,
  PASSOS,
  type ChavePasso,
} from "./configuracao";
import VisaoGeral from "./metricas";
import { alternarAtivo, editarWebhook, excluirWebhook } from "./acoes";
import { botao, botaoFraco, botaoIcone } from "./estilos";
import { NOME_PADRAO, type Webhook } from "@/lib/webhooks";

export default function PainelWebhook({
  webhook,
  detalhe,
  alvos,
  baseUrl,
  baseUrlPublica,
}: {
  webhook: Webhook;
  detalhe: DetalheWebhook;
  alvos: Alvos;
  baseUrl: string;
  baseUrlPublica: boolean;
}) {
  const [editando, setEditando] = useState(false);

  const pendentes = useMemo(() => calcularPendencias(detalhe), [detalhe]);
  const quantasFaltam = PASSOS.filter((p) => pendentes[p.chave]).length;

  // A etapa mora aqui, e não dentro da Configuração, porque as abas ficam no
  // cabeçalho — que é desta casca — e o conteúdo, do corpo.
  const [etapa, setEtapa] = useState<ChavePasso>(
    () => PASSOS.find((p) => pendentes[p.chave])?.chave ?? "campos",
  );

  function abrirEdicao(chave?: ChavePasso) {
    if (chave) setEtapa(chave);
    setEditando(true);
  }

  return (
    <section className="surge flex min-h-0 min-w-0 flex-1 flex-col bg-conteudo">
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <Identificacao
          webhook={webhook}
          editando={editando}
          quantasFaltam={quantasFaltam}
          aoEditar={() => abrirEdicao()}
          aoConcluir={() => setEditando(false)}
        />

        {editando && (
          <AbasDaConfiguracao
            atual={etapa}
            pendentes={pendentes}
            aoIr={setEtapa}
          />
        )}
      </header>

      {editando ? (
        <Configuracao
          webhookId={webhook.id}
          detalhe={detalhe}
          alvos={alvos}
          etapa={etapa}
          aoIr={setEtapa}
          aoConcluir={() => setEditando(false)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <VisaoGeral
            webhook={webhook}
            detalhe={detalhe}
            baseUrl={baseUrl}
            baseUrlPublica={baseUrlPublica}
            aoEditarCampos={() => abrirEdicao("campos")}
          />
        </div>
      )}
    </section>
  );
}

function Identificacao({
  webhook,
  editando,
  quantasFaltam,
  aoEditar,
  aoConcluir,
}: {
  webhook: Webhook;
  editando: boolean;
  quantasFaltam: number;
  aoEditar: () => void;
  aoConcluir: () => void;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(webhook.nome);
  const [descricao, setDescricao] = useState(webhook.descricao ?? "");
  const [salvando, iniciar] = useTransition();

  // Salva ao sair do campo, não a cada tecla: é texto livre, e um autosave por
  // caractere renderia uma escrita por letra digitada.
  function salvar() {
    if (!nome.trim()) return;
    if (
      nome.trim() === webhook.nome &&
      descricao.trim() === (webhook.descricao ?? "")
    ) {
      return;
    }
    iniciar(async () => {
      await editarWebhook(webhook.id, nome, descricao);
    });
  }

  function remover() {
    if (
      !window.confirm(
        `Excluir a webhook "${webhook.nome}"? A URL para de responder na hora e o histórico de recebimentos vai junto. Os contatos e cards já criados por ela FICAM — o lead é seu, não dela.`,
      )
    )
      return;
    iniciar(async () => {
      await excluirWebhook(webhook.id);
      router.push("/webhooks");
    });
  }

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        {/* Input sem moldura no lugar do <h2>: mesma tipografia do título do
            painel de Automações, editável sem abrir nada. */}
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={salvar}
          aria-label="Nome da webhook"
          placeholder="Nome da captação"
          autoFocus={nome === NOME_PADRAO}
          className="w-full truncate border-none bg-transparent p-0 text-sm font-semibold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
        />
        <div className="mt-0.5 flex items-center gap-1">
          <WebhookIcon
            className="size-3 shrink-0 text-zinc-400"
            aria-hidden="true"
          />
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onBlur={salvar}
            placeholder="De onde vem esse lead"
            aria-label="Descrição"
            className="w-full truncate border-none bg-transparent p-0 text-[11px] text-zinc-500 outline-none placeholder:text-zinc-400 dark:text-zinc-400"
          />
        </div>
      </div>

      <span
        className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
          webhook.ativo
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
            : "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
        }`}
      >
        {webhook.ativo ? "Ativa" : "Desligada"}
      </span>

      <button
        type="button"
        onClick={() => iniciar(() => void alternarAtivo(webhook.id, !webhook.ativo))}
        disabled={salvando}
        title={
          webhook.ativo
            ? "Desligar: a URL passa a responder 404"
            : "Ligar: a URL volta a aceitar lead"
        }
        aria-label={webhook.ativo ? "Desligar webhook" : "Ligar webhook"}
        className={botaoIcone}
      >
        {webhook.ativo ? (
          <PowerOff className="size-4" aria-hidden="true" />
        ) : (
          <Power className="size-4" aria-hidden="true" />
        )}
      </button>

      {editando ? (
        <button type="button" onClick={aoConcluir} className={botaoFraco}>
          <Check className="size-3.5" aria-hidden="true" />
          Concluir
        </button>
      ) : (
        <button type="button" onClick={aoEditar} className={botao}>
          <Pencil className="size-3.5" aria-hidden="true" />
          Editar
          {/* O contador é o que faz o botão valer mais que um rótulo: de fora da
              configuração dá para ver que falta coisa lá dentro. Âmbar sólido
              em vez do âmbar claro dos avisos: aqui o fundo é escuro no tema
              claro e claro no escuro, e só um chip opaco lê nos dois. */}
          {quantasFaltam > 0 && (
            <span
              aria-label={`${quantasFaltam} pendência${quantasFaltam === 1 ? "" : "s"}`}
              className="flex min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-semibold tabular-nums text-zinc-900"
            >
              {quantasFaltam}
            </span>
          )}
        </button>
      )}

      {/* Só o ícone, e cinza: é a ação irreversível do cabeçalho e não deve ter
          o mesmo peso visual de Editar, que é a de todo dia. */}
      <button
        type="button"
        onClick={remover}
        disabled={salvando}
        aria-label={`Excluir ${webhook.nome}`}
        title="Excluir webhook"
        className={`${botaoIcone} hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400`}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
