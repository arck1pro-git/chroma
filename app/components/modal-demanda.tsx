"use client";

// O formulário de demanda, em modal. Serve a três lugares:
//   · "Abrir chamado", no topo do Dashboard — sem o campo "Para": o chamado vai
//     sempre para o TI;
//   · "Nova demanda", em /demandas — com "Para". Todo mundo escolhe entre si
//     mesmo e um chamado para o TI; Admin e TI, também qualquer pessoa ou
//     todos (quem decide é podeCriarPara, em lib/demandas.ts);
//   · "Editar demanda", em /demandas — abre preenchido (`inicial`) e sem "Para":
//     editar não muda o destino.
//
// Sai pelo <CamadaTopo>, no <body>: no Dashboard ele precisa ficar por cima do
// quadro e de tudo que flutua sobre ele (ver a escala em camada-topo.tsx).
import { useEffect, useId, useState, useTransition } from "react";
import { CircleCheck, X } from "lucide-react";
import CamadaTopo from "./camada-topo";
import {
  PARA_O_TI,
  PRIORIDADES,
  type DadosDemanda,
  type Prioridade,
  type ResultadoDemanda,
} from "@/lib/demandas-tipos";

/** Uma opção do campo "Para". */
export type Destino = {
  valor: string;
  rotulo: string;
  /** No seletor, as opções com grupo entram num <optgroup> com este nome. */
  grupo?: string;
  /** Uma linha embaixo do campo quando esta opção está escolhida. */
  dica?: string;
};

const campo =
  "w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[13px] text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600";

const rotulo = "text-[11px] font-medium text-zinc-600 dark:text-zinc-400";

function classeDaPilula(escolhida: boolean) {
  return `rounded-lg px-3 py-2 text-[12px] font-medium transition ${
    escolhida
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
  }`;
}

export default function ModalDemanda({
  titulo,
  subtitulo,
  botao,
  destinos,
  destinoInicial = "",
  inicial,
  enviar,
  aoFechar,
  aoConcluir,
}: {
  titulo: string;
  subtitulo: string;
  /** Texto do botão de enviar. Com "Chamado para o TI" escolhido, vira "Abrir chamado". */
  botao: string;
  /**
   * Com a lista, aparece o campo "Para". Até três opções viram botões lado a
   * lado — é o caso de quem só cria para si ou para o TI, e um seletor para
   * duas opções esconderia a escolha atrás de um clique. Mais que isso, um
   * seletor: o Admin escolhe entre a equipe inteira.
   */
  destinos?: Destino[];
  /** Já escolhido ao abrir. Vazio obriga a escolher. */
  destinoInicial?: string;
  /** Os valores de quando o modal abre — é o caso de editar. */
  inicial?: Omit<DadosDemanda, "para">;
  enviar: (dados: DadosDemanda) => Promise<ResultadoDemanda>;
  aoFechar: () => void;
  /**
   * Quem chamou mostra o resultado (e fecha o modal). Sem isto, o próprio modal
   * troca o formulário pela confirmação — é o caso do Dashboard, que não tem
   * faixa de aviso.
   */
  aoConcluir?: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(inicial?.titulo ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [prazo, setPrazo] = useState(inicial?.prazo ?? "");
  const [prioridade, setPrioridade] = useState<Prioridade>(inicial?.prioridade ?? "normal");
  const [para, setPara] = useState(destinoInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const idPara = useId();

  // Esc fecha, como nos outros modais — menos no meio do envio, quando sumir
  // com a tela deixaria a pessoa sem saber se a demanda nasceu.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, enviando]);

  // É chamado o modal do Dashboard (sem destinos e sem `inicial`) e a "Nova
  // demanda" com o TI escolhido. Muda o tom dos exemplos e o nome do botão.
  const chamado = destinos ? para === PARA_O_TI : inicial === undefined;
  const escolhido = destinos?.find((d) => d.valor === para);
  const podeEnviar = Boolean(nome.trim()) && (!destinos || Boolean(escolhido)) && !enviando;

  // As soltas primeiro, depois cada grupo na ordem em que aparece.
  const soltos = destinos?.filter((d) => !d.grupo) ?? [];
  const grupos = new Map<string, Destino[]>();
  for (const d of destinos ?? []) {
    if (!d.grupo) continue;
    grupos.set(d.grupo, [...(grupos.get(d.grupo) ?? []), d]);
  }

  function mandar() {
    if (!podeEnviar) return;
    setErro(null);
    iniciar(async () => {
      const r = await enviar({
        titulo: nome,
        descricao,
        prazo,
        prioridade,
        ...(destinos ? { para } : {}),
      });
      if (!r.ok) {
        setErro(r.mensagem);
        return;
      }
      if (aoConcluir) aoConcluir(r.mensagem);
      else setFeito(r.mensagem);
    });
  }

  return (
    <CamadaTopo>
      <div
        className="veu-surge fixed inset-0 z-[300] bg-zinc-900/30 dark:bg-black/50"
        onClick={() => !enviando && aoFechar()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="surge fixed left-1/2 top-1/2 z-[310] flex max-h-[90vh] w-[min(30rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-200 bg-conteudo shadow-xl dark:border-zinc-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-950 dark:text-zinc-50">{titulo}</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{subtitulo}</p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            disabled={enviando}
            aria-label="Fechar"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {feito ? (
          <>
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <CircleCheck className="size-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{feito}</p>
            </div>
            <footer className="flex justify-end border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <button
                type="button"
                autoFocus
                onClick={aoFechar}
                className="rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Fechar
              </button>
            </footer>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mandar();
            }}
            className="flex min-h-0 flex-col"
          >
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
              {/* "Para" vem primeiro: é ele que diz se isto é uma tarefa ou um
                  chamado, e os exemplos dos campos de baixo mudam com ele. */}
              {destinos && (
                <div className="flex flex-col gap-1">
                  <span id={idPara} className={rotulo}>
                    Para
                  </span>
                  {destinos.length <= 3 ? (
                    <div role="radiogroup" aria-labelledby={idPara} className="flex flex-wrap gap-1">
                      {destinos.map((d) => (
                        <button
                          key={d.valor}
                          type="button"
                          role="radio"
                          aria-checked={para === d.valor}
                          onClick={() => setPara(d.valor)}
                          className={classeDaPilula(para === d.valor)}
                        >
                          {d.rotulo}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <select
                      aria-labelledby={idPara}
                      value={para}
                      onChange={(e) => setPara(e.target.value)}
                      className={campo}
                    >
                      <option value="" disabled>
                        Escolha
                      </option>
                      {soltos.map((d) => (
                        <option key={d.valor} value={d.valor}>
                          {d.rotulo}
                        </option>
                      ))}
                      {[...grupos].map(([grupo, lista]) => (
                        <optgroup key={grupo} label={grupo}>
                          {lista.map((d) => (
                            <option key={d.valor} value={d.valor}>
                              {d.rotulo}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                  {escolhido?.dica && (
                    <span className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                      {escolhido.dica}
                    </span>
                  )}
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className={rotulo}>Título</span>
                <input
                  autoFocus
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={chamado ? "O que está acontecendo" : "O que precisa ser feito"}
                  maxLength={200}
                  className={campo}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className={rotulo}>
                  Descrição <span className="font-normal text-zinc-400">(opcional)</span>
                </span>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder={
                    chamado ? "Em que tela, o que você tentou, a mensagem de erro" : "Detalhes, links, onde fica"
                  }
                  className={`${campo} resize-y`}
                />
              </label>

              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1">
                  <span className={rotulo}>
                    Prazo <span className="font-normal text-zinc-400">(opcional)</span>
                  </span>
                  <input
                    type="date"
                    value={prazo}
                    onChange={(e) => setPrazo(e.target.value)}
                    className={`${campo} w-40 [color-scheme:light] dark:[color-scheme:dark]`}
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <span className={rotulo}>Prioridade</span>
                  <div role="radiogroup" aria-label="Prioridade" className="flex gap-1">
                    {PRIORIDADES.map((p) => (
                      <button
                        key={p.valor}
                        type="button"
                        role="radio"
                        aria-checked={prioridade === p.valor}
                        onClick={() => setPrioridade(p.valor)}
                        className={classeDaPilula(prioridade === p.valor)}
                      >
                        {p.rotulo}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {erro && <p className="text-[12px] text-red-600 dark:text-red-400">{erro}</p>}
            </div>

            <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={aoFechar}
                disabled={enviando}
                className="rounded-full px-4 py-2 text-[13px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!podeEnviar}
                className="rounded-full bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {enviando ? "Enviando…" : destinos && para === PARA_O_TI ? "Abrir chamado" : botao}
              </button>
            </footer>
          </form>
        )}
      </div>
    </CamadaTopo>
  );
}
