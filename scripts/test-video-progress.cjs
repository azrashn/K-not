/** Real browser/media/MySQL test. Adds an isolated course; never resets or deletes user data. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'last-run.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8')).accounts;
process.loadEnvFile(path.join(root, 'backend/.env'));
const { PrismaService } = require('../backend/dist/prisma/prisma.service');
const { loadConfig } = require('../backend/dist/config/config');
const base = 'http://127.0.0.1:3100';
const report = { checks: [], status: 'running' };
const record = (check, detail) => { report.checks.push({ check, detail }); console.log(check, JSON.stringify(detail)); };
async function call(method, route, token, body) {
  return fetch(base + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
}
async function eventually(action, condition, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await action(); if (condition(value)) return value; await new Promise(r => setTimeout(r, 150)); }
  throw new Error(message);
}
async function main() {
  const prisma = new PrismaService(loadConfig()); let browser;
  try {
    const tag = Date.now().toString(36);
    const course = await prisma.course.create({ data: { code: 'WATCH-' + tag, term: '2026-demo', name: 'Demo • Video öğrenme ilerlemesi',
      memberships: { create: accounts.map(a => ({ userId: a.id, role: 'STUDENT' })) } } });
    report.course_id = course.id;
    const tokens = [];
    for (const account of accounts) {
      const response = await call('POST', '/auth/login', null, { email: account.email, password: account.password });
      assert.equal(response.status, 200); const result = await response.json(); tokens.push(result.access_token || result.token);
    }
    const upload = new FormData();
    upload.append('file', new Blob([fs.readFileSync(path.join(output, 'integral-fresh.mp4'))], { type: 'video/mp4' }), 'İntegral — ilerleme demosu.mp4');
    const uploaded = await call('POST', `/courses/${course.id}/videos`, tokens[0], upload);
    assert.equal(uploaded.status, 201); const video = await uploaded.json(); report.video_id = video.id;
    assert.equal(video.title, 'İntegral — ilerleme demosu.mp4');
    const route = `/courses/${course.id}/videos/${video.id}/progress`;
    const get = async () => { const r = await call('GET', route, tokens[0]); assert.equal(r.status, 200); return r.json(); };
    assert.equal((await call('GET', route)).status, 401);
    assert.equal((await call('GET', route, tokens[1])).status, 404);
    assert.equal((await call('PUT', route, tokens[1], { position_ms: 0, intervals: [] })).status, 404);
    const initial = await get(); assert.equal(initial.watched_ms, 0); assert.ok(initial.duration_ms > 400000);
    record('real-metadata-and-private-progress', { duration_ms: initial.duration_ms, anonymous: 401, other_user: 404 });
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:5174/#/dersler/${course.id}/videolar`);
    await page.getByLabel('E-posta', { exact: true }).fill(accounts[0].email);
    await page.getByLabel('Parola', { exact: true }).fill(accounts[0].password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    const player = page.getByLabel('Ders videosu', { exact: true });
    await player.waitFor({ timeout: 30000 });
    await page.getByRole('progressbar', { name: 'İzlenen video oranı' }).waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await player.evaluate(async v => { v.muted = true; await v.play(); });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 3.5);
    await player.evaluate(v => v.pause());
    const first = await eventually(get, p => p.watched_ms >= 2500, 'First playback was not saved');
    assert.ok(first.watched_ms < 5000);
    record('real-playing-observation', { watched_ms: first.watched_ms, position_ms: first.position_ms });
    await player.evaluate(v => { v.currentTime = 100; });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.seeking && v.currentTime >= 100; });
    const seek = await eventually(get, p => p.position_ms >= 100000, 'Seek position not saved');
    assert.equal(seek.watched_ms, first.watched_ms);
    await player.evaluate(v => v.play());
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 103.5);
    await player.evaluate(v => v.pause());
    const second = await eventually(get, p => p.watched_ms > first.watched_ms + 2000, 'Second playback was not saved');
    assert.ok(second.watched_ms < 10000);
    assert.ok(second.intervals.every(i => i.end_ms < 5000 || i.start_ms >= 100000));
    record('seek-gap-not-watched', { watched_ms: second.watched_ms, intervals: second.intervals });
    await player.evaluate(v => { v.currentTime = 0; });
    await page.waitForFunction(() => !document.querySelector('video')?.seeking);
    await player.evaluate(v => v.play());
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 2);
    await player.evaluate(v => v.pause());
    await eventually(get, p => p.position_ms > 1500 && p.position_ms < 4000, 'Replay position not saved');
    const replay = await get(); assert.ok(replay.watched_ms < second.watched_ms + 1000);
    record('replay-does-not-double-count', { watched_before: second.watched_ms, watched_after: replay.watched_ms });
    await player.evaluate(v => { v.currentTime = 100; });
    await eventually(get, p => p.position_ms === 100000, 'Final position not saved');
    await page.reload();
    await page.getByRole('button', { name: 'Kaldığın yere dön · 1:40', exact: true }).waitFor();
    // A paused reopening must not overwrite the saved position at the next timer.
    await page.waitForTimeout(5500);
    assert.equal((await get()).position_ms, 100000);
    await page.getByRole('button', { name: 'Kaldığın yere dön · 1:40', exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('video')?.currentTime - 100) < 0.2);
    const saved = await get();
    const row = await prisma.videoProgress.findUniqueOrThrow({ where: { videoId_userId: { videoId: video.id, userId: accounts[0].id } } });
    assert.equal(row.positionMs, 100000); assert.ok(row.revision > 0);
    record('reload-resume-and-real-mysql', { position_ms: saved.position_ms, watched_ms: saved.watched_ms, revision: row.revision });
    await page.screenshot({ path: path.join(output, 'watch-progress-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport + 1); assert.deepEqual(errors, []);
    record('mobile-and-runtime', { ...width, page_errors: errors });
    await page.screenshot({ path: path.join(output, 'watch-progress-mobile.png') });
    report.status = 'passed';
  } finally { if (browser) await browser.close(); await prisma.$disconnect(); }
}
main().catch(error => { report.status = 'failed'; report.error = error.message; console.error(error.message); process.exitCode = 1; })
  .finally(() => {
    const result = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(output, 'progress-run.json'), result);
    if (report.course_id) fs.writeFileSync(path.join(output, `progress-run-${report.course_id}.json`), result);
  });
