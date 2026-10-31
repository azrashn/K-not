/** Real SQL and HTTP/auth; retrieval/model boundary is explicitly fake. */
import { createHash } from 'node:crypto';
import { Harness } from '../support/harness';
import { FakeAiService } from '../support/fake-ai';
const h = new Harness();
const engine = new FakeAiService();
beforeAll(async () => { await engine.start(); await h.start({ videoServiceUrl: engine.url }); });
afterAll(async () => { await h.stop(); await engine.stop(); });
beforeEach(async () => {
  await h.reset();
  await h.prisma.studyMaterial.create({ data: { id: 'water-notes', courseId: h.world.courses.vy, ownerId: h.world.users.ayse,
    kind: 'TXT', title: 'Physics notes', filename: 'physics.txt', sha256: 'a'.repeat(64),
    segments: [{ text: 'Evaporation changes liquid water to vapour.', location: { kind: 'text', section: 1 } }] } });
  h.ai.on('POST', '/api/v1/knowledge/state', () => ({ status: 200, body: { versions: {} } }));
  h.ai.on('POST', '/api/v1/knowledge/index', () => ({ status: 200, body: { indexed: 1 } }));
  h.ai.on('POST', '/api/v1/knowledge/search', r => {
    const m = r.body.materials[0], location = { kind: 'text', section: 1 }, text = 'Evaporation changes liquid water to vapour.';
    const id = createHash('sha256').update(m.id + m.version + JSON.stringify(location) + text).digest('hex');
    return { status: 200, body: { evidence: [{ id, text, location, material_id: m.id, version: m.version, kind: m.kind }], associations: [], conflicts: [] } };
  });
  h.ai.on('POST', '/api/v1/knowledge/explain', () => ({ status: 200, body: { status: 'SOURCE_EXCERPTS', answer: '[1] Source text', llm_used: false } }));
});
const route = () => `/courses/${h.world.courses.vy}/knowledge`;

test('persistent chat survives expired transient receipt, retains follow-up and isolates users',async()=>{
 const first=await h.http().post(route()+'/answers').set(await h.as('ayse')).send({question:'Evaporation'}).expect(200);
 const chat=first.body.chat_id;expect(chat).toMatch(/^[a-f0-9-]{36}$/);
 const list=await h.http().get(route()+'/conversations').set(await h.as('ayse')).expect(200);expect(list.body[0].id).toBe(chat);
 const saved=await h.http().get(route()+'/conversations/'+chat).set(await h.as('ayse')).expect(200);expect(saved.body.messages).toHaveLength(2);
 expect(saved.body.messages[1].payload.conversation_id).toBeUndefined();
 await h.http().get(route()+'/conversations/'+chat).set(await h.as('mehmet')).expect(404);
 const follow=await h.http().post(route()+'/answers').set(await h.as('ayse')).send({question:'Bir örnek göster',chat_id:chat}).expect(200);
 expect(follow.body.resolved_question).toContain('Evaporation');expect(follow.body.chat_id).toBe(chat);
 expect(await h.prisma.learningMessage.count()).toBe(4);
 await h.http().delete(route()+'/materials/file_water-notes').set(await h.as('ayse')).expect(200);
 const gone=await h.http().get(route()+'/conversations/'+chat).set(await h.as('ayse')).expect(200);
 expect(gone.body.messages.filter((m:any)=>m.role==='assistant').every((m:any)=>m.redacted&&m.payload.evidence.length===0)).toBe(true);
});
test('changed material versions redact stored message text when reopening history',async()=>{
 const first=await h.http().post(route()+'/answers').set(await h.as('ayse')).send({question:'Evaporation'}).expect(200);
 await h.prisma.studyMaterial.update({where:{id:'water-notes'},data:{sha256:'b'.repeat(64)}});
 const saved=await h.http().get(route()+'/conversations/'+first.body.chat_id).set(await h.as('ayse')).expect(200);
 expect(saved.body.messages[1].redacted).toBe(true);expect(saved.body.messages[1].payload.evidence).toEqual([]);
});
test('durable chat rehydrates page/slide location after MySQL JSON key normalization',async()=>{
 const pdf=await h.uploadOk('ayse',h.world.courses.vy,{name:'water.pdf'});
 const text='Evaporation changes liquid water to vapour.';
 await h.makeReady(pdf.id,[text]);
 h.ai.on('POST','/api/v1/knowledge/search',r=>{
  const m=r.body.materials.find((m:any)=>m.kind==='PDF'),location={kind:'page',page:1,char_start:0,char_end:text.length};
  return {status:200,body:{evidence:[{id:createHash('sha256').update(m.id+m.version+JSON.stringify(location)+text).digest('hex'),text,location,material_id:m.id,version:m.version,kind:m.kind}]}};
 });
 const first=await h.http().post(route()+'/answers').set(await h.as('ayse')).send({question:'Evaporation'}).expect(200);
 const saved=await h.http().get(route()+'/conversations/'+first.body.chat_id).set(await h.as('ayse')).expect(200);
 expect(Object.keys(saved.body.messages[1].payload.evidence[0].location)).not.toEqual(Object.keys(first.body.evidence[0].location));
 const follow=await h.http().post(route()+'/answers').set(await h.as('ayse')).send({question:'Bir örnek göster',chat_id:first.body.chat_id}).expect(200);
 expect(follow.body.evidence[0].location.page).toBe(1);
});
test('material rename is owner scoped and leaves original bytes/content unchanged',async()=>{
 await h.http().patch(route()+'/materials/file_water-notes').set(await h.as('mehmet')).send({title:'hijack'}).expect(404);
 await h.http().patch(route()+'/materials/file_water-notes').set(await h.as('ayse')).send({title:'Renamed physics'}).expect(200);
 const m=await h.prisma.studyMaterial.findUniqueOrThrow({where:{id:'water-notes'}});expect(m.title).toBe('Renamed physics');expect(m.sha256).toBe('a'.repeat(64));expect(m.filename).toBe('physics.txt');
 const r=await h.http().post(route()+'/answers').set(await h.as('ayse')).send({question:'Evaporation'}).expect(200);expect(r.body.evidence[0].title).toBe('Renamed physics');
});
test('unprocessed PDF cannot bypass ingestion validation through the visual endpoint',async()=>{
 const pdf=await h.uploadOk('ayse',h.world.courses.vy,{name:'not-ready.pdf'});
 await h.http().get(route()+`/materials/pdf_${pdf.id}/visual/1`).set(await h.as('ayse')).expect(404);
 expect(h.ai.calls('POST','/api/v1/knowledge/render')).toHaveLength(0);
});
test('quiz answers persist, wrong-source recommendation clears after correction, open response has no invented grade',async()=>{
 h.ai.on('POST','/api/v1/knowledge/quiz',r=>({status:200,body:{kind:r.body.kind,question:'Complete: _____ changes liquid water to vapour.',options:[],expected:r.body.kind==='OPEN'?'':'Evaporation',quote:r.body.evidence[0].text}}));
 const base=`/courses/${h.world.courses.vy}/quizzes`;
 const q=await h.http().post(base).set(await h.as('ayse')).send({topic:'Evaporation',kind:'CLOZE'}).expect(201);
 expect(q.body.expected).toBeUndefined();
 await h.http().get(base+'/'+q.body.id).set(await h.as('mehmet')).expect(404);
 const answer=base+'/'+q.body.id+'/answers';
 await h.http().post(answer).set(await h.as('ayse')).send({response:'wrong'}).expect(200).expect(r=>expect(r.body.score).toBe(0));
 let overview=await h.http().get('/learning/overview').set(await h.as('ayse')).expect(200);expect(overview.body.recommendation.source.material_id).toBe('file_water-notes');
 await h.http().post(answer).set(await h.as('ayse')).send({response:'Evaporation'}).expect(200);
 overview=await h.http().get('/learning/overview').set(await h.as('ayse')).expect(200);expect(overview.body.recommendation).toBeNull();expect(overview.body.correct_count).toBe(1);expect(overview.body.mastery_estimated).toBe(false);
 const open=await h.http().post(base).set(await h.as('ayse')).send({topic:'Evaporation',kind:'OPEN'}).expect(201);
 await h.http().post(base+'/'+open.body.id+'/answers').set(await h.as('ayse')).send({response:'My reflection'}).expect(200).expect(r=>expect(r.body.score).toBeNull());
 await h.http().delete(route()+'/materials/file_water-notes').set(await h.as('ayse')).expect(200);
 await h.http().get(base+'/'+q.body.id).set(await h.as('ayse')).expect(404);
 expect((await h.http().get('/learning/overview').set(await h.as('ayse'))).body.attempts).toEqual([]);
 expect((await h.prisma.learningQuizAttempt.findMany()).every(a=>(a.feedback as any).source_removed)).toBe(true);
});

test('typed material source and scoped manifest reach retrieval, no invented mastery', async () => {
  const r = await h.http().post(route() + '/answers').set(await h.as('ayse')).send({ question: 'What is evaporation?' }).expect(200);
  expect(r.body.status).toBe('SOURCE_EXCERPTS'); expect(r.body.support_confirmed).toBe(false); expect(r.body.video_learning).toEqual([]);
  const e = r.body.evidence[0];
  await h.http().get(route() + `/materials/${e.material_id}/sources/${e.id}`).set(await h.as('ayse')).expect(200);
  expect(h.ai.calls('POST', '/api/v1/knowledge/search')[0].body.materials).toHaveLength(1);
});
test('shared search endpoint retrieves real-scoped evidence without generating an answer', async () => {
  const r = await h.http().post(route() + '/search').set(await h.as('ayse')).send({ question: 'Evaporation' }).expect(200);
  expect(r.body.status).toBe('EVIDENCE_ONLY'); expect(r.body.evidence).toHaveLength(1);
  expect(h.ai.calls('POST', '/api/v1/knowledge/explain')).toHaveLength(0);
});
test('unwatched video does not block an explanation supported by another course material', async () => {
  const id = 'water-video', engineId = 'up_0123456789';
  await h.prisma.video.create({ data: { id, ownerId: h.world.users.ayse, courseId: h.world.courses.vy,
    engineVideoId: engineId, title: 'Water lesson', originalFilename: 'water.mp4', contentSha256: 'b'.repeat(64), durationMs: 200000 } });
  await h.prisma.videoProgress.create({ data: { videoId: id, userId: h.world.users.ayse, intervals: [], positionMs: 0, revision: 1 } });
  engine.on('GET', '/api/videos/' + engineId, () => ({ status: 200, body: { id: engineId, status: 'indexed' } }));
  engine.on('GET', '/api/transcript/' + engineId, () => ({ status: 200, body: { video_id: engineId, chunks: [{ text: 'Evaporation changes water to vapour.', t_start: 100, t_end: 120 }] } }));
  h.ai.on('POST', '/api/v1/knowledge/search', r => ({ status: 200, body: { evidence: r.body.materials.map((m: any) => {
    const text = m.kind === 'VIDEO' ? 'Evaporation changes water to vapour.' : 'Evaporation changes liquid water to vapour.';
    const location = m.kind === 'VIDEO' ? { kind: 'video', start_ms: 100000, end_ms: 120000, char_start: 0, char_end: text.length } : { kind: 'text', section: 1 };
    return { id: createHash('sha256').update(m.id + m.version + JSON.stringify(location) + text).digest('hex'),
      material_id: m.id, version: m.version, kind: m.kind, text, location };
  }), associations: [], conflicts: [] } }));
  const r = await h.http().post(route() + '/answers').set(await h.as('ayse')).send({ question: 'Evaporation' }).expect(200);
  expect(r.body.video_learning[0].state).toBe('UNWATCHED');
  expect(r.body.status).toBe('SOURCE_EXCERPTS');
  expect(h.ai.calls('POST', '/api/v1/knowledge/explain')).toHaveLength(1);
});
test('private material invisible to other member and foreign course is rejected', async () => {
  const list = await h.http().get(route() + '/materials').set(await h.as('instructor')).expect(200);
  expect(list.body.materials).toEqual([]);
  await h.http().get(route() + '/materials/file_water-notes').set(await h.as('instructor')).expect(404);
  await h.http().get(route() + '/materials').set(await h.as('outsider')).expect(404);
  await h.http().get(route() + '/materials').expect(401);
});
test('upstream foreign or fabricated source fails closed before generation', async () => {
  h.ai.on('POST', '/api/v1/knowledge/search', () => ({ status: 200, body: { evidence: [{ id: 'a'.repeat(64), material_id: 'file_foreign', kind: 'TXT' }] } }));
  await h.http().post(route() + '/answers').set(await h.as('ayse')).send({ question: 'Evaporation' }).expect(500);
  expect(h.ai.calls('POST', '/api/v1/knowledge/explain')).toHaveLength(0);
});
test('an association cannot smuggle a source outside the authorized evidence', async () => {
  const r = await h.http().post(route() + '/search').set(await h.as('ayse')).send({ question: 'Evaporation' }).expect(200);
  const evidence = r.body.evidence.map(({ n, source_id, ...e }: any) => e);
  h.ai.on('POST', '/api/v1/knowledge/search', () => ({ status: 200, body: { evidence,
    associations: [{ kind: 'RELATED_TOPIC', source_ids: [evidence[0].id, 'foreign-source'] }] } }));
  await h.http().post(route() + '/answers').set(await h.as('ayse')).send({ question: 'Evaporation' }).expect(500);
  expect(h.ai.calls('POST', '/api/v1/knowledge/explain')).toHaveLength(0);
});
test('conversation owner scope and deleted source receipt are enforced', async () => {
  const first = await h.http().post(route() + '/answers').set(await h.as('ayse')).send({ question: 'Evaporation' }).expect(200);
  const body = { question: 'İkinci adımı açıkla', conversation_id: first.body.conversation_id };
  await h.http().post(route() + '/answers').set(await h.as('instructor')).send(body).expect(404);
  const follow = await h.http().post(route() + '/answers').set(await h.as('ayse')).send(body).expect(200);
  expect(follow.body.resolved_question).toContain('Evaporation');
  expect(h.ai.calls('POST', '/api/v1/knowledge/explain').at(-1)!.body.conversation_context).toBe('[1] Source text');
  await h.http().delete(route() + '/materials/file_water-notes').set(await h.as('ayse')).expect(200);
  await h.http().post(route() + '/answers').set(await h.as('ayse')).send(body).expect(404);
  expect(await h.prisma.studyMaterial.count()).toBe(0);
});
test('client identity/watch spoofing and oversized file rejected', async () => {
  await h.http().post(route() + '/answers').set(await h.as('ayse')).send({ question: 'x', watched_percent: 100 }).expect(422);
  await h.http().post(route() + '/materials').set(await h.as('ayse')).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'too-big.txt').expect(413);
});
test('new original text file survives duplicate upload and is removed with its material', async () => {
  h.ai.on('POST', '/api/v1/knowledge/extract', () => ({ status: 200, body: { segments: [{ text: 'Physics original file.', location: { kind: 'text', section: 1 } }] } }));
  const upload = () => h.http().post(route() + '/materials');
  const stored = await upload().set(await h.as('ayse')).attach('file', Buffer.from('Physics original file.'), 'new.txt').expect(201);
  const original = route() + '/materials/' + stored.body.id + '/file';
  await upload().set(await h.as('ayse')).attach('file', Buffer.from('Physics original file.'), 'new.txt').expect(409);
  const file = await h.http().get(original).set(await h.as('ayse')).expect(200);
  expect(file.text).toBe('Physics original file.');
  await h.http().get(original).set(await h.as('instructor')).expect(404);
  await h.http().delete(route() + '/materials/' + stored.body.id).set(await h.as('ayse')).expect(200);
  await h.http().get(original).set(await h.as('ayse')).expect(404);
});
test('practice is source-bound, literal feedback is not a mastery claim, deleted source invalidates it', async () => {
  const first = await h.http().post(route() + '/answers').set(await h.as('ayse')).send({ question: 'Evaporation' }).expect(200);
  const p = await h.http().post(route() + '/practice').set(await h.as('ayse')).send({ conversation_id: first.body.conversation_id }).expect(200);
  expect(p.body.prompt).toContain('_____'); expect(p.body.expected).toBeUndefined();
  const answerRoute = route() + '/practice/' + p.body.id + '/answers';
  const wrong = await h.http().post(answerRoute).set(await h.as('ayse')).send({ answer: 'wrong' }).expect(200);
  expect(wrong.body.outcome).toBe('REVIEW_SOURCE'); expect(wrong.body.mastery_estimated).toBe(false);
  await h.http().post(answerRoute).set(await h.as('instructor')).send({ answer: 'Evaporation' }).expect(404);
  const correct = await h.http().post(answerRoute).set(await h.as('ayse')).send({ answer: wrong.body.expected }).expect(200);
  expect(correct.body.outcome).toBe('EXACT_MATCH'); expect(correct.body.persisted).toBe(false);
  await h.http().delete(route() + '/materials/file_water-notes').set(await h.as('ayse')).expect(200);
  await h.http().post(answerRoute).set(await h.as('ayse')).send({ answer: 'Evaporation' }).expect(404);
});
