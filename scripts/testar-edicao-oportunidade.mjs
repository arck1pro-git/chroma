// Funções reais e banco DEV; autenticação simulada e cenário inteiro desfeito.
// node --env-file=.env scripts/testar-edicao-oportunidade.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import ts from "typescript";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
assert.ok(process.env.DATABASE_URL, "DATABASE_URL deve apontar para o DEV");
assert.notEqual(process.env.DATABASE_URL, process.env.DATABASE_URL_PROD, "não executar na produção");
assert.notEqual(process.env.VERCEL_ENV, "production");
const jiti = createJiti(import.meta.url);
const { sql, listaUuid } = await jiti.import("../lib/db.ts");
let banco;
let usuario;
const revalidacoes = [];
const cache = new Map();
function carregar(arquivo) {
  const p = path.resolve(raiz, arquivo);
  if (cache.has(p)) return cache.get(p).exports;
  const modulo = { exports: {} };
  cache.set(p, modulo);
  const codigo = ts.transpileModule(fs.readFileSync(p, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const importar = (nome) => {
    if (nome === "server-only") return {};
    if (nome === "next/cache") return { revalidatePath: (p) => revalidacoes.push(p) };
    if (nome === "@/lib/db") return { sql: banco, listaUuid };
    if (nome === "@/lib/auth/dal") return { exigirModulo: async (chave, operacao) => {
      assert.equal(chave, "inicio");
      assert.equal(operacao, undefined, "a edição própria não exige a operação geral");
      const escopo = usuario.modulos.get(chave);
      if (!escopo) throw new Error("sem módulo");
      return { usuario, escopo };
    } };
    if (nome.startsWith("@/")) return carregar(`${nome.slice(2)}.ts`);
    if (nome.startsWith(".")) return carregar(path.relative(raiz, path.resolve(path.dirname(p), `${nome}.ts`)));
    return require(nome);
  };
  new Function("require", "module", "exports", codigo)(importar, modulo, modulo.exports);
  return modulo.exports;
}

const rollback = new Error("desfazer cenário");
let verificacoes = 0;
try {
  await sql.begin(async (tx) => {
    banco = tx;
    const [dono, colega] = await tx`
      INSERT INTO usuarios (nome, iniciais)
      VALUES ('[teste edição responsável] dono', 'TD'), ('[teste edição responsável] colega', 'TC')
      RETURNING id`;
    const contatos = await tx`
      INSERT INTO contatos (nome) VALUES ('[teste edição responsável] A'), ('[teste edição responsável] B') RETURNING id`;
    const [funil] = await tx`INSERT INTO funis (nome) VALUES ('[teste edição responsável]') RETURNING id`;
    const [etapa] = await tx`INSERT INTO etapas (nome, funil_id, ordem) VALUES ('Teste', ${funil.id}, 1) RETURNING id`;
    const oportunidades = [];
    for (const [i, pessoa] of [dono, colega].entries()) {
      const [op] = await tx`
        INSERT INTO oportunidades (nome, contato_id, valor, responsavel_id, funil_id, etapa_id)
        VALUES ('Original', ${contatos[i].id}, 10, ${pessoa.id}, ${funil.id}, ${etapa.id}) RETURNING id`;
      oportunidades.push(op.id);
    }
    const [propria, outra] = oportunidades;
    const entrar = (pessoa, escopo, editar) => {
      usuario = { id: pessoa.id, modulos: new Map([["inicio", escopo]]), permissoes: { inicio: { criar: false, editar, excluir: false } } };
    };
    const { editarOportunidade } = carregar("app/funil/acoes-edicao.ts");
    const { oportunidadesNoEscopo } = carregar("lib/auth/escopo-oportunidades.ts");

    entrar(dono, "proprio", false);
    assert.deepEqual(await editarOportunidade(propria, { nome: "  Novo nome  ", valor: 123.45, responsavel_id: colega.id }), { ok: true, nome: "Novo nome", valor: 123.45 });
    let [salva] = await tx`SELECT nome, valor::float8 AS valor, responsavel_id FROM oportunidades WHERE id = ${propria}`;
    assert.equal(salva.nome, "Novo nome"); assert.equal(salva.valor, 123.45); assert.equal(salva.responsavel_id, dono.id);
    let [historia] = await tx`SELECT count(*)::int AS total FROM historico WHERE oportunidade_id = ${propria} AND autor_id = ${dono.id}`;
    assert.equal(historia.total, 1);
    await editarOportunidade(propria, { nome: "Novo nome", valor: 123.45 });
    [historia] = await tx`SELECT count(*)::int AS total FROM historico WHERE oportunidade_id = ${propria}`;
    assert.equal(historia.total, 1, "salvar sem mudanças não duplica histórico");
    verificacoes++;

    entrar(dono, "todos", false);
    assert.equal((await editarOportunidade(propria, { nome: "Sem valor", valor: 0 })).ok, true);
    assert.equal((await editarOportunidade(outra, { nome: "Proibido", valor: 1 })).ok, false);
    assert.deepEqual((await oportunidadesNoEscopo(oportunidades, "editar")).ids, [propria]);
    assert.deepEqual((await oportunidadesNoEscopo(oportunidades)).ids, oportunidades, "leitura de todos continua válida");
    verificacoes++;

    entrar(dono, "todos", true);
    assert.equal((await editarOportunidade(outra, { nome: "Edição permitida", valor: 55.50 })).ok, true);
    assert.deepEqual((await oportunidadesNoEscopo(oportunidades, "editar")).ids, oportunidades);
    entrar(dono, "proprio", true);
    assert.equal((await editarOportunidade(outra, { nome: "Proibido pelo escopo", valor: 1 })).ok, false);
    assert.deepEqual((await oportunidadesNoEscopo(oportunidades, "editar")).ids, [propria]);
    verificacoes++;

    for (const dados of [{ nome: " ", valor: 1 }, { nome: "x".repeat(201), valor: 1 }, { nome: "Teste", valor: -1 }, { nome: "Teste", valor: NaN }, { nome: "Teste", valor: Infinity }, { nome: "Teste", valor: 1e12 }, { nome: "Teste", valor: 1.005 }, { nome: "Teste", valor: "10" }]) {
      assert.equal((await editarOportunidade(propria, dados)).ok, false);
    }
    assert.equal((await editarOportunidade("inválido", { nome: "Teste", valor: 1 })).ok, false);
    verificacoes++;

    entrar(dono, "todos", false);
    await tx`UPDATE oportunidades SET responsavel_id = ${colega.id} WHERE id = ${propria}`;
    assert.equal((await editarOportunidade(propria, { nome: "Responsável antigo", valor: 1 })).ok, false);
    entrar(colega, "proprio", false);
    assert.equal((await editarOportunidade(propria, { nome: "Novo responsável", valor: 77.25 })).ok, true);
    usuario.modulos.clear();
    await assert.rejects(editarOportunidade(propria, { nome: "Sem módulo", valor: 1 }), /sem módulo/);
    verificacoes++;
    assert.ok(revalidacoes.includes("/") && revalidacoes.includes("/contatos"));
    throw rollback;
  });
} catch (e) {
  if (e !== rollback) throw e;
} finally {
  await sql.end();
}
console.log(`OK: ${verificacoes} grupos de verificações (responsável, permissão, escopo, histórico, validação e transferência); cenário desfeito no DEV.`);
