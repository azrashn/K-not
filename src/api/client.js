// NestJS genel API istemcisi. Tarayıcı yalnızca NestJS ile konuşur (Python/ChromaDB'ye asla).
// Hata zarfı: { schema_version, error: { code, message, request_id, retryable, details } }
import * as session from './session'

export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor({ status = 0, code = 'INTERNAL_ERROR', message = 'Beklenmeyen bir hata oluştu.', requestId = null, retryable = false, details = null }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.retryable = retryable
    this.details = details
  }
}

export const newRequestId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

/**
 * @param {string} method
 * @param {string} path  e.g. `/courses`
 * @param {{ body?: unknown, form?: FormData, signal?: AbortSignal, as?: 'json'|'blob', auth?: boolean }} [opts]
 */
export async function request(method, path, opts = {}) {
  const { body, form, signal, as = 'json', auth = true } = opts
  const requestId = newRequestId()
  const headers = { Accept: as === 'blob' ? 'application/pdf' : 'application/json', 'X-Request-ID': requestId }
  const tok = auth ? session.token() : null
  if (tok) headers.Authorization = `Bearer ${tok}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method, headers, signal,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new ApiError({ code: 'NETWORK_ERROR', message: 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.', requestId, retryable: true })
  }

  if (res.ok) {
    if (as === 'blob') return res.blob()
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  let envelope = null
  try { envelope = await res.json() } catch { envelope = null }
  const err = envelope?.error
  const apiError = new ApiError({
    status: res.status,
    code: err?.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'),
    message: err?.message ?? `HTTP ${res.status}`,
    requestId: err?.request_id ?? res.headers.get('X-Request-ID') ?? requestId,
    retryable: Boolean(err?.retryable),
    details: err?.details ?? null,
  })
  // Süresi dolmuş/geçersiz oturum: oturumu kapat (giriş ekranı "oturum sona erdi" der).
  if (res.status === 401 && auth && tok) session.expire()
  throw apiError
}
