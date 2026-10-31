/** REAL deletion test: only removes rows created by this test, never existing videos.
 * Requires the private fixture from test-video-local.cjs. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const engineRoot = process.env.MOMENTSEARCH_ROOT || 'C:/Users/ASUS/Documents/Codex/MomentSearch';
const python = path.join(engineRoot, '.venv/Scripts/python.exe');
const output = path.join(root, 'data/video-tests');
const fixture = JSON.parse(fs.readFileSync(path.join(output, 'last-run.json'), 'utf8'));
const credentials = JSON.parse(fs.readFileSync(fixture.credentials_file, 'utf8'));
// Keep Knot's MySQL variables out of the separate engine's PostgreSQL process.
const engineEnv = { ...process.env };
delete engineEnv.DATABASE_URL;
process.loadEnvFile(path.join(root, 'backend/.env'));
const { PrismaService } = require('../backend/dist/prisma/prisma.service');
const { loadConfig } = require('../backend/dist/config/config');
const route = `/courses/${fixture.course_id}/videos`;
const report = { checks: [], created_ids: [], status: 'running' };
const record = (check, detail) => { report.checks.push({ check, detail }); console.log(check, JSON.stringify(detail)); };
const call = (method, url, token, body) => fetch('http://127.0.0.1:3100' + url, { method,
  headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
  body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  signal: AbortSignal.timeout(125000) });
function inspect(id) {
  const code = `import json,sys\nfrom src import db,storage,config\nfrom src.rag import vector_store as v\nfrom qdrant_client.http import models as qm\nid=sys.argv[1]\nf=qm.Filter(must=[qm.FieldCondition(key='video_id',match=qm.MatchValue(value=id)),qm.FieldCondition(key='user_id',match=qm.MatchValue(value='local'))])\ncounts={c:v.client().count(collection_name=c,count_filter=f,exact=True).count if v.client().collection_exists(c) else 0 for c in (v.IMAGE_COLLECTION,v.TEXT_COLLECTION)}\nprint(json.dumps({'manifest':db.get_video(id) is not None,'files':storage.list_keys(storage.video_prefix('local',id)),'directory_exists':storage.local_path(storage.video_prefix('local',id)).exists(),'vectors':counts}))`;
  try {
    return JSON.parse(execFileSync(python, ['-c', code, id], { cwd: engineRoot, env: engineEnv,
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  } catch { throw new Error('Engine disk/index inspection failed; no connection details are printed.'); }
}
async function main() {
  const source = process.argv[2];
  assert.ok(source && fs.existsSync(source), 'Provide a fresh test-only MP4 with speech.');
  const prisma = new PrismaService(loadConfig());
  let browser;
  try {
    const beforeRows = await prisma.video.findMany({ select: { id: true } });
    const tokens = [];
    for (const account of credentials.accounts) {
      const login = await call('POST', '/auth/login', null, { email: account.email, password: account.password });
      assert.equal(login.status, 200); const data = await login.json(); tokens.push(data.access_token || data.token);
    }
    const rows = [];
    for (const token of tokens) {
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(source)], { type: 'video/mp4' }), path.basename(source));
      const response = await call('POST', route, token, form);
      assert.equal(response.status, 201, await response.clone().text());
      const row = await response.json();
      assert.ok(!beforeRows.some(old => old.id === row.id), 'Refuse to delete pre-existing records.');
      rows.push(row); report.created_ids.push(row.id);
    }
    const owner = await prisma.video.findUniqueOrThrow({ where: { id: rows[0].id } });
    const other = await prisma.video.findUniqueOrThrow({ where: { id: rows[1].id } });
    assert.equal(owner.engineVideoId, other.engineVideoId);
    report.engine_id = owner.engineVideoId;
    record('same-bytes-share-asset', { same_engine: true, separate_private_records: rows[0].id !== rows[1].id });
    for (let attempt = 0; attempt < 120; attempt++) {
      const list = await call('GET', route, tokens[0]);
      const row = (await list.json()).videos.find(v => v.id === rows[0].id);
      assert.notEqual(row.status, 'failed'); if (row.status === 'indexed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const before = inspect(owner.engineVideoId);
    assert.ok(before.manifest && before.files.some(f => f.endsWith('transcript.json')));
    assert.ok(Object.values(before.vectors).every(n => n > 0));
    record('real-data-before-cleanup', { files: before.files.length, vectors: before.vectors });
    assert.equal((await call('DELETE', `${route}/${owner.id}`)).status, 401);
    assert.equal((await call('DELETE', `${route}/${owner.id}`, tokens[1])).status, 404);
    const first = await call('DELETE', `${route}/${owner.id}`, tokens[0]);
    assert.equal(first.status, 200); assert.equal((await first.json()).shared_asset_retained, true);
    assert.ok(inspect(owner.engineVideoId).manifest);
    const media = await call('GET', `${route}/${other.id}/file`, tokens[1]);
    assert.equal(media.status, 200); await media.body.cancel();
    record('private-removal-preserves-second-owner', { unauthorized: 404, anonymous: 401, remaining_media: 200 });

    // A real PostgreSQL advisory lock simulates an actively processing job.
    const holder = spawn(python, ['-u', '-c', "import sys; from src import db;\nwith db.video_lease(sys.argv[1]) as locked:\n print('LOCKED' if locked else 'BUSY',flush=True);sys.stdin.readline()", owner.engineVideoId],
      { cwd: engineRoot, env: engineEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Lock holder did not start')), 10000);
        holder.stdout.once('data', data => { clearTimeout(timer); String(data).includes('LOCKED') ? resolve() : reject(new Error('Lock busy')); });
        holder.once('error', reject);
      });
      const blocked = await call('DELETE', `${route}/${other.id}`, tokens[1]);
      assert.equal(blocked.status, 409);
      assert.ok(await prisma.video.findUnique({ where: { id: other.id } }));
      record('active-worker-mutex-blocks-cleanup', { status: 409, row_preserved: true });
    } finally {
      const closed = new Promise(resolve => holder.once('close', resolve));
      holder.stdin.end('\n'); await closed;
    }
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5174/#/dersler/${fixture.course_id}/videolar`);
    await page.getByLabel('E-posta', { exact: true }).fill(credentials.accounts[1].email);
    await page.getByLabel('Parola', { exact: true }).fill(credentials.accounts[1].password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    const card = page.locator(`[data-video-id="${other.id}"]`);
    const remove = card.getByRole('button', { name: `${other.title} videosunu kaldır`, exact: true });
    await remove.click();
    await page.getByRole('button', { name: 'Vazgeç', exact: true }).click();
    assert.ok(await prisma.video.findUnique({ where: { id: other.id } }));
    await remove.click();
    await page.getByRole('button', { name: 'Kalıcı olarak sil', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'video-delete-confirm.png') });
    const responsePromise = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().endsWith(other.id));
    await page.getByRole('button', { name: 'Kalıcı olarak sil', exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200); assert.equal((await response.json()).shared_asset_retained, false);
    await page.getByText('Video, transkript, kareler ve arama kayıtları kalıcı olarak silindi.', { exact: true }).waitFor();
    assert.equal(await remove.count(), 0);
    assert.equal(await card.count(), 0);
    const after = inspect(owner.engineVideoId);
    assert.equal(after.manifest, false); assert.equal(after.directory_exists, false);
    assert.deepEqual(after.files, []); assert.ok(Object.values(after.vectors).every(n => n === 0));
    assert.equal(await prisma.video.count({ where: { id: { in: report.created_ids } } }), 0);
    const remaining = new Set((await prisma.video.findMany({ select: { id: true } })).map(v => v.id));
    assert.ok(beforeRows.every(row => remaining.has(row.id)), 'Existing videos must be preserved.');
    for (const suffix of ['/file', '/frames', '/transcript']) {
      assert.equal((await call('GET', `${route}/${other.id}${suffix}`, tokens[1])).status, 404);
    }
    const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport + 1); assert.deepEqual(errors, []);
    record('real-browser-last-reference-purge', { ...after, existing_records_preserved: true, cancel_preserves_record: true, mobile: width, page_errors: errors });
    await page.screenshot({ path: path.join(output, 'video-delete-complete.png') });
    report.status = 'passed';
  } finally { if (browser) await browser.close(); await prisma.$disconnect(); }
}
main().catch(error => { report.status = 'failed'; report.error = error.message; console.error(error.stack); process.exitCode = 1; })
  .finally(() => fs.writeFileSync(path.join(output, 'deletion-run.json'), JSON.stringify(report, null, 2)));
