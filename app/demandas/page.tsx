import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { administraDemandas, listarDemandas, pessoasParaDemanda } from "@/lib/demandas";
import PainelDemandas from "./painel";

export const metadata: Metadata = {
  title: "Demandas · Chroma",
};

export const dynamic = "force-dynamic";

// "Hoje" e "agora" saem do servidor, no fuso de Brasília, e vão prontos para a
// tela: se o navegador calculasse, o SSR (UTC) e o cliente discordariam sobre o
// que está atrasado ou sobre o "há 2 h", e o React acusaria erro de hidratação.
function hojeEmBrasilia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export default async function DemandasPage() {
  const { usuario } = await exigirModulo("demandas");
  const admin = administraDemandas(usuario);

  const eu = {
    id: usuario.id,
    nome: usuario.nome,
    departamentoId: usuario.departamento?.id ?? null,
  };

  const hoje = hojeEmBrasilia();
  const agora = new Date().toISOString();

  let demandas, pessoas;
  try {
    [demandas, pessoas] = await Promise.all([
      listarDemandas(usuario, admin),
      admin ? pessoasParaDemanda() : null,
    ]);
  } catch (e) {
    // 42P01 = undefined_table: migration-demandas.sql ainda não rodou.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01") {
      return <PainelDemandas demandas={[]} pessoas={null} admin={admin} eu={eu} hoje={hoje} agora={agora} faltaMigration />;
    }
    throw e;
  }

  return (
    <PainelDemandas
      demandas={demandas}
      pessoas={pessoas}
      admin={admin}
      eu={eu}
      hoje={hoje}
      agora={agora}
      faltaMigration={false}
    />
  );
}
