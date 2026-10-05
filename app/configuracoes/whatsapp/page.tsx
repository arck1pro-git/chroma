import { carregarInstancias, carregarUsuarios } from "../dados";
import { SecaoWhatsApp } from "../secoes/whatsapp";
import { exigirModulo } from "@/lib/auth/dal";

export default async function WhatsAppPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("configuracoes");
  const [instancias, usuarios] = await Promise.all([carregarInstancias(), carregarUsuarios()]);
  return <SecaoWhatsApp instancias={instancias} usuarios={usuarios} />;
}
