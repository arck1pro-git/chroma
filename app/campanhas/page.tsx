import type { Metadata } from "next";
import { exigirModulo } from "@/lib/auth/dal";
import { contasDeAnuncios } from "@/lib/meta";
import { lerOpcoesDaCampanha } from "@/lib/campanhas-opcoes";
import PainelCampanhasMeta from "./painel-meta";

export const metadata: Metadata = { title: "Campanhas · AmaanOffice" };

export const dynamic = "force-dynamic";

export default async function Page() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("campanhas");
  // As contas de anúncio saem daqui, do servidor (guardadas em lib/meta.ts), e
  // não do /api/meta/status do navegador: era ele que a aba de Meta Ads
  // esperava — 4 s consultando WhatsApp e templates — antes de pedir qualquer
  // número. Só o que a tela usa atravessa para o cliente.
  const contas = contasDeAnuncios().then(
    (lista) => ({ lista: lista.map(({ id, name, currency, timezone_name }) => ({ id, name, currency, timezone_name })), erro: null }),
    (e: unknown) => ({ lista: [], erro: e instanceof Error ? e.message : "Não foi possível consultar a Meta." }),
  );
  // As opções dos blocos (tags, segmentos, etapas na ordem do funil, equipe,
  // IAs, números de aviso e as consequências) de um lugar só: a IA do
  // construtor lê o mesmo (lib/campanhas-opcoes.ts).
  const [opcoes, contasAds] = await Promise.all([lerOpcoesDaCampanha(), contas]);
  return <PainelCampanhasMeta opcoes={opcoes} contasAds={contasAds.lista} erroContas={contasAds.erro} />;
}
