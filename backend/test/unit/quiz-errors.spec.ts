import { LearningService } from '../../src/learning/learning.service';

test.each([
  [{ kind: 'timeout' }, 'PROVIDER_TIMEOUT'],
  [{ kind: 'unreachable' }, 'AI_SERVICE_UNAVAILABLE'],
  [{ kind: 'response', status: 503, body: {} }, 'AI_SERVICE_UNAVAILABLE'],
  [{ kind: 'response', status: 422, body: {} }, 'VALIDATION_ERROR'],
])('quiz failure %j is classified without publishing a question', async (response, code) => {
  const prisma = { learningQuiz: { create: jest.fn() } };
  const knowledge = { ask: jest.fn().mockResolvedValue({ evidence: [{ text: 'A real retrieved source excerpt.' }] }) };
  const ai = { call: jest.fn().mockResolvedValue(response) };
  const service = new LearningService(prisma as any, {} as any, knowledge as any, ai as any);
  await expect(service.start({ id: 'owner', role: 'USER' }, 'course', { topic: 'Storage', kind: 'MULTIPLE_CHOICE' })).rejects.toMatchObject({ code });
  expect(prisma.learningQuiz.create).not.toHaveBeenCalled();
});
