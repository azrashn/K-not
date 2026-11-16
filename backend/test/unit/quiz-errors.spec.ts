import { LearningService } from '../../src/learning/learning.service';

test('wrong multiple-choice feedback explains the selected option rather than short-answer grading', async () => {
  const row={id:'q',kind:'MULTIPLE_CHOICE',materialId:'m',segmentId:'s',data:{
    question:'Which structure?',options:['Queue','Stack','Tree','Set'],expected:'0',
    quote:'BFS uses a queue.',source:{id:'s'},quality:{option_audit_version:2}}};
  const prisma={learningQuiz:{findFirst:jest.fn().mockResolvedValue(row),findUniqueOrThrow:jest.fn().mockResolvedValue(row)},
    learningQuizAttempt:{create:jest.fn().mockResolvedValue({id:'a',outcome:'REVIEW_SOURCE',score:0})}};
  const service=new LearningService(prisma as any,{requireMember:jest.fn()} as any,{source:jest.fn()} as any,{} as any);
  const result=await service.answer({id:'u',role:'USER'},'c','q','1');
  expect(result.message).toContain('Seçtiğin seçenek');
  expect(result.message).not.toContain('kısa cevap');
});

test('selected ready source is offered to the topic planner when lexical retrieval misses its language', async () => {
  const knowledge={ask:jest.fn().mockResolvedValue({evidence:[],video_learning:[]}),
    materials:jest.fn().mockResolvedValue([{id:'video_a',status:'READY',version:'v',title:'Lesson',kind:'VIDEO'}]),
    preview:jest.fn().mockResolvedValue({segments:[{id:'s',text:'Photosynthesis uses sunlight.',location:{start_ms:0,end_ms:1000}}]})};
  const ai={call:jest.fn().mockResolvedValue({kind:'response',status:422,body:{detail:{code:'QUIZ_TOPIC_NOT_FOUND'}}})};
  const service=new LearningService({} as any,{} as any,knowledge as any,ai as any);
  await expect(service.start({id:'u',role:'USER'},'c',{topic:'Fotosentez',kind:'MULTIPLE_CHOICE',scope:{mode:'selected',material_ids:['video_a']}})).rejects.toThrow();
  expect(ai.call.mock.calls[0][2].body.evidence[0]).toMatchObject({material_id:'video_a',version:'v',text:'Photosynthesis uses sunlight.'});
});

test('watched-only quiz never falls back to an unwatched material', async () => {
  const knowledge={ask:jest.fn().mockResolvedValue({evidence:[],video_learning:[]}),preview:jest.fn()};
  const ai={call:jest.fn()};
  const service=new LearningService({} as any,{} as any,knowledge as any,ai as any);
  await expect(service.start({id:'u',role:'USER'},'c',{topic:'Energy',kind:'MULTIPLE_CHOICE',watched_only:true,scope:{mode:'selected',material_ids:['video_a']}})).rejects.toThrow();
  expect(ai.call).not.toHaveBeenCalled();expect(knowledge.preview).not.toHaveBeenCalled();
});

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
