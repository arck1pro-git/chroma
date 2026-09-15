import { carregarTags } from "../dados";
import { SecaoTags } from "../secoes/nomes";

export default async function TagsPage() {
  const tags = await carregarTags();
  return <SecaoTags itens={tags} />;
}
