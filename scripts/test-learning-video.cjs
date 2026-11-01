/** Real services + Edge. Creates private test video references/observations only;
 * never changes the reported video's original watch history. No model mocks. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'last-run.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8')).accounts;
process.loadEnvFile(path.join(root, 'backend/.env'));
const { PrismaService } = require('../backend/dist/prisma/prisma.service');
const { loadConfig } = require('../backend/dist/config/config');
const { newId } = require('../backend/dist/common/ids');
const report = { checks: [], status: 'running' };
const record = (check, detail) => { report.checks.push({ check, detail }); console.log(check, JSON.stringify(detail)); };
async function call(method, route, token, body) {
  return fetch('http://127.0.0.1:3100' + route, { method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(200000) });
}
async function main() {
  const prisma = new PrismaService(loadConfig()); let browser;
  try {
    const source = await prisma.video.findFirst({ where: { ownerId: accounts[0].id, originalFilename: 'videoplayback.mp4' } });
    assert.ok(source, 'The reported Prim video must exist.');
    const clean = await prisma.video.findFirst({ where: { ownerId: accounts[0].id, originalFilename: { contains: 'integral' } } });
    assert.ok(clean, 'The earlier real integral fixture must exist.');
    const before = await prisma.videoProgress.findUnique({ where: { videoId_userId: { videoId: source.id, userId: accounts[0].id } } });
    const course = await prisma.course.create({ data: { code: 'CONTEXT-' + Date.now().toString(36), name: 'Demo • İzleme farkında video cevapları', term: '2026-test',
      memberships: { create: accounts.map(a => ({ userId: a.id, role: 'STUDENT' })) } } });
    report.course_id = course.id;
    const rows = [];
    for (const original of [source, clean]) rows.push(await prisma.video.create({ data: { id: newId(), ownerId: accounts[0].id,
      courseId: course.id, title: original.title, originalFilename: original.originalFilename, contentSha256: original.contentSha256,
      engineVideoId: original.engineVideoId, durationMs: original.durationMs } }));
    report.test_video_ids = rows.map(r => r.id);
    const tokens = [];
    for (const account of accounts) {
      const response = await call('POST', '/auth/login', null, { email: account.email, password: account.password });
      assert.equal(response.status, 200); const result = await response.json(); tokens.push(result.access_token || result.token);
    }
    const route = `/courses/${course.id}/videos/${rows[0].id}/answers`;
    const ask = async (options = {}) => { const response = await call('POST', route, tokens[0], { question: 'prims algoritması nedir?', current_time_ms: 1000, ...options });
      assert.equal(response.status, 200); return response.json(); };
    const missing = await ask(); assert.equal(missing.learning_state, 'UNKNOWN'); assert.equal(missing.llm_used, false);
    assert.ok(missing.relevant_segment); const span = missing.relevant_segment;
    record('missing-progress-unknown-real-evidence', { state: missing.learning_state, start_ms: span.start_ms, end_ms: span.end_ms });
    async function arrange(intervals) {
      // Explicitly scripted test observations; not presented as human playback.
      await prisma.videoProgress.upsert({ where: { videoId_userId: { videoId: rows[0].id, userId: accounts[0].id } },
        create: { videoId: rows[0].id, userId: accounts[0].id, positionMs: 500000, intervals, revision: 1 },
        update: { intervals, positionMs: 500000, revision: { increment: 1 } } });
    }
    for (const [name, intervals, expected] of [
      ['never-watched', [], 'UNWATCHED'],
      ['full-source-watched', [{ start_ms: span.start_ms, end_ms: span.end_ms }], 'WATCHED'],
      ['partial-source', [{ start_ms: span.start_ms, end_ms: span.start_ms + 500 }], 'PARTIALLY_WATCHED'],
      ['seek-skipped-source', [{ start_ms: 30000, end_ms: 31000 }], 'UNWATCHED'],
    ]) {
      await arrange(intervals); const result = await ask(); assert.equal(result.learning_state, expected);
      if (expected !== 'WATCHED') { assert.equal(result.status, 'GUIDANCE'); assert.equal(result.llm_used, false); }
      assert.ok(result.source_warnings.some(w => w.code === 'SOURCE_CONCEPT_CONFLICT'));
      record(name, { scripted_observations: true, state: result.learning_state, status: result.status, llm_used: result.llm_used });
    }
    assert.equal((await call('POST', route, tokens[1], { question: 'Prim nedir?' })).status, 404);
    assert.equal((await call('POST', route, null, { question: 'Prim nedir?' })).status, 401);
    const absent = await call('POST', route, tokens[0], { question: 'Dijkstra nedir?' });
    const absentBody = await absent.json(); assert.equal(absentBody.learning_state, 'UNKNOWN'); assert.equal(absentBody.relevant_segment, null);
    record('different-algorithm-has-no-invented-timestamp', { state: absentBody.learning_state, citations: absentBody.citations.length });
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5174/#/dersler/${course.id}/videolar`);
    await page.getByLabel('E-posta', { exact: true }).fill(accounts[0].email);
    await page.getByLabel('Parola', { exact: true }).fill(accounts[0].password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await page.locator(`[data-video-id="${rows[0].id}"] button[aria-pressed]`).click();
    const player = page.getByLabel('Ders videosu', { exact: true }); await player.waitFor();
    await page.getByRole('progressbar', { name: 'İzlenen video oranı' }).waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
    await player.evaluate(v => { v.currentTime = 1; });
    await page.waitForFunction(() => !document.querySelector('video')?.seeking);
    const guidePromise = page.waitForResponse(r => r.url().endsWith('/answers') && r.request().method() === 'POST');
    await page.getByLabel('Video hakkında soru').fill('prims algoritması nedir?');
    await page.getByRole('button', { name: 'Sor', exact: true }).click();
    const guided = await (await guidePromise).json(); assert.equal(guided.status, 'GUIDANCE'); assert.equal(guided.llm_used, false);
    await page.getByRole('button', { name: 'Şimdi açıkla', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'learning-guidance.png') });
    await page.getByRole('button', { name: 'İlgili bölüme git', exact: true }).click();
    await page.waitForFunction(t => Math.abs(document.querySelector('video')?.currentTime - t) < .2, span.start_ms / 1000);
    record('real-browser-jump', { expected_seconds: span.start_ms / 1000, actual_seconds: await player.evaluate(v => v.currentTime) });
    const explanationPromise = page.waitForResponse(r => r.url().endsWith('/answers') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Şimdi açıkla', exact: true }).click();
    const explained = await (await explanationPromise).json();
    assert.equal(explained.generation_status, 'SOURCE_CONFLICT'); assert.equal(explained.llm_used, false);
    assert.ok(explained.background_references.some(r => r.statement.includes('minimum kapsayan ağaç') && !r.is_video_evidence));
    await page.getByRole('heading', { name: 'Doğrulanmış başvuru bilgisi · video alıntısı değildir' }).waitFor();
    record('real-prim-source-conflict-handled', { status: explained.generation_status, background_is_separate: true });
    await page.screenshot({ path: path.join(output, 'learning-prim-source-warning.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport + 1); assert.deepEqual(errors, []);
    record('real-mobile-ui', { ...width, page_errors: errors });
    const cleanRoute = `/courses/${course.id}/videos/${rows[1].id}/answers`;
    const first = await call('POST', cleanRoute, tokens[0], { question: 'Burada hangi konu anlatılıyor?', current_time_ms: 50000 });
    const cleanEvidence = await first.json(); assert.equal(cleanEvidence.status, 'GUIDANCE'); assert.equal(cleanEvidence.context_resolution, 'PLAYBACK_TRANSCRIPT');
    assert.ok(cleanEvidence.relevant_segment.start_ms <= 50000 && cleanEvidence.relevant_segment.end_ms >= 50000);
    const start = Date.now();
    const second = await call('POST', cleanRoute, tokens[0], { question: 'Burada hangi konu anlatılıyor?', current_time_ms: 50000,
      explain_now: true, evidence_id: cleanEvidence.evidence_id });
    assert.equal(second.status, 200); const cleanAnswer = await second.json();
    assert.equal(cleanAnswer.llm_used, true); assert.equal(cleanAnswer.generation_status, 'GENERATED_UNVERIFIED');
    assert.ok(cleanAnswer.citations.length && /\[\d/.test(cleanAnswer.answer));
    record('real-local-model-explicit-explanation', { elapsed_ms: Date.now() - start, generation_status: cleanAnswer.generation_status,
      llm_used: cleanAnswer.llm_used, citations: cleanAnswer.citations.length, start_ms: cleanAnswer.relevant_segment.start_ms, end_ms: cleanAnswer.relevant_segment.end_ms });
    const after = await prisma.videoProgress.findUnique({ where: { videoId_userId: { videoId: source.id, userId: accounts[0].id } } });
    assert.equal(JSON.stringify(after), JSON.stringify(before));
    record('original-reported-video-progress-preserved', { unchanged: true });
    report.status = 'passed';
  } finally { if (browser) await browser.close(); await prisma.$disconnect(); }
}
main().catch(error => { report.status = 'failed'; report.error = error.message; console.error(error.message); process.exitCode = 1; })
  .finally(() => {
    const result = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(output, 'learning-run.json'), result);
    if (report.course_id) fs.writeFileSync(path.join(output, `learning-run-${report.course_id}.json`), result);
  });
