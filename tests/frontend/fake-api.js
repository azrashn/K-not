// TEST DOUBLE: fetch'i taklit eden küçük yönlendirici. Gerçek NestJS yanıt şekillerini kullanır
// (backend/test/api ile aynı sözleşme). Gerçek uçtan uca test: tests/e2e.
import { vi } from 'vitest'
import * as session from '../../src/api/session'

export const envelope = (code, message = code, extra = {}) => ({
  schema_version: 'api.v1', error: { code, message, request_id: 'req-test', retryable: false, details: null, ...extra },
})

export function fakeApi(routes) {
  const calls = []
  const fetchMock = vi.fn(async (url, init = {}) => {
    const u = new URL(url, 'http://localhost')
    const method = init.method || 'GET'
    const path = u.pathname.replace(/^\/api/, '') + u.search
    calls.push({ method, path, headers: init.headers || {}, body: init.body })
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(' ')
      const re = new RegExp(`^${pattern}$`)
      if (m === method && re.test(path)) {
        const out = typeof handler === 'function' ? await handler({ path, init, match: path.match(re) }) : handler
        if (out instanceof Error) throw out
        const { status = 200, body = null, blob } = out
        return new Response(blob ?? (body === null ? '' : JSON.stringify(body)), { status, headers: { 'Content-Type': blob ? 'application/pdf' : 'application/json' } })
      }
    }
    return new Response(JSON.stringify(envelope('NOT_FOUND')), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

export const USER = { id: 'u-ayse', email: 'ayse@knot.test', display_name: 'Ayşe Yılmaz', role: 'USER' }

export function signIn(user = USER, expiresIn = 3600) {
  session.start({ access_token: 'header.payload.sig', token_type: 'Bearer', expires_in: expiresIn, user })
}

export const COURSE = {
  id: 'ccourse0000000000000000vy', code: 'BIL 211', name: 'Veri Yapıları', instructor_name: 'Doç. Dr. M. Aydın', term: 'Güz 2026',
  my_role: 'STUDENT', documents: { total: 2, ready: 1, processing: 1, failed: 0 },
}

export function doc(id, state, extra = {}) {
  const ui = { UPLOADED: 'uploaded', EXTRACTING: 'reading', CHUNKING: 'preparing', EMBEDDING: 'preparing', INDEXING: 'preparing', READY: 'ready', FAILED: 'error' }[state]
  return {
    id, course_id: COURSE.id, owner_id: USER.id, visibility: 'PRIVATE', document_type: 'slide', title: id, original_filename: `${id}.pdf`,
    mime_type: 'application/pdf', size_bytes: 1000, page_count: state === 'READY' ? 5 : null, created_at: '2026-10-08T10:00:00Z',
    status: { state, ui_state: ui, stage: null, updated_at: '2026-10-08T10:00:00Z', error: null }, can_delete: true, notices: [], ...extra,
  }
}
