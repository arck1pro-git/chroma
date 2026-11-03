import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { carregarInfra, SEM_LEITURA } from "@/lib/infra";
import PainelInfra from "./painel";

export const metadata: Metadata = {
  title: "Infra · AmaanOffice",
};

export const dynamic = "force-dynamic";

// O estado de cada serviço de que o CRM depende (lib/infra.ts), lido a cada
// abertura. Nasce sem ninguém: o TI marca quem vê em Configurações › Acessos.
export default async function InfraPage() {
  await exigirModulo("infra");
  const { cartoes, lidoEm } = await carregarInfra();
  return <PainelInfra cartoes={cartoes} lidoEm={lidoEm} semLeitura={SEM_LEITURA} />;
}
