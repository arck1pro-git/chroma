import { carregarDepartamentosDaConta, carregarUsuariosComConta } from "../dados";
import { UsuariosSection } from "../secoes/usuarios";
import { exigirGestaoDeUsuarios } from "@/lib/auth/dal";

export default async function UsuariosPage() {
  // Checagem POR PÁGINA, e não no layout: com Partial Rendering o layout não
  // re-renderiza a cada navegação, então a checagem lá deixaria de rodar
  // justamente quando a pessoa troca de tela (guia de autenticação do Next,
  // "Layouts and auth checks"). Aqui ela roda antes de qualquer consulta.
  //
  // NÃO é exigirModulo("configuracoes") desde 2026-10-07: Admin e TI criam e
  // editam contas sem precisar do resto das Configurações (ver gereUsuarios
  // em lib/auth/dal.ts).
  const eu = await exigirGestaoDeUsuarios();
  const [usuarios, departamentos] = await Promise.all([
    carregarUsuariosComConta(),
    carregarDepartamentosDaConta(),
  ]);
  return (
    <UsuariosSection
      usuarios={usuarios}
      departamentos={departamentos}
      euId={eu.id}
      administraAcessos={eu.departamento?.gerenciaAcessos ?? false}
    />
  );
}
