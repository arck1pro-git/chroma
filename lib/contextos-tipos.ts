// Tipos dos Contextos, SEM tocar o banco.
//
// Existe separado de ./contextos.ts por uma razão dura: aquele importa
// lib/db.ts, que importa `postgres`, que importa `net`/`tls`. Um componente de
// cliente que importe de lá arrasta o driver do Postgres para o bundle do
// navegador e o build quebra em "module not found: net".
//
// A regra prática: o que a TELA precisa saber mora aqui; o que fala com o banco
// mora em ./contextos.ts, que reexporta isto para o servidor não precisar
// importar dos dois lugares.
//
// UM CONTEXTO É: nome, descrição e o prompt (`conteudo`). Nada diz onde ele se
// aplica — havia um `escopo` ('analise' | 'conteudo' | 'automacao' |
// 'atendimento') e ele saiu em migration-contextos-sem-escopo.sql: quem sabe se
// um bloco serve para uma tela é a tela, na hora de oferecê-lo. Os outros
// campos são comportamento, não classificação: `ativo` liga/desliga, `ordem`
// posiciona na lista e `versao` é o que torna uma análise reproduzível depois.

export type Contexto = {
  id: string;
  nome: string;
  descricao: string | null;
  conteudo: string;
  ativo: boolean;
  ordem: number;
  versao: number;
  data_atualizacao: string;
};
