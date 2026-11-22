import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExamProfile, type ExamFormat } from '../../src/learning/exam-style';

/**
 * Reference set: short excerpts of public university exams (MIT OCW, Fordham, Colorado State, UNBC, Princeton,
 * Yildiz Technical, Sakarya), read with the same PDF reader the ai-service uses, each with the format a person
 * gives it. The style reader must give every excerpt exactly that format. See the fixture for the sources.
 */
type Case = { id: string; source: string; expected: ExamFormat; text: string };
const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'exam-style-reference.json'), 'utf8')) as {
  sources: Record<string, { title: string; url: string }>;
  cases: Case[];
};

describe('exam style reference set (real university exam questions)', () => {
  test('every case cites a source and has text', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(20);
    for (const c of fixture.cases) {
      expect(fixture.sources[c.source]?.url).toMatch(/^https:\/\//);
      expect(c.text.length).toBeGreaterThan(30);
    }
  });

  test.each(fixture.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const profile = buildExamProfile(c.text);
    const got = Object.entries(profile.formats).filter(([, n]) => n > 0).map(([f, n]) => `${f}:${n}`);
    // every question found in the excerpt has the expected format
    expect({ got, count: profile.question_count }).toEqual({ got: [`${c.expected}:${profile.question_count}`], count: profile.question_count });
  });
});
