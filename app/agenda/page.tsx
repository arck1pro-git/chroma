import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { exigirModulo } from "@/lib/auth/dal";
import { conexaoGoogle, GoogleDesconectado } from "@/lib/google-oauth";
import { agendasDaConta, eventosDasAgendas, reunioesDoSistema } from "@/lib/agenda";
import Agenda from "./agenda";
import { diaDe, janelaDa, meiaNoite, VISOES, type Visao } from "./tempo";

export const metadata: Metadata = {
  title: "Agenda · Chroma",
};

// A Agenda: o servidor lê do Google os eventos da janela que a tela mostra
// (dia, semana, mês ou lista) e do banco o que o CRM sabe das reuniões que
// marcou; a tela (./agenda.tsx) desenha e cuida do painel.
//
// SÓ LEITURA, no Google e no banco: abrir a Agenda não cria, muda nem apaga
// nada — nem o vínculo das reuniões (quem corrige data remarcada é a ficha e a
// IA, em lib/agenda.ts).

type Busca = {
  visao?: string | string[];
  data?: string | string[];
  agenda?: string | string[];
  evento?: string | string[];
};

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ehData = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** As reuniões do CRM que a lateral lista: as próximas e as dos últimos 30 dias. */
const desdeTrintaDias = () => new Date(Date.now() - 30 * 24 * 3600_000);

async function carregar(visao: Visao, data: string, pedidas: string[] | null) {
  const conexao = await conexaoGoogle();
  if (!conexao) return { tipo: "sem-conexao" as const };
  try {
    const { agendas, podeListar } = await agendasDaConta();
    // Só ids que a conta tem: um link velho com agenda que saiu não vira erro.
    const selecionadas =
      pedidas === null
        ? agendas.filter((a) => a.marcadaNoGoogle).map((a) => a.id)
        : agendas.filter((a) => pedidas.includes(a.id)).map((a) => a.id);

    const { de, ate } = janelaDa(visao, data);
    const [{ eventos, falhas }, agendados] = await Promise.all([
      eventosDasAgendas(meiaNoite(de), meiaNoite(ate), selecionadas),
      reunioesDoSistema({ desde: desdeTrintaDias(), limite: 100 }),
    ]);
    const sistemaDosEventos = await reunioesDoSistema({ eventoIds: eventos.map((e) => e.id) });
    const nomeDe = new Map(agendas.map((a) => [a.id, a.nome]));

    return {
      tipo: "ok" as const,
      conta: conexao.contaEmail,
      agendas,
      podeListar,
      selecionadas,
      eventos,
      falhas: falhas.map((id) => nomeDe.get(id) ?? id),
      agendados,
      sistemaDosEventos,
    };
  } catch (e) {
    console.error("[agenda] não carregou:", e);
    const motivo = e instanceof Error ? e.message : String(e);
    return e instanceof GoogleDesconectado ? { tipo: "caiu" as const, motivo } : { tipo: "erro" as const, motivo };
  }
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Busca> }) {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação (guia de autenticação do Next, "Layouts and
  // auth checks"). Aqui ela roda antes de qualquer consulta.
  const { usuario } = await exigirModulo("agenda");

  const busca = await searchParams;
  const hoje = diaDe(new Date());
  const pedidaVisao = um(busca.visao);
  const visao: Visao = VISOES.includes(pedidaVisao as Visao) ? (pedidaVisao as Visao) : "semana";
  const pedidaData = um(busca.data);
  const data = ehData(pedidaData) ? pedidaData : hoje;
  // undefined = sem escolha (padrão do Google); "" = escolheu nenhuma.
  const pedidas =
    busca.agenda === undefined ? null : (Array.isArray(busca.agenda) ? busca.agenda : [busca.agenda]).filter(Boolean);

  const carga = await carregar(visao, data, pedidas);

  if (carga.tipo !== "ok") {
    return <SemAgenda carga={carga} podeConectar={usuario.modulos.has("integracoes")} />;
  }

  return (
    <Agenda
      visao={visao}
      data={data}
      hoje={hoje}
      conta={carga.conta}
      agendas={carga.agendas}
      selecionadas={carga.selecionadas}
      escolhaNaUrl={pedidas !== null}
      podeListar={carga.podeListar}
      falhas={carga.falhas}
      eventos={carga.eventos}
      sistemaDosEventos={carga.sistemaDosEventos}
      agendados={carga.agendados}
      eventoInicial={um(busca.evento) ?? null}
    />
  );
}

function SemAgenda({
  carga,
  podeConectar,
}: {
  carga: { tipo: "sem-conexao" } | { tipo: "caiu" | "erro"; motivo: string };
  podeConectar: boolean;
}) {
  const titulo =
    carga.tipo === "sem-conexao"
      ? "Nenhuma agenda conectada"
      : carga.tipo === "caiu"
        ? "A conexão com o Google caiu"
        : "Não deu para ler a agenda agora";
  const texto =
    carga.tipo === "sem-conexao"
      ? "A Agenda mostra o Google Calendar da equipe comercial. Conecte a conta em Integrações."
      : carga.motivo;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-conteudo px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        <CalendarDays className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{titulo}</h1>
      <p className="mt-1.5 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{texto}</p>
      {carga.tipo !== "erro" &&
        (podeConectar ? (
          <Link
            href="/integracoes"
            className="mt-5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Ir para Integrações
          </Link>
        ) : (
          <p className="mt-5 text-[12px] text-zinc-400">Peça a quem cuida das Integrações para conectar.</p>
        ))}
    </div>
  );
}
