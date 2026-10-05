// node scripts/testar-cadencia-responsavel.mjs
// Executa os módulos reais com banco, autenticação e WhatsApp simulados.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function carregar(arquivo, mocks = {}, cache = new Map()) {
  const caminho = [arquivo, `${arquivo}.ts`, `${arquivo}/index.ts`].find((p) => existsSync(p) && /\.ts$/.test(p));
  if (!caminho) throw new Error(`Módulo não encontrado: ${arquivo}`);
  if (cache.has(caminho)) return cache.get(caminho).exports;
  const modulo = { exports: {} };
  cache.set(caminho, modulo);
  const codigo = ts.transpileModule(readFileSync(caminho, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const importar = (nome) => {
    if (Object.hasOwn(mocks, nome)) return mocks[nome];
    if (nome.startsWith("@/")) return carregar(resolve(raiz, nome.slice(2)), mocks, cache);
    if (nome.startsWith(".")) return carregar(resolve(dirname(caminho), nome), mocks, cache);
    return require(nome);
  };
  new Function("require", "module", "exports", codigo)(importar, modulo, modulo.exports);
  return modulo.exports;
}

const { lerCadencia, escreverCadencia } = carregar(resolve(raiz, "lib/automacoes/cadencia.ts"));
const { compilar } = carregar(resolve(raiz, "lib/automacoes/compilador/index.ts"));
const { paraWorkflow } = carregar(resolve(raiz, "lib/automacoes/motores/n8n/adaptador.ts"));
const usuarioId = "11111111-1111-4111-8111-111111111111";
const execucaoId = "22222222-2222-4222-8222-222222222222";
const instanciaId = "33333333-3333-4333-8333-333333333333";
const cred = {
  banco: "banco", crmBaseUrl: "https://crm.example", crmCredencialId: "crm",
  porInstancia: new Map([[instanciaId, { numero: "5547999999999", baseUrl: "https://wpp.example", credencialId: "wpp" }]]),
};
for (const canal of ["whatsapp", "ligacao"]) {
  const coluna = {
    id: "msg1", ordem: 1, nome: "Mensagem", mensagem: "Olá", canal,
    dia: 0, minutos: 0, acoes: [], instanciaId: "responsavel",
    documentoId: canal === "whatsapp" ? instanciaId : null, usuarioId,
  };
  const definicao = { ...escreverCadencia([coluna]), layout: {} };
  assert.equal(lerCadencia(definicao).subetapas[0].instanciaId, "responsavel");
  const plano = compilar(definicao, { fluxoId: "fluxo", nome: "Cadência", webhookCaminho: "teste" });
  const workflow = paraWorkflow(plano, cred);
  const envio = workflow.nodes.find((n) => n.id === "msg1");
  assert.match(envio.parameters.jsonBody, /"pelo_responsavel":true/);
  assert.match(envio.parameters.jsonBody, /execucao_id/);
  assert.doesNotMatch(envio.parameters.jsonBody, /numero_origem/);
  assert.throws(() => paraWorkflow(plano, { banco: "banco" }), /endereço público/);
  coluna.instanciaId = instanciaId;
  coluna.documentoId = null;
  const fixo = compilar({ ...escreverCadencia([coluna]), layout: {} }, { fluxoId: "fluxo", nome: "Teste", webhookCaminho: "teste" });
  assert.match(paraWorkflow(fixo, cred).nodes.find((n) => n.id === "msg1").parameters.jsonBody, /"numero_origem":"5547999999999"/);
  assert.throws(() => paraWorkflow(fixo, { ...cred, porInstancia: new Map() }), /número/);
}

let linha = {
  oportunidade_id: "oportunidade", usuario_id: usuarioId, responsavel: "Ana",
  id: instanciaId, nome: "WhatsApp Ana", base_url: "https://wpp.example", token: "teste", numero: "5547999999999",
};
const envios = [];
let autorizada = true;
let consultasFixas = 0;
const { POST } = carregar(resolve(raiz, "app/api/automacoes/enviar/route.ts"), {
  "@/lib/automacoes/servico": { autorizado: () => autorizada, naoAutorizado: () => Response.json({}, { status: 401 }) },
  "@/lib/db": { sql: async (partes, ...valores) => {
    if (partes.join("").includes("fluxo_execucoes")) {
      assert.deepEqual(valores, [execucaoId]);
      return linha ? [linha] : [];
    }
    return [{ nome: "Pessoa avisada", whatsapp: "5547888888888" }];
  } },
  "@/lib/uazapi": {
    enviarTexto: async (...args) => { envios.push(args); return { messageid: "texto" }; },
    enviarMidia: async (...args) => { envios.push(args); return { messageid: "arquivo" }; },
    instanciaExataPorNumero: async () => { consultasFixas++; return { nome: "Fixa", numero: "5547777777777" }; },
  },
  "@/lib/documentos": { paraEnvio: async () => ({ base64: "arquivo", tipo: "documento", arquivoNome: "teste.pdf", mime: "application/pdf" }) },
});
const payload = { pelo_responsavel: true, execucao_id: execucaoId, para: "5547666666666", texto: "Olá" };
const enviar = (corpo = payload) => POST({ json: async () => corpo });
assert.equal((await enviar()).status, 200);
assert.equal(envios.at(-1).at(-1).nome, "WhatsApp Ana");
linha = { ...linha, responsavel: "Bia", nome: "WhatsApp Bia", token: "novo", numero: "5547555555555" };
assert.equal((await enviar()).status, 200);
assert.equal(envios.at(-1).at(-1).token, "novo", "reconsulta o vínculo no próximo envio");
assert.equal((await enviar({ ...payload, documento_id: instanciaId })).status, 200);
assert.equal(envios.at(-1).at(-1).nome, "WhatsApp Bia");
assert.equal((await enviar({ ...payload, usuario_id: usuarioId })).status, 200);
assert.equal(envios.at(-1)[0], "5547888888888", "destinatário do aviso permanece separado do remetente");
assert.equal(consultasFixas, 0);
for (const [alteracao, mensagem] of [
  [{ oportunidade_id: null }, /oportunidade válida/],
  [{ usuario_id: null }, /sem responsável/],
  [{ id: null }, /sem instância/],
  [{ numero: null }, /não foi pareado/],
]) {
  const anterior = linha;
  linha = { ...linha, ...alteracao };
  const antes = envios.length;
  const resposta = await enviar({ ...payload, numero_origem: "5547777777777" });
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, mensagem);
  assert.equal(envios.length, antes);
  assert.equal(consultasFixas, 0, "não cai no número fixo se faltar responsável/vínculo");
  linha = anterior;
}
linha = null;
assert.equal((await enviar()).status, 400);
assert.equal((await enviar({ ...payload, execucao_id: "inválido" })).status, 400);
assert.equal((await enviar({ para: payload.para, texto: "Olá" })).status, 400);
assert.equal((await enviar({ para: payload.para, texto: "Olá", numero_origem: "5547777777777" })).status, 200);
assert.equal(consultasFixas, 1);
autorizada = false;
assert.equal((await enviar()).status, 401);

let chamadasExternas = 0;
let vinculado = null;
let existeUsuario = true;
let emTransacao = false;
const sql = async (partes, ...valores) => {
  const query = partes.join("");
  if (query.includes("INSERT INTO instancias_uazapi")) {
    assert.ok(emTransacao);
    return [{ id: instanciaId }];
  }
  if (query.includes("UPDATE usuarios SET instancia_id")) {
    assert.ok(emTransacao);
    vinculado = valores;
    return [{ id: usuarioId }];
  }
  return existeUsuario ? [{ id: usuarioId }] : [];
};
sql.begin = async (fn) => { emTransacao = true; try { return await fn(sql); } finally { emTransacao = false; } };
const acoes = carregar(resolve(raiz, "app/configuracoes/actions.ts"), {
  "@/lib/auth/dal": { exigirModulo: async () => {} },
  "next/cache": { revalidatePath: () => {} },
  "next/headers": { headers: async () => new Headers() },
  "@/lib/endereco": { enderecoDoCrm: () => ({ publico: false, host: "localhost" }) },
  "@/lib/db": { sql },
});
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async () => { chamadasExternas++; return Response.json({ instance: { id: "uazapi", token: "teste" } }); };
process.env.UAZAPI_BASE_URL = "https://wpp.example";
process.env.UAZAPI_ADMIN_TOKEN = "teste";
try {
  await assert.rejects(acoes.criarInstanciaNaUazapi("Comercial", ""), /Selecione o usuário/);
  existeUsuario = false;
  await assert.rejects(acoes.criarInstanciaNaUazapi("Comercial", usuarioId), /não existe/);
  assert.equal(chamadasExternas, 0, "valida usuário antes de criar na uazapi");
  existeUsuario = true;
  assert.equal((await acoes.criarInstanciaNaUazapi("Comercial", usuarioId)).id, instanciaId);
  assert.deepEqual(vinculado, [instanciaId, usuarioId]);
} finally {
  globalThis.fetch = fetchOriginal;
}
console.log("OK: cadência, publicação, envio dinâmico, anexos, avisos, falhas sem fallback e cadastro vinculado.");
