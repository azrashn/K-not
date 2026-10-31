// docs/architecture/api-contracts.md §2–§3 — gerçek NestJS uç noktaları.
import { request } from './client'

const enc = encodeURIComponent

export const api = {
  login: (email, password) => request('POST', '/auth/login', { body: { email, password }, auth: false }),
  me: (signal) => request('GET', '/auth/me', { signal }),

  courses: (signal) => request('GET', '/courses', { signal }),
  course: (courseId, signal) => request('GET', `/courses/${enc(courseId)}`, { signal }),
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
