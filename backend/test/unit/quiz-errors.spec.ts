import { LearningService } from '../../src/learning/learning.service';

test('public quiz does not expose a paraphrased answer through its objective', async () => {
  const row={id:'q',topic:'Energy',kind:'MULTIPLE_CHOICE',materialId:'m',segmentId:'s',data:{
    question:'What does the pigment capture?',options:['Light','Sound','Heat','Motion'],
    objective:'Understand how light energy is captured.',expected:'0',quote:'Source light',
    quality:{option_audit_version:2}, source:{id:'s',material_id:'m',text:'Source light'}
  }};
  const service=new LearningService({learningQuiz:{findFirst:jest.fn().mockResolvedValue(row)}} as any,
    {requireMember:jest.fn()} as any,{source:jest.fn()} as any,{} as any);
  const result=await service.quiz({id:'u',role:'USER'},'c','q');
  expect(result.objective).toBeNull();
  expect(result).not.toHaveProperty('expected');
  expect(result.source).not.toHaveProperty('text');
});

test.each([
  [{ kind: 'timeout' }, 'PROVIDER_TIMEOUT'],
  [{ kind: 'unreachable' }, 'AI_SERVICE_UNAVAILABLE'],
  [{ kind: 'response', status: 503, body: {} }, 'AI_SERVICE_UNAVAILABLE'],
  [{ kind: 'response', status: 422, body: {} }, 'VALIDATION_ERROR'],
  [{ kind: 'response', status: 422, body: { detail: { code: 'QUIZ_TOPIC_NOT_FOUND' } } }, 'VALIDATION_ERROR'],
])('quiz failure %j is classified without publishing a question', async (response, code) => {
  const prisma = { learningQuiz: { create: jest.fn() } };
  const knowledge = { ask: jest.fn().mockResolvedValue({ evidence: [{ text: 'A real retrieved source excerpt.' }] }) };
  const ai = { call: jest.fn().mockResolvedValue(response) };
  const service = new LearningService(prisma as any, {} as any, knowledge as any, ai as any);
  await expect(service.start({ id: 'owner', role: 'USER' }, 'course', { topic: 'Storage', kind: 'MULTIPLE_CHOICE' })).rejects.toMatchObject({ code });
  expect(prisma.learningQuiz.create).not.toHaveBeenCalled();
});

test('missing topic feedback explains the actual source limitation', async () => {
  const knowledge = { ask: jest.fn().mockResolvedValue({ evidence: [{ text: 'A retrieved source.' }] }) };
  const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 422,
    body: { detail: { code: 'QUIZ_TOPIC_NOT_FOUND' } } }) };
  const service = new LearningService({} as any, {} as any, knowledge as any, ai as any);
  await expect(service.start({ id: 'owner', role: 'USER' }, 'course', { topic: 'Unknown', kind: 'MULTIPLE_CHOICE' }))
    .rejects.toThrow('Seçili kaynaklarda bu konuyu açıklayan bir bölüm bulunamadı.');
});
