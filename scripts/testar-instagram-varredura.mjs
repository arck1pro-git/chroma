import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function ambiente({ ocupado = false, lento = false } = {}) {
  const avaliados = [], midias = [], fila = new Set();
  let inseriu = false, relogio = 1000000;
  const sql = async (partes, ...valores) => {
    const q = partes.join('?');
    if (q.includes('SELECT conta_id')) return [{ conta_id: '100', midia_id: 'antiga-configurada' }];
    if (q.includes('SELECT id FROM instagram_comentarios')) {
      assert.match(q, /NOT da_conta AND pai_id IS NULL/);
      assert.match(q, /interval '10 minutes'/);
      return [...fila].map((id) => ({ id }));
    }
    if (q.includes('WHERE id =')) { fila.delete(valores[0]); return []; }
    if (q.includes('UPDATE instagram_comentarios')) return [];
    assert.fail(q);
  };
  sql.begin = (f) => f(async () => [{ obtida: !ocupado }]);
  const exports = {};
  const deps = {
    'server-only': {}, '@/lib/db': { sql }, '@/lib/social/perfis': { PERFIS: [{ instagramId: '100' }] },
    '@/lib/instagram': { motivoDoErro: String, postagensDaConta: async () => [{ id: 'recente', comentarios: 2, produto: 'FEED' }] },
    '@/lib/ia/comentarios': { responderComentarioComIa: async (id) => { avaliados.push(id); if (lento) relogio += 190000; } },
    '@/lib/instagram-comentarios': { sincronizarComentarios: async (conta, midia, automatico, produto) => {
      assert.equal(automatico, true);
      midias.push({ conta, midia, produto });
      if (inseriu) return { novos: 0 };
      inseriu = true; fila.add('primeiro'); fila.add('segundo'); return { novos: 2 };
    } },
  };
  const codigo = ts.transpileModule(fs.readFileSync('lib/instagram-varredura.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(codigo, { exports, Date: { now: () => relogio }, Set, Map, console,
    require: (n) => deps[n] ?? assert.fail(`sem mock: ${n}`) });
  return { ...exports, avaliados, midias, fila };
}
test('importa comentários e avalia a fila uma vez, com tipo de publicação confirmado', async () => {
  const a = ambiente();
  const r = await a.varrerComentariosInstagram();
  assert.equal(r.novos, 2);
  assert.deepEqual(a.avaliados, ['primeiro', 'segundo']);
  assert.equal(a.midias[0].midia, 'antiga-configurada');
  assert.equal(a.midias[1].produto, 'FEED');
  await a.varrerComentariosInstagram();
  assert.equal(a.avaliados.length, 2);
});
test('esgotar orçamento preserva candidatos para a rodada seguinte', async () => {
  const a = ambiente({ lento: true });
  assert.equal((await a.varrerComentariosInstagram()).avaliados, 1);
  assert.equal(a.fila.has('segundo'), true);
  assert.equal((await a.varrerComentariosInstagram()).avaliados, 1);
  assert.deepEqual(a.avaliados, ['primeiro', 'segundo']);
});
test('outra rodada em andamento não consulta a Meta nem executa ação', async () => {
  const a = ambiente({ ocupado: true });
  assert.equal((await a.varrerComentariosInstagram()).ocupado, true);
  assert.equal(a.midias.length, 0);
});
