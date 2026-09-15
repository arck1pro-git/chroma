import { carregarUsuarios } from "../dados";
import { UsuariosSection } from "../secoes/usuarios";

export default async function UsuariosPage() {
  const usuarios = await carregarUsuarios();
  return <UsuariosSection usuarios={usuarios} />;
}
