// The material a student last opened in a course, kept in this browser only as a convenience.
// It may be missing (private window, blocked storage); nothing depends on it.
const key = (courseId) => `knot.last-material.${courseId}`

export function rememberMaterial(courseId, materialId) {
  try { window.localStorage.setItem(key(courseId), String(materialId)) } catch { /* optional */ }
}
export function lastMaterial(courseId) {
  try { return window.localStorage.getItem(key(courseId)) || null } catch { return null }
}

/** The material to suggest: the one last opened if it is still ready, otherwise the first ready one. */
export function recommendedMaterial(materials, lastId) {
  const ready = (materials || []).filter((m) => m.status === 'READY')
  const last = lastId && ready.find((m) => m.id === lastId)
  return { material: last || ready[0] || null, resumed: Boolean(last), others: ready.filter((m) => m !== (last || ready[0])).slice(0, 4) }
}
