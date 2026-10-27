// Regressões do Blog após a retirada do módulo de blocos de prompt.
// Executa os módulos reais com banco, matéria e modelo simulados.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function cenario() {
  const consultas = [];
  const acessos = [];
  const prompts = [];
  const blog = { id: 1, nome: "Blog teste", descricao: "Arquitetura sustentável", autor: "Equipe", url_base: "https://example.com/blog", chave: "teste" };
  const sql = async (partes, ...valores) => {
    const query = partes.map((p, i) => p + (typeof valores[i] === "string" ? valores[i] : "")).join("");
    assert.doesNotMatch(query, /\bcontextos\b|auditoria_id|auditoria_nome/);
    consultas.push(query);
    if (/INSERT INTO blog|UPDATE blog/.test(query)) return [{ id: 1 }];
    if (/FROM blog_rss/.test(query)) return [{ url: "https://example.com/rss" }];
    if (/FROM artigo/.test(query) && !/FROM blog b/.test(query)) return [];
    if (/FROM blog/.test(query)) return [blog];
    throw new Error(`Consulta inesperada: ${query}`);
  };
  sql.unsafe = (v) => v;
  class Modelo {
    static AuthenticationError = class extends Error {};
    messages = {
      stream: (pedido) => {
        prompts.push(pedido.messages[0].content);
        return { finalMessage: async () => ({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ titulo: "Construir melhor", conteudo: "## Arquitetura\nMatéria revisada.", keywords: ["arquitetura"] }) }],
        }) };
      },
    };
  }
  const mocks = {
    "server-only": {},
    "@/lib/db": { sql },
    "@/lib/auth/dal": {
      exigirModuloApi: async (...args) => { acessos.push(args); return { usuario: { id: "operador" } }; },
      exigirLoginApi: async () => ({ id: "operador" }),
    },
    "@anthropic-ai/sdk": { default: Modelo, __esModule: true },
    "@/lib/artigo-materia": { FalhaMateria: class extends Error {}, MENSAGEM_FALHA: {}, lerMateria: async () => ({ texto: "Uma matéria real sobre arquitetura.", url: "https://example.com/materia" }) },
    "@/lib/ia/conversa": {
      SEM_CREDENCIAL: "sem credencial",
      conversar: async (pedido) => Response.json({ sistema: pedido.sistema, pergunta: pedido.pergunta }),
      historicoDe: () => [],
      texto: (v) => typeof v === "string" ? v : "",
    },
    "@/lib/ia/ferramentas": { ferramentasDoUsuario: () => [], REGRAS_DE_ANALISE: "Leia dados autorizados." },
    "@/lib/ia/completa": { temIaCompleta: () => false },
    "@/lib/blog-rss": { pautaDosFeeds: async () => [{ titulo: "Matéria", link: "https://example.com/materia", data: null }] },
  };
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
      if (Object.hasOwn(mocks, nome)) return mocks[nome];
      if (nome.startsWith("@/")) return carregar(`${nome.slice(2)}.ts`);
      if (nome.startsWith(".")) return carregar(path.relative(raiz, path.resolve(path.dirname(p), `${nome}.ts`)));
      return require(nome);
    };
    new Function("require", "module", "exports", codigo)(importar, modulo, modulo.exports);
    return modulo.exports;
  }
  return { carregar, consultas, acessos, prompts };
}

test("cadastro de blog precisa somente de nome e mantém a autorização de criar", async () => {
  const c = cenario();
  const rota = c.carregar("app/api/blogs/route.ts");
  const resposta = await rota.POST(new Request("https://example.com/api/blogs", { method: "POST", body: JSON.stringify({ nome: "Blog teste" }) }));
  assert.equal(resposta.status, 201);
  assert.equal((await resposta.json()).nome, "Blog teste");
  assert.deepEqual(c.acessos, [["blog", "criar"]]);
  assert.ok(c.consultas.some((q) => /INSERT INTO blog/.test(q)));
});

test("editar e listar blogs funcionam sem vínculo de auditoria", async () => {
  const c = cenario();
  const rota = c.carregar("app/api/blogs/[id]/route.ts");
  const resposta = await rota.PUT(new Request("https://example.com/api/blogs/1", { method: "PUT", body: JSON.stringify({ nome: "Blog teste", descricao: "Arquitetura sustentável" }) }), { params: Promise.resolve({ id: "1" }) });
  assert.equal(resposta.status, 200);
  assert.deepEqual(c.acessos, [["blog", "editar"]]);
  const lista = await c.carregar("lib/blog.ts").listarBlogs();
  assert.equal(lista.length, 1);
  const publico = await c.carregar("lib/blog-publico.ts").blogPorChave("teste");
  assert.equal(publico.nome, "Blog teste");
});

test("pauta automática aceita blog com RSS ativo sem auditoria", async () => {
  const c = cenario();
  const pauta = await c.carregar("lib/blog-pauta.ts").pautaDosBlogs({ somenteAtivos: true, limite: 10 });
  assert.equal(pauta[0].itens.length, 1);
  assert.ok(c.consultas.some((q) => /b.rss_ativo/.test(q)));
});

test("geração usa descrição e instruções do editor, sem consultar blocos removidos", async () => {
  const c = cenario();
  const gerador = c.carregar("lib/artigo-geracao.ts");
  const r = await gerador.gerarArtigoDeMateria({ blogId: 1, link: "https://example.com/materia", instrucoes: "Explique para iniciantes." });
  assert.equal(r.artigo.titulo, "Construir melhor");
  assert.match(c.prompts[0], /Arquitetura sustentável/);
  assert.match(c.prompts[0], /Explique para iniciantes/);
  assert.doesNotMatch(c.prompts[0], /AUDITORIA DESTE BLOG/);
});

test("catálogo e rotas não expõem mais o módulo ou sua API auxiliar", () => {
  const c = cenario();
  const catalogo = c.carregar("lib/auth/modulos.ts");
  assert.equal(catalogo.ehChaveModulo("contextos"), false);
  for (const p of ["app/contextos/page.tsx", "app/contextos/actions.ts", "app/api/auditorias/route.ts", "lib/contextos.ts", "lib/contextos-tipos.ts"]) assert.equal(fs.existsSync(path.join(raiz, p)), false, p);
});

test("painel de IA ignora seleções antigas enviadas por uma aba aberta", async () => {
  const c = cenario();
  const rota = c.carregar("app/api/ia/route.ts");
  const resposta = await rota.POST(new Request("https://example.com/api/ia", {
    method: "POST", body: JSON.stringify({ pergunta: "Como está o funil?", contextos: ["antigo"], conversa_id: "antiga" }),
  }));
  assert.equal(resposta.status, 200);
  assert.equal((await resposta.json()).pergunta, "Como está o funil?");
  assert.equal(c.consultas.length, 0, "não tenta ler conteúdo nem registrar vínculo antigo");
});
