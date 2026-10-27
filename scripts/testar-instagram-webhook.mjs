// Sem banco, rede ou contas reais: transpila o core e substitui apenas suas dependências.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";

function carregar(arquivo, dependencias) {
  const codigo = ts.transpileModule(fs.readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(codigo, {
    exports, Buffer, setTimeout,
    console: { warn() {}, error() {} },
    require: (nome) => {
      if (Object.hasOwn(dependencias, nome)) return dependencias[nome];
      throw new Error(`Dependência sem mock: ${nome}`);
    },
  }, { filename: arquivo });
  return exports;
}

const segredo = "segredo-apenas-do-teste";
const assinatura = carregar("lib/meta-assinatura.ts", {
  "server-only": {},
  "node:crypto": crypto,
  "@/lib/segredo": carregar("lib/segredo.ts", { "server-only": {}, "node:crypto": crypto }),
});
const conta = "100";
const perfil = { instagramId: conta };
const mensagem = (mid, pessoa = "200") => ({
  sender: { id: pessoa }, recipient: { id: conta },
  timestamp: Date.now(), message: { mid, text: "Olá" },
});
const lote = (messaging, changes = []) => ({
  object: "instagram", entry: [{ id: conta, time: Date.now(), messaging, changes }],
});

function ambiente({ falharComentarios = true } = {}) {
  const gravadas = new Map();
  const comentarios = new Map();
  const candidatos = [];
  const falhas = new Set();
  const contatos = new Set();
  const ia = [];
  const perfis = [];
  const tentativas = [];
  const core = carregar("lib/instagram-webhook.ts", {
    "server-only": {}, zod: { z }, "@/lib/meta-assinatura": assinatura,
    "@/lib/db": { sql: async (partes, ...valores) => {
      const consulta = partes.join("?");
      if (consulta.includes("INSERT INTO mensagens")) {
        const mid = valores[2];
        tentativas.push(mid);
        if (falhas.has(mid)) throw new Error("banco temporariamente indisponível");
        if (gravadas.has(mid)) return [];
        const id = `mensagem-${mid}`;
        gravadas.set(mid, id);
        return [{ id }];
      }
      if (consulta.includes("INSERT INTO instagram_comentarios")) {
        if (falharComentarios) throw new Error("banco temporariamente indisponível");
        const id = valores[3];
        if (comentarios.has(id)) return [];
        comentarios.set(id, valores[7]);
        return [{ id: `comentario-${id}` }];
      }
      throw new Error(`SQL sem mock: ${consulta}`);
    } },
    "@/lib/instagram": {
      COMENTARIO_RECENTE_MS: 60_000,
      ehContaNossa: (id) => id === conta,
      ehIdMeta: (id) => /^\d{1,32}$/.test(id),
      perfilDaConta: (id) => id === conta ? perfil : null,
      hostDeAnexoPermitido: () => false,
      motivoDoErro: (erro) => erro.message,
      usuarioValido: (nome) => nome ?? null,
    },
    "@/lib/instagram-conversa": {
      contatoDoInstagram: async ({ igsid }) => {
        const criado = !contatos.has(igsid);
        contatos.add(igsid);
        return { id: `contato-${igsid}`, criado };
      },
      conversaDoInstagram: async (id) => `atendimento-${id}`,
      atualizarPerfilDoContato: async (id) => { perfis.push(id); },
    },
    "@/lib/midia": { baixarPendentes: async () => {} },
    "@/lib/ia/atendente": {
      responderComIa: async (atendimentoId, mensagemId) => { ia.push({ atendimentoId, mensagemId }); },
      alternarIaPelaPalavra: async () => {},
    },
    "@/lib/ia/comentarios": { responderComentarioComIa: async (id) => { candidatos.push(id); } },
  });
  const receber = async (valor, cabecalho) => {
    const bytes = Buffer.from(typeof valor === "string" ? valor : JSON.stringify(valor));
    const hmac = `sha256=${crypto.createHmac("sha256", segredo).update(bytes).digest("hex")}`;
    return core.receberWebhookInstagram(bytes, cabecalho ?? hmac, segredo);
  };
  return { receber, falhas, gravadas, comentarios, candidatos, ia, perfis, tentativas };
}

test("recebe comentários automaticamente antes de avaliar regras e não duplica na reentrega", async () => {
  const a = ambiente({ falharComentarios: false });
  const payload = lote([], [{ field: "comments", value: {
    id: "300", text: "Quero", from: { id: "200" }, media: { id: "400" },
  } }]);
  payload.entry[0].time = Math.floor(Date.now() / 1000);
  const r = await a.receber(payload);
  assert.equal(r.status, 200);
  assert.equal(a.comentarios.get("300"), "Quero", "persistência independe de regra ligada");
  assert.equal(a.candidatos.length, 0, "ação só depois da persistência");
  await r.depois();
  assert.deepEqual(a.candidatos, ["comentario-300"]);
  const repetido = await a.receber(payload);
  assert.equal(repetido.depois, null);
  assert.equal(a.comentarios.size, 1);
  assert.equal(a.candidatos.length, 1);
});

test("assinatura real válida confirma payloads inválidos e eventos ignoráveis com 200", async () => {
  const a = ambiente();
  for (const payload of ["{", {}, { object: "outro", entry: [] },
    { object: "instagram", entry: [{ id: "999", messaging: [mensagem("alheia")] }] },
    lote([{}, { ...mensagem("apagada"), message: { mid: "apagada", is_deleted: true } }]),
    lote([], [{ field: "likes", value: {} }]),
  ]) {
    const r = await a.receber(payload);
    assert.equal(r.status, 200);
    assert.equal(r.depois, null);
  }
  assert.equal(a.tentativas.length, 0);
  assert.equal((await a.receber(lote([mensagem("x")]), "sha256=incorreta")).status, 401);
});

test("falha de persistência do direct devolve 503", async () => {
  const a = ambiente();
  a.falhas.add("falha");
  assert.equal((await a.receber(lote([mensagem("falha")]))).status, 503);
  assert.equal(a.gravadas.size, 0);
  assert.equal(a.ia.length, 0);
});

test("falha de persistência de comentário devolve 503", async () => {
  const a = ambiente();
  const r = await a.receber(lote([], [{ field: "comments", value: {
    id: "300", text: "Olá", from: { id: "200" }, media: { id: "400" },
  } }]));
  assert.equal(r.status, 503);
});

test("lote parcial preserva after; reentrega responde só ao novo insert", async () => {
  const a = ambiente();
  const payload = lote([mensagem("primeira", "201"), mensagem("segunda", "202")]);
  a.falhas.add("segunda");
  const parcial = await a.receber(payload);
  assert.equal(parcial.status, 503);
  assert.equal(typeof parcial.depois, "function");
  assert.deepEqual([...a.gravadas.keys()], ["primeira"]);
  assert.equal(a.ia.length, 0);
  await parcial.depois();
  assert.deepEqual(a.ia.map((m) => m.mensagemId), ["mensagem-primeira"]);
  assert.deepEqual(a.perfis, ["contato-201", "contato-202"]);

  a.falhas.clear();
  const reentrega = await a.receber(payload);
  assert.equal(reentrega.status, 200);
  assert.equal(typeof reentrega.depois, "function");
  await reentrega.depois();
  assert.deepEqual(a.ia.map((m) => m.mensagemId), ["mensagem-primeira", "mensagem-segunda"]);
  assert.deepEqual(a.tentativas, ["primeira", "segunda", "primeira", "segunda"]);

  const repetido = await a.receber(payload);
  assert.equal(repetido.status, 200);
  assert.equal(repetido.depois, null);
  assert.equal(a.ia.length, 2);
});
