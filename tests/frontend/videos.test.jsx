import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Videos from '../../src/pages/Videos'
import { validateVideoFile, videoTime, videoErrorText } from '../../src/lib/video'
import { api } from '../../src/api/endpoints'
vi.mock('../../src/api/endpoints', () => ({ api: { videos: vi.fn(), videoTranscript: vi.fn(), videoFrames: vi.fn(), videoFile: vi.fn(), videoFrame: vi.fn(), videoAnswer: vi.fn(), importVideoLink: vi.fn() } }))
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn() }) }))
vi.mock('../../src/components/PageBits', () => ({ MobileBar: () => null }))
beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:authenticated-video')
  URL.revokeObjectURL = vi.fn()
  api.videos.mockResolvedValue({ videos: [{ id: 'video-1', title: 'Lecture', status: 'indexed', frame_count: 1 }] })
  api.videoFile.mockResolvedValue(new Blob(['video']))
  api.videoTranscript.mockResolvedValue({ chunks: [{ text: 'A real timestamp contract', start_seconds: 65, end_seconds: 72 }] })
  api.videoFrames.mockResolvedValue({ frames: [] })
})
test('formats timestamps and rejects unsupported/oversized uploads', () => {
  expect(videoTime(65.9)).toBe('1:05')
  expect(validateVideoFile({ name: 'notes.pdf', size: 1 })).toContain('MP4')
  expect(validateVideoFile({ name: 'video.mp4', size: 101 * 1024 * 1024 })).toContain('100 MB')
  expect(videoErrorText({ code: 'PAYLOAD_TOO_LARGE', message: 'Video en fazla 100 MB olabilir.' })).toContain('100 MB')
})
test('processing video does not expose the question form', async () => {
  api.videos.mockResolvedValue({ videos: [{ id: 'video-1', title: 'Lecture', status: 'embedding' }] })
  render(<Videos courseId="course-1" />)
  await screen.findByText('Ses ve görseller hazırlanıyor', { selector: 'h2' })
  expect(screen.queryByRole('textbox', { name: 'Video hakkında soru' })).not.toBeInTheDocument()
})
test('clicking a transcript seeks the authenticated video blob', async () => {
  render(<Videos courseId="course-1" />)
  const line = await screen.findByRole('button', { name: /1:05 A real timestamp/ })
  await waitFor(() => expect(screen.getByLabelText('Ders videosu')).toHaveAttribute('src', 'blob:authenticated-video'))
  fireEvent.click(line)
  expect(screen.getByLabelText('Ders videosu').currentTime).toBe(65)
  expect(api.videoFile).toHaveBeenCalledWith('course-1', 'video-1', expect.any(AbortSignal))
})
test('link import shows progress, preserves errors and submits to the current course', async () => {
  let reject
  api.importVideoLink.mockImplementation(() => new Promise((_, no) => { reject = no }))
  render(<Videos courseId="course-1" />)
  const field = screen.getByLabelText('YouTube veya Drive bağlantısı')
  fireEvent.change(field, { target: { value: 'https://youtu.be/BaW_jenozKc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Bağlantıdan ekle' }))
  expect(api.importVideoLink).toHaveBeenCalledWith('course-1', 'https://youtu.be/BaW_jenozKc', expect.any(AbortSignal))
  expect(screen.getByRole('button', { name: 'Video alınıyor…' })).toBeDisabled()
  reject(new Error('Video indirilemedi'))
  await screen.findByRole('alert')
  expect(field).toHaveValue('https://youtu.be/BaW_jenozKc')
})
