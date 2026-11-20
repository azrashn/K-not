// Sends the progress that an earlier offline session left on this device.
import { api } from '../api/endpoints'
import * as session from '../api/session'
import { isTransient, outbox } from './progress-outbox'

/**
 * Drain the signed-in user's outbox. `positionFor(courseId, videoId)` may return the position the
 * server already holds for a video that is open right now, which then replaces the queued one.
 * Returns the drain summary, or null when nobody is signed in.
 */
export async function drainProgressOutbox({ positionFor = () => null } = {}) {
  const userId = session.get()?.user?.id
  if (!userId) return null
  return outbox.drain(userId, async (courseId, videoId, body) => {
    const live = positionFor(courseId, videoId)
    try {
      await api.saveVideoProgress(courseId, videoId, { position_ms: live ?? body.position_ms, intervals: body.intervals }, AbortSignal.timeout(15000))
      return 'ok'
    } catch (e) {
      // 401: the session ended; keep the entries for the next sign-in. Other client errors cannot succeed.
      return isTransient(e) || e?.status === 401 ? 'retry' : 'drop'
    }
  })
}

export async function clearProgressOutbox(userId) {
  return userId ? outbox.clear(userId) : 0
}
