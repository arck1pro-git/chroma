// Quem tem a IA no MODO COMPLETO (lib/ia/completa.ts) e o painel fixo dela em
// todas as telas (app/components/ia-global.tsx): o departamento que administra
// os acessos — o TI. É a marca `gerencia_acessos` do banco, e não o nome do
// departamento: renomear "TI" não pode desligar isto.
//
// Arquivo à parte, e leve, porque o layout raiz pergunta isto em TODA página:
// importar lib/ia/completa.ts ali puxaria o SDK e todas as ferramentas da IA
// para cada requisição.
import type { UsuarioLogado } from "@/lib/auth/dal";

export function temIaCompleta(usuario: UsuarioLogado): boolean {
  return usuario.departamento?.gerenciaAcessos === true;
}
