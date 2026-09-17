import { carregarTags } from "../dados";
import { SecaoTags } from "../secoes/nomes";
import { exigirModulo } from "@/lib/auth/dal";

export default async function TagsPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("configuracoes");
  const tags = await carregarTags();
  return <SecaoTags itens={tags} />;
}
