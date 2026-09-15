import { carregarFunis } from "../dados";
import { SecaoFunis } from "../secoes/funis";

export default async function FunisPage() {
  const { funis, etapasPorFunil } = await carregarFunis();
  return <SecaoFunis funis={funis} etapasPorFunil={etapasPorFunil} />;
}
