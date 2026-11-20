// docs/architecture/api-contracts.md §2–§3 — gerçek NestJS uç noktaları.
import { request } from './client'

const enc = encodeURIComponent

export const api = {
  login: (email, password) => request('POST', '/auth/login', { body: { email, password }, auth: false }),
  limits: (signal) => request('GET', '/limits', { signal }),
  ttsStatus: (signal) => request('GET', '/tts/status', { signal }),
  tts: (text, lang, signal) => request('POST', '/tts', { body: { text, lang }, signal }),
  me: (signal) => request('GET', '/auth/me', { signal }),

  courses: (signal, archived = false) => request('GET', '/courses' + (archived ? '?archived=1' : ''), { signal }),
  createCourse: (body) => request('POST','/courses',{body}),
  updateCourse: (id,body) => request('PATCH',`/courses/${enc(id)}`,{body}),
  archiveCourse: (id,archived) => request('POST',`/courses/${enc(id)}/archive`,{body:{archived}}),
  deleteCourse: (id,name) => request('DELETE',`/courses/${enc(id)}`,{body:{confirm_name:name}}),
  learningOverview: (signal) => request('GET','/learning/overview',{signal}),
  activity: (course,body) => request('POST',`/courses/${enc(course)}/activity`,{body}),
  conversations: (course,signal) => request('GET',`/courses/${enc(course)}/knowledge/conversations`,{signal}),
  conversation: (course,id,signal) => request('GET',`/courses/${enc(course)}/knowledge/conversations/${enc(id)}`,{signal}),
  quizzes: (course,signal) => request('GET',`/courses/${enc(course)}/quizzes`,{signal}),
  createQuiz: (course,body,signal) => request('POST',`/courses/${enc(course)}/quizzes`,{body,signal}),
  quizSet: (course,id,signal) => request('GET',`/courses/${enc(course)}/quiz-sets/${enc(id)}`,{signal}),
  examStyles: (course,signal) => request('GET',`/courses/${enc(course)}/exam-styles`,{signal}),
  createExamStyle: (course,body) => request('POST',`/courses/${enc(course)}/exam-styles`,{body}),
  uploadExamStyleFile: (course,file,name) => { const form = new FormData(); if (name) form.append('name', name); form.append('file', file, file.name); return request('POST',`/courses/${enc(course)}/exam-styles/file`,{form}) },
  createExam: (course,body) => request('POST',`/courses/${enc(course)}/exams`,{body}),
  exams: (course,signal) => request('GET',`/courses/${enc(course)}/exams`,{signal}),
  exam: (course,id,signal) => request('GET',`/courses/${enc(course)}/exams/${enc(id)}`,{signal}),
  examKey: (course,id) => request('GET',`/courses/${enc(course)}/exams/${enc(id)}/key`),
  deleteExam: (course,id) => request('DELETE',`/courses/${enc(course)}/exams/${enc(id)}`),
  deleteExamStyle: (course,id) => request('DELETE',`/courses/${enc(course)}/exam-styles/${enc(id)}`),
  quiz: (course,id) => request('GET',`/courses/${enc(course)}/quizzes/${enc(id)}`),
  answerQuiz: (course,id,response) => request('POST',`/courses/${enc(course)}/quizzes/${enc(id)}/answers`,{body:{response}}),
  knowledgeVisual: (course,id,page,signal) => request('GET',`/courses/${enc(course)}/knowledge/materials/${enc(id)}/visual/${page}`,{as:'blob',signal}),
  coverage: (courseId, signal) => request('GET', `/courses/${enc(courseId)}/coverage`, { signal }),
  course: (courseId, signal) => request('GET', `/courses/${enc(courseId)}`, { signal }),
  knowledgeMaterials: (courseId, signal) => request('GET', `/courses/${enc(courseId)}/knowledge/materials`, { signal }),
  knowledgePreview: (courseId, id, signal) => request('GET', `/courses/${enc(courseId)}/knowledge/materials/${enc(id)}`, { signal }),
  knowledgeFile: (courseId, id) => request('GET', `/courses/${enc(courseId)}/knowledge/materials/${enc(id)}/file`, { as: 'blob' }),
  knowledgeSource: (courseId, id, segment, signal) => request('GET', `/courses/${enc(courseId)}/knowledge/materials/${enc(id)}/sources/${enc(segment)}`, { signal }),
  knowledgeAnswer: (courseId, body, signal) => request('POST', `/courses/${enc(courseId)}/knowledge/answers`, { body, signal }),
  knowledgePractice: (courseId, conversation) => request('POST', `/courses/${enc(courseId)}/knowledge/practice`, { body: { conversation_id: conversation } }),
  materialFind: (courseId, materialId, q, signal) => request('GET', `/courses/${enc(courseId)}/knowledge/materials/${enc(materialId)}/find?q=${enc(q)}`, { signal }),
  materialLinks: (courseId, materialId, { page, timeMs } = {}, signal) => request('GET', `/courses/${enc(courseId)}/knowledge/materials/${enc(materialId)}/links?${page != null ? 'page=' + enc(page) : 'time_ms=' + enc(Math.round(timeMs))}`, { signal }),
  materialSummary: (courseId, materialId, focus, signal) => request('POST', `/courses/${enc(courseId)}/knowledge/materials/${enc(materialId)}/summary`, { body: { focus }, signal }),
  selfCheck: (courseId, body, signal) => request('POST', `/courses/${enc(courseId)}/knowledge/self-check`, { body, signal }),
  selfCheckWeb: (courseId, claim, signal) => request('POST', `/courses/${enc(courseId)}/knowledge/self-check/web`, { body: { claim }, signal }),
  knowledgeGrade: (courseId, id, answer) => request('POST', `/courses/${enc(courseId)}/knowledge/practice/${enc(id)}/answers`, { body: { answer } }),
  knowledgeRemove: (courseId, id) => request('DELETE', `/courses/${enc(courseId)}/knowledge/materials/${enc(id)}`),
  knowledgeRename: (course,id,title) => request('PATCH',`/courses/${enc(course)}/knowledge/materials/${enc(id)}`,{body:{title}}),
  knowledgeUpload: (courseId, file) => {
    const form = new FormData(); form.append('file', file, file.name)
    return request('POST', `/courses/${enc(courseId)}/knowledge/materials`, { form })
  },
  videos: (courseId, signal) => request('GET', `/courses/${enc(courseId)}/videos`, { signal }),
  importVideoLink: (courseId, url, signal) => request('POST', `/courses/${enc(courseId)}/videos/import-link`, { body: { url }, signal }),
  uploadVideo: (courseId, file) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return request('POST', `/courses/${enc(courseId)}/videos`, { form })
  },
  retryVideo: (courseId, videoId) => request('POST', `/courses/${enc(courseId)}/videos/${enc(videoId)}/retry`),
  removeVideo: (courseId, videoId) => request('DELETE', `/courses/${enc(courseId)}/videos/${enc(videoId)}`),
  videoProgress: (courseId, videoId, signal) => request('GET', `/courses/${enc(courseId)}/videos/${enc(videoId)}/progress`, { signal }),
  saveVideoProgress: (courseId, videoId, body, signal, keepalive = false) => request('PUT', `/courses/${enc(courseId)}/videos/${enc(videoId)}/progress`, { body, signal, keepalive }),
  videoTranscript: (courseId, videoId, signal) => request('GET', `/courses/${enc(courseId)}/videos/${enc(videoId)}/transcript`, { signal }),
  correctTranscript: (courseId, videoId, index, text) => request('PUT', `/courses/${enc(courseId)}/videos/${enc(videoId)}/transcript/${enc(index)}`, { body: { text } }),
  revertTranscript: (courseId, videoId, index) => request('DELETE', `/courses/${enc(courseId)}/videos/${enc(videoId)}/transcript/${enc(index)}`),
  videoFrames: (courseId, videoId, signal) => request('GET', `/courses/${enc(courseId)}/videos/${enc(videoId)}/frames`, { signal }),
  videoFile: (courseId, videoId, signal) => request('GET', `/courses/${enc(courseId)}/videos/${enc(videoId)}/file`, { as: 'blob', signal }),
  videoFrame: (courseId, videoId, index, signal) => request('GET', `/courses/${enc(courseId)}/videos/${enc(videoId)}/frames/${enc(index)}`, { as: 'blob', signal }),
  videoAnswer: (courseId, videoId, question, signal, context = {}) => request('POST', `/courses/${enc(courseId)}/videos/${enc(videoId)}/answers`, { body: { question, ...context }, signal }),

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
}
