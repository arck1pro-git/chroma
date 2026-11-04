// A folha do Financeiro (lib/financeiro-tipos.ts e lib/financeiro-pagamentos.ts).
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-folha.ts
//
// A conta do profissional (por hora, fixo, deslocamento, sem cadastro,
// adicional e descontos, centavos), os valores do mês (a foto ou o padrão), as
// recusas da validação e, contra o banco DEV: a foto do mês (o mês lançado não
// muda quando o padrão muda; salvar um mês passado não mexe no padrão; salvar
// o mês corrente mexe), a linha da folha (não toca em setor, atividade nem
// lançamentos) e a IA (papel chroma_ia) sem leitura das tabelas. As linhas de
// teste levam a marca "seed-folha-" e saem no fim.
import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import { carregarFolha, conferirFicha, conferirLinha, salvarFicha, salvarLinha } from "@/lib/financeiro-pagamentos";
import { contaDoMes, reais, SEM_LANCAMENTO, valoresDoMes, type CadastroPagamento } from "@/lib/financeiro-tipos";
import { Recusa } from "@/lib/resultado-acao";

const MARCA = "seed-folha-";
let passos = 0;
const passo = (t: string) => {
  passos++;
  console.log(`ok   ${t}`);
};

// ── A conta ───────────────────────────────────────────────────────────────────
const porHora = { tipo: "hora" as const, valorHora: 25, valorMes: 3000, taxaDeslocamento: null };
assert.deepEqual(contaDoMes(porHora, 160 * 60, 18), { base: 4000, deslocamento: 0, adicional: 0, descontos: 0, total: 4000 });
passo("por hora: 160 h × R$ 25 = R$ 4.000; sem taxa, sem deslocamento; o valor mês guardado não entra");
assert.deepEqual(contaDoMes({ ...porHora, taxaDeslocamento: 22.5 }, 160 * 60, 18), { base: 4000, deslocamento: 405, adicional: 0, descontos: 0, total: 4405 });
passo("deslocamento: 18 dias presenciais × R$ 22,50 = R$ 405, somado ao total");
assert.deepEqual(contaDoMes({ ...porHora, tipo: "fixo" }, 10 * 60, 0, { adicional: 300, descontos: 150 }), { base: 3000, deslocamento: 0, adicional: 300, descontos: 150, total: 3150 });
passo("fixo: o valor mês, trabalhe quanto trabalhar, + adicional − descontos");
assert.equal(contaDoMes(porHora, 100, 0).total, 41.67);
passo("1h40 × R$ 25 = R$ 41,67 (centavos arredondados)");
assert.deepEqual(contaDoMes(null, 600, 5, { adicional: 50, descontos: 0 }), { base: null, deslocamento: 0, adicional: 50, descontos: 0, total: null });
assert.equal(contaDoMes({ tipo: "hora", valorHora: null, valorMes: 2000, taxaDeslocamento: 10 }, 600, 5).total, null);
passo("sem cadastro, ou por hora sem valor hora, não tem total (fica fora das somas)");
assert.equal(reais(1234.5).replace(/\s/g, " "), "R$ 1.234,50");
passo("reais com centavos e milhar");

const cadastro: CadastroPagamento = { pessoaId: "x", setor: null, atividade: null, pix: null, tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: 10 };
const foto = { tipo: "fixo" as const, valorHora: null, valorMes: 2800, taxaDeslocamento: null };
assert.deepEqual(valoresDoMes(cadastro, { adicional: 0, descontos: 0, valores: foto }), foto);
assert.deepEqual(valoresDoMes(cadastro, SEM_LANCAMENTO), { tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: 10 });
assert.equal(valoresDoMes(null, SEM_LANCAMENTO), null);
passo("valores do mês: a foto do mês quando há; o padrão do cadastro quando o mês não foi lançado");

// ── A validação ───────────────────────────────────────────────────────────────
const recusa = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    assert.ok(e instanceof Recusa, `esperava Recusa, veio ${e}`);
    return e.message;
  }
};
const base = { pessoaId: "x", tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: null, setor: "Marketing", atividade: "Edição", pix: "a@b.com", adicional: null, descontos: null };
assert.match(String(recusa(() => conferirLinha({ ...base, tipo: "mensal" }))), /por hora ou fixo/);
assert.match(String(recusa(() => conferirLinha({ ...base, valorHora: null }))), /precisa do valor hora/);
assert.match(String(recusa(() => conferirLinha({ ...base, tipo: "fixo" }))), /precisa do valor mês/);
assert.match(String(recusa(() => conferirLinha({ ...base, valorHora: -1 }))), /Valor hora inválido/);
assert.match(String(recusa(() => conferirLinha({ ...base, taxaDeslocamento: "10" }))), /Taxa de deslocamento inválido/);
assert.match(String(recusa(() => conferirFicha({ ...base, descontos: 2_000_000 }))), /Descontos inválido/);
assert.match(String(recusa(() => conferirFicha({ ...base, setor: "x".repeat(81) }))), /Setor: no máximo 80/);
assert.match(String(recusa(() => conferirLinha({ ...base, pessoaId: "" }))), /Colaborador inválido/);
const limpo = conferirFicha({ ...base, setor: "  Marketing \u0007", pix: "", adicional: 120.456 });
assert.equal(limpo.setor, "Marketing");
assert.equal(limpo.pix, null);
assert.deepEqual([limpo.adicional, limpo.descontos], [120.46, 0]);
passo("recusas com a frase para ler, texto aparado e sem controle, PIX vazio vira null, adicional vazio vira zero");

// ── O banco DEV ───────────────────────────────────────────────────────────────
async function noBanco() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  const id = `${MARCA}${Date.now()}`;
  try {
    // Outubro lançado pela ficha (mês passado; a pessoa não tinha cadastro e nasce com estes valores).
    await salvarFicha("2026-10", conferirFicha({ ...base, pessoaId: id, taxaDeslocamento: 20, adicional: 200, descontos: 50 }), false);
    let out = (await carregarFolha("2026-10"))!;
    assert.deepEqual(out.lancamentos.get(id), { adicional: 200, descontos: 50, valores: { tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: 20 } });
    assert.equal(out.cadastros.get(id)?.valorHora, 25, "quem não tinha cadastro nasce com os valores salvos");
    passo("outubro lançado pela ficha: foto do mês com valores e taxa, adicional e descontos; o cadastro nasce com eles");

    // Novembro (mês corrente) pela linha: muda o padrão e grava a foto de novembro.
    await salvarLinha("2026-11", conferirLinha({ ...base, pessoaId: id, tipo: "fixo", valorMes: 3500, taxaDeslocamento: 20, pix: "chave-nova" }), true);
    out = (await carregarFolha("2026-10"))!;
    const nov = (await carregarFolha("2026-11"))!;
    assert.equal(out.cadastros.get(id)?.tipo, "fixo", "salvar o mês corrente muda o padrão");
    assert.deepEqual(valoresDoMes(out.cadastros.get(id), out.lancamentos.get(id)), { tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: 20 }, "outubro segue com os valores dele");
    assert.deepEqual(nov.lancamentos.get(id), { adicional: 0, descontos: 0, valores: { tipo: "fixo", valorHora: 25, valorMes: 3500, taxaDeslocamento: 20 } });
    assert.deepEqual([out.cadastros.get(id)?.setor, out.cadastros.get(id)?.atividade, out.cadastros.get(id)?.pix], ["Marketing", "Edição", "chave-nova"], "a linha troca o PIX e não toca em setor nem atividade");
    passo("novembro pela linha: muda o padrão e grava a foto de novembro; outubro, já lançado, não muda");

    // Corrigir outubro (mês passado) não mexe no padrão; setembro, nunca lançado, segue o padrão.
    await salvarLinha("2026-10", conferirLinha({ ...base, pessoaId: id, valorHora: 27, taxaDeslocamento: 20, pix: "chave-nova" }), false);
    out = (await carregarFolha("2026-10"))!;
    assert.equal(out.lancamentos.get(id)?.valores?.valorHora, 27, "a foto de outubro foi corrigida");
    assert.deepEqual(out.lancamentos.get(id) && [out.lancamentos.get(id)!.adicional, out.lancamentos.get(id)!.descontos], [200, 50], "a linha não mexe nos lançamentos");
    assert.equal(out.cadastros.get(id)?.tipo, "fixo", "corrigir um mês passado não mexe no padrão");
    const set = (await carregarFolha("2026-09"))!;
    assert.equal(set.lancamentos.has(id), false);
    assert.deepEqual(valoresDoMes(set.cadastros.get(id), set.lancamentos.get(id))?.tipo, "fixo", "mês nunca lançado segue o padrão");
    passo("corrigir outubro grava só a foto de outubro; o padrão fica; setembro, nunca lançado, segue o padrão");

    const ia = await sql`SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'chroma_ia' AND table_name LIKE 'financeiro_%'`;
    assert.equal(ia.length, 0, "a IA não tem permissão nas tabelas da folha");
    passo("a IA das telas (chroma_ia) não lê as tabelas da folha");
  } finally {
    await sql`DELETE FROM financeiro_lancamentos WHERE pessoa_id LIKE ${MARCA + "%"}`;
    await sql`DELETE FROM financeiro_colaboradores WHERE pessoa_id LIKE ${MARCA + "%"}`;
  }
}

noBanco()
  .then(() => console.log(`\nOK: ${passos} conferências`))
  .catch((e) => {
    console.error("FALHOU:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
    process.exit();
  });
