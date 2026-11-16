/** Opt-in real local AI regression using existing graph course material.
 * Writes private evidence under ignored data/. No mocks, reset, or answer submission.
 * Leaves one model-reviewed quiz in practice history; human quality review is separate.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'data/context-tests');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/video-tests/last-run.json')));
const account = JSON.parse(fs.readFileSync(seed.credentials_file)).accounts[0];
const reference = JSON.parse(fs.readFileSync(path.join(out, 'graph-reference.json')));
const report = { started_at: new Date().toISOString(), status: 'RUNNING', checks: [] };
let token;
async function request(method, route, body) {
  const response = await fetch('http://127.0.0.1:3100' + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(160000),
  });
  return { status: response.status, data: await response.json() };
}
async function main() {
  try {
    const login = await request('POST', '/auth/login', { email: account.email, password: account.password });
    assert.equal(login.status, 200);
    token = login.data.access_token;
    assert.ok(token);
    const base = '/courses/' + reference.course_id;
    const topic = 'Graf veri yapısında noktalar arasındaki bağlantılar';
    const scope = { mode: 'course' };
    const search = await request('POST', base + '/knowledge/search', { question: topic, scope });
    assert.equal(search.status, 200);
    assert.ok(search.data.evidence.length);
    // Private fixture for testing the actual model's exact quote, without an
    // answer key ever being exposed by the public quiz API.
    fs.writeFileSync(path.join(out, 'quiz-binding-evidence.json'), JSON.stringify({
      question: topic, kind: 'MULTIPLE_CHOICE', evidence: search.data.evidence.slice(0, 4),
    }, null, 2));
    const started = Date.now();
    const quiz = await request('POST', base + '/quizzes', { topic, kind: 'MULTIPLE_CHOICE', scope });
    report.generation_ms = Date.now() - started;
    report.http_status = quiz.status;
    report.quiz = quiz.data;
    assert.equal(quiz.status, 201, 'Real model did not publish a valid question');
    const q = quiz.data;
    assert.equal(q.quality_state, 'MODEL_REVIEWED_UNVERIFIED');
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    for (const key of ['expected', 'quote', 'option_feedback', 'explanation']) assert.equal(q[key], undefined);
    assert.equal(q.source.text, undefined);
    assert.ok(search.data.evidence.some(e => e.id === q.source.id && e.material_id === q.source.material_id));
    report.checks.push('real-local-generation', 'source-metadata-match', 'four-distinct-options', 'no-answer-leak');
    const reloaded = await request('GET', base + '/quizzes/' + q.id);
    assert.equal(reloaded.status, 200);
    assert.deepEqual(reloaded.data, q);
    report.checks.push('persisted-quiz-reload');
    report.status = 'PASS_PIPELINE_HUMAN_REVIEW_REQUIRED';
    console.log(JSON.stringify({ status: report.status, generation_ms: report.generation_ms, checks: report.checks }));
  } catch (error) {
    report.status = 'FAIL';
    report.failure = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'quiz-source-binding-run.json'), JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
