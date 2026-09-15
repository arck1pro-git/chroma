import { carregarCampos } from "../dados";
import { CamposSection } from "../secoes/campos";

export default async function CamposPage() {
  const campos = await carregarCampos();
  return <CamposSection campos={campos} />;
}
