// A folha do Financeiro (lib/financeiro-tipos.ts e lib/financeiro-pagamentos.ts).
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-folha.ts
//
// A conta do profissional (por hora, fixo, sem cadastro, adicional e
// descontos, centavos), as recusas da validação e, contra o banco DEV, gravar
// e ler o cadastro e o lançamento do mês (o lançamento é por mês: mexer em um
// não muda o outro), a gravação pela linha da folha (só tipo, valores e PIX) e
// conferir que a IA (papel chroma_ia) não lê as tabelas.
// As linhas de teste levam a marca "seed-folha-" e saem no fim.
import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import { carregarFolha, conferirFolha, conferirPagamento, salvarFolha, salvarPagamento } from "@/lib/financeiro-pagamentos";
import { contaDoMes, reais } from "@/lib/financeiro-tipos";
import { Recusa } from "@/lib/resultado-acao";

const MARCA = "seed-folha-";
let passos = 0;
const passo = (t: string) => {
  passos++;
  console.log(`ok   ${t}`);
};

// ── A conta ───────────────────────────────────────────────────────────────────
const porHora = { tipo: "hora" as const, valorHora: 25, valorMes: 3000 };
assert.deepEqual(contaDoMes(porHora, 160 * 60), { base: 4000, adicional: 0, descontos: 0, total: 4000 });
passo("por hora: 160 h × R$ 25 = R$ 4.000, e o valor mês guardado não entra");
assert.deepEqual(contaDoMes({ ...porHora, tipo: "fixo" }, 10 * 60, { adicional: 300, descontos: 150 }), { base: 3000, adicional: 300, descontos: 150, total: 3150 });
passo("fixo: o valor mês, trabalhe quanto trabalhar, + adicional − descontos");
assert.equal(contaDoMes(porHora, 100, { adicional: 0, descontos: 0 }).total, 41.67);
passo("1h40 × R$ 25 = R$ 41,67 (centavos arredondados)");
assert.deepEqual(contaDoMes(null, 600, { adicional: 50, descontos: 0 }), { base: null, adicional: 50, descontos: 0, total: null });
passo("sem cadastro não tem total (fica fora das somas)");
assert.equal(contaDoMes({ tipo: "hora", valorHora: null, valorMes: 2000 }, 600).total, null);
passo("por hora sem valor hora não tem total");
assert.equal(reais(1234.5).replace(/\s/g, " "), "R$ 1.234,50");
passo("reais com centavos e milhar");

// ── A validação ───────────────────────────────────────────────────────────────
const recusa = (dados: Record<string, unknown>) => {
  try {
    conferirFolha(dados);
    return null;
  } catch (e) {
    assert.ok(e instanceof Recusa, `esperava Recusa, veio ${e}`);
    return e.message;
  }
};
const base = { pessoaId: "x", tipo: "hora", valorHora: 25, valorMes: null, setor: "Marketing", atividade: "Edição", pix: "a@b.com", adicional: null, descontos: null };
assert.match(String(recusa({ ...base, tipo: "mensal" })), /por hora ou fixo/);
assert.match(String(recusa({ ...base, valorHora: null })), /precisa do valor hora/);
assert.match(String(recusa({ ...base, tipo: "fixo" })), /precisa do valor mês/);
assert.match(String(recusa({ ...base, valorHora: -1 })), /Valor hora inválido/);
assert.match(String(recusa({ ...base, valorHora: "25" })), /Valor hora inválido/);
assert.match(String(recusa({ ...base, descontos: 2_000_000 })), /Descontos inválido/);
assert.match(String(recusa({ ...base, setor: "x".repeat(81) })), /Setor: no máximo 80/);
assert.match(String(recusa({ ...base, pessoaId: "" })), /Colaborador inválido/);
const limpo = conferirFolha({ ...base, setor: "  Marketing \u0007", pix: "", adicional: 120.456 });
assert.equal(limpo.cadastro.setor, "Marketing");
assert.equal(limpo.cadastro.pix, null);
assert.deepEqual(limpo.lancamento, { adicional: 120.46, descontos: 0 });
passo("recusas com a frase para ler, texto aparado e sem controle, PIX vazio vira null, adicional vazio vira zero");

// ── O banco DEV ───────────────────────────────────────────────────────────────
async function noBanco() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  const id = `${MARCA}${Date.now()}`;
  try {
    const { cadastro, lancamento } = conferirFolha({ ...base, pessoaId: id, adicional: 200, descontos: 50 });
    assert.equal(await salvarFolha(cadastro, "2026-10", lancamento), true);
    let f = (await carregarFolha("2026-10"))!;
    assert.deepEqual(f.cadastros.get(id), cadastro);
    assert.deepEqual(f.lancamentos.get(id), { adicional: 200, descontos: 50 });
    passo("grava e lê o cadastro e o lançamento de outubro (numeric volta como número)");

    const novembro = conferirFolha({ ...base, pessoaId: id, tipo: "fixo", valorMes: 3500, descontos: 80 });
    await salvarFolha(novembro.cadastro, "2026-11", novembro.lancamento);
    f = (await carregarFolha("2026-10"))!;
    assert.equal(f.cadastros.get(id)?.tipo, "fixo", "o cadastro vale para todos os meses");
    assert.deepEqual(f.lancamentos.get(id), { adicional: 200, descontos: 50 }, "outubro continua com o lançamento dele");
    assert.deepEqual((await carregarFolha("2026-11"))!.lancamentos.get(id), { adicional: 0, descontos: 80 });
    assert.equal((await carregarFolha("2026-09"))!.lancamentos.has(id), false, "mês sem lançamento não tem linha (é zero)");
    passo("o cadastro troca para todos os meses; o lançamento de novembro não mexe no de outubro");

    // A linha da folha grava só tipo, valores e PIX: setor, atividade e lançamentos ficam.
    assert.equal(await salvarPagamento(conferirPagamento({ pessoaId: id, tipo: "hora", valorHora: 42.5, valorMes: null, pix: "chave-nova" })), true);
    f = (await carregarFolha("2026-10"))!;
    const depois = f.cadastros.get(id)!;
    assert.deepEqual([depois.tipo, depois.valorHora, depois.valorMes, depois.pix], ["hora", 42.5, null, "chave-nova"]);
    assert.deepEqual([depois.setor, depois.atividade], ["Marketing", "Edição"], "setor e atividade não mudam pela linha");
    assert.deepEqual(f.lancamentos.get(id), { adicional: 200, descontos: 50 }, "o lançamento do mês não muda pela linha");
    const novo = `${MARCA}novo-${Date.now()}`;
    assert.equal(await salvarPagamento(conferirPagamento({ pessoaId: novo, tipo: "fixo", valorHora: null, valorMes: 2800, pix: "" })), true);
    assert.deepEqual((await carregarFolha("2026-10"))!.cadastros.get(novo), { pessoaId: novo, setor: null, atividade: null, tipo: "fixo", valorHora: null, valorMes: 2800, pix: null });
    passo("pela linha da folha: troca tipo, valores e PIX sem tocar em setor, atividade e lançamentos; quem não tinha cadastro nasce sem setor");

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
