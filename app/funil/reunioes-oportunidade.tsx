"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarCheck2, CalendarClock, CalendarX2, FileText, Play, Plus, Video } from "lucide-react";
import type { Gravacao } from "@/lib/gravacoes";
import VisorGravacao, { quandoDaGravacao, tituloDaGravacao } from "../components/visor-gravacao";
import type { Usuario } from "../data";
import { diaDe, hora, Selo, type Tom } from "../contatos/pecas";
import {
  AcaoSecao,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  BotaoCopiar,
  CAMPO,
  Carregando,
  IconeLinha,
  LINHA_FIXA,
  Secao,
  Vazio,
} from "../components/gaveta";
import {
  marcarReuniaoDaOportunidade,
  reunioesDaFicha,
  sugestoesDeHorario,
  type ReunioesDaFicha,
  type SugestaoHorario,
} from "./acoes-agenda";

// A seção "Reuniões" da ficha da oportunidade: as reuniões no Google Calendar
// e o "+ Marcar" no canto do título. Carregadas ao abrir a ficha, como as
// automações: é consulta por oportunidade (e vai ao Google), e a raiz já
// carrega a base inteira.

const DURACOES = [
  { min: 30, rotulo: "30 min" },
  { min: 60, rotulo: "1 hora" },
  { min: 90, rotulo: "1h30" },
];

const FUSO = "America/Sao_Paulo";
const fmtDia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "short", day: "2-digit", month: "short" });

/** "seg, 05 out" */
function diaDaReuniao(iso: string) {
  return fmtDia.format(new Date(iso)).replace(/\./g, "").replace(/ de /g, " ");
}

/** O selo de cada reunião. `hoje` é o dia da leitura — o render não chama o relógio. */
function seloDaReuniao(
  r: { inicio: string; passou: boolean; cancelada: boolean },
  hoje: string,
): { texto: string; tom: Tom } | null {
  if (r.cancelada) return { texto: "Cancelada", tom: "ruim" };
  if (r.passou) return { texto: "Já aconteceu", tom: "neutro" };
  const dia = diaDe(r.inicio);
  if (dia === hoje) return { texto: "Hoje", tom: "aviso" };
  const amanha = new Date(`${hoje}T12:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  if (dia === amanha.toISOString().slice(0, 10)) return { texto: "Amanhã", tom: "bom" };
  return null;
}

const hojeAgora = () => diaDe(new Date().toISOString());

export default function ReunioesDaOportunidade({
  oportunidadeId,
  usuarioPorId,
}: {
  oportunidadeId: string;
  usuarioPorId: Map<string, Usuario>;
}) {
  // A carga guarda de QUAL oportunidade é — mesma razão do `carga` das
  // automações na ficha: a ficha é reaproveitada ao abrir outro card. E o dia
  // da leitura, para o "Hoje"/"Amanhã" sem relógio no render.
  const [carga, setCarga] = useState<{ opId: string; dado: ReunioesDaFicha; hoje: string } | null>(null);
  const estado = carga?.opId === oportunidadeId ? carga : null;
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [aberto, setAberto] = useState(false);
  const [visor, setVisor] = useState<Gravacao | null>(null);

  useEffect(() => {
    let vivo = true;
    reunioesDaFicha(oportunidadeId)
      .then((dado) => vivo && setCarga({ opId: oportunidadeId, dado, hoje: hojeAgora() }))
      .catch(
        () =>
          vivo &&
          setCarga({ opId: oportunidadeId, dado: { conectado: false, reunioes: [], gravacaoDe: {}, doContato: [] }, hoje: hojeAgora() }),
      );
    return () => {
      vivo = false;
    };
  }, [oportunidadeId]);

  async function recarregar() {
    const dado = await reunioesDaFicha(oportunidadeId);
    setCarga({ opId: oportunidadeId, dado, hoje: hojeAgora() });
  }

  const reunioes = estado?.dado.reunioes ?? [];
  const conectado = estado?.dado.conectado ?? false;
  const gravacaoDe = estado?.dado.gravacaoDe ?? {};
  const doContato = estado?.dado.doContato ?? [];

  return (
    <Secao
      titulo="Reuniões"
      contagem={reunioes.length}
      acao={
        conectado && !aberto ? (
          <AcaoSecao
            Icone={Plus}
            onClick={() => {
              setAviso(null);
              setAberto(true);
            }}
          >
            Marcar
          </AcaoSecao>
        ) : null
      }
    >
      {!estado ? (
        <Carregando />
      ) : !conectado && reunioes.length === 0 && doContato.length === 0 ? (
        <Vazio>
          Conecte o Google Calendar em{" "}
          <Link href="/integracoes" className="font-medium text-zinc-600 underline underline-offset-2 dark:text-zinc-300">
            Integrações
          </Link>{" "}
          para marcar reuniões daqui.
        </Vazio>
      ) : (
        <div className="flex flex-col gap-2">
          {reunioes.length === 0 && !aberto && <Vazio>Nenhuma reunião marcada pelo CRM</Vazio>}

          {reunioes.length > 0 && (
            <ul className="flex flex-col">
              {reunioes.map((r) => {
                const autor = r.autorId ? (usuarioPorId.get(r.autorId)?.nome ?? "equipe") : null;
                const selo = seloDaReuniao(r, estado.hoje);
                const futura = !r.passou && !r.cancelada;
                const gravacao = gravacaoDe[r.id];
                return (
                  <li key={r.id} className={LINHA_FIXA}>
                    <IconeLinha
                      Icone={r.cancelada ? CalendarX2 : r.passou ? CalendarCheck2 : CalendarClock}
                      tom={futura ? "ativo" : "neutro"}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`flex items-center gap-1.5 text-[13px] font-medium text-zinc-900 dark:text-zinc-50 ${
                          r.cancelada ? "line-through decoration-zinc-400" : ""
                        }`}
                      >
                        <span className="truncate">{diaDaReuniao(r.inicio)}</span>
                        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{hora(r.inicio)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                        {selo && <Selo tom={selo.tom}>{selo.texto}</Selo>}
                        <span className="truncate">marcada {autor ? `por ${autor}` : "pela IA"}</span>
                      </span>
                    </span>
                    {gravacao && <BotaoAssistir gravacao={gravacao} aoAbrir={setVisor} />}
                    {r.meet && futura && !gravacao && (
                      <>
                        <BotaoCopiar texto={r.meet} rotulo="link do Meet" />
                        <a
                          href={r.meet}
                          target="_blank"
                          rel="noreferrer"
                          className={`${BOTAO_SECUNDARIO} ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800`}
                        >
                          <Video className="size-3.5" aria-hidden="true" />
                          Entrar
                        </a>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {doContato.length > 0 && (
            <div className={reunioes.length > 0 || aberto ? "mt-2" : ""}>
              <p className="mb-1 text-[11.5px] font-medium text-zinc-500 dark:text-zinc-400">
                Gravações do Meet com este nome · {doContato.length}
              </p>
              <ul className="flex flex-col">
                {doContato.map((g) => (
                  <li key={g.id} className={LINHA_FIXA}>
                    <IconeLinha Icone={g.videoId ? Video : FileText} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{tituloDaGravacao(g)}</span>
                      <span className="block truncate text-[11.5px] tabular-nums text-zinc-500 dark:text-zinc-400">
                        {quandoDaGravacao(g)}
                      </span>
                    </span>
                    <BotaoAssistir gravacao={g} aoAbrir={setVisor} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conectado && aberto && (
            <FormMarcar
              oportunidadeId={oportunidadeId}
              aoCancelar={() => setAberto(false)}
              aoMarcar={async (texto) => {
                setAberto(false);
                setAviso({ ok: true, texto });
                await recarregar();
              }}
            />
          )}

          {aviso && (
            <p role="status" className={`text-[11.5px] ${aviso.ok ? "text-zinc-500 dark:text-zinc-400" : "text-red-500"}`}>
              {aviso.texto}
            </p>
          )}
        </div>
      )}
      {visor && <VisorGravacao gravacao={visor} aoFechar={() => setVisor(null)} />}
    </Secao>
  );
}

/** "Assistir" quando há vídeo; "Resumo" quando o Meet só deixou as anotações. */
function BotaoAssistir({ gravacao, aoAbrir }: { gravacao: Gravacao; aoAbrir: (g: Gravacao) => void }) {
  return (
    <button
      type="button"
      onClick={() => aoAbrir(gravacao)}
      className={`${BOTAO_SECUNDARIO} shrink-0 ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800`}
      title={gravacao.videoId ? "Ver a gravação e o resumo do Gemini" : "Ver o resumo do Gemini"}
    >
      {gravacao.videoId ? <Play className="size-3.5 fill-current" aria-hidden="true" /> : <FileText className="size-3.5" aria-hidden="true" />}
      {gravacao.videoId ? "Assistir" : "Resumo"}
    </button>
  );
}

function FormMarcar({
  oportunidadeId,
  aoCancelar,
  aoMarcar,
}: {
  oportunidadeId: string;
  aoCancelar: () => void;
  aoMarcar: (mensagem: string) => Promise<void>;
}) {
  const [data, setData] = useState("");
  const [horaEscolhida, setHora] = useState("");
  const [duracao, setDuracao] = useState(60);
  const [livres, setLivres] = useState<SugestaoHorario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcando, marcar] = useTransition();

  // Os próximos horários livres (mesma regra da IA) viram atalhos: um clique
  // preenche data e hora. Qualquer outro horário continua valendo nos campos.
  useEffect(() => {
    let vivo = true;
    sugestoesDeHorario()
      .then((r) => vivo && setLivres(r.ok ? r.horarios.slice(0, 6) : []))
      .catch(() => vivo && setLivres([]));
    return () => {
      vivo = false;
    };
  }, []);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    marcar(async () => {
      const r = await marcarReuniaoDaOportunidade(oportunidadeId, data, horaEscolhida, duracao);
      if (r.ok) await aoMarcar(r.mensagem);
      else setErro(r.mensagem);
    });
  }

  return (
    <form
      onSubmit={enviar}
      className="surge flex flex-col gap-3 rounded-xl bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-900/60 dark:ring-zinc-800"
    >
      <p className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
        Nova reunião <span className="font-normal text-zinc-400">· horário de Brasília, com Meet</span>
      </p>

      {livres === null ? (
        <p className="text-[11.5px] text-zinc-400">Buscando horários livres…</p>
      ) : livres.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {livres.map((l) => {
            const ativo = l.data === data && l.hora === horaEscolhida;
            return (
              <button
                key={l.rotulo}
                type="button"
                onClick={() => {
                  setData(l.data);
                  setHora(l.hora);
                }}
                aria-pressed={ativo}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition ${
                  ativo
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:ring-zinc-300 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:ring-zinc-700"
                }`}
              >
                {l.rotulo}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex gap-2">
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} required aria-label="Data" className={`${CAMPO} flex-1`} />
        <input
          type="time"
          value={horaEscolhida}
          onChange={(e) => setHora(e.target.value)}
          required
          step={900}
          aria-label="Hora"
          className={`${CAMPO} w-[5.5rem]`}
        />
        <select
          value={duracao}
          onChange={(e) => setDuracao(Number(e.target.value))}
          aria-label="Duração"
          className={`${CAMPO} w-[5.5rem]`}
        >
          {DURACOES.map((d) => (
            <option key={d.min} value={d.min}>
              {d.rotulo}
            </option>
          ))}
        </select>
      </div>

      {erro && <p className="text-[11.5px] text-red-500">{erro}</p>}

      <div className="flex justify-end gap-1">
        <button type="button" onClick={aoCancelar} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
        <button type="submit" disabled={marcando || !data || !horaEscolhida} className={BOTAO_PRIMARIO}>
          {marcando ? "Marcando…" : "Marcar no Google"}
        </button>
      </div>
    </form>
  );
}
