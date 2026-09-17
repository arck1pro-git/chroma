import { carregarUsuarios } from "../dados";
import { UsuariosSection } from "../secoes/usuarios";
import { exigirModulo } from "@/lib/auth/dal";

export default async function UsuariosPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("configuracoes");
  const usuarios = await carregarUsuarios();
  return <UsuariosSection usuarios={usuarios} />;
}
