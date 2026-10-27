import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function ambiente(existente) {
  const exports = {}, operacoes = [];
  let workflow = existente;
  const deps = {
    'server-only': {},
    '@/lib/campanhas-workflow': { garantirCredencialDoCrm: async () => ({ id: 'credencial-falsa' }) },
    '@/lib/automacoes/motores/n8n/adaptador': {
      acharWorkflowPorNome: async () => workflow ? { id: 'id-falso', active: workflow.active } : null,
      lerWorkflow: async () => workflow,
      criarWorkflow: async (w) => { operacoes.push('criar'); workflow = w; return 'id-falso'; },
      ativarWorkflow: async () => { operacoes.push('ativar'); workflow.active = true; },
      desativarWorkflow: async () => { operacoes.push('desativar'); workflow.active = false; },
      atualizarWorkflow: async (id, w) => { assert.equal(id, 'id-falso'); operacoes.push('atualizar'); workflow = w; },
    },
  };
  const codigo = ts.transpileModule(fs.readFileSync('lib/instagram-varredura-workflow.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(codigo, { exports, require: (n) => deps[n] ?? assert.fail(n) });
  return { ...exports, operacoes };
}
test('cria consulta autenticada a cada dois minutos, sem duplicar ao criar outra regra', async () => {
  const a = ambiente();
  const w = a.montarWorkflowVarreduraInstagram('credencial-falsa');
  assert.equal(w.nodes[0].parameters.rule.interval[0].minutesInterval, 2);
  assert.equal(w.nodes[1].parameters.authentication, 'genericCredentialType');
  assert.equal((await a.garantirVarreduraInstagram()).active, true);
  await a.garantirVarreduraInstagram();
  assert.deepEqual(a.operacoes, ['criar', 'ativar']);
});
test('atualiza somente o agendador reconhecido para o intervalo pedido', async () => {
  const fonte = ambiente();
  const w = fonte.montarWorkflowVarreduraInstagram('credencial-falsa');
  w.nodes[0].parameters.rule.interval[0].minutesInterval = 1;
  w.active = true;
  const a = ambiente(w);
  await a.garantirVarreduraInstagram();
  assert.deepEqual(a.operacoes, ['desativar', 'atualizar', 'ativar']);
});
test('não altera fluxo com destino inesperado', async () => {
  const fonte = ambiente();
  const w = fonte.montarWorkflowVarreduraInstagram('credencial-falsa');
  w.nodes[1].parameters.url = 'https://outro.invalid';
  const a = ambiente(w);
  await assert.rejects(a.garantirVarreduraInstagram(), /destino diferente/);
  assert.equal(a.operacoes.length, 0);
});
