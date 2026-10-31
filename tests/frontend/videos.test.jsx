import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Videos from '../../src/pages/Videos'
import { validateVideoFile, videoTime, videoErrorText } from '../../src/lib/video'
import { api } from '../../src/api/endpoints'
vi.mock('../../src/api/endpoints', () => ({ api: { videos: vi.fn(), videoTranscript: vi.fn(), videoFrames: vi.fn(), videoFile: vi.fn(), videoFrame: vi.fn(), videoAnswer: vi.fn(), importVideoLink: vi.fn(), removeVideo: vi.fn(), videoProgress: vi.fn(), saveVideoProgress: vi.fn() } }))
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn() }) }))
vi.mock('../../src/components/PageBits', () => ({ MobileBar: () => null }))
beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:authenticated-video')
  URL.revokeObjectURL = vi.fn()
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 1 })
  api.videos.mockResolvedValue({ videos: [{ id: 'video-1', title: 'Lecture', status: 'indexed', frame_count: 1 }] })
  api.videoFile.mockResolvedValue(new Blob(['video']))
  api.videoTranscript.mockResolvedValue({ chunks: [{ text: 'A real timestamp contract', start_seconds: 65, end_seconds: 72 }] })
  api.videoFrames.mockResolvedValue({ frames: [] })
  api.videoProgress.mockResolvedValue({ video_id: 'video-1', duration_ms: 100000, position_ms: 65000,
    watched_ms: 5000, watched_percent: 5, intervals: [{ start_ms: 0, end_ms: 5000 }], revision: 1 })
  api.saveVideoProgress.mockResolvedValue({ video_id: 'video-1', duration_ms: 100000, position_ms: 65000,
    watched_ms: 5000, watched_percent: 5, intervals: [{ start_ms: 0, end_ms: 5000 }], revision: 2 })
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
test('a source click before video loading is applied once metadata is ready', async () => {
  let open
  api.videoFile.mockImplementation(() => new Promise(resolve => { open = resolve }))
  render(<Videos courseId="course-1" />)
  fireEvent.click(await screen.findByRole('button', { name: /1:05 A real timestamp/ }))
  expect(screen.queryByLabelText('Ders videosu')).not.toBeInTheDocument()
  open(new Blob(['video']))
  const video = await screen.findByLabelText('Ders videosu')
  fireEvent.loadedMetadata(video)
  expect(video.currentTime).toBe(65)
})
test('server progress is shown separately from mastery with a working resume control', async () => {
  render(<Videos courseId="course-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Kaldığın yere dön · 1:05' }))
  expect(screen.getByLabelText('Ders videosu').currentTime).toBe(65)
  expect(screen.getByRole('progressbar', { name: 'İzlenen video oranı' })).toHaveAttribute('aria-valuenow', '5')
  expect(screen.getByText(/Bu kayıt konu hâkimiyetini ölçmez/)).toBeInTheDocument()
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
test('removal requires confirmation and cancel never sends DELETE', async () => {
  render(<Videos courseId="course-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Lecture videosunu kaldır' }))
  expect(api.removeVideo).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
  expect(screen.queryByRole('button', { name: 'Kalıcı olarak sil' })).not.toBeInTheDocument()
  expect(api.removeVideo).not.toHaveBeenCalled()
})
test('successful deletion removes the selected video and revokes its blob', async () => {
  api.removeVideo.mockResolvedValue({ deleted: true, shared_asset_retained: false })
  render(<Videos courseId="course-1" />)
  await waitFor(() => expect(screen.getByLabelText('Ders videosu')).toHaveAttribute('src', 'blob:authenticated-video'))
  api.videos.mockResolvedValue({ videos: [] })
  fireEvent.click(screen.getByRole('button', { name: 'Lecture videosunu kaldır' }))
  fireEvent.click(screen.getByRole('button', { name: 'Kalıcı olarak sil' }))
  await screen.findByText('Video, transkript, kareler ve arama kayıtları kalıcı olarak silindi.')
  expect(api.removeVideo).toHaveBeenCalledWith('course-1', 'video-1')
  expect(screen.queryByLabelText('Ders videosu')).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authenticated-video')
})
test('failed cleanup keeps the card and displays the retry message', async () => {
  api.removeVideo.mockRejectedValue({ code: 'AI_SERVICE_UNAVAILABLE', message: 'Video tamamen silinemedi. Kayıt korundu; yeniden deneyin.' })
  render(<Videos courseId="course-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Lecture videosunu kaldır' }))
  fireEvent.click(screen.getByRole('button', { name: 'Kalıcı olarak sil' }))
  await screen.findByRole('alert')
  expect(screen.getByText('Lecture')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Kayıt korundu')
})
test('learning guidance carries playback context and both real actions use backend evidence', async () => {
  const guidance = { question: 'Prim nedir?', status: 'GUIDANCE', learning_state: 'UNWATCHED',
    answer: 'Bu bölümü henüz izlemedin.', evidence_id: '96c907cc-7835-4f00-8a91-91fd8486163a',
    relevant_segment: { start_ms: 20000, end_ms: 30000, title: 'Lecture', video_id: 'video-1' },
    citations: [{ n: 1, video_id: 'video-1', timestamp_ms: 20000, transcript: 'Gerçek kaynak' }],
    background_references: [], source_warnings: [] }
  api.videoAnswer.mockResolvedValueOnce(guidance).mockResolvedValueOnce({ ...guidance, status: 'EXPLANATION', answer: 'Kaynaklı açıklama [1]' })
  render(<Videos courseId="course-1" />)
  await screen.findByRole('button', { name: 'Kaldığın yere dön · 1:05' })
  fireEvent.change(screen.getByLabelText('Video hakkında soru'), { target: { value: 'Prim nedir?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sor', exact: true }))
  await screen.findByText('İlgili bölüm henüz izlenmedi')
  expect(api.videoAnswer).toHaveBeenNthCalledWith(1, 'course-1', 'video-1', 'Prim nedir?', expect.any(AbortSignal), { current_time_ms: 0 })
  expect(api.videoAnswer).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'İlgili bölüme git', exact: true }))
  expect(screen.getByLabelText('Ders videosu').currentTime).toBe(20)
  fireEvent.click(screen.getByRole('button', { name: 'Şimdi açıkla', exact: true }))
  await screen.findByText('Kaynaklı açıklama [1]')
  expect(api.videoAnswer).toHaveBeenNthCalledWith(2, 'course-1', 'video-1', 'Prim nedir?', expect.any(AbortSignal),
    { current_time_ms: 20000, explain_now: true, evidence_id: guidance.evidence_id })
})
test('unknown without a reliable timestamp does not manufacture jump/explain buttons', async () => {
  api.videoAnswer.mockResolvedValue({ question: 'Bilinmeyen', status: 'NO_RELIABLE_EVIDENCE', learning_state: 'UNKNOWN',
    answer: 'Güvenilir zaman bulunamadı.', relevant_segment: null, citations: [] })
  render(<Videos courseId="course-1" />)
  await screen.findByLabelText('Ders videosu')
  fireEvent.change(screen.getByLabelText('Video hakkında soru'), { target: { value: 'Bilinmeyen' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sor', exact: true }))
  await screen.findByText('İzlenme durumu belirsiz')
  expect(screen.queryByRole('button', { name: 'İlgili bölüme git' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Şimdi açıkla' })).not.toBeInTheDocument()
})
