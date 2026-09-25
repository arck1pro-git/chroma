// Nomes de evento da Meta que uma etapa do funil pode enviar.
//
// Arquivo separado de lib/meta-eventos.ts porque a tela de Configurações
// (client component) precisa da lista e da regra de formato, e aquele arquivo é
// server-only — importá-lo do navegador derrubaria a página.
//
// Só os eventos PADRÃO que fazem sentido para funil de venda. Padrão é o que dá
// para escolher direto como objetivo de otimização da campanha; um nome
// personalizado chega do mesmo jeito, mas só vira objetivo depois de alguém
// criar uma conversão personalizada em cima dele no Gerenciador.
export const EVENTOS_META_PADRAO: ReadonlyArray<{ nome: string; rotulo: string }> = [
  { nome: "Lead", rotulo: "Lead — virou lead" },
  { nome: "Contact", rotulo: "Contact — houve contato" },
  { nome: "Schedule", rotulo: "Schedule — agendou" },
  { nome: "SubmitApplication", rotulo: "SubmitApplication — enviou proposta" },
  { nome: "CompleteRegistration", rotulo: "CompleteRegistration — cadastro completo" },
  { nome: "Purchase", rotulo: "Purchase — fechou (envia o valor)" },
];

// A Meta aceita nome de evento até 50 caracteres. Letra na frente e só letra,
// número e "_" depois: espaço e acento viram um evento que ninguém acha no
// Gerenciador, e "lead" em vez de "Lead" vira um evento DIFERENTE do padrão.
export const NOME_EVENTO_META = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;

export function ehEventoPadrao(nome: string | null | undefined): boolean {
  return EVENTOS_META_PADRAO.some((e) => e.nome === nome);
}
