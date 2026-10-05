"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Copy, Plus, Video } from "lucide-react";
import type { Usuario } from "../data";
import { dataHora } from "../formato";
import {
  marcarReuniaoDaOportunidade,
  reunioesDaFicha,
  sugestoesDeHorario,
  type ReunioesDaFicha,
  type SugestaoHorario,
} from "./acoes-agenda";

// As reuniões da oportunidade no Google Calendar, e o "Marcar reunião".
// Carregadas ao abrir a ficha, como as automações: é consulta por oportunidade
// (e vai ao Google), e a raiz já carrega a base inteira.

const DURACOES = [
  { min: 30, rotulo: "30 min" },
  { min: 60, rotulo: "1 hora" },
  { min: 90, rotulo: "1h30" },
];

export default function ReunioesDaOportunidade({
  oportunidadeId,
  usuarioPorId,
}: {
  oportunidadeId: string;
  usuarioPorId: Map<string, Usuario>;
}) {
  // A carga guarda de QUAL oportunidade é — mesma razão do `carga` das
  // automações na ficha: a ficha é reaproveitada ao abrir outro card.
  const [carga, setCarga] = useState<{ opId: string; dado: ReunioesDaFicha } | null>(null);
  const estado = carga?.opId === oportunidadeId ? carga.dado : null;
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    reunioesDaFicha(oportunidadeId)
      .then((dado) => vivo && setCarga({ opId: oportunidadeId, dado }))
      .catch(() => vivo && setCarga({ opId: oportunidadeId, dado: { conectado: false, reunioes: [] } }));
    return () => {
      vivo = false;
    };
  }, [oportunidadeId]);

  async function recarregar() {
    setCarga({ opId: oportunidadeId, dado: await reunioesDaFicha(oportunidadeId) });
  }

  if (!estado) return <Vazio>Carregando…</Vazio>;

  if (!estado.conectado && estado.reunioes.length === 0) {
    return (
      <Vazio>
        Conecte o Google Calendar em{" "}
        <Link href="/integracoes" className="underline underline-offset-2">
          Integrações
        </Link>{" "}
        para marcar reuniões daqui.
      </Vazio>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {estado.reunioes.length === 0 && !aberto && <Vazio>Nenhuma reunião marcada</Vazio>}

      {estado.reunioes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {estado.reunioes.map((r) => {
            const passou = r.passou;
            const autor = r.autorId ? (usuarioPorId.get(r.autorId)?.nome ?? "equipe") : "IA";
            return (
              <li
                key={r.id}
                className={`flex items-center gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 ${
                  passou || r.cancelada ? "opacity-60" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50 ${r.cancelada ? "line-through" : ""}`}>
                    {dataHora(r.inicio)}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                    {r.cancelada ? "Cancelada no Google · " : passou ? "Já aconteceu · " : ""}
                    marcada por {autor}
                  </span>
                </span>
                {r.meet && !r.cancelada && !passou && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(r.meet ?? "");
                        setAviso({ ok: true, texto: "Link do Meet copiado." });
                      }}
                      aria-label="Copiar link do Meet"
                      title="Copiar link do Meet"
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </button>
                    <a
                      href={r.meet}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <Video className="size-3.5" aria-hidden="true" />
                      Meet
                    </a>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {estado.conectado &&
        (aberto ? (
          <FormMarcar
            oportunidadeId={oportunidadeId}
            aoCancelar={() => setAberto(false)}
            aoMarcar={async (texto) => {
              setAberto(false);
              setAviso({ ok: true, texto });
              await recarregar();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setAviso(null);
              setAberto(true);
            }}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Marcar reunião
          </button>
        ))}

      {aviso && (
        <p className={`text-[11px] ${aviso.ok ? "text-zinc-500 dark:text-zinc-400" : "text-red-500"}`}>{aviso.texto}</p>
      )}
    </div>
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
  const [hora, setHora] = useState("");
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
      const r = await marcarReuniaoDaOportunidade(oportunidadeId, data, hora, duracao);
      if (r.ok) await aoMarcar(r.mensagem);
      else setErro(r.mensagem);
    });
  }

  const campo =
    "min-w-0 rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-zinc-600";

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2.5 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
        <CalendarClock className="size-3.5" aria-hidden="true" />
        Nova reunião (horário de Brasília, com Meet)
      </p>

      {livres === null ? (
        <p className="text-[11px] text-zinc-400">Buscando horários livres…</p>
      ) : livres.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {livres.map((l) => {
            const ativo = l.data === data && l.hora === hora;
            return (
              <button
                key={l.rotulo}
                type="button"
                onClick={() => {
                  setData(l.data);
                  setHora(l.hora);
                }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  ativo
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                }`}
              >
                {l.rotulo}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          required
          aria-label="Data"
          className={`${campo} flex-1`}
        />
        <input
          type="time"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          required
          step={900}
          aria-label="Hora"
          className={`${campo} w-24`}
        />
        <select
          value={duracao}
          onChange={(e) => setDuracao(Number(e.target.value))}
          aria-label="Duração"
          className={`${campo} w-24`}
        >
          {DURACOES.map((d) => (
            <option key={d.min} value={d.min}>
              {d.rotulo}
            </option>
          ))}
        </select>
      </div>

      {erro && <p className="text-[11px] text-red-500">{erro}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={aoCancelar}
          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={marcando || !data || !hora}
          className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {marcando ? "Marcando…" : "Marcar no Google"}
        </button>
      </div>
    </form>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
      {children}
    </p>
  );
}
