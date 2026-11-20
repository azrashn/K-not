import { describe, expect, test, vi } from 'vitest'
import { ApiError, request } from '../../src/api/client'
import { api } from '../../src/api/endpoints'
import * as session from '../../src/api/session'
import { envelope, fakeApi, signIn } from './fake-api'

describe('API client', () => {
  test('sends the bearer token and a request id to the same-origin /api base', async () => {
    const { calls, fetchMock } = fakeApi({ 'GET /courses': { body: [] } })
    signIn()
    await api.courses()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courses')
    expect(calls[0].headers.Authorization).toBe('Bearer header.payload.sig')
    expect(calls[0].headers['X-Request-ID']).toMatch(/^[\w-]{8,}$/)
  })

  test('login is sent without any token and never carries internal secrets', async () => {
    const { calls } = fakeApi({ 'POST /auth/login': { body: { access_token: 't', expires_in: 60, user: {} } } })
    signIn()
    await api.login('a@b.c', 'pw-123456789')
    expect(calls[0].headers.Authorization).toBeUndefined()
    expect(JSON.parse(calls[0].body)).toEqual({ email: 'a@b.c', password: 'pw-123456789' })
  })

  test('parses the documented error envelope into ApiError', async () => {
    fakeApi({ 'GET /courses/x': { status: 409, body: envelope('NO_READY_DOCUMENTS', 'none ready', { retryable: true, details: { a: 1 } }) } })
    const err = await request('GET', '/courses/x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'NO_READY_DOCUMENTS', retryable: true, requestId: 'req-test', details: { a: 1 } })
  })

  test('network failures become NETWORK_ERROR (retryable)', async () => {
    fakeApi({ 'GET /courses': () => new TypeError('Failed to fetch') })
    const err = await api.courses().catch((e) => e)
    expect(err).toMatchObject({ code: 'NETWORK_ERROR', retryable: true })
  })

  test('aborts propagate as AbortError (no error UI for cancelled requests)', async () => {
    fakeApi({ 'GET /courses': () => Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    await expect(api.courses()).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('a 401 on an authenticated call expires the session', async () => {
    fakeApi({ 'GET /courses': { status: 401, body: envelope('UNAUTHENTICATED') } })
    signIn()
    const seen = vi.fn()
    const off = session.subscribe(seen)
    await api.courses().catch(() => {})
    expect(session.get()).toBeNull()
    expect(seen).toHaveBeenCalledWith(null, 'expired')
    off()
  })

  test('uploads use multipart FormData (browser sets the boundary)', async () => {
    const { calls } = fakeApi({ 'POST /courses/c1/documents': { status: 201, body: {} } })
    signIn()
    await api.upload('c1', new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' }), { documentType: 'slide', visibility: 'PRIVATE' })
    expect(calls[0].headers['Content-Type']).toBeUndefined()
    const form = calls[0].body
    expect(form.get('document_type')).toBe('slide')
    expect(form.get('visibility')).toBe('PRIVATE')
    expect(form.get('file').name).toBe('a.pdf')
  })

  test('identifiers are URL-encoded and page requests carry indexing_version', async () => {
    const { calls } = fakeApi({ 'GET /documents/.*': { body: {} } })
    signIn()
    await api.page('d 1', 4, 'c1')
    expect(calls[0].path).toBe('/documents/d%201/pages/4?indexing_version=c1')
  })
})

describe('session', () => {
  test('persists only in sessionStorage and expires on time', async () => {
    vi.useFakeTimers()
    signIn(undefined, 2)
    expect(JSON.parse(sessionStorage.getItem('knot.session')).token).toBe('header.payload.sig')
    expect(localStorage.getItem('knot.session')).toBeNull()
    vi.advanceTimersByTime(2100)
    expect(session.get()).toBeNull()
    expect(sessionStorage.getItem('knot.session')).toBeNull()
  })

  test('an expired stored session is discarded on load', () => {
    sessionStorage.setItem('knot.session', JSON.stringify({ token: 't', user: {}, expiresAt: Date.now() - 1 }))
    expect(session.load()).toBeNull()
  })
})
