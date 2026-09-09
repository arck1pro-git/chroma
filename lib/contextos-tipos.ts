// Tipos e constantes dos Contextos, SEM tocar o banco.
//
// Existe separado de ./contextos.ts por uma razão dura: aquele importa
// lib/db.ts, que importa `postgres`, que importa `net`/`tls`. Um componente de
// cliente (app/contextos/painel.tsx precisa de ESCOPOS para desenhar as abas)
// que importe de lá arrasta o driver do Postgres para o bundle do navegador e
// o build quebra em "module not found: net".
//
// A regra prática: o que a TELA precisa saber mora aqui; o que fala com o banco
// mora em ./contextos.ts, que reexporta isto para o servidor não precisar
// importar dos dois lugares.

export type EscopoContexto = "analise" | "conteudo" | "automacao" | "atendimento";

export const ESCOPOS: { id: EscopoContexto; rotulo: string; dica: string }[] = [
  { id: "analise", rotulo: "Análise", dica: "Auditar o funil, contatos e conversas" },
  { id: "conteudo", rotulo: "Conteúdo", dica: "Gerar textos a partir dos dados" },
  { id: "automacao", rotulo: "Automação", dica: "Montar fluxos e cadências" },
  { id: "atendimento", rotulo: "Atendimento", dica: "Tom e regras de resposta no chat" },
];

export type Contexto = {
  id: string;
  nome: string;
  descricao: string | null;
  conteudo: string;
  escopo: EscopoContexto;
  ativo: boolean;
  ordem: number;
  versao: number;
  data_atualizacao: string;
};
