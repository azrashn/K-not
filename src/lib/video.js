export function videoTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export function validateVideoFile(file) {
  if (!file || !/\.(mp4|webm)$/i.test(file.name)) return 'MP4 veya WebM video seçin.'
  if (file.size > 100 * 1024 * 1024) return 'Video en fazla 100 MB olabilir.'
  return null
}
