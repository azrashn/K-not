/** Opt-in REAL local integration test. Creates its own course and two test users;
 * never resets databases or changes existing accounts. Passwords stay outside repo.
 * Usage: node scripts/test-video-local.cjs <MP4 path> */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
process.loadEnvFile(path.join(root, 'backend/.env'));
const { loadConfig } = require('../backend/dist/config/config');
const { PrismaService } = require('../backend/dist/prisma/prisma.service');
const { hashPassword } = require('../backend/dist/auth/auth.service');
const base = 'http://127.0.0.1:3100';
async function main() {
  const source = process.argv[2];
  if (!source || !fs.existsSync(source)) throw new Error('Provide a real MP4 path.');
  const prisma = new PrismaService(loadConfig());
  const out = path.join(root, 'data/video-tests');
  fs.mkdirSync(out, { recursive: true });
  const report = { checks: [] };
  const record = (check, detail) => { report.checks.push({ check, detail }); console.log(check, JSON.stringify(detail)); };
  async function call(method, route, token, body, extra = {}) {
    const headers = token ? { Authorization: 'Bearer '+token } : {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    return fetch(base+route, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(200000), ...extra });
  }
  try {
    const tag = Date.now().toString(36);
    const accounts = [];
    for (const name of ['owner','other']) {
      const password = randomBytes(24).toString('base64url');
      const email = `video-${name}-${tag}@knot.local`;
      const user = await prisma.user.create({ data: { email, displayName: `Video Test ${name}`, passwordHash: await hashPassword(password) } });
      accounts.push({ id: user.id, email, password });
    }
    const course = await prisma.course.create({ data: { code: 'VIDEO-'+tag, name: 'Video entegrasyon denemesi', term: '2026-test' } });
    for (const a of accounts) await prisma.courseMembership.create({ data: { userId: a.id, courseId: course.id, role: 'STUDENT' } });
    const credentialsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'knot-video-')), 'accounts.json');
    fs.writeFileSync(credentialsFile, JSON.stringify({ course_id: course.id, accounts }, null, 2), { mode: 0o600, flag: 'wx' });
    report.credentials_file = credentialsFile;
    report.course_id = course.id;
    const tokens = [];
    for (const a of accounts) {
      const r = await call('POST','/auth/login',null,{email:a.email,password:a.password});
      assert.equal(r.status,200,await r.clone().text());
      const d = await r.json();
      tokens.push(d.access_token || d.token);
      assert.ok(tokens.at(-1));
    }
    const route = `/courses/${course.id}/videos`;
    assert.equal((await call('GET',route)).status,401);
    assert.equal((await call('POST',route,null,new FormData())).status,401);
    const form = new FormData();
    form.append('file',new Blob([fs.readFileSync(source)],{type:'video/mp4'}),'integral-lecture.mp4');
    const start = Date.now();
    const upload = await call('POST',route,tokens[0],form);
    assert.equal(upload.status,201,await upload.clone().text());
    const v = await upload.json();
    report.video_id = v.id;
    record('real-video-upload', { status:upload.status, elapsed_ms:Date.now()-start, video_id:v.id });
    let video = v;
    for (let attempt=0; attempt<240 && video.status !== 'indexed'; attempt++) {
      assert.notEqual(video.status,'failed');
      await new Promise(r=>setTimeout(r,1000));
      const listing = await call('GET',route,tokens[0]);
      assert.equal(listing.status,200);
      video = (await listing.json()).videos.find(x=>x.id===v.id);
    }
    assert.equal(video.status,'indexed');
    record('real-processing', { status:video.status, frames:video.frame_count, elapsed_ms:Date.now()-start });
    const otherList = await call('GET',route,tokens[1]);
    assert.equal((await otherList.json()).videos.length,0);
    for (const suffix of ['transcript','frames','file','frames/0']) {
      assert.equal((await call('GET',`${route}/${v.id}/${suffix}`,tokens[1])).status,404);
    }
    assert.equal((await call('POST',`${route}/${v.id}/answers`,tokens[1],{question:'Konu nedir?'})).status,404);
    assert.equal((await call('GET',`/courses/nonmember-course/videos/${v.id}/file`,tokens[0])).status,404);
    record('privacy', { anonymous:401, other_member_read:404, other_member_ask:404 });
    const transcript = await call('GET',`${route}/${v.id}/transcript`,tokens[0]);
    assert.equal(transcript.status,200,await transcript.clone().text());
    const t = await transcript.json();
    assert.ok(t.chunks.length > 0);
    const frameList = await call('GET',`${route}/${v.id}/frames`,tokens[0]);
    assert.equal(frameList.status,200,await frameList.clone().text());
    const f = await frameList.json();
    assert.ok(f.frames.length > 0);
    const image = await call('GET',`${route}/${v.id}/frames/${f.frames[0].index}`,tokens[0]);
    assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/jpeg');
    const media = await call('GET',`${route}/${v.id}/file`,tokens[0]);
    assert.equal(media.status,200);
    assert.equal((await media.arrayBuffer()).byteLength,fs.statSync(source).size);
    record('real-sources',{ transcript_chunks:t.chunks.length, frames:f.frames.length, image_http:image.status, media_http:media.status });
    const qstart=Date.now();
    const answer = await call('POST',`${route}/${v.id}/answers`,tokens[0],{question:'Videoda hangi konu anlatılıyor? Türkçe kısa cevapla.'});
    assert.equal(answer.status,200,await answer.clone().text());
    const a = await answer.json();
    assert.equal(a.experimental,true); assert.equal(a.support_confirmed,false);
    assert.equal(a.llm_used,true); assert.ok(a.citations.length>0);
    assert.ok(a.citations.every(c=>c.video_id===v.id && c.timestamp_ms>=0));
    report.answer=a;
    record('real-local-answer', { elapsed_ms:Date.now()-qstart, llm_used:a.llm_used, citations:a.citations.length, support_confirmed:a.support_confirmed });
    const again = new FormData(); again.append('file',new Blob([fs.readFileSync(source)],{type:'video/mp4'}),'integral-lecture.mp4');
    const repeated=await call('POST',route,tokens[0],again);
    assert.equal((await repeated.json()).id,v.id);
    record('duplicate-upload',{same_video_id:true});
    report.status='passed';
    console.log('Credentials saved privately outside repository:',credentialsFile);
  } finally {
    fs.writeFileSync(path.join(out,'last-run.json'),JSON.stringify(report,null,2));
    await prisma.$disconnect();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
