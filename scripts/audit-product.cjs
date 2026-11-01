const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'data/product-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'data/video-tests/last-run.json'), 'utf8'));
const account = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8')).accounts[0];
const demo = JSON.parse(fs.readFileSync(path.join(root, 'data/video-tests/unified-run.json'), 'utf8'));
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const report = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:5174/');
    for (const [label, value] of [['E-posta', account.email], ['Parola', account.password]]) {
      await page.getByLabel(label, { exact: true }).click(); await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await page.getByRole('button', { name: 'Çıkış yap' }).waitFor();
    for (const [name, route] of [['home','/'],['courses','/dersler'],['workspace',`/dersler/${demo.course_id}/ogrenme`],['quiz','/quiz'],['analytics','/analitik']]) {
      await page.goto('http://127.0.0.1:5174/#' + route);
      await page.waitForTimeout(600);
      const info = await page.evaluate(() => ({ headings: [...document.querySelectorAll('h1')].map(n => n.textContent),
        sample_notice: document.body.innerText.includes('örnek'), viewport: innerWidth, content_width: document.documentElement.scrollWidth }));
      await page.screenshot({ path: path.join(out, `audit-${name}.png`) });
      report.push({ name, ...info });
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'screen-audit.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e.message); process.exitCode=1; });
