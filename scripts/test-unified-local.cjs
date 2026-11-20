/** REAL local services and Edge; private test references, never reset user data.
 * Existing integral video + our own PDF/PPTX/TXT fixtures. No mocked AI. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'last-run.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8')).accounts;
process.loadEnvFile(path.join(root, 'backend/.env'));
const { PrismaService } = require('../backend/dist/prisma/prisma.service');
const { loadConfig } = require('../backend/dist/config/config');
const { newId } = require('../backend/dist/common/ids');
const report = { checks: [], status: 'running' };
const record = (name, detail) => { report.checks.push({ name, ...detail }); console.log(name, JSON.stringify(detail)); };
async function request(method, route, token, body) {
  const r = await fetch('http://127.0.0.1:3100' + route, { method, signal: AbortSignal.timeout(180000),
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await r.json(); return { status: r.status, data };
}
async function main() {
  const prisma = new PrismaService(loadConfig()); let browser;
  try {
    const source = await prisma.video.findFirst({ where: { ownerId: accounts[0].id, originalFilename: { contains: 'integral' } } });
    assert.ok(source, 'Prior real integral fixture required');
    const original = await prisma.videoProgress.findMany({ where: { videoId: source.id } });
    const c = await prisma.course.create({ data: { code: 'UNIFIED-' + Date.now().toString(36), name: 'Demo • Ortak integral kaynakları', term: '2026-test',
      memberships: { create: accounts.map(a => ({ userId: a.id, role: 'STUDENT' })) } } });
    const bio = await prisma.course.create({ data: { code: 'BIO-' + Date.now().toString(36), name: 'Demo • Biyoloji ve kaynak izolasyonu', term: '2026-test',
      memberships: { create: [{ userId: accounts[0].id, role: 'STUDENT' }] } } });
    report.course_id = c.id; report.biology_course_id = bio.id;
    const video = await prisma.video.create({ data: { id: newId(), courseId: c.id, ownerId: accounts[0].id, title: source.title,
      originalFilename: source.originalFilename, contentSha256: source.contentSha256, engineVideoId: source.engineVideoId, durationMs: source.durationMs } });
    const tokens = [];
    for (const account of accounts) {
      const r = await request('POST', '/auth/login', null, { email: account.email, password: account.password });
      assert.equal(r.status, 200); tokens.push(r.data.access_token);
    }
    const route = `/courses/${c.id}/knowledge`;
    async function upload(filename, endpoint, course = c.id) {
      const form = new FormData();
      if (endpoint === 'documents') form.set('document_type', 'notes');
      form.set('file', new Blob([fs.readFileSync(path.join(output, 'unified', filename))]), filename);
      const r = await request('POST', `/courses/${course}/${endpoint}`, tokens[0], form);
      assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data;
    }
    const pdf = await upload('calculus-notes.pdf', 'documents');
    const ppt = await upload('calculus-slides.pptx', 'knowledge/materials');
    const downloaded = await fetch('http://127.0.0.1:3100' + route + '/materials/' + ppt.id + '/file', { headers: { Authorization: 'Bearer ' + tokens[0] } });
    assert.equal(downloaded.status, 200);
    assert.ok(Buffer.from(await downloaded.arrayBuffer()).equals(fs.readFileSync(path.join(output, 'unified/calculus-slides.pptx'))));
    record('original-pptx-bytes-preserved', { exact_match: true });
    await upload('biology.txt', 'knowledge/materials', bio.id);
    let ready = false;
    for (let n = 0; n < 100; n++) {
      const r = await request('GET', '/documents/' + pdf.id, tokens[0]);
      if (r.data.status?.state === 'READY') { ready = true; break; }
      if (r.data.status?.state === 'FAILED') throw new Error('Real PDF extraction failed');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'PDF must become READY');
    const listed = await request('GET', route + '/materials', tokens[0]);
    assert.equal(listed.data.materials.length, 3);
    record('real-upload-and-ingestion', { kinds: listed.data.materials.map(m => m.kind) });
    const question = 'İntegralde değişken değiştirme yöntemi nasıl kullanılır?';
    const start = Date.now(); const first = await request('POST', route + '/answers', tokens[0], { question });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.ok(first.data.evidence.length, 'Actual scoped evidence must exist');
    const kinds = [...new Set(first.data.evidence.map(e => e.kind))];
    assert.ok(kinds.includes('PDF') && kinds.includes('PPTX') && kinds.includes('VIDEO'), JSON.stringify(kinds));
    assert.ok(first.data.video_learning.every(l => l.state === 'UNKNOWN'));
    assert.notEqual(first.data.status, 'GUIDANCE', 'PDF/PPTX must not be blocked by unwatched video');
    record('three-material-answer', { kinds, elapsed_ms: Date.now() - start, status: first.data.status, llm_used: first.data.llm_used,
      generation_failure: first.data.generation_failure || null, indexed_materials: first.data.indexed_materials });
    report.first_answer_status = first.data.status;
    for (const e of first.data.evidence) {
      const r = await request('GET', route + `/materials/${e.material_id}/sources/${e.id}`, tokens[0]);
      assert.equal(r.status, 200); assert.equal(r.data.text, e.text);
    }
    record('all-citations-open-real-source', { count: first.data.evidence.length });
    const emptyObservation = await request('PUT', `/courses/${c.id}/videos/${video.id}/progress`, tokens[0], { position_ms: 0, intervals: [] });
    assert.equal(emptyObservation.status, 200);
    const unwatched = await request('POST', route + '/answers', tokens[0], { question });
    assert.equal(unwatched.status, 200); assert.ok(unwatched.data.video_learning.every(l => l.state === 'UNWATCHED'));
    assert.notEqual(unwatched.data.status, 'GUIDANCE');
    record('unwatched-video-still-uses-document-evidence', { learning_state: 'UNWATCHED', status: unwatched.data.status, document_access_blocked: false });
    const follow = await request('POST', route + '/answers', tokens[0], { question: 'İkinci adımı örnekle.', conversation_id: first.data.conversation_id });
    assert.equal(follow.status, 200); assert.ok(follow.data.resolved_question.includes('İntegralde'));
    record('bounded-follow-up-and-incremental-index', { indexed_materials: follow.data.indexed_materials, uses_prior_context: true });
    assert.equal(follow.data.indexed_materials, 0);
    const practice = await request('POST', route + '/practice', tokens[0], { conversation_id: first.data.conversation_id });
    assert.equal(practice.status, 200); assert.ok(practice.data.prompt.includes('_____')); assert.equal(practice.data.expected, undefined);
    const wrong = await request('POST', route + '/practice/' + practice.data.id + '/answers', tokens[0], { answer: 'deliberately-wrong-test-answer' });
    assert.equal(wrong.data.outcome, 'REVIEW_SOURCE'); assert.equal(wrong.data.mastery_estimated, false);
    const correct = await request('POST', route + '/practice/' + practice.data.id + '/answers', tokens[0], { answer: wrong.data.expected });
    assert.equal(correct.data.outcome, 'EXACT_MATCH');
    record('source-linked-practice-and-feedback', { wrong: wrong.data.outcome, matched: correct.data.outcome, persisted: correct.data.persisted, mastery_estimated: false });
    const denied = await request('GET', route + '/materials', tokens[1]);
    assert.deepEqual(denied.data.materials, []);
    assert.equal((await request('POST', route + '/answers', tokens[1], { question, conversation_id: first.data.conversation_id })).status, 404);
    const missing = await request('POST', route + '/answers', tokens[0], { question: 'Kloroplast içinde klorofil fotosentez sırasında ne yapar?' });
    assert.equal(missing.status, 200); assert.equal(missing.data.evidence.length, 0);
    const biology = await request('POST', `/courses/${bio.id}/knowledge/answers`, tokens[0], { question: 'Fotosentezde klorofil ne yapar?' });
    assert.equal(biology.status, 200); assert.ok(biology.data.evidence.length > 0);
    record('subject-independence-and-course-isolation', { calculus_has_biology_evidence: false, biology_evidence: biology.data.evidence.length });
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, reducedMotion: 'reduce' }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:5174/#/dersler/${c.id}/ogrenme`);
    // Wait for actionable fields before typing, including the login entrance animation.
    await page.getByLabel('E-posta', { exact: true }).click();
    await page.getByLabel('E-posta', { exact: true }).fill(accounts[0].email);
    await page.getByLabel('Parola', { exact: true }).click();
    await page.getByLabel('Parola', { exact: true }).fill(accounts[0].password);
    const loggedIn = page.waitForResponse(r => r.url().endsWith('/auth/login'));
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    assert.equal((await loggedIn).status(), 200);
    await page.getByLabel('Ders kaynaklarına sorun', { exact: true }).fill(question);
    const response = page.waitForResponse(r => r.url().endsWith('/knowledge/answers'));
    await page.getByRole('button', { name: 'Derse sor', exact: true }).click();
    const browserResponse = await response; assert.equal(browserResponse.status(), 200);
    const browserAnswer = await browserResponse.json();
    await page.getByLabel('Ders yanıtı 1', { exact: true }).waitFor();
    await page.getByRole('button', { name: /\[\d\] PPTX/ }).first().click();
    await page.getByText('Çıkarılan slayt metni · özgün slayt görünümü değildir', { exact: true }).waitFor();
    await page.getByRole('button', { name: /\[\d\] PDF/ }).first().click();
    await page.getByRole('button', { name: "Özgün PDF'yi aç", exact: true }).waitFor();
    const citation = browserAnswer.evidence.find(e => e.kind === 'VIDEO');
    await page.getByRole('button', { name: /\[\d\] VIDEO/ }).first().click();
    await page.getByLabel('Ortak ders videosu', { exact: true }).waitFor();
    await page.waitForFunction(ms => Math.abs(document.querySelector('video')?.currentTime * 1000 - ms) < 300, citation.location.start_ms);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video')?.seeking);
    const media = page.getByLabel('Ortak ders videosu', { exact: true });
    await media.evaluate(async v => { v.muted = true; await v.play(); });
    await page.waitForTimeout(3200); // Real playback, never synthetic currentTime coverage.
    await media.evaluate(v => v.pause());
    let observed;
    for (let n = 0; n < 12; n++) {
      observed = await request('GET', `/courses/${c.id}/videos/${video.id}/progress`, tokens[0]);
      if (observed.data.watched_ms >= 2000) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.ok(observed.data.watched_ms >= 2000 && observed.data.watched_ms < 8000);
    record('real-unified-player-persists-observed-playback', { watched_ms: observed.data.watched_ms, revision: observed.data.revision });
    const partial = await request('POST', route + '/search', tokens[0], { question });
    assert.equal(partial.status, 200); assert.ok(partial.data.video_learning.some(l => l.state === 'PARTIALLY_WATCHED'));
    record('actual-playback-changes-retrieved-span-state', { includes_partial: true, llm_used: partial.data.llm_used });
    await page.screenshot({ path: path.join(output, 'unified-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport + 1); assert.deepEqual(errors, []);
    const voice = await page.evaluate(() => window.speechSynthesis?.getVoices().filter(v => v.localService && v.lang.startsWith('tr')).length || 0);
    record('real-workspace-navigation-and-mobile', { ...width, page_errors: errors, local_turkish_voices: voice });
    if (voice && await page.getByRole('button', { name: 'Açıklamayı seslendir', exact: true }).count()) {
      await page.getByRole('button', { name: 'Açıklamayı seslendir', exact: true }).first().click();
      const state = await Promise.race([
        page.getByRole('button', { name: 'Seslendirmeyi duraklat', exact: true }).waitFor({ timeout: 8000 }).then(() => 'STARTED'),
        page.getByText('Seslendirme başarısız. Metni okuyabilirsin.', { exact: true }).waitFor({ timeout: 8000 }).then(() => 'ENVIRONMENT_ERROR'),
      ]).catch(() => 'NOT_CONFIRMED');
      if (state === 'STARTED') {
        await page.getByRole('button', { name: 'Seslendirmeyi duraklat', exact: true }).click();
        await page.getByRole('button', { name: 'Seslendirmeye devam et', exact: true }).click();
      }
      record('local-voice-control', { status: state, physical_audio_quality: 'UNMEASURED' });
      await page.evaluate(() => window.speechSynthesis.cancel());
    } else record('local-voice-control', { status: 'VOICE_NOT_AVAILABLE', physical_audio_quality: 'UNMEASURED' });
    await page.screenshot({ path: path.join(output, 'unified-mobile.png'), fullPage: true });
    const pptSource = first.data.evidence.find(e => e.kind === 'PPTX');
    assert.equal((await request('DELETE', route + '/materials/' + ppt.id, tokens[0])).status, 200);
    assert.equal((await request('GET', route + `/materials/${ppt.id}/sources/${pptSource.id}`, tokens[0])).status, 404);
    const after = await request('POST', route + '/answers', tokens[0], { question });
    assert.equal(after.status, 200); assert.ok(after.data.evidence.every(e => e.material_id !== ppt.id));
    record('deleted-material-no-longer-retrievable', { deleted_kind: 'PPTX', stale_source_status: 404 });
    const restored = await upload('calculus-slides.pptx', 'knowledge/materials');
    assert.notEqual(restored.id, ppt.id);
    report.restored_pptx_id = restored.id;
    record('reupload-gets-new-source-identity', { same_material_id: false, demo_materials: 3 });
    assert.equal(JSON.stringify(await prisma.videoProgress.findMany({ where: { videoId: source.id } })), JSON.stringify(original));
    record('original-video-progress-preserved', { unchanged: true });
    report.status = 'passed';
  } finally { if (browser) await browser.close(); await prisma.$disconnect(); }
}
main().catch(e => { report.status = 'failed'; report.error = e.message; console.error(e.message); process.exitCode = 1; })
  .finally(() => fs.writeFileSync(path.join(output, 'unified-run.json'), JSON.stringify(report, null, 2)));
