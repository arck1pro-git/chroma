// Os status possíveis de uma oportunidade.
//
// MORA AQUI, e não em actions.ts, por uma regra do Next: arquivo com
// "use server" só pode exportar função async — exportar a lista de lá derruba a
// página inteira com "A 'use server' file can only export async functions".
// Como a tela e a action precisam da MESMA lista, ela fica neste módulo neutro,
// que os dois importam.
//
// É também a única garantia que existe: `oportunidades.status` é `text` SEM
// CHECK no banco (schema.sql), então nada impede alguém de gravar "Ganho" ou
// "won" por fora. Fechar isso é um CHECK na tabela.
//
// Feminino porque concorda com "oportunidade" e porque 'aberta' já era assim
// desde o schema — 'ganho'/'perdido' obrigaria a migrar o que já está gravado.
export const STATUS_OPORTUNIDADE = ["aberta", "ganha", "perdida"] as const;

export type StatusOportunidade = (typeof STATUS_OPORTUNIDADE)[number];
