/** Local run, 20 Nov: GET /learning/overview and GET /courses/:id/exams answered 500 and the log said only
 *  "PrismaClientKnownRequestError". The log now names the Prisma code and the columns, and rows written
 *  before the newer fields (styleIds, purpose, JSON items/data) are listed instead of failing. */
import { Logger } from '@nestjs/common';
import { ApiExceptionFilter, prismaErrorFields } from '../../src/common/errors';
import { Prisma } from '../../src/generated/prisma/client';
import { ExamsService } from '../../src/learning/exams.service';
import { LearningService } from '../../src/learning/learning.service';

const u = { id: 'u', role: 'USER' } as any;
const day = (n: number) => new Date(Date.UTC(2026, 10, n));
const prismaError = (code: string, meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('The column `knot_dev.GeneratedExam.purpose` does not exist; secret@example.com', {
    code, clientVersion: '7.10.0', meta,
  });

describe('the unhandled-error log names the Prisma error, never its message or values', () => {
  test('code, model, column and target; the driver error kind and code', () => {
    expect(prismaErrorFields(prismaError('P2022', { modelName: 'GeneratedExam', column: 'GeneratedExam.purpose' })))
      .toEqual({ prisma_code: 'P2022', prisma_model: 'GeneratedExam', prisma_column: 'GeneratedExam.purpose' });
    expect(prismaErrorFields(prismaError('P2002', { modelName: 'User', target: ['email'] })))
      .toEqual({ prisma_code: 'P2002', prisma_model: 'User', prisma_target: ['email'] });
    const adapter = prismaError('P2010', {
      modelName: 'LearningQuiz',
      driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'mysql', originalCode: '45028', originalMessage: 'pool timeout (user u@x)' } },
    });
    expect(prismaErrorFields(adapter)).toEqual({ prisma_code: 'P2010', prisma_model: 'LearningQuiz', db_error_kind: 'mysql', db_error_code: '45028' });
    expect(prismaErrorFields(new Error('x'))).toEqual({});
    expect(prismaErrorFields('x')).toEqual({});
  });

  test('the filter logs them with the request id and answers the usual 500 envelope', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ requestId: 'r1' }) }) } as any;
    new ApiExceptionFilter().catch(prismaError('P2022', { modelName: 'GeneratedExam', column: 'GeneratedExam.purpose' }), host);
    const logged = error.mock.calls[0][0] as Record<string, unknown>;
    expect(logged).toEqual({
      event: 'http.unhandled_error', request_id: 'r1', error_type: 'PrismaClientKnownRequestError',
      prisma_code: 'P2022', prisma_model: 'GeneratedExam', prisma_column: 'GeneratedExam.purpose',
    });
    expect(JSON.stringify(logged)).not.toMatch(/secret@example\.com|does not exist/);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toMatchObject({ code: 'INTERNAL_ERROR', request_id: 'r1' });
    error.mockRestore();
  });
});

describe('rows written before the newer fields are listed, not a 500', () => {
  test('GET /courses/:id/exams: styleIds null, items/topics/failures JSON null, styleId only', async () => {
    const rows = [
      { id: 'old', title: '19 Kasım sınavı', status: 'READY', requested: 5, items: null, topics: null, failures: null,
        note: null, styleId: 's1', styleIds: null, purpose: 'EXAM', createdAt: day(19), finishedAt: day(19) },
      { id: 'new', title: 'Yeni', status: 'READY', requested: 2, items: [{ quiz_id: 'q1' }, { quiz_id: 'q2' }], topics: ['Kalıtım'],
        failures: [], note: null, styleId: 's1', styleIds: ['s1', 's2'], purpose: 'EXAM', createdAt: day(20), finishedAt: day(20) },
    ];
    const prisma = { generatedExam: { findMany: jest.fn().mockResolvedValue(rows) } };
    const svc = new ExamsService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any);
    const list = await svc.list(u, 'c');
    expect(list.map((e: any) => [e.id, e.produced, e.topics, e.failures, e.style_ids])).toEqual([
      ['old', 0, [], [], ['s1']],
      ['new', 2, ['Kalıtım'], [], ['s1', 's2']],
    ]);
    expect(prisma.generatedExam.findMany.mock.calls[0][0].where).toEqual({ courseId: 'c', userId: 'u', purpose: 'EXAM' });
  });

  test('GET /learning/overview: an answered question whose data is JSON null', async () => {
    const quiz = (id: string, data: unknown) => ({
      id, courseId: 'c', topic: 'Kalıtım', materialId: 'm1', version: 'v1', data, purpose: 'PRACTICE', redacted: false,
    });
    const attempts = [
      { id: 'a1', quizId: 'q1', outcome: 'REVIEW_SOURCE', score: 0, createdAt: day(19), quiz: quiz('q1', null) },
      { id: 'a2', quizId: 'q2', outcome: 'CORRECT', score: 1, createdAt: day(20), quiz: quiz('q2', { source: { id: 's', title: 'Notlar' } }) },
    ];
    const prisma = {
      learningActivity: { findMany: jest.fn().mockResolvedValue([]) },
      learningQuizAttempt: { findMany: jest.fn().mockResolvedValue(attempts) },
      learningQuiz: { count: jest.fn().mockResolvedValue(2) },
      videoProgress: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const knowledge = { materials: jest.fn().mockResolvedValue([{ id: 'm1', version: 'v1', status: 'READY' }]) };
    const svc = new LearningService(prisma as any, {} as any, knowledge as any, {} as any);
    const overview: any = await svc.overview(u);
    expect(overview.attempts.map((a: any) => [a.quiz_id, a.source])).toEqual([['q1', null], ['q2', { id: 's', title: 'Notlar' }]]);
    expect(overview.recommendation).toEqual({ course_id: 'c', topic: 'Kalıtım', source: null });
    expect([overview.graded_count, overview.correct_count]).toEqual([2, 1]);
  });
});
