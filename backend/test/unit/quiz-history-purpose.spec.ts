import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LearningService } from '../../src/learning/learning.service';

const u = { id: 'u', role: 'USER' } as any;

function service() {
  const prisma = { learningQuiz: { findMany: jest.fn().mockResolvedValue([]) }, generatedExam: { findMany: jest.fn().mockResolvedValue([]) } };
  const learning = new LearningService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any);
  return { learning, prisma };
}

describe('quiz history keeps exam questions apart', () => {
  test('practice by default', async () => {
    const { learning, prisma } = service();
    await learning.quizzes(u, 'c');
    expect(prisma.learningQuiz.findMany.mock.calls[0][0].where).toEqual({ userId: 'u', courseId: 'c', redacted: false, purpose: 'PRACTICE' });
  });

  test('the questions of generated exams only when asked for', async () => {
    const { learning, prisma } = service();
    await learning.quizzes(u, 'c', 'EXAM');
    expect(prisma.learningQuiz.findMany.mock.calls[0][0].where).toMatchObject({ purpose: 'EXAM' });
    // The cards are the generated exams of the same purpose.
    expect(prisma.generatedExam.findMany.mock.calls[0][0].where).toEqual({ userId: 'u', courseId: 'c', purpose: 'EXAM' });
  });

  test('the migration marks the questions of earlier exams and defaults new ones to practice', () => {
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261120120000_generation_purpose/migration.sql'), 'utf8');
    expect(sql).toContain("ALTER TABLE `LearningQuiz` ADD COLUMN `purpose` VARCHAR(16) NOT NULL DEFAULT 'PRACTICE'");
    expect(sql).toMatch(/UPDATE `LearningQuiz`[\s\S]*SET q\.`purpose` = 'EXAM'[\s\S]*JSON_CONTAINS/);
  });
});
