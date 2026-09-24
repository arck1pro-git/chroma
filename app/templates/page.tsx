import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import PainelTemplates from "./painel";

export const metadata: Metadata = { title: "Templates · Chroma" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await exigirModulo("templates");
  return <PainelTemplates />;
}
