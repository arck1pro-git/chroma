import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { correspondeAoComentario, validarAutomacaoComentario, automacaoDoRegistro } = await jiti.import("../lib/instagram-automacao.ts");
const regra = { modo: "mensagem", palavras: ["quero", "apresentação"], mensagemDirect: "Veja https://exemplo.invalid/material", respostaPublica: "", continuarComIa: false };

test("palavras alternativas e expressões ignoram caixa e acento, com limites de palavra", () => {
  assert.equal(correspondeAoComentario("Quero!", regra.palavras), true);
  assert.equal(correspondeAoComentario("APRESENTACAO por favor", regra.palavras), true);
  assert.equal(correspondeAoComentario("quero detalhes agora", ["quero detalhes"]), true);
  assert.equal(correspondeAoComentario("quero outros detalhes", ["quero detalhes"]), false);
  assert.equal(correspondeAoComentario("oi", ["😍"]), false);
  assert.equal(correspondeAoComentario("materialista", ["material"]), false);
  assert.equal(correspondeAoComentario("coisa", ["oi"]), false);
});

test("mensagem pronta exige palavra e texto e preserva link configurado", () => {
  assert.equal(validarAutomacaoComentario(regra).mensagemDirect, regra.mensagemDirect);
  assert.throws(() => validarAutomacaoComentario({ ...regra, palavras: [] }));
  assert.throws(() => validarAutomacaoComentario({ ...regra, palavras: ["!!!"] }));
  assert.throws(() => validarAutomacaoComentario({ ...regra, palavras: Array(31).fill("quero") }));
  assert.throws(() => validarAutomacaoComentario({ ...regra, mensagemDirect: "x".repeat(1001) }));
  assert.throws(() => validarAutomacaoComentario({ ...regra, continuarComIa: "sim" }));
  assert.throws(() => validarAutomacaoComentario(null));
});

test("legado mantém IA e duplicatas normalizadas não criam disparos extras", () => {
  assert.equal(automacaoDoRegistro({}).modo, "ia");
  assert.equal(automacaoDoRegistro({}).continuarComIa, true);
  assert.equal(correspondeAoComentario("interesse", []), true);
  assert.deepEqual(validarAutomacaoComentario({ ...regra, palavras: ["apresentação", "APRESENTACAO"] }).palavras, ["APRESENTACAO"]);
});
