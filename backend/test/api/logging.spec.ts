/** Structured logs never contain secrets, passwords, tokens, questions or document text. */
import { JsonLogger } from '../../src/common/logging';
import { CALLBACK_TOKEN, Harness, PASSWORD, PDF, RAG_TOKEN } from '../support/harness';

const h = new Harness();
const lines: string[] = [];
let write: typeof process.stdout.write;

beforeAll(async () => {
  await h.start({}, new JsonLogger('debug'));
  write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
});
afterAll(async () => {
  process.stdout.write = write;
  await h.stop();
});

test('a full flow logs structured events without sensitive content', async () => {
  await h.reset();
  const secretText = 'GİZLİ-BELGE-İÇERİĞİ-AVL';
  const question = 'Gizli soru metni burada mı?';
  const id = (await h.uploadOk('ayse', h.world.courses.vy, { file: Buffer.concat([PDF, Buffer.from(secretText)]), title: 'Özel Başlık' })).id;
  await h.makeReady(id, [secretText]);
  h.ai.on('POST', '/api/v1/rag/answer', (r) => ({ status: 200, body: { outcome: 'INSUFFICIENT_EVIDENCE', evidence: [], claims: [], question: r.body.question } }));
  await h.http().post(`/courses/${h.world.courses.vy}/answers`).set(await h.as('ayse')).send({ question }).expect(200);
  await h.http().post('/auth/login').send({ email: 'ayse@knot.test', password: 'wrong-password-123' }).expect(401);
  await h.http().get(`/documents/${id}/pages/1`).set(await h.as('ayse')).expect(200);

  const all = lines.join('');
  expect(lines.length).toBeGreaterThan(10);
  for (const l of lines.filter((x) => x.trim())) expect(() => JSON.parse(l)).not.toThrow();
  expect(all).toContain('"event":"document.uploaded"');
  expect(all).toContain('"event":"job.event_applied"');
  expect(all).toContain('"event":"rag.answered"');
  for (const forbidden of [secretText, question, PASSWORD, 'wrong-password-123', CALLBACK_TOKEN, RAG_TOKEN, h.config.jwtSecret, 'Bearer ey']) {
    expect(all).not.toContain(forbidden);
  }
});
