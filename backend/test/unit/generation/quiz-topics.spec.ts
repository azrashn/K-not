import { LearningService } from '../../../src/learning/learning.service';
import { buildPool } from '../../../src/learning/generation/source-pool';
import { suggestTopics } from '../../../src/learning/generation/topic-planner';
import { knowledge as course, NOTES, SEGMENTS, SLIDES, VIDEO } from './java-course';

const u = { id: 'u', role: 'USER' } as any;
const service = (materials: any[], policy: 'documents_first' | 'never' = 'documents_first') => {
  const k = course(materials);
  const learning = new LearningService({} as any, { requireMember: jest.fn() } as any, k as any, {} as any, undefined,
    { quizEngine: 'v2', quizTranscriptPolicy: policy } as any);
  return { learning, k };
};

describe('topic suggestions for the quiz form (Azra: the raw video title filled the topic)', () => {
  test('headings first, then the subject words of the parts; never a file or video title', async () => {
    const { learning } = service([NOTES, SLIDES, VIDEO]);
    const { topics } = await learning.quizTopics(u, 'c');
    expect(topics[0]).toBe('Kapsülleme');
    expect(topics).toHaveLength(5);
    for (const t of topics) {
      expect(t.length).toBeLessThanOrEqual(60);
      expect(t).not.toMatch(/Dakikada|java-notlari|Nesneye yönelik programlama/);
      expect(t).not.toMatch(/Ceva|Neave|Intelijayda/); // the transcript is not read when documents exist
    }
    expect(new Set(topics.map((t) => t.toLocaleLowerCase('tr'))).size).toBe(topics.length);
  });

  test('a course without usable sources, or without a document under "never", gives no suggestions', async () => {
    expect(await service([]).learning.quizTopics(u, 'c')).toEqual({ topics: [] });
    expect(await service([VIDEO], 'never').learning.quizTopics(u, 'c')).toEqual({ topics: [] });
  });

  test('a course with only the video suggests from its transcript (the questions would too)', async () => {
    const { topics } = await service([VIDEO]).learning.quizTopics(u, 'c');
    expect(topics.length).toBeGreaterThan(0);
  });

  test('at most the asked number, and only as many labels as needed are computed', () => {
    const pool = buildPool([NOTES, SLIDES], SEGMENTS);
    expect(suggestTopics(pool, 2)).toEqual(['Kapsülleme', expect.any(String)]);
    expect(suggestTopics(pool, 0)).toEqual([]);
  });
});
