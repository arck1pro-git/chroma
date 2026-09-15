import { carregarSegmentos } from "../dados";
import { SecaoSegmentos } from "../secoes/nomes";

export default async function SegmentosPage() {
  const segmentos = await carregarSegmentos();
  return <SecaoSegmentos itens={segmentos} />;
}
