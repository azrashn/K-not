/** Real E5/Chroma/SQL, no model calls. Small descriptive A/B/C latency sample.
 * Material-type coverage is NOT annotated semantic retrieval recall. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(out, 'last-run.json'), 'utf8'));
const account = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8')).accounts[0];
const demo = JSON.parse(fs.readFileSync(path.join(out, 'unified-run.json'), 'utf8'));
const base = 'http://127.0.0.1:3100';
async function main() {
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(login.status, 200); const token = (await login.json()).access_token;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const route = `/courses/${demo.course_id}/knowledge`;
  const list = await (await fetch(base + route + '/materials', { headers })).json();
  const pdf = list.materials.find(m => m.kind === 'PDF'); assert.ok(pdf);
  const rows = [];
  for (const strategy of ['single', 'unified', 'aligned']) {
    for (let n = 0; n < 3; n++) {
      let r, start;
      for (let attempt = 0; attempt < 13; attempt++) {
        start = performance.now();
        r = await fetch(base + route + '/search', { method: 'POST', headers, body: JSON.stringify({
          question: 'İntegralde değişken değiştirme yöntemi nasıl kullanılır?', strategy, active_material_id: pdf.id }) });
        if (r.status !== 429 || attempt === 12) break;
        await r.body.cancel(); await new Promise(resolve => setTimeout(resolve, 5000));
      }
      assert.equal(r.status, 200); const body = await r.json(); assert.equal(body.llm_used, false);
      if (process.argv.includes('--assert-warm')) assert.equal(body.indexed_materials, 0);
      rows.push({ strategy, elapsed_ms: +(performance.now() - start).toFixed(2), evidence_count: body.evidence.length,
        kinds: [...new Set(body.evidence.map(e => e.kind))], indexed_materials: body.indexed_materials,
        associations: body.associations.length });
    }
  }
  const summary = ['single', 'unified', 'aligned'].map(strategy => {
    const selected = rows.filter(r => r.strategy === strategy), times = selected.map(r => r.elapsed_ms).sort((a, b) => a - b);
    return { strategy, samples: selected.length, p50_ms: times[1], p95_ms: times[2], kinds: selected[0].kinds };
  });
  const result = { status: 'passed', real_embedder: 'existing configured multilingual-e5-small', generative_model_used: false, summary, rows,
    limitation: 'Three repeats per profile on one small course; no accuracy, faithfulness or annotated recall metric.' };
  fs.writeFileSync(path.join(out, process.argv.includes('--assert-warm') ? 'unified-persistence.json' : 'unified-benchmark.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(summary));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
