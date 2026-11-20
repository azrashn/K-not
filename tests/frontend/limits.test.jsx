import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_LIMITS, mb, resetLimitsCache, useLimits } from '../../src/lib/limits'
import { validateVideoFile } from '../../src/lib/video'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
const MIB = 1024 * 1024
function Probe() {
  const l = useLimits()
  return <p>{mb(l.study_file_bytes)} / {mb(l.video_bytes)}</p>
}
beforeEach(() => { vi.resetAllMocks(); resetLimitsCache() })

test('defaults are shown first and replaced by what the server enforces', async () => {
  api.limits.mockResolvedValue({ study_file_bytes: 8 * MIB, video_bytes: 500 * MIB, document_bytes: 30 * MIB })
  render(<Probe />)
  expect(screen.getByText('20 MB / 100 MB')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('8 MB / 500 MB')).toBeInTheDocument())
})

test('if the server cannot be asked the defaults stay', async () => {
  api.limits.mockRejectedValue(new Error('offline'))
  render(<Probe />)
  await waitFor(() => expect(api.limits).toHaveBeenCalled())
  expect(screen.getByText('20 MB / 100 MB')).toBeInTheDocument()
  expect(DEFAULT_LIMITS.video_bytes).toBe(100 * MIB)
})

test('the video check follows the limit it is given', () => {
  const big = { name: 'ders.mp4', size: 300 * MIB }
  expect(validateVideoFile(big)).toBe('Video en fazla 100 MB olabilir.')
  expect(validateVideoFile(big, 500 * MIB)).toBeNull()
  expect(validateVideoFile({ name: 'ders.mov', size: 1 })).toMatch(/MP4/)
})
