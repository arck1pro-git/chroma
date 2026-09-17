import { redirect } from "next/navigation";
import { exigirLogin, exigirModulo } from "@/lib/auth/dal";

// /configuracoes não tem tela própria: a barra da esquerda sempre tem um item
// marcado, e "nenhum" não é um estado que valha desenhar.
//
// DOIS DESTINOS desde os departamentos, e a ordem importa. Funis continua sendo
// o primeiro para quem tem o módulo — é a entidade que estrutura o resto do CRM.
// Mas quem administra acessos SEM ter o módulo 'configuracoes' (um departamento
// só de portaria, que a tela de Acessos permite criar) cairia num
// redirecionamento para uma seção que ele não abre. Aqui ele vai direto pra
// única coisa que lhe pertence.
export default async function ConfiguracoesPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  const usuario = await exigirLogin();

  if (usuario.modulos.has("configuracoes")) redirect("/configuracoes/funis");
  if (usuario.departamento?.gerenciaAcessos) redirect("/configuracoes/acessos");

  // Nenhuma das duas: cai no guarda do módulo, que manda a pessoa pro primeiro
  // lugar que ela PODE ver. Chamar exigirModulo aqui em vez de repetir a conta
  // do destino mantém essa regra num lugar só (lib/auth/dal.ts).
  await exigirModulo("configuracoes");
  redirect("/configuracoes/funis");
}
