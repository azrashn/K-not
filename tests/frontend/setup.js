import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { MotionGlobalConfig } from 'framer-motion'

// Animasyonlar testte anında biter (sahte zamanlayıcılar framer-motion döngüsünü askıda bırakmasın).
MotionGlobalConfig.skipAnimations = true

// jsdom eksikleri
window.matchMedia ??= (query) => ({ matches: query.includes('min-width: 1024px'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.scrollTo ??= function () {}
globalThis.URL.createObjectURL ??= () => 'blob:mock'
globalThis.URL.revokeObjectURL ??= () => {}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  window.location.hash = ''
  vi.useRealTimers()
})
