"use client";

// Montar uma campanha nova (POST, que já ativa depois da confirmação) ou
// editar uma pausada ou em rascunho (PUT, sem mexer no público). A barra de
// cima tem o nome e os botões; o público mora no nó de início do canvas, onde
// o fluxo começa.
//
// MONTAR COM IA (2026-10-28): o chat (../ia-campanhas.tsx) manda o fluxo
// aberto e a IA devolve o fluxo inteiro num evento. O editor só aplica o
// desenho da MESMA campanha (campanhaId), organiza, guarda o que havia para o
// Desfazer e solta o que o servidor tinha apontado; nada é gravado até Ativar
// ou Salvar, que conferem tudo de novo. A faixa "A IA desenhou o fluxo" some
// na primeira mudança feita à mão. Em campanha que já rodou, bloco que mudou
// de tipo vira pendência (blocosQueMudaramDeTipo): a IA reescreve o fluxo
// inteiro e poderia reaproveitar um id. Aberto, o chat é uma coluna no lugar
// da paleta, ao lado do canvas e fora dele: o canvas remonta a cada desenho, a
// conversa não. Desenho que chega e não é aplicado (incompleto, de outra
// campanha, durante o envio) deixa um aviso curto na mesma faixa.
//
// Revisão de 2026-10-28: o editor conta a quem lista se há mudança não salva
// (fluxo, nome ou segmentos diferentes de como abriu), para a saída pedir
// confirmação; e Salvar que tira gente de blocos apagados (os números da
// campanha que já rodou) pergunta antes, dizendo quantos e de onde.
import { useCallback, useEffect, useMemo, useState } from "react";
import { blocosQueMudaramDeTipo, EVENTO_DESENHO, type FluxoCampanha as Fluxo, type ProblemaDoFluxo } from "@/lib/campanhas-fluxo";
import type { TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { LoaderCircle, RotateCcw, Save, Send, Sparkles, TriangleAlert, X } from "@/app/components/icones";
import FluxoCampanha, { type AtualizarFluxo } from "../fluxo-campanha";
import IaCampanhas from "../ia-campanhas";
import { botaoAds, botaoPrincipalAds, campoAds, Confirmacao } from "../pecas";
import { Ajuda, Grupo } from "./campos";
import ConfirmarAtivacao from "./confirmar-ativacao";
import {
  fluxoInicial,
  lerDesenhoDaIa,
  organizarFluxo,
  problemasDaTela,
  quantosContatos,
  rotuloDoBloco,
  sincronizarBotoes,
  type MetricasFluxo,
  type OpcoesFluxo,
} from "./grafo";
import { pedirCampanha } from "./pedido";

/** A conta e o número que enviam (os primeiros que a Meta devolve, como antes). */
export type ContaWhatsApp = { waba: string; telefoneId: string; telefone: string };

const numero = (n: number) => n.toLocaleString("pt-BR");

// Uma referência só para "nada apontado": arrastar chama mudar() a cada quadro,
// e um [] novo a cada vez refaria as pendências e redesenharia todos os cartões.
const NADA_DO_SERVIDOR: ProblemaDoFluxo[] = [];

export default function EditorCampanha({
  conta,
  templates,
  opcoes,
  existente,
  iaAberta,
  mudarIa,
  aoMudarSujo,
  aoConcluir,
  aoCancelar,
}: {
  conta: ContaWhatsApp;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  /** Campanha pausada ou rascunho: salva por PUT; o público fica como está. */
  existente?: { id: string; nome: string; publico: string; fluxo: Fluxo; metricas?: MetricasFluxo | null };
  /** O chat "Montar com IA": quem lista guarda, para o botão de lá abrir a campanha nova já com ele. */
  iaAberta: boolean;
  mudarIa: (aberta: boolean) => void;
  /** Se há mudança não salva (fluxo, nome ou segmentos): quem lista pergunta antes de sair. */
  aoMudarSujo: (sujo: boolean) => void;
  aoConcluir: (id: string, mensagem: string) => void;
  aoCancelar: () => void;
}) {
  // Como abriu: é contra isto que "há mudança não salva" se mede.
  const [inicial] = useState(() => {
    const f = existente?.fluxo ?? fluxoInicial(templates);
    return { fluxo: f, json: JSON.stringify(f), nome: existente?.nome ?? "" };
  });
  const [nome, setNome] = useState(inicial.nome);
  const [segmentoIds, setSegmentoIds] = useState<string[]>([]);
  const [fluxo, setFluxo] = useState<Fluxo>(inicial.fluxo);
  const [doServidor, setDoServidor] = useState(NADA_DO_SERVIDOR);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  // O que havia antes do último desenho da IA; null = nada a desfazer (e sem faixa).
  const [antesDaIa, setAntesDaIa] = useState<{ fluxo: Fluxo; nome: string; segmentoIds: string[] } | null>(null);
  // Muda a cada desenho aplicado ou desfeito: o canvas remonta e ajusta a vista
  // ao desenho novo. Com `desenhoDaIa`, ele ainda reorganiza pela altura medida.
  const [vista, setVista] = useState(0);
  const [desenhoDaIa, setDesenhoDaIa] = useState(false);
  // Desenho que chegou e não foi aplicado: a pessoa precisa saber que pediu e nada mudou.
  const [descartado, setDescartado] = useState<string | null>(null);
  // A frase da confirmação de salvar quando o fluxo novo tira gente de blocos apagados.
  const [tiraContatos, setTiraContatos] = useState<string | null>(null);

  const fluxoMudou = useMemo(() => JSON.stringify(fluxo) !== inicial.json, [fluxo, inicial.json]);
  const sujo = fluxoMudou || nome !== inicial.nome || segmentoIds.length > 0;
  useEffect(() => aoMudarSujo(sujo), [sujo, aoMudarSujo]);
  useEffect(() => () => aoMudarSujo(false), [aoMudarSujo]);

  // Mexeu no fluxo, o que o servidor apontou na última tentativa deixa de
  // valer, e o desenho da IA deixa de ser desfazível.
  const mudar = useCallback<AtualizarFluxo>((atualizar) => {
    setFluxo(atualizar);
    setDoServidor(NADA_DO_SERVIDOR);
    setErro("");
    setAntesDaIa(null);
    setDescartado(null);
  }, []);

  function receberDaIa(t: string, v: unknown) {
    if (t !== EVENTO_DESENHO) return;
    const desenho = lerDesenhoDaIa(v);
    // Só no editor da campanha a que o desenho responde: resposta atrasada não
    // cai em outra. Com o salvar ou o ativar a caminho, o que foi é o de antes.
    // Descartado, a faixa diz por quê.
    if (!desenho) return setDescartado("A IA mandou um desenho incompleto; nada mudou. Peça de novo.");
    if (desenho.campanhaId !== (existente?.id ?? null)) return setDescartado("O desenho da IA era de outra campanha; nada mudou.");
    if (enviando) return setDescartado("O desenho da IA chegou durante o envio; nada mudou.");
    setDescartado(null);
    setAntesDaIa({ fluxo, nome, segmentoIds });
    setFluxo(sincronizarBotoes(organizarFluxo(desenho.fluxo), templates));
    // A revisão aberta era do fluxo de antes: ativar pede uma revisão nova.
    setConfirmando(false);
    setTiraContatos(null);
    setDoServidor(NADA_DO_SERVIDOR);
    setErro("");
    if (desenho.nome) setNome(desenho.nome.slice(0, 160));
    // O público só muda em campanha nova, e só com segmento que existe.
    if (!existente && desenho.segmentoIds) setSegmentoIds(desenho.segmentoIds.filter((id) => opcoes.segmentos.some((s) => s.id === id)));
    setDesenhoDaIa(true);
    setVista((n) => n + 1);
  }

  function desfazer() {
    if (!antesDaIa) return;
    setFluxo(antesDaIa.fluxo);
    setNome(antesDaIa.nome);
    setSegmentoIds(antesDaIa.segmentoIds);
    setAntesDaIa(null);
    setDoServidor(NADA_DO_SERVIDOR);
    setErro("");
    setDesenhoDaIa(false);
    setVista((n) => n + 1);
  }

  const escolhidos = opcoes.segmentos.filter((s) => segmentoIds.includes(s.id));
  // "Até": quem está em dois segmentos entra uma vez só, e o servidor ainda tira quem não tem WhatsApp.
  const contatos = escolhidos.reduce((soma, s) => soma + s.contatos, 0);

  // As pendências dependem dos blocos e do início, não das posições: arrastar
  // um bloco muda o fluxo a cada quadro, e uma lista nova de pendências
  // redesenharia todos os cartões junto.
  const { versao, inicio, blocos } = fluxo;
  const problemas = useMemo(() => {
    const comContato = opcoes.segmentos.some((s) => segmentoIds.includes(s.id) && s.contatos > 0);
    const doPublico: ProblemaDoFluxo[] = existente
      ? []
      : !segmentoIds.length
        ? [{ blocoId: null, mensagem: "Escolha pelo menos um segmento." }]
        : !comContato
          ? [{ blocoId: null, mensagem: "Os segmentos escolhidos não têm contato com WhatsApp." }]
          : [];
    const semPosicoes = { versao, inicio, blocos, posicoes: {} };
    return [
      ...doPublico,
      ...problemasDaTela(semPosicoes, templates),
      ...(existente ? blocosQueMudaramDeTipo(existente.fluxo, semPosicoes) : []),
      ...doServidor,
    ];
  }, [existente, segmentoIds, opcoes.segmentos, versao, inicio, blocos, templates, doServidor]);

  // O contrato com /api/ia/campanhas (todos texto): o fluxo vai sem as
  // posições, que são só desenho. Memorizado pelos blocos: arrastar um cartão
  // não refaz o JSON a cada quadro.
  const extraDaIa = useMemo(
    () => ({ construtor: "1", fluxo: JSON.stringify({ versao, inicio, blocos }), waba: conta.waba, campanha: existente?.id ?? "" }),
    [versao, inicio, blocos, conta.waba, existente?.id],
  );

  const motivo = !nome.trim() ? "Dê um nome à campanha." : problemas.length ? "Resolva as pendências do fluxo." : "";

  const publico = existente
    ? existente.publico
    : escolhidos.length
      ? `${escolhidos.map((s) => s.nome).join(", ")} · até ${quantosContatos(contatos)}`
      : "Nenhum segmento escolhido";

  /**
   * Antes do PUT: quem está agora num bloco que o fluxo novo não tem termina a
   * campanha ali (o servidor encerra). Salvar assim pede confirmação, com
   * quantos saem e de onde.
   */
  function pedirSalvar() {
    if (!existente) return;
    const porBloco = existente.metricas?.porBloco ?? {};
    const saem = Object.keys(existente.fluxo.blocos)
      .filter((id) => !Object.hasOwn(fluxo.blocos, id) && (porBloco[id]?.agora ?? 0) > 0)
      .map((id) => ({ id, agora: porBloco[id].agora }));
    if (!saem.length) return void salvar();
    const total = saem.reduce((soma, s) => soma + s.agora, 0);
    const onde = saem.map((s) => `${numero(s.agora)} em “${rotuloDoBloco(existente.fluxo.blocos[s.id], opcoes)}”`).join(", ");
    setTiraContatos(`Salvar tira ${quantosContatos(total)} da campanha, que estão em blocos apagados: ${onde}. Eles terminam ali e não recebem mais nada.`);
  }

  async function salvar() {
    if (!existente) return;
    setTiraContatos(null);
    setEnviando(true);
    setErro("");
    try {
      const r = await pedirCampanha<{ concluidas?: number }>(`/api/meta/whatsapp/campanhas/${existente.id}`, "PUT", { nome: nome.trim(), definicao: fluxo });
      if (!r.ok) {
        setErro(r.erro);
        setDoServidor(r.problemas);
        return;
      }
      // Quem estava num bloco apagado termina ali (o servidor conta): quem salvou precisa saber.
      const encerrados = r.dados.concluidas ?? 0;
      aoConcluir(
        existente.id,
        encerrados ? `Alterações salvas. ${quantosContatos(encerrados)} em blocos apagados terminaram a campanha.` : "Alterações salvas.",
      );
    } catch {
      setErro("Não consegui falar com o servidor. Confira a conexão e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  async function ativar() {
    setEnviando(true);
    setErro("");
    try {
      const r = await pedirCampanha<{ id: string; total: number }>("/api/meta/whatsapp/campanhas", "POST", {
        confirmar: true,
        nome: nome.trim(),
        segmentoIds,
        waba: conta.waba,
        telefoneId: conta.telefoneId,
        definicao: fluxo,
      });
      if (!r.ok) {
        setErro(r.erro);
        setDoServidor(r.problemas);
        // Com blocos apontados, o canvas mostra onde; sem, o erro fica no modal.
        if (r.problemas.length) setConfirmando(false);
        return;
      }
      setConfirmando(false);
      aoConcluir(r.dados.id, `Campanha ativada para ${quantosContatos(r.dados.total)}.`);
    } catch {
      setErro("Não consegui falar com o servidor. Confira a conexão e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const painelInicio = existente ? (
    <div className="space-y-3 text-[12px] text-zinc-700 dark:text-zinc-200">
      <p>{existente.publico}</p>
      <Ajuda>O público não muda depois que a campanha foi criada.</Ajuda>
      <p className="text-zinc-500 dark:text-zinc-400">Envia por {conta.telefone}</p>
    </div>
  ) : (
    <div className="space-y-4">
      <Grupo rotulo="Segmentos" ajuda="Entram os contatos com WhatsApp. Quem está em mais de um segmento entra uma vez só.">
        <div className="max-h-80 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-300 p-1.5 dark:border-zinc-700">
          {opcoes.segmentos.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <input
                type="checkbox"
                checked={segmentoIds.includes(s.id)}
                onChange={(e) => {
                  setSegmentoIds((atuais) => (e.target.checked ? [...atuais, s.id] : atuais.filter((id) => id !== s.id)));
                  setErro("");
                  setAntesDaIa(null);
                  setDescartado(null);
                }}
              />
              <span className="min-w-0 flex-1 truncate">{s.nome}</span>
              <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">{numero(s.contatos)}</span>
            </label>
          ))}
          {!opcoes.segmentos.length && <p className="px-1.5 py-1 text-zinc-400 dark:text-zinc-500">Nenhum segmento criado.</p>}
        </div>
      </Grupo>
      <p className="text-[12px] text-zinc-500 dark:text-zinc-400">Envia por {conta.telefone}</p>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-2.5 tela-baixa:py-2 dark:border-zinc-800">
        <input
          aria-label="Nome da campanha"
          className={`${campoAds} min-w-40 max-w-72 flex-1`}
          value={nome}
          maxLength={160}
          placeholder={existente ? "Nome da campanha" : "Nome da campanha nova"}
          onChange={(e) => {
            setNome(e.target.value);
            setAntesDaIa(null);
            setDescartado(null);
          }}
        />
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {erro ? (
            <p role="alert" className="min-w-0 truncate text-[12px] text-rose-600 dark:text-rose-400" title={erro}>
              {erro}
            </p>
          ) : (
            motivo && <p className="min-w-0 truncate text-[12px] text-zinc-500 dark:text-zinc-400">{motivo}</p>
          )}
          <button
            type="button"
            onClick={() => mudarIa(!iaAberta)}
            aria-pressed={iaAberta}
            className={`${botaoAds} shrink-0 ${iaAberta ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50" : ""}`}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            Montar com IA
          </button>
          <button type="button" onClick={aoCancelar} disabled={enviando} className={`${botaoAds} shrink-0`}>
            Cancelar
          </button>
          {existente ? (
            <button type="button" onClick={pedirSalvar} disabled={enviando || !!motivo || !!tiraContatos} className={`${botaoPrincipalAds} shrink-0`}>
              {enviando ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
              Salvar alterações
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setErro("");
                setConfirmando(true);
              }}
              disabled={enviando || !!motivo}
              className={`${botaoPrincipalAds} shrink-0`}
            >
              <Send className="size-3.5" aria-hidden="true" />
              Ativar campanha
            </button>
          )}
        </div>
      </div>

      {tiraContatos && (
        <Confirmacao texto={tiraContatos} rotuloConfirmar="Salvar mesmo assim" aoConfirmar={() => void salvar()} aoVoltar={() => setTiraContatos(null)} />
      )}

      {/* O chat fica FORA do canvas, que remonta a cada desenho (key): a
          conversa não pode ir junto. Aberto, ele ocupa o lugar da paleta. */}
      <div className="flex min-h-0 flex-1">
        <IaCampanhas
          campanhaId={existente?.id ?? null}
          aberta={iaAberta}
          mudarAberta={mudarIa}
          contexto={existente ? `construtor da campanha de WhatsApp “${existente.nome}”, em edição` : "construtor de uma campanha nova de WhatsApp"}
          extra={extraDaIa}
          templates={templates}
          aoEvento={receberDaIa}
        />
        <FluxoCampanha
          key={vista}
          fluxo={fluxo}
          mudar={mudar}
          semPaleta={iaAberta}
          reorganizarAoMedir={desenhoDaIa ? setFluxo : undefined}
          templates={templates}
          opcoes={opcoes}
          problemas={problemas}
          metricas={existente?.metricas ?? null}
          inicio={{
            // Sem segmento, a faixa de pendência do cartão já diz o que fazer.
            resumo: existente ? existente.publico : escolhidos.length ? escolhidos.map((s) => s.nome).join(", ") : "Nenhum segmento escolhido",
            detalhe: existente ? conta.telefone : escolhidos.length ? `até ${quantosContatos(contatos)}` : "",
            painel: painelInicio,
          }}
          faixa={
            descartado ? (
              <p
                role="status"
                className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 py-1 pl-3 pr-1 text-[12px] text-amber-800 shadow-sm dark:border-amber-500/40 dark:bg-zinc-950 dark:text-amber-300"
              >
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                {descartado}
                <button
                  type="button"
                  onClick={() => setDescartado(null)}
                  aria-label="Dispensar aviso"
                  className="rounded-full p-1 outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:hover:bg-amber-500/10"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </p>
            ) : (
              antesDaIa && (
              <p
                role="status"
                className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-3 pr-1 text-[12px] text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
              >
                <Sparkles className="size-3.5 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
                A IA desenhou o fluxo
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">
                  ·
                </span>
                <button
                  type="button"
                  onClick={desfazer}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-zinc-900 outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:text-zinc-50 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100/20"
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  Desfazer
                </button>
              </p>
              )
            )
          }
        />
      </div>

      {confirmando && (
        <ConfirmarAtivacao
          titulo={`Ativar “${nome.trim()}”?`}
          rotuloConfirmar="Ativar e enviar"
          publico={`${publico} · por ${conta.telefone}`}
          fluxo={fluxo}
          templates={templates}
          opcoes={opcoes}
          enviando={enviando}
          erro={erro}
          aoConfirmar={() => void ativar()}
          aoCancelar={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}
