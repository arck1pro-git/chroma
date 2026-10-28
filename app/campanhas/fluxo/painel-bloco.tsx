"use client";

// O miolo do painel da direita quando um bloco está selecionado: a
// configuração de cada tipo e, embaixo, para onde vai cada saída. A lista de
// destinos é o jeito de ligar sem arrastar (teclado, leitor de tela, tablet) e
// já não oferece o que fecharia um laço.
//
// Na campanha no ar o mesmo painel aparece dentro de um <fieldset disabled>:
// mostra tudo o que foi configurado, sem deixar mexer.
//
// Menos texto desde 2026-10-28 (pedido dele): rótulo curto, a regra que
// importa num "?" (Dica, ./campos.tsx), sem a frase de arrastar a bolinha nem
// a da janela de 24 h (o selo no cabeçalho do painel explica). Os blocos de
// controle e o horário moram em ./formularios-controle.tsx.
import { useRef } from "react";
import { LIMITES_FLUXO, saidasDe, type BlocoCampanha, type FluxoCampanha } from "@/lib/campanhas-fluxo";
import { DADOS_NA_CAMPANHA, marcaDoContato, type TemplateWhatsApp } from "@/lib/templates-whatsapp";
import { BotaoIcone } from "@/app/components/gaveta";
import { Plus, X } from "@/app/components/icones";
import { campoAds } from "../pecas";
import { Ajuda, Alternar, Campo, CampoDuracao, Escolha, FunilEEtapa, Grupo } from "./campos";
import EditorTemplate from "./editor-template";
import { FormularioCondicao, FormularioHorario, FormularioPassagem } from "./formularios-controle";
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
      return <EditorTemplate bloco={b} templates={templates} documentos={o.documentos} mudar={mudar} />;

    case "aguardar_resposta": {
      const botoes = Object.keys(b.botoes);
      return (
        <div className="space-y-4">
          <CampoDuracao key={id} rotulo="Prazo para responder" minutos={b.prazo_minutos} mudar={(m) => mudar({ ...b, prazo_minutos: m })} />
          <Grupo rotulo="Botões do template" dica="Vêm do “Enviar template” ligado antes deste bloco.">
            {botoes.length ? (
              <ul className="flex flex-wrap gap-1">
                {botoes.map((t) => (
                  <li key={t} className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[12px] text-sky-700 dark:border-zinc-700 dark:text-sky-300">
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-zinc-400 dark:text-zinc-500">Nenhum</p>
            )}
          </Grupo>
          <Grupo rotulo="Palavras na resposta" dica="Vale a primeira que a resposta contiver. Maiúscula e acento não contam.">
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
        </div>
      );
    }

    case "enviar_texto":
      return <TextoComMarcas rotulo="Texto" valor={b.texto} linhas={5} mudar={(texto) => mudar({ ...b, texto })} />;

    case "enviar_arquivo":
      return (
        <div className="space-y-3">
          <Escolha
            rotulo="Arquivo"
            dica="Imagem, PDF ou vídeo da biblioteca de Documentos."
            valor={b.documentoId}
            opcoes={o.documentos}
            vazio="Escolha o arquivo"
            mudar={(documentoId) => mudar({ ...b, documentoId })}
          />
          {!o.documentos.length && <Ajuda>Nenhum arquivo. Suba em Documentos.</Ajuda>}
          <TextoComMarcas rotulo="Legenda" valor={b.legenda} linhas={3} placeholder="Opcional" mudar={(legenda) => mudar({ ...b, legenda })} />
        </div>
      );

    case "esperar":
      return <CampoDuracao key={id} rotulo="Esperar" minutos={b.minutos} mudar={(m) => mudar({ ...b, minutos: m })} />;

    case "horario":
      return <FormularioHorario bloco={b} mudar={mudar} />;

    case "condicao":
      return <FormularioCondicao key={id} bloco={b} opcoes={o} mudar={mudar} />;

    case "limitar_passagem":
      return <FormularioPassagem key={id} bloco={b} mudar={mudar} />;

    case "mudar_tag":
      return (
        <div className="space-y-3">
          <Alternar rotulo="O que fazer" valor={b.acao} opcoes={[["adicionar", "Adicionar"], ["remover", "Tirar"]]} mudar={(acao) => mudar({ ...b, acao })} />
          <Escolha rotulo="Tag" valor={b.tagId} opcoes={o.tags} vazio="Escolha a tag" mudar={(tagId) => mudar({ ...b, tagId })} />
        </div>
      );

    case "mudar_segmento":
      return (
        <div className="space-y-3">
          <Alternar rotulo="O que fazer" valor={b.acao} opcoes={[["adicionar", "Pôr"], ["remover", "Tirar"]]} mudar={(acao) => mudar({ ...b, acao })} />
          <Escolha rotulo="Segmento" valor={b.segmentoId} opcoes={o.segmentos} vazio="Escolha o segmento" mudar={(segmentoId) => mudar({ ...b, segmentoId })} />
        </div>
      );

    case "criar_oportunidade":
    case "mover_oportunidade":
      return (
        <div className="space-y-3">
          <FunilEEtapa
            funis={o.funis}
            etapas={o.etapas}
            funilId={b.funilId}
            etapaId={b.etapaId}
            dica={b.tipo === "mover_oportunidade" ? "Move a oportunidade aberta mais recente do contato neste funil. Sem nenhuma, ele segue em frente." : undefined}
            mudar={(funilId, etapaId) => mudar({ ...b, funilId, etapaId })}
          />
          {b.tipo === "criar_oportunidade" && (
            <Campo rotulo="Nome da oportunidade" dica="{{nome}} vira o nome do contato.">
              <input className={campoAds} value={b.nome} maxLength={160} onChange={(e) => mudar({ ...b, nome: e.target.value })} />
            </Campo>
          )}
        </div>
      );

    case "registrar_conversao":
      return <p className="text-[12px] text-zinc-400 dark:text-zinc-500">Nada a configurar.</p>;

    case "avisar_equipe":
      return (
        <div className="space-y-3">
          <Escolha rotulo="Número que avisa" valor={b.instanciaId} opcoes={o.instancias} vazio="Escolha o número" mudar={(instanciaId) => mudar({ ...b, instanciaId })} />
          {!o.instancias.length && <Ajuda>Nenhum número. Cadastre em Configurações › WhatsApp.</Ajuda>}
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
          <Campo rotulo="Também o responsável">
            <select className={campoAds} value={b.responsavelDoFunil ?? ""} onChange={(e) => mudar({ ...b, responsavelDoFunil: e.target.value || null })}>
              <option value="">Não</option>
              {o.funis.map((x) => (
                <option key={x.id} value={x.id}>
                  No funil {x.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Aviso" dica="Vai com o nome do contato e o link da conversa, nunca telefone, e-mail ou a resposta. Sai agrupado por pessoa.">
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
      return <Escolha rotulo="IA de atendimento" valor={b.iaId} opcoes={o.ias} vazio="Escolha a IA" mudar={(iaId) => mudar({ ...b, iaId })} />;
  }
}

/** Texto com as marcas do contato ({{primeiro_nome}}…): o do Enviar texto e a legenda do Enviar arquivo. */
function TextoComMarcas({
  rotulo,
  valor,
  linhas,
  placeholder,
  mudar,
}: {
  rotulo: string;
  valor: string;
  linhas: number;
  placeholder?: string;
  mudar: (texto: string) => void;
}) {
  const campo = useRef<HTMLTextAreaElement>(null);
  // A marca entra onde está o cursor, e o cursor fica logo depois dela.
  function inserir(marca: string) {
    const el = campo.current;
    const inicio = el?.selectionStart ?? valor.length;
    const fim = el?.selectionEnd ?? inicio;
    mudar((valor.slice(0, inicio) + marca + valor.slice(fim)).slice(0, LIMITES_FLUXO.texto));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(inicio + marca.length, inicio + marca.length);
    });
  }
  return (
    <div className="space-y-2">
      <Campo rotulo={rotulo}>
        <textarea
          ref={campo}
          className={area}
          rows={linhas}
          maxLength={LIMITES_FLUXO.texto}
          value={valor}
          placeholder={placeholder}
          onChange={(e) => mudar(e.target.value)}
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
          {valor.length}/{LIMITES_FLUXO.texto}
        </span>
      </div>
    </div>
  );
}

function Saidas({ id, bloco, fluxo, opcoes, metricas, ligar }: Props) {
  const outros = Object.entries(fluxo.blocos).filter(([outro]) => outro !== id);
  const voltaria = new Set(outros.filter(([outro]) => fechaLaco(fluxo, id, outro)).map(([outro]) => outro));
  const varias = bloco.tipo === "aguardar_resposta" || bloco.tipo === "condicao";
  return (
    <Grupo
      rotulo={bloco.tipo === "aguardar_resposta" ? "Para onde vai cada resposta" : varias ? "Para onde vai" : "Depois"}
      dica={bloco.tipo === "aguardar_resposta" ? "Quem responde só “sair”, “parar” ou “stop” sai da campanha." : undefined}
    >
      <ul className="space-y-2.5">
        {saidasDe(bloco).map((s) => (
          <li key={s.id}>
            <label className="block">
              {/* Bloco de saída única: o "Depois" do grupo já é o rótulo. */}
              {(varias || metricas) && (
                <span className="mb-1 flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
                  <span className="min-w-0 flex-1 truncate">{s.rotulo || "Próximo bloco"}</span>
                  {metricas && (
                    <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">
                      {numero(metricas.porSaida[`${id}|${s.id}`] ?? 0)} pessoas
                    </span>
                  )}
                </span>
              )}
              <select
                aria-label={varias ? undefined : "Próximo bloco"}
                className={campoAds}
                value={s.destino ?? ""}
                onChange={(e) => ligar(s.id, e.target.value || null)}
              >
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
