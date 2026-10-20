// docs/architecture/api-contracts.md §2–§3 — gerçek NestJS uç noktaları.
import { request } from './client'

const enc = encodeURIComponent

export const api = {
  login: (email, password) => request('POST', '/auth/login', { body: { email, password }, auth: false }),
  me: (signal) => request('GET', '/auth/me', { signal }),

  courses: (signal) => request('GET', '/courses', { signal }),
  course: (courseId, signal) => request('GET', `/courses/${enc(courseId)}`, { signal }),

  createCourse: (body) => request('POST', '/courses', { body }),
  updateCourse: (courseId, body) => request('PATCH', `/courses/${enc(courseId)}`, { body }),

  documents: (courseId, signal) => request('GET', `/courses/${enc(courseId)}/documents`, { signal }),
  document: (documentId, signal) => request('GET', `/documents/${enc(documentId)}`, { signal }),
  upload: (courseId, file, { documentType, title, visibility } = {}) => {
    const form = new FormData()
    form.append('document_type', documentType)
    if (title) form.append('title', title)
    if (visibility) form.append('visibility', visibility)
    form.append('file', file, file.name)
    return request('POST', `/courses/${enc(courseId)}/documents`, { form })
  },
  retry: (documentId) => request('POST', `/documents/${enc(documentId)}/retry`),
  remove: (documentId) => request('DELETE', `/documents/${enc(documentId)}`),
  page: (documentId, page, indexingVersion, signal) =>
    request('GET', `/documents/${enc(documentId)}/pages/${enc(page)}${indexingVersion ? `?indexing_version=${enc(indexingVersion)}` : ''}`, { signal }),
  file: (documentId) => request('GET', `/documents/${enc(documentId)}/file`, { as: 'blob' }),

  answer: (courseId, question, documentIds) =>
    request('POST', `/courses/${enc(courseId)}/answers`, { body: { question, ...(documentIds?.length ? { document_ids: documentIds } : {}) } }),

  // Quiz: yalnızca seçilen materyallerden üretilir; cevap anahtarı gönderimden önce istemciye gelmez.
  createQuiz: (courseId, config) => request('POST', `/courses/${enc(courseId)}/quizzes`, { body: config }),
  quizzes: (courseId, signal) => request('GET', `/quizzes${courseId ? `?course_id=${enc(courseId)}` : ''}`, { signal }),
  quiz: (quizId, signal) => request('GET', `/quizzes/${enc(quizId)}`, { signal }),
  startAttempt: (quizId) => request('POST', `/quizzes/${enc(quizId)}/attempts`),
  attempt: (attemptId, signal) => request('GET', `/quiz-attempts/${enc(attemptId)}`, { signal }),
  saveAnswers: (attemptId, answers) => request('PUT', `/quiz-attempts/${enc(attemptId)}/answers`, { body: { answers } }),
  submitAttempt: (attemptId, answers) => request('POST', `/quiz-attempts/${enc(attemptId)}/submit`, { body: { answers } }),
  quizSummary: (signal) => request('GET', '/analytics/quiz-summary', { signal }),
}
