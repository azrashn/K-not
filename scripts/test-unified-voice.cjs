/** Real LOCAL browser voice control; physical audio quality is not graded. */
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(out, 'last-run.json'), 'utf8'));
const account = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8')).accounts[0];
const demo = JSON.parse(fs.readFileSync(path.join(out, 'unified-run.json'), 'utf8'));
const report = { status: 'running', physical_audio_quality: 'UNMEASURED' };
async function main() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:5174/#/dersler/${demo.course_id}/ogrenme`);
    for (const [label, value] of [['E-posta', account.email], ['Parola', account.password]]) {
      await page.getByLabel(label, { exact: true }).click(); await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await page.getByLabel('Ders kaynaklarına sorun').fill('İntegralde değişken değiştirme nedir?');
    const response = page.waitForResponse(r => r.url().endsWith('/knowledge/answers'));
    await page.getByRole('button', { name: 'Derse sor', exact: true }).click();
    const data = await (await response).json(); report.generation_status = data.status;
    const speak = page.getByRole('button', { name: 'Açıklamayı seslendir', exact: true });
    await speak.waitFor({ timeout: 10000 }); await speak.click();
    await page.getByRole('button', { name: 'Seslendirmeyi duraklat', exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Seslendirmeyi duraklat', exact: true }).click();
    await page.getByRole('button', { name: 'Seslendirmeye devam et', exact: true }).click();
    report.status = 'STARTED_PAUSED_RESUMED';
    report.local_turkish_voices = await page.evaluate(() => speechSynthesis.getVoices().filter(v => v.localService && v.lang.startsWith('tr')).length);
    await page.evaluate(() => speechSynthesis.cancel());
  } finally { await browser.close(); }
}
main().catch(e => { report.status = 'NOT_CONFIRMED'; report.reason = 'Browser voice did not confirm start/control within the bounded test.'; process.exitCode = 1; })
  .finally(() => { fs.writeFileSync(path.join(out, 'unified-voice.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); });
