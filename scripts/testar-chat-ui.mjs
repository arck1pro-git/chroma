// Renderiza a interface real com a demonstração, sem navegador, banco ou rede.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cache = new Map();
let chamadas = 0;
function carregar(arquivo) {
  const base = path.resolve(raiz, arquivo);
  const p = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!p) throw new Error(`Módulo não encontrado: ${arquivo}`);
  if (p.endsWith(".json")) return require(p);
  if (cache.has(p)) return cache.get(p).exports;
  const fonte = fs.readFileSync(p, "utf8");
  const modulo = { exports: {} };
  cache.set(p, modulo);
  const ast = ts.createSourceFile(p, fonte, ts.ScriptTarget.Latest, true, p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (ast.statements[0]?.getText(ast) === '"use server";') {
    for (const n of ast.statements) {
      if (ts.isFunctionDeclaration(n) && n.name && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        modulo.exports[n.name.text] = async () => { chamadas++; throw new Error("A demonstração não deve executar ações"); };
      }
    }
    return modulo.exports;
  }
  const codigo = ts.transpileModule(fonte, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const importar = (nome) => {
    if (nome === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/chat" };
    if (nome === "next/link") return { __esModule: true, default: ({ href, children, scroll, prefetch, ...props }) => {
      void scroll; void prefetch;
      return React.createElement("a", { href, ...props }, children);
    } };
    if (nome === "server-only") throw new Error(`Componente importou servidor: ${p}`);
    if (nome.startsWith("@/")) return carregar(nome.slice(2));
    if (nome.startsWith(".")) return carregar(path.relative(raiz, path.resolve(path.dirname(p), nome)));
    return require(nome);
  };
  new Function("require", "module", "exports", codigo)(importar, modulo, modulo.exports);
  return modulo.exports;
}

const { carregarChatDemo } = carregar("app/chat/demo.ts");
const Chat = carregar("app/chat/chat.tsx").default;
const usuarioId = "demo-operador";
const permissoes = { criar: true, editar: true };
const demo = (opcoes = {}) => carregarChatDemo({ canal: "", atendimentoId: null, usuarioId, ...opcoes });

test("demonstração preserva WhatsApp e adiciona as contas Instagram", () => {
  const dados = demo();
  assert.ok(dados.canais.some((c) => c.tipo === "web"));
  assert.equal(dados.canais.filter((c) => c.tipo === "instagram").length, 3);
  assert.ok(dados.conversas.some((c) => c.canal === "instagram"));
  const html = renderToStaticMarkup(React.createElement(Chat, { dados, usuarioId, permissoes }));
  assert.match(html, /Demonstração com dados fictícios/);
});

test("comentários e direct do mesmo autor são navegáveis na demonstração", () => {
  const conta = demo().canais.find((c) => c.tipo === "instagram").chave;
  const inicial = demo({ canal: conta, aba: "comentarios" });
  const postagemId = inicial.instagram.postagens[0].id;
  const dados = demo({ canal: conta, aba: "comentarios", postagemId });
  const html = renderToStaticMarkup(React.createElement(Chat, { dados, usuarioId, permissoes }));
  assert.match(html, /Comentários/);
  assert.match(html, /Buscar comentários/);
  assert.match(html, /Marina Exemplo|marina/);
  const autor = dados.instagram.comentarios.find((c) => !c.daConta && c.atendimentoId);
  const direct = demo({ canal: conta, atendimentoId: autor.atendimentoId });
  assert.equal(direct.aberta.id, autor.atendimentoId);
  assert.equal(direct.aberta.resumo.canal, "instagram");
  assert.equal(chamadas, 0);
});

test("acesso de leitura mantém o compositor desabilitado", () => {
  const base = demo();
  const conversa = base.conversas.find((c) => c.canal === "instagram");
  const dados = { ...demo({ atendimentoId: conversa.id }), demo: false };
  const html = renderToStaticMarkup(React.createElement(Chat, { dados, usuarioId, permissoes: { criar: false, editar: false } }));
  assert.match(html, /<textarea[^>]*disabled=""[^>]*aria-label="Mensagem"/);
  assert.equal(chamadas, 0);
});

test("texto de comentários é escapado como dado, sem virar HTML", () => {
  const conta = demo().canais.find((c) => c.tipo === "instagram").chave;
  const inicial = demo({ canal: conta, aba: "comentarios" });
  const dados = demo({ canal: conta, aba: "comentarios", postagemId: inicial.instagram.postagens[0].id });
  dados.instagram.comentarios[0].texto = '<img src="x" onerror="alert(1)">';
  const html = renderToStaticMarkup(React.createElement(Chat, { dados, usuarioId, permissoes }));
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src="x"/);
  assert.equal(chamadas, 0);
});
