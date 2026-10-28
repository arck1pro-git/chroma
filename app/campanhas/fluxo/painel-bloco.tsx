"use client";

// O miolo do painel da direita quando um bloco está selecionado: a
// configuração de cada tipo e, embaixo, para onde vai cada saída. A lista de
// destinos é o jeito de ligar sem arrastar (teclado, leitor de tela, tablet) e
// já não oferece o que fecharia um laço.
//
// Na campanha no ar o mesmo painel aparece dentro de um <fieldset disabled>:
// mostra tudo o que foi configurado, sem deixar mexer.
import { useRef } from "react";
import { LIMITES_FLUXO, saidasDe, type BlocoCampanha, type FluxoCampanha } from "@/lib/campanhas-fluxo";
import { DADOS_NA_CAMPANHA, marcaDoContato, type TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { BotaoIcone } from "@/app/components/gaveta";
import { AlertTriangle, Plus, X } from "@/app/components/icones";
import { campoAds } from "../pecas";
import { Ajuda, Alternar, Campo, CampoDuracao, Grupo } from "./campos";
import EditorTemplate from "./editor-template";
import { fechaLaco, rotuloDoBloco, type MetricasFluxo, type OpcoesFluxo } from "./grafo";

type Props = {
  id: string;
  bloco: BlocoCampanha;
  fluxo: FluxoCampanha;
  templates: TemplateWhatsApp[];
  opcoes: OpcoesFluxo;
  metricas: MetricasFluxo | null;
  mudar: (b: BlocoCampanha) => void;
  ligar: (saidaId: string, destino: string | null) => void;
};

const area = `${campoAds} resize-y leading-relaxed`;
const numero = (n: number) => n.toLocaleString("pt-BR");

export default function PainelDoBloco(p: Props) {
  return (
    <div className="space-y-5">
      <Configuracao {...p} />
      <Saidas {...p} />
    </div>
  );
}

function Configuracao({ id, bloco: b, templates, opcoes: o, mudar }: Props) {
  switch (b.tipo) {
    case "enviar_template":
      return <EditorTemplate bloco={b} templates={templates} mudar={mudar} />;

    case "aguardar_resposta": {
      const botoes = Object.keys(b.botoes);
      return (
        <div className="space-y-4">
          <CampoDuracao key={id} rotulo="Prazo para responder" minutos={b.prazo_minutos} mudar={(m) => mudar({ ...b, prazo_minutos: m })} />
          <Grupo rotulo="Botões do template">
            {botoes.length ? (
              <ul className="flex flex-wrap gap-1">
                {botoes.map((t) => (
                  <li key={t} className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] text-sky-700 dark:border-zinc-700 dark:text-sky-300">
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <Ajuda>Aparecem sozinhos quando um “Enviar template” com botões de resposta vem antes deste bloco.</Ajuda>
            )}
          </Grupo>
          <Grupo
            rotulo="Palavras na resposta escrita"
            ajuda="Vale a primeira da lista que a resposta contiver, sem diferença de maiúscula e acento."
          >
            <div className="space-y-1.5">
              {b.palavras.map((p, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    aria-label={`Palavra ${i + 1}`}
                    className={campoAds}
                    value={p.contem}
                    maxLength={80}
                    placeholder="preço, visita, quero…"
                    onChange={(e) => mudar({ ...b, palavras: b.palavras.map((x, j) => (j === i ? { ...x, contem: e.target.value } : x)) })}
                  />
                  <BotaoIcone Icone={X} rotulo={`Tirar a palavra ${i + 1}`} onClick={() => mudar({ ...b, palavras: b.palavras.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <button
                type="button"
                disabled={b.palavras.length >= LIMITES_FLUXO.palavras}
                onClick={() => mudar({ ...b, palavras: [...b.palavras, { contem: "", proximo: null }] })}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-zinc-500 outline-none transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                <Plus className="size-3" aria-hidden="true" />
                Palavra
              </button>
            </div>
          </Grupo>
          <Ajuda>Quem responde só “sair”, “parar” ou “stop” sai da campanha, por qualquer caminho.</Ajuda>
        </div>
      );
    }

    case "enviar_texto":
      return <EditorTexto bloco={b} mudar={mudar} />;

    case "esperar":
      return <CampoDuracao key={id} rotulo="Esperar" minutos={b.minutos} mudar={(m) => mudar({ ...b, minutos: m })} />;

    case "mudar_tag":
      return (
        <div className="space-y-3">
          <Alternar rotulo="O que fazer" valor={b.acao} opcoes={[["adicionar", "Adicionar"], ["remover", "Tirar"]]} mudar={(acao) => mudar({ ...b, acao })} />
          <Campo rotulo="Tag">
            <select className={campoAds} value={b.tagId} onChange={(e) => mudar({ ...b, tagId: e.target.value })}>
              <option value="">Escolha a tag</option>
              {o.tags.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      );

    case "mudar_segmento":
      return (
        <div className="space-y-3">
          <Alternar rotulo="O que fazer" valor={b.acao} opcoes={[["adicionar", "Pôr"], ["remover", "Tirar"]]} mudar={(acao) => mudar({ ...b, acao })} />
          <Campo rotulo="Segmento">
            <select className={campoAds} value={b.segmentoId} onChange={(e) => mudar({ ...b, segmentoId: e.target.value })}>
              <option value="">Escolha o segmento</option>
              {o.segmentos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      );

    case "criar_oportunidade":
    case "mover_oportunidade":
      return (
        <div className="space-y-3">
          <Campo rotulo="Funil">
            <select className={campoAds} value={b.funilId} onChange={(e) => mudar({ ...b, funilId: e.target.value, etapaId: "" })}>
              <option value="">Escolha o funil</option>
              {o.funis.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Etapa">
            <select className={campoAds} value={b.etapaId} disabled={!b.funilId} onChange={(e) => mudar({ ...b, etapaId: e.target.value })}>
              <option value="">Escolha a etapa</option>
              {o.etapas
                .filter((x) => x.funil_id === b.funilId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
            </select>
          </Campo>
          {b.tipo === "criar_oportunidade" ? (
            <Campo rotulo="Nome da oportunidade" ajuda="{{nome}} vira o nome do contato.">
              <input className={campoAds} value={b.nome} maxLength={160} onChange={(e) => mudar({ ...b, nome: e.target.value })} />
            </Campo>
          ) : (
            <Ajuda>Move a oportunidade aberta mais recente do contato neste funil. Sem nenhuma, o contato segue em frente.</Ajuda>
          )}
        </div>
      );

    case "registrar_conversao":
      return <Ajuda>O contato que passa por aqui conta como resultado da campanha.</Ajuda>;

    case "avisar_equipe":
      return (
        <div className="space-y-3">
          <Campo rotulo="Número que manda o aviso">
            <select className={campoAds} value={b.instanciaId} onChange={(e) => mudar({ ...b, instanciaId: e.target.value })}>
              <option value="">Escolha o número</option>
              {o.instancias.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
          </Campo>
          {!o.instancias.length && <Ajuda>Nenhum número disponível para avisos. Os números ficam em Configurações › WhatsApp.</Ajuda>}
          <Grupo rotulo="Quem recebe">
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-300 p-1.5 dark:border-zinc-700">
              {o.usuarios.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900">
                  <input
                    type="checkbox"
                    checked={b.usuarioIds.includes(u.id)}
                    onChange={(e) =>
                      mudar({ ...b, usuarioIds: e.target.checked ? [...b.usuarioIds, u.id] : b.usuarioIds.filter((x) => x !== u.id) })
                    }
                  />
                  <span className="truncate">{u.nome}</span>
                </label>
              ))}
              {!o.usuarios.length && <p className="px-1.5 py-1 text-[12px] text-zinc-400 dark:text-zinc-500">Ninguém da equipe disponível.</p>}
            </div>
          </Grupo>
          <Campo rotulo="Também o responsável da oportunidade">
            <select className={campoAds} value={b.responsavelDoFunil ?? ""} onChange={(e) => mudar({ ...b, responsavelDoFunil: e.target.value || null })}>
              <option value="">Não</option>
              {o.funis.map((x) => (
                <option key={x.id} value={x.id}>
                  No funil {x.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Aviso" ajuda="Vai com o nome do contato e o link da conversa, nunca telefone, e-mail ou o que ele respondeu. Os avisos de cada pessoa saem agrupados.">
            <textarea
              className={area}
              rows={3}
              maxLength={LIMITES_FLUXO.texto}
              value={b.texto}
              placeholder="Respondeu a campanha e quer falar com alguém."
              onChange={(e) => mudar({ ...b, texto: e.target.value })}
            />
          </Campo>
        </div>
      );

    case "ligar_ia":
      return (
        <Campo rotulo="IA de atendimento" ajuda="A IA passa a responder este contato daqui em diante.">
          <select className={campoAds} value={b.iaId} onChange={(e) => mudar({ ...b, iaId: e.target.value })}>
            <option value="">Escolha a IA</option>
            {o.ias.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
              </option>
            ))}
          </select>
        </Campo>
      );
  }
}

function EditorTexto({ bloco, mudar }: { bloco: Extract<BlocoCampanha, { tipo: "enviar_texto" }>; mudar: (b: BlocoCampanha) => void }) {
  const campo = useRef<HTMLTextAreaElement>(null);
  // A marca entra onde está o cursor, e o cursor fica logo depois dela.
  function inserir(marca: string) {
    const el = campo.current;
    const inicio = el?.selectionStart ?? bloco.texto.length;
    const fim = el?.selectionEnd ?? inicio;
    mudar({ ...bloco, texto: (bloco.texto.slice(0, inicio) + marca + bloco.texto.slice(fim)).slice(0, LIMITES_FLUXO.texto) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(inicio + marca.length, inicio + marca.length);
    });
  }
  return (
    <div className="space-y-2">
      <p className="flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        Só sai com a janela de 24 horas aberta: o contato respondeu há menos de 24 horas. Ligue este bloco depois de uma resposta.
      </p>
      <Campo rotulo="Texto">
        <textarea
          ref={campo}
          className={area}
          rows={5}
          maxLength={LIMITES_FLUXO.texto}
          value={bloco.texto}
          onChange={(e) => mudar({ ...bloco, texto: e.target.value })}
        />
      </Campo>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Inserir:</span>
        {DADOS_NA_CAMPANHA.map((d) => (
          <button
            key={d.chave}
            type="button"
            onClick={() => inserir(marcaDoContato(d.chave))}
            className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {d.rotulo}
          </button>
        ))}
        <span className="ml-auto text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {bloco.texto.length}/{LIMITES_FLUXO.texto}
        </span>
      </div>
    </div>
  );
}

function Saidas({ id, bloco, fluxo, opcoes, metricas, ligar }: Props) {
  const outros = Object.entries(fluxo.blocos).filter(([outro]) => outro !== id);
  const voltaria = new Set(outros.filter(([outro]) => fechaLaco(fluxo, id, outro)).map(([outro]) => outro));
  return (
    <Grupo
      rotulo={bloco.tipo === "aguardar_resposta" ? "Para onde vai cada resposta" : "Depois"}
      ajuda="Também dá para ligar arrastando a bolinha da direita do bloco até outro."
    >
      <ul className="space-y-2.5">
        {saidasDe(bloco).map((s) => (
          <li key={s.id}>
            <label className="block">
              <span className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                <span className="min-w-0 flex-1 truncate">{s.rotulo || "Próximo bloco"}</span>
                {metricas && (
                  <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">
                    {numero(metricas.porSaida[`${id}|${s.id}`] ?? 0)} pessoas
                  </span>
                )}
              </span>
              <select className={`${campoAds} mt-1`} value={s.destino ?? ""} onChange={(e) => ligar(s.id, e.target.value || null)}>
                <option value="">Fim do fluxo</option>
                {outros.map(([outro, b]) => (
                  <option key={outro} value={outro} disabled={voltaria.has(outro)}>
                    {rotuloDoBloco(b, opcoes)}
                    {voltaria.has(outro) ? " (voltaria atrás)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
    </Grupo>
  );
}
