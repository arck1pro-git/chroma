import { carregarAcessos } from "../dados";
import { AcessosSection } from "../secoes/acessos";
import { exigirGerenciaAcessos } from "@/lib/auth/dal";

export default async function AcessosPage() {
  // NÃO é `exigirModulo("configuracoes")`. Se fosse, quem tem Configurações
  // poderia se dar qualquer módulo — inclusive os três que o pedido tirou do
  // Admin. Esta tela pertence a quem administra acessos, e isso é uma coluna
  // própria do departamento (ver migration-departamentos.sql).
  //
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  const usuario = await exigirGerenciaAcessos();
  const dados = await carregarAcessos();

  return (
    <AcessosSection
      dados={dados}
      departamentoIdAtual={usuario.departamento?.id ?? null}
      usuarioIdAtual={usuario.id}
    />
  );
}
