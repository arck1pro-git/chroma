import type { Metadata } from "next";
import { listarContextos } from "@/lib/contextos";
import PainelContextos from "./painel";

export const metadata: Metadata = {
  title: "Contextos · Chroma",
};

export const dynamic = "force-dynamic";

export default async function ContextosPage() {
  const contextos = await listarContextos();
  return <PainelContextos contextos={contextos} />;
}
