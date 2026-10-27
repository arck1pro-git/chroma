import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function carregar(arquivo, dependencias = {}) {
  const codigo = ts.transpileModule(fs.readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(codigo, {
    exports, Response, Map, Set,
    require: (nome) => {
      if (Object.hasOwn(dependencias, nome)) return dependencias[nome];
      throw new Error(`Dependência sem mock: ${nome}`);
    },
  }, { filename: arquivo });
  return exports;
}

const modulos = carregar("lib/auth/modulos.ts");
const permissoes = carregar("lib/auth/permissoes.ts");
function dal({ slug = "comercial", grants = {}, operacoes = {}, ativo = true, sessao = true } = {}) {
  return carregar("lib/auth/dal.ts", {
    "server-only": {},
    react: { cache: (fn) => fn },
    "next/navigation": { redirect: (url) => { throw new Error(`redirect:${url}`); } },
    "@/lib/db": { sql: async () => ativo ? [{
      id: "pessoa", nome: "Teste", iniciais: "T", email: "teste@example.com",
      departamento_id: "departamento", departamento_slug: slug,
      modulos: grants, permissoes: operacoes,
    }] : [] },
    "./sessao": { lerSessao: async () => sessao ? { usuarioId: "pessoa" } : null },
    "./modulos": modulos,
    "./permissoes": permissoes,
  });
}

test("visualizar não concede nenhuma escrita", async () => {
  const d = dal({ grants: { blog: "todos" } });
  assert.equal((await d.exigirModulo("blog")).escopo, "todos");
  for (const op of permissoes.OPERACOES) {
    await assert.rejects(d.exigirModulo("blog", op), /Sem permissão/);
    const resposta = await d.exigirModuloApi("blog", op);
    assert.equal(resposta.status, 403);
  }
});

test("cada operação é independente, inclusive excluir sem editar", async () => {
  for (const concedida of permissoes.OPERACOES) {
    const d = dal({ grants: { contatos: "proprio" }, operacoes: { contatos: { [concedida]: true } } });
    for (const op of permissoes.OPERACOES) {
      const resposta = await d.exigirModuloApi("contatos", op);
      assert.equal(resposta instanceof Response, op !== concedida);
      if (op === concedida) assert.equal(resposta.escopo, "proprio");
    }
  }
});

test("permissão órfã não abre módulo desligado", async () => {
  const d = dal({ operacoes: { blog: { criar: true, editar: true, excluir: true } } });
  assert.equal((await d.exigirModuloApi("blog", "criar")).status, 403);
});

test("API distingue sessão ausente, usuário desativado e acesso negado", async () => {
  assert.equal((await dal({ sessao: false }).exigirModuloApi("blog", "criar")).status, 401);
  assert.equal((await dal({ ativo: false }).exigirModuloApi("blog", "criar")).status, 401);
  assert.equal((await dal().exigirModuloApi("blog", "criar")).status, 403);
});

test("ação compartilhada aceita só módulo que também concede a operação", async () => {
  const d = dal({ grants: { inicio: "proprio", contatos: "todos" }, operacoes: { contatos: { editar: true } } });
  const acesso = await d.exigirOperacaoEmAlgumModulo("editar", "inicio", "contatos");
  assert.equal(acesso.escopo, "todos");
  await assert.rejects(d.exigirOperacaoEmAlgumModulo("excluir", "inicio", "contatos"), /Sem permissão/);
});

test("somente Admin gerencia usuários; TI e Configurações não concedem esse direito", async () => {
  for (const slug of ["admin", "ti", "comercial", "suporte"]) {
    const d = dal({ slug, grants: { configuracoes: "todos" }, operacoes: { configuracoes: { criar: true, editar: true, excluir: true } } });
    assert.equal(d.gereUsuarios(await d.usuarioAtual()), slug === "admin");
    if (slug === "admin") assert.equal((await d.exigirGestaoDeUsuarios()).id, "pessoa");
    else await assert.rejects(d.exigirGestaoDeUsuarios(), /redirect:/);
  }
});

test("tirar a concessão no banco invalida a operação na próxima chamada", async () => {
  const operacoes = { blog: { editar: true } };
  const d = dal({ grants: { blog: "todos" }, operacoes });
  assert.equal((await d.exigirModulo("blog", "editar")).usuario.id, "pessoa");
  operacoes.blog.editar = false;
  assert.equal((await d.exigirModuloApi("blog", "editar")).status, 403);
});
