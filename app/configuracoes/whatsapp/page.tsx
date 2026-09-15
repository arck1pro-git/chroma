import { carregarInstancias } from "../dados";
import { SecaoWhatsApp } from "../secoes/whatsapp";

export default async function WhatsAppPage() {
  const instancias = await carregarInstancias();
  return <SecaoWhatsApp instancias={instancias} />;
}
