import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function ambiente(campos = [], confirmar = true) {
  let atuais = campos;
  const chamadas = [];
  const exports = {};
  const deps = {
    "server-only": {},
    "@/lib/meta": {
      ErroMeta: Error,
      requisicao: async (alvo, opcoes) => {
        chamadas.push({ alvo, ...opcoes });
        assert.equal(alvo, "100/subscribed_apps", "só a conta Instagram, nunca a página");
        if (opcoes.method === "POST") {
          if (confirmar) atuais = opcoes.params.subscribed_fields.split(",");
          return { success: true };
        }
        return { data: atuais.length ? [{ app_id: "app", subscribed_fields: atuais }] : [] };
      },
    },
    "@/lib/meta-leads": {}, "@/lib/link-do-crm": { ENDERECO_DO_CRM: "https://exemplo.invalid" },
    "@/lib/social/perfis": { PERFIS: [{ instagramId: "100", paginaId: "200" }] },
    "@/lib/social/meta-publicar": {},
  };
  const codigo = ts.transpileModule(fs.readFileSync("lib/instagram-inscricao.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(codigo, { exports, require: (n) => deps[n] ?? assert.fail(`dependência inesperada: ${n}`) });
  return { ...exports, chamadas };
}

test("conta sem inscrição recebe comments e messages, com leitura de confirmação", async () => {
  const a = ambiente();
  assert.equal(await a.inscreverContaInstagram("100", "app", "token-falso"), true);
  assert.equal(a.chamadas.length, 3);
  assert.equal(a.chamadas[1].params.subscribed_fields, "messages,comments");
});
test("preserva campos anteriores e é idempotente", async () => {
  const a = ambiente(["mentions", "comments"]);
  await a.inscreverContaInstagram("100", "app", "token-falso");
  assert.equal(a.chamadas[1].params.subscribed_fields, "mentions,comments,messages");
  assert.equal(await a.inscreverContaInstagram("100", "app", "token-falso"), false);
  assert.equal(a.chamadas.filter((x) => x.method === "POST").length, 1);
});
test("não declara ativação sem confirmação e recusa conta arbitrária", async () => {
  const a = ambiente([], false);
  await assert.rejects(a.inscreverContaInstagram("100", "app", "token-falso"), /não confirmou/);
  await assert.rejects(a.inscreverContaInstagram("999", "app", "token-falso"), /inválida/);
});
