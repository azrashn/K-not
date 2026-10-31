import { errorText } from '../api/messages'

export function videoTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export function validateVideoFile(file) {
  if (!file || !/\.(mp4|webm)$/i.test(file.name)) return 'MP4 veya WebM video seçin.'
  if (file.size > 100 * 1024 * 1024) return 'Video en fazla 100 MB olabilir.'
  return null
}

// Video routes send controlled, user-facing messages; PDF-specific defaults
// (30 MB / PDF only) do not apply to this workspace.
export function videoErrorText(error) {
  const videoCodes = ['VALIDATION_ERROR', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE',
    'JOB_ALREADY_RUNNING', 'NOT_RETRYABLE', 'PROVIDER_TIMEOUT', 'RATE_LIMITED', 'AI_SERVICE_UNAVAILABLE']
  return videoCodes.includes(error?.code) && typeof error.message === 'string'
    ? error.message : errorText(error)
}
