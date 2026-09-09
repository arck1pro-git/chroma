// Normalização de número BR pro casamento recebido → contato.
//
// O problema real: mandei pra 5547999346074 e o WhatsApp devolveu o chatid como
// 554799346074 — sumiu o "9" depois do DDD. Celular no Brasil ganhou o nono
// dígito, mas o WhatsApp guarda MUITOS JIDs no formato antigo (8 dígitos). Então
// o mesmo contato pode chegar com ou sem esse 9. Pra casar, gero as duas formas
// e comparo pela chave canônica (sempre SEM o 9), que colapsa as duas na mesma.

// Só os dígitos. Tira "+", espaço, "-", "(", ")".
export function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// Chave canônica pra comparação: 55 + DDD + 8 dígitos finais.
// - Aceita com 55 na frente ou sem (assume BR).
// - Se for celular com o nono dígito (55 DDD 9XXXXXXXX = 13 díg), remove o 9.
// - Fora do padrão BR (ex.: número de Portugal), devolve só os dígitos — o que
//   dá pra fazer sem inventar regra de outro país.
export function chaveTelefone(valor: string): string {
  let d = soDigitos(valor);
  // JID do WhatsApp às vezes vem com sufixo (ex.: "554799346074:12") — corta.
  d = d.split(/[^0-9]/)[0];

  // Sem código de país e com cara de número BR (10 ou 11 díg) → prefixa 55.
  if (d.length === 10 || d.length === 11) d = "55" + d;

  // 55 + DDD(2) + 9 + 8 díg = 13: tira o nono dígito pra bater com o formato
  // antigo (12 díg) que o WhatsApp usa no JID.
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") {
    d = d.slice(0, 4) + d.slice(5);
  }
  return d;
}
