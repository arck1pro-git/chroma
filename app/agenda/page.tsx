import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import ModuloEmBreve from "../components/modulo-em-breve";
import { exigirModulo } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Agenda · Chroma",
};

// Módulo VAZIO de propósito, e isso não é um esboço esquecido: a Agenda entrou
// junto com os departamentos porque é um dos três que o Comercial recebe, e o
// acesso dela precisava existir antes do conteúdo. A rota e a permissão estão
// de pé; o que a tela mostra é o próximo capítulo.
//
// Quando o conteúdo chegar, o único arquivo que muda é este — a linha de
// permissão abaixo continua valendo, e /configuracoes/acessos já sabe listar o
// módulo.
export default async function AgendaPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  await exigirModulo("agenda");

  return (
    <ModuloEmBreve
      Icone={CalendarDays}
      titulo="Agenda"
      descricao="Os compromissos do time — reuniões, calls e visitas, ligadas ao contato e à oportunidade."
    />
  );
}
