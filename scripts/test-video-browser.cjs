/** Real browser + real running services, no routes or model replies mocked.
 * Prerequisite: scripts/test-video-local.cjs has created its private fixture.
 * Passwords remain outside the repo and are never printed. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'last-run.json'), 'utf8'));
const credentials = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8'));

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('Set CHROMIUM_PATH to an installed Chromium browser.');
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const report = { checks: [], engine: path.basename(executablePath) };
  const record = (check, details) => { report.checks.push({ check, details }); console.log(check, JSON.stringify(details)); };
  try {
    await page.goto('http://127.0.0.1:5174/#/dersler', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('E-posta', { exact: true }).fill(credentials.accounts[0].email);
    await page.getByLabel('Parola', { exact: true }).fill(credentials.accounts[0].password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await page.getByRole('button', { name: /Video entegrasyon denemesi/ }).click();
    await page.getByRole('button', { name: 'Ders videoları', exact: true }).click();
    await page.getByRole('heading', { name: 'Ders videoları', exact: true }).waitFor();
    const video = page.getByLabel('Ders videosu', { exact: true });
    await video.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 30000 });
    record('login-and-native-video-workspace', { loaded: true });

    const source = path.join(output, 'integral-fresh.mp4');
    if (fs.existsSync(source)) {
      const uploaded = page.waitForResponse(r => /\/videos$/.test(r.url()) && r.request().method() === 'POST');
      await page.getByLabel('Ders videosu seç', { exact: true }).setInputFiles(source);
      const response = await uploaded;
      assert.equal(response.status(), 201);
      assert.equal((await response.json()).id, fixture.video_id);
      await page.getByRole('button', { name: 'Video yükle', exact: true }).waitFor();
      record('real-browser-upload-dedup', { status: 201, same_video_id: true });
    }

    await page.getByRole('button', { name: /^0:47 Hepsinde/ }).click();
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - 47.84) < 0.25;
    }, null, { timeout: 15000 });
    record('transcript-seek', await video.evaluate(v => ({ seconds: v.currentTime, duration: v.duration })));

    await page.getByRole('button', { name: 'Videodan kaynak karesi 0:10', exact: true }).click();
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && Math.abs(v.currentTime - 10) < 0.5;
    });
    record('gallery-seek', { seconds: await video.evaluate(v => v.currentTime) });

    const answerResponse = page.waitForResponse(r => /\/answers$/.test(r.url()) && r.request().method() === 'POST', { timeout: 200000 });
    await page.getByRole('textbox', { name: 'Video hakkında soru' }).fill('Videoda hangi konu anlatılıyor? Türkçe kısa cevapla.');
    await page.getByRole('button', { name: 'Sor', exact: true }).click();
    const response = await answerResponse;
    assert.equal(response.status(), 200);
    let answer = await response.json();
    if (answer.status === 'GUIDANCE') {
      record('learning-guidance-before-explanation', { learning_state: answer.learning_state, llm_used: answer.llm_used });
      const explained = page.waitForResponse(r => /\/answers$/.test(r.url()) && r.request().method() === 'POST', { timeout: 200000 });
      await page.getByRole('button', { name: 'Şimdi açıkla', exact: true }).click();
      const generated = await explained; assert.equal(generated.status(), 200); answer = await generated.json();
    }
    assert.equal(answer.llm_used, true);
    assert.equal(answer.support_confirmed, false);
    assert.ok(answer.citations.length);
    const answerPanel = page.getByLabel('Video yanıtı', { exact: true });
    await answerPanel.waitFor({ state: 'visible' });
    await answerPanel.getByRole('button', { name: /^\[1\]/ }).click();
    const target = answer.citations[0].timestamp_ms / 1000;
    await page.waitForFunction(t => {
      const v = document.querySelector('video');
      return v && !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - t) < 0.25;
    }, target, { timeout: 15000 });
    record('real-answer-and-source-seek', { llm_used: true, citations: answer.citations.length,
      expected_seconds: target, actual_seconds: await video.evaluate(v => v.currentTime) });
    await page.screenshot({ path: path.join(output, 'knot-video-desktop.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: 'Ders videoları', exact: true }).scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth }));
    assert.ok(dimensions.content <= dimensions.viewport + 1, JSON.stringify(dimensions));
    await page.screenshot({ path: path.join(output, 'knot-video-mobile.png') });
    record('mobile-no-horizontal-overflow', dimensions);
    assert.deepEqual(errors, []);
    report.status = 'passed';
  } finally {
    report.page_errors = errors;
    fs.writeFileSync(path.join(output, 'browser-run.json'), JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
