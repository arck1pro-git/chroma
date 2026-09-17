import { carregarFunis } from "../dados";
import { SecaoFunis } from "../secoes/funis";
import { exigirModulo } from "@/lib/auth/dal";

export default async function FunisPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("configuracoes");
  const { funis, etapasPorFunil } = await carregarFunis();
  return <SecaoFunis funis={funis} etapasPorFunil={etapasPorFunil} />;
}
