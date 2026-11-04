// A folha do Financeiro (lib/financeiro-tipos.ts e lib/financeiro-pagamentos.ts).
//
//   node --env-file=.env scripts/jiti.mjs scripts/testar-folha.ts
//
// A conta do profissional (por hora, fixo, deslocamento, sem cadastro,
// adicional e descontos, centavos), os valores do mês (a foto ou o padrão), as
// recusas da validação e, contra o banco DEV: a foto do mês (o mês lançado não
// muda quando o padrão muda; salvar um mês passado não mexe no padrão; salvar
// o mês corrente mexe; corrigir o lançamento de um mês passado), a conta do
// AmaanOffice como colaborador (amaanoffice:<id>), o cadastrado à mão
// (manual:<uuid>, com o nome na folha) e a IA (papel
// chroma_ia) sem leitura das tabelas. As linhas de teste levam a marca
// "seed-folha-" e saem no fim.
import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import { carregarFolha, colaboradorExiste, conferirFicha, resolverColaborador, salvarFicha } from "@/lib/financeiro-pagamentos";
import {
  contaDoMes,
  NOVO_MANUAL,
  origemDe,
  PREFIXO_AMAANOFFICE,
  PREFIXO_MANUAL,
  reais,
  SEM_LANCAMENTO,
  TAXA_PRESENCIAL,
  valoresDoMes,
  type CadastroPagamento,
} from "@/lib/financeiro-tipos";
import { ehUuid } from "@/lib/validacao";
import { Recusa } from "@/lib/resultado-acao";

const MARCA = "seed-folha-";
let passos = 0;
const passo = (t: string) => {
  passos++;
  console.log(`ok   ${t}`);
};

// ── A conta ───────────────────────────────────────────────────────────────────
const porHora = { tipo: "hora" as const, valorHora: 25, valorMes: 3000, taxaDeslocamento: 0 };
assert.deepEqual(contaDoMes(porHora, 160 * 60, 18), { base: 4000, deslocamento: 0, adicional: 0, descontos: 0, total: 4000 });
passo("por hora: 160 h × R$ 25 = R$ 4.000; taxa 0, sem deslocamento; o valor mês guardado não entra");
assert.equal(TAXA_PRESENCIAL, 15);
assert.deepEqual(contaDoMes({ ...porHora, taxaDeslocamento: null }, 160 * 60, 18), { base: 4000, deslocamento: 270, adicional: 0, descontos: 0, total: 4270 });
passo("sem taxa gravada vale a regra: 18 dias presenciais × R$ 15 = R$ 270, somado ao total");
assert.deepEqual(contaDoMes({ ...porHora, taxaDeslocamento: 22.5 }, 160 * 60, 18), { base: 4000, deslocamento: 405, adicional: 0, descontos: 0, total: 4405 });
passo("taxa gravada: 18 dias presenciais × R$ 22,50 = R$ 405");
assert.deepEqual(contaDoMes({ ...porHora, tipo: "fixo" }, 10 * 60, 0, { adicional: 300, descontos: 150 }), { base: 3000, deslocamento: 0, adicional: 300, descontos: 150, total: 3150 });
passo("fixo: o valor mês, trabalhe quanto trabalhar, + adicional − descontos");
assert.equal(contaDoMes(porHora, 100, 0).total, 41.67);
passo("1h40 × R$ 25 = R$ 41,67 (centavos arredondados)");
assert.deepEqual(contaDoMes(null, 600, 5, { adicional: 50, descontos: 0 }), { base: null, deslocamento: 0, adicional: 50, descontos: 0, total: null });
assert.equal(contaDoMes({ tipo: "hora", valorHora: null, valorMes: 2000, taxaDeslocamento: 10 }, 600, 5).total, null);
passo("sem cadastro, ou por hora sem valor hora, não tem total (fica fora das somas)");
assert.equal(reais(1234.5).replace(/\s/g, " "), "R$ 1.234,50");
passo("reais com centavos e milhar");

const cadastro: CadastroPagamento = { pessoaId: "x", nome: null, setor: null, atividade: null, pix: null, tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: 10 };
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
assert.match(String(recusa(() => conferirFicha({ ...base, tipo: "mensal" }))), /por hora ou fixo/);
assert.match(String(recusa(() => conferirFicha({ ...base, valorHora: null }))), /precisa do valor hora/);
assert.match(String(recusa(() => conferirFicha({ ...base, tipo: "fixo" }))), /precisa do valor mês/);
assert.match(String(recusa(() => conferirFicha({ ...base, valorHora: -1 }))), /Valor hora inválido/);
assert.match(String(recusa(() => conferirFicha({ ...base, taxaDeslocamento: "10" }))), /Taxa de deslocamento inválido/);
assert.match(String(recusa(() => conferirFicha({ ...base, descontos: 2_000_000 }))), /Descontos inválido/);
assert.match(String(recusa(() => conferirFicha({ ...base, setor: "x".repeat(81) }))), /Setor: no máximo 80/);
assert.match(String(recusa(() => conferirFicha({ ...base, pessoaId: "" }))), /Colaborador inválido/);
assert.match(String(recusa(() => conferirFicha({ ...base, pessoaId: NOVO_MANUAL, nome: "   " }))), /Escreva o nome/);
assert.match(String(recusa(() => conferirFicha({ ...base, pessoaId: NOVO_MANUAL, nome: "x".repeat(121) }))), /Nome: no máximo 120/);
assert.equal(conferirFicha({ ...base, nome: "Quem vem do ponto" }).nome, null, "do ponto, o nome vem de lá: o que a tela mandar não grava");
const limpo = conferirFicha({ ...base, setor: "  Marketing \u0007", pix: "", adicional: 120.456 });
assert.equal(limpo.setor, "Marketing");
assert.equal(limpo.pix, null);
assert.deepEqual([limpo.adicional, limpo.descontos], [120.46, 0]);
assert.equal(limpo.valores.taxaDeslocamento, 15, "taxa vazia grava a da regra, com o número");
assert.equal(conferirFicha({ ...base, taxaDeslocamento: 0 }).valores.taxaDeslocamento, 0, "0 fica 0: não recebe");
passo("recusas com a frase para ler, texto aparado e sem controle, PIX vazio vira null, adicional vazio vira zero, taxa vazia grava R$ 15");

// ── O banco DEV ───────────────────────────────────────────────────────────────
async function noBanco() {
  if ((process.env.DATABASE_URL ?? "").includes("ep-noisy-pond")) throw new Error("RECUSADO: DATABASE_URL aponta para PRODUÇÃO");
  const id = `${MARCA}${Date.now()}`;
  // A conta do AmaanOffice usada no teste (só é apagada a que o teste gravou: escolhida sem cadastro).
  let idConta = "";
  let idManual = "";
  try {
    // Outubro lançado pela ficha (mês passado; a pessoa não tinha cadastro e nasce com estes valores).
    await salvarFicha("2026-10", conferirFicha({ ...base, pessoaId: id, taxaDeslocamento: 20, adicional: 200, descontos: 50 }), false);
    let out = (await carregarFolha("2026-10"))!;
    assert.deepEqual(out.lancamentos.get(id), { adicional: 200, descontos: 50, valores: { tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: 20 } });
    assert.equal(out.cadastros.get(id)?.valorHora, 25, "quem não tinha cadastro nasce com os valores salvos");
    passo("outubro lançado pela ficha: foto do mês com valores e taxa, adicional e descontos; o cadastro nasce com eles");

    // Novembro (mês corrente): muda o padrão e grava a foto de novembro.
    await salvarFicha("2026-11", conferirFicha({ ...base, pessoaId: id, tipo: "fixo", valorMes: 3500, taxaDeslocamento: 20, pix: "chave-nova" }), true);
    out = (await carregarFolha("2026-10"))!;
    const nov = (await carregarFolha("2026-11"))!;
    assert.equal(out.cadastros.get(id)?.tipo, "fixo", "salvar o mês corrente muda o padrão");
    assert.deepEqual(valoresDoMes(out.cadastros.get(id), out.lancamentos.get(id)), { tipo: "hora", valorHora: 25, valorMes: null, taxaDeslocamento: 20 }, "outubro segue com os valores dele");
    assert.deepEqual(nov.lancamentos.get(id), { adicional: 0, descontos: 0, valores: { tipo: "fixo", valorHora: 25, valorMes: 3500, taxaDeslocamento: 20 } });
    assert.deepEqual([out.cadastros.get(id)?.setor, out.cadastros.get(id)?.atividade, out.cadastros.get(id)?.pix], ["Marketing", "Edição", "chave-nova"], "o PIX novo vale para o cadastro");
    passo("novembro (mês corrente): muda o padrão e grava a foto de novembro; outubro, já lançado, não muda");

    // Corrigir outubro (mês passado, já lançado) não mexe no padrão; setembro, nunca lançado, segue o padrão.
    await salvarFicha("2026-10", conferirFicha({ ...base, pessoaId: id, valorHora: 27, taxaDeslocamento: 20, pix: "chave-nova", adicional: 250, descontos: 50 }), false);
    out = (await carregarFolha("2026-10"))!;
    assert.equal(out.lancamentos.get(id)?.valores?.valorHora, 27, "a foto de outubro foi corrigida");
    assert.deepEqual(out.lancamentos.get(id) && [out.lancamentos.get(id)!.adicional, out.lancamentos.get(id)!.descontos], [250, 50], "o adicional de outubro foi corrigido");
    assert.equal(out.cadastros.get(id)?.tipo, "fixo", "corrigir um mês passado não mexe no padrão");
    const set = (await carregarFolha("2026-09"))!;
    assert.equal(set.lancamentos.has(id), false);
    assert.deepEqual(valoresDoMes(set.cadastros.get(id), set.lancamentos.get(id))?.tipo, "fixo", "mês nunca lançado segue o padrão");
    passo("corrigir outubro grava só a foto de outubro; o padrão fica; setembro, nunca lançado, segue o padrão");

    // Conta do AmaanOffice (sem ponto): entra na folha como "amaanoffice:<id>", com o nome da conta.
    const [conta] = await sql`
      SELECT u.id, u.nome FROM usuarios u
       WHERE u.ativo AND NOT EXISTS (SELECT 1 FROM financeiro_colaboradores c WHERE c.pessoa_id = ${PREFIXO_AMAANOFFICE} || u.id::text)
       LIMIT 1`;
    assert.ok(conta, "o DEV precisa de uma conta ativa sem cadastro na folha");
    idConta = `${PREFIXO_AMAANOFFICE}${conta.id}`;
    assert.equal(await colaboradorExiste(idConta), true);
    assert.equal(await colaboradorExiste(`${PREFIXO_AMAANOFFICE}00000000-0000-4000-8000-000000000000`), false);
    assert.equal(await colaboradorExiste(`${PREFIXO_AMAANOFFICE}nao-e-uuid`), false);
    assert.equal(await colaboradorExiste("id-que-nao-existe-no-ponto"), false);
    await salvarFicha("2026-10", conferirFicha({ ...base, pessoaId: idConta, tipo: "fixo", valorMes: 2000 }), false);
    out = (await carregarFolha("2026-10"))!;
    assert.equal(out.cadastros.get(idConta)?.valorMes, 2000);
    assert.equal(out.contas.find((c) => c.id === idConta)?.nome, conta.nome, "o nome vem da conta do AmaanOffice");
    assert.equal(origemDe(idConta), "amaanoffice");
    passo("conta do AmaanOffice: confere que existe, grava como amaanoffice:<id> e o nome vem da conta; id inexistente é recusado");

    // Cadastrado à mão: o servidor sorteia o id, o nome fica na folha e pode ser trocado.
    idManual = (await resolverColaborador(NOVO_MANUAL))!;
    assert.ok(idManual.startsWith(PREFIXO_MANUAL) && ehUuid(idManual.slice(PREFIXO_MANUAL.length)), "id novo = manual:<uuid>");
    assert.notEqual(await resolverColaborador(NOVO_MANUAL), idManual, "cada cadastro novo ganha o seu id");
    assert.equal(await resolverColaborador(idManual), null, "id manual que não está na folha não vale (não se inventa pelo navegador)");
    const nomeManual = `${MARCA}manual Fulano`;
    await salvarFicha("2026-11", conferirFicha({ ...base, pessoaId: idManual, nome: `  ${nomeManual} `, tipo: "fixo", valorMes: 1800 }), true);
    let manual = (await carregarFolha("2026-11"))!.cadastros.get(idManual);
    assert.deepEqual([manual?.nome, manual?.valorMes, manual?.taxaDeslocamento], [nomeManual, 1800, TAXA_PRESENCIAL]);
    assert.equal(origemDe(idManual), "manual");
    assert.equal(await colaboradorExiste(idManual), true);
    assert.equal(await resolverColaborador(idManual), idManual, "depois de gravado, edita-se pelo mesmo id");
    await salvarFicha("2026-11", conferirFicha({ ...base, pessoaId: idManual, nome: `${nomeManual} Silva`, tipo: "fixo", valorMes: 1800 }), true);
    manual = (await carregarFolha("2026-11"))!.cadastros.get(idManual);
    assert.equal(manual?.nome, `${nomeManual} Silva`, "o nome se corrige pela gaveta");
    assert.equal(out.cadastros.get(idConta)?.nome, null, "a conta do AmaanOffice não grava nome: vem da conta");
    passo("cadastrado à mão: id manual:<uuid> sorteado no servidor, nome obrigatório gravado na folha e corrigível; id inventado é recusado");

    const ia = await sql`SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'chroma_ia' AND table_name LIKE 'financeiro_%'`;
    assert.equal(ia.length, 0, "a IA não tem permissão nas tabelas da folha");
    passo("a IA das telas (chroma_ia) não lê as tabelas da folha");
  } finally {
    await sql`DELETE FROM financeiro_lancamentos WHERE pessoa_id LIKE ${MARCA + "%"} OR pessoa_id = ${idConta} OR pessoa_id = ${idManual}`;
    await sql`DELETE FROM financeiro_colaboradores WHERE pessoa_id LIKE ${MARCA + "%"} OR pessoa_id = ${idConta} OR pessoa_id = ${idManual}`;
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
