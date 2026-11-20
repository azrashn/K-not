/** Opt-in, REAL public link + browser test. Uses the existing isolated fixture.
 * No passwords/tokens printed, no existing material changed or deleted. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'last-run.json'), 'utf8'));
const credentials = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8'));
const base = 'http://127.0.0.1:3100';
const route = `/courses/${fixture.course_id}/videos`;
const report = { checks: [], status: 'running' };
const record = (check, details) => { report.checks.push({ check, details }); console.log(check, JSON.stringify(details)); };
const request = (method, url, token, body) => fetch(base + url, { method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(240000) });

async function main() {
  const tokens = [];
  for (const account of credentials.accounts) {
    const response = await request('POST', '/auth/login', null, { email: account.email, password: account.password });
    assert.equal(response.status, 200);
    const data = await response.json(); tokens.push(data.access_token || data.token);
  }
  assert.equal((await request('POST', route + '/import-link', null, { url: 'https://youtu.be/aqz-KE-bpKQ' })).status, 401);
  assert.equal((await request('POST', route + '/import-link', tokens[0], { url: 'http://127.0.0.1:8100/' })).status, 422);
  record('anonymous-and-invalid-origin-blocked', { anonymous: 401, invalid_origin: 422 });

  const executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:5174/#/dersler/${fixture.course_id}/videolar`);
    await page.getByLabel('E-posta', { exact: true }).fill(credentials.accounts[0].email);
    await page.getByLabel('Parola', { exact: true }).fill(credentials.accounts[0].password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    const input = page.getByLabel('YouTube veya Drive bağlantısı', { exact: true });
    await input.waitFor();
    const sources = [
      ['drive', 'https://drive.google.com/file/d/0ByeS4oOUV-49Zzh4R1J6R09zazQ/view'],
      ['youtube', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
    ];
    for (const [source, url] of sources) {
      await input.fill(url);
      const start = Date.now();
      const responsePromise = page.waitForResponse(r => r.url().endsWith('/import-link') && r.request().method() === 'POST', { timeout: 240000 });
      await page.getByRole('button', { name: 'Bağlantıdan ekle', exact: true }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 201, await response.text());
      const row = await response.json();
      let status = row;
      for (let n = 0; status.status !== 'indexed' && n < 180; n++) {
        assert.notEqual(status.status, 'failed');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const list = await request('GET', route, tokens[0]);
        status = (await list.json()).videos.find(v => v.id === row.id);
        assert.ok(status);
      }
      assert.equal(status.status, 'indexed');
      const frames = await request('GET', `${route}/${row.id}/frames`, tokens[0]);
      const frameData = await frames.json();
      assert.equal(frames.status, 200); assert.ok(frameData.frames.length > 0);
      const transcript = await request('GET', `${route}/${row.id}/transcript`, tokens[0]);
      assert.equal(transcript.status, 200);
      const other = await request('GET', `${route}/${row.id}/file`, tokens[1]);
      assert.equal(other.status, 404);
      await page.getByLabel('Ders videosu', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
      const playback = await page.getByLabel('Ders videosu', { exact: true }).evaluate(v => ({ duration: v.duration, readyState: v.readyState }));
      assert.ok(Math.abs(playback.duration - (source === 'drive' ? 45.07 : 634.57)) < 3, JSON.stringify(playback));
      record('real-' + source + '-browser-import', { elapsed_ms: Date.now() - start, id: row.id,
        indexed: true, frames: frameData.frames.length, transcript_chunks: (await transcript.json()).chunks.length,
        other_user_media: 404, playback });
      await page.screenshot({ path: path.join(output, `video-link-${source}.png`) });
    }
    await input.fill('https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ');
    await page.getByRole('button', { name: 'Bağlantıdan ekle', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Geçerli bir HTTPS' }).waitFor();
    record('invalid-link-message-visible', { passed: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport + 1);
    assert.deepEqual(errors, []);
    record('mobile-and-js-errors', { ...width, page_errors: errors });
    report.status = 'passed';
  } finally { await browser.close(); }
}
main().catch(error => { report.status = 'failed'; report.error = error.message; console.error(error.message); process.exitCode = 1; })
  .finally(() => fs.writeFileSync(path.join(output, 'link-browser-run.json'), JSON.stringify(report, null, 2)));
