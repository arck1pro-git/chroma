// O ponto do módulo Financeiro (lib/ponto.ts e lib/ponto-db.ts).
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-ponto.ts
//
// Sempre: as regras de `calcularDia` (pares entrada → saída, entrada sem saída,
// repetida, saída sem entrada, o dia de hoje). Com PONTO_DATABASE_URL: lê o mês
// corrente e o anterior da base de verdade, confere que o resumo bate com os
// dias e que a conexão recusa escrita (a transação é READ ONLY). Nada é gravado
// na base do ponto.
import assert from "node:assert/strict";
import { calcularDia, carregarPonto, ehMes, hojeNoFuso, mesAtual } from "@/lib/ponto";
import { lerPonto, temBasePonto } from "@/lib/ponto-db";

let passos = 0;
function passo(texto: string) {
  passos++;
  console.log(`ok   ${texto}`);
}

const h = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00-03:00`);
const dia = (...b: Array<[("in" | "out"), string]>) => b.map(([tipo, hora]) => ({ tipo, instante: h(hora) }));

// ── Regras ────────────────────────────────────────────────────────────────────
assert.deepEqual(calcularDia(dia(["in", "08:00"], ["out", "12:00"], ["in", "13:00"], ["out", "18:00"]), false), { minutos: 540, situacao: "completo" });
passo("dois pares somam 9h e o dia fica completo");
assert.deepEqual(calcularDia(dia(["in", "08:00"], ["out", "17:30"]), false), { minutos: 570, situacao: "completo" });
passo("um par só também é dia completo");
assert.deepEqual(calcularDia(dia(["in", "08:00"], ["out", "12:00"], ["in", "13:00"]), false), { minutos: 240, situacao: "falta_saida" });
passo("entrada sem saída num dia passado: conta só o par fechado e fica \"falta saída\"");
assert.deepEqual(calcularDia(dia(["in", "08:00"], ["out", "12:00"], ["in", "13:00"]), true, h("15:30")), { minutos: 390, situacao: "em_andamento" });
passo("entrada sem saída hoje é \"em andamento\" e conta até agora (4h + 2h30)");
assert.deepEqual(calcularDia(dia(["in", "08:00"], ["in", "08:01"], ["out", "12:00"], ["out", "12:01"]), false), { minutos: 240, situacao: "irregular" });
passo("entrada e saída repetidas: vale a primeira de cada, e o dia fica irregular");
assert.deepEqual(calcularDia(dia(["out", "12:00"], ["in", "13:00"], ["out", "18:00"]), false), { minutos: 300, situacao: "irregular" });
passo("saída sem entrada antes não vira hora e deixa o dia irregular");
assert.ok(ehMes("2026-11") && !ehMes("2026-13") && !ehMes("2026-1") && !ehMes("x"));
passo("ehMes só aceita AAAA-MM válido");
const virada = new Date("2026-11-04T02:30:00Z"); // 23h30 de 03/11 em Brasília, 22h30 em Manaus
assert.equal(hojeNoFuso("America/Sao_Paulo", virada), "2026-11-03");
assert.equal(hojeNoFuso("America/Manaus", virada), "2026-11-03");
assert.equal(hojeNoFuso("Fuso/Inexistente", virada), "2026-11-03");
passo("o dia de hoje sai no fuso da pessoa, e fuso inválido cai em Brasília");

// ── A base de verdade ─────────────────────────────────────────────────────────
async function comBase() {
  for (const mes of [mesAtual(), (() => {
    const [a, m] = mesAtual().split("-").map(Number);
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  })()]) {
    const d = await carregarPonto(mes);
    const soma = d.dias.reduce((s, x) => s + x.minutos, 0);
    assert.equal(d.resumos.reduce((s, r) => s + r.minutos, 0), soma, "o total por pessoa bate com a soma dos dias");
    assert.ok(d.dias.every((x) => x.dia.startsWith(mes)), "todo dia é do mês pedido");
    assert.ok(d.pessoas.every((p) => !("senha" in p)), "a senha não sai da base");
    assert.equal(d.porDia.reduce((s, x) => s + x.minutos, 0), soma, "o gráfico por dia soma o mesmo que os dias");
    const doMes = d.porMes.find((m) => m.mes === mes);
    assert.equal(doMes?.minutos ?? 0, soma, "o gráfico por mês tem o mesmo total do mês");
    assert.ok(d.porMes.every((m, i, l) => i === 0 || l[i - 1].mes < m.mes), "os meses do gráfico vêm em ordem");
    assert.ok(d.resumos.every((r) => r.entradaMedia === null || (r.entradaMedia >= 0 && r.entradaMedia < 1440)), "a entrada média é um horário do dia");
    const pend = d.dias.filter((x) => x.situacao !== "completo" && x.situacao !== "em_andamento").length;
    passo(`${mes}: ${d.pessoas.length} cadastros, ${d.resumos.length} com registro, ${d.dias.length} dias, ${Math.round(soma / 60)} h, ${pend} dias com pendência`);
  }
  const escrita = await lerPonto((sql) => sql`CREATE TEMP TABLE teste_somente_leitura (x int)`).then(
    () => null,
    (e: Error) => e.message,
  );
  assert.match(String(escrita), /read-only/i, "a transação recusa escrita");
  passo("a conexão recusa escrita: " + escrita);
}

(temBasePonto() ? comBase() : Promise.resolve(console.log("(sem PONTO_DATABASE_URL: só as regras)")))
  .then(() => console.log(`\nOK: ${passos} conferências`))
  .catch((e) => {
    console.error("FALHOU:", e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
