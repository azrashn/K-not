import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseExams from '../../src/pages/CourseExams'
import { api } from '../../src/api/endpoints'
import { ApiError } from '../../src/api/client'
import { examFormProblem, examStatusText, fileProblem, topicsFromText } from '../../src/lib/exam'

vi.mock('../../src/api/endpoints')
const nav = vi.hoisted(() => vi.fn())
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: nav }) }))

const profile = { question_count: 4, formats: { MULTIPLE_CHOICE: 1, TRUE_FALSE: 1, CALCULATION: 1, OPEN: 1 }, topic_terms: ['graf'] }
const style = { id: '11111111-1111-4111-8111-111111111111', name: 'Final 2025', profile }
const q = (id, over = {}) => ({ id, kind: 'MULTIPLE_CHOICE', question: `Soru ${id}?`, options: ['Yığın', 'Kuyruk', 'Ağaç', 'Küme'], available: true, source: { title: 'Notlar' }, ...over })
const ready = { id: 'x1', title: 'Final 2025 — yeni sınav', status: 'READY', requested: 2, produced: 2, failures: [], note: null, questions: [q('q1'), q('q2', { kind: 'OPEN', options: [] })] }

beforeEach(() => {
  vi.resetAllMocks()
  api.examStyles.mockResolvedValue([style])
  api.exams.mockResolvedValue([])
  window.print = vi.fn()
})
afterEach(() => vi.useRealTimers())

test('helpers bound the form and describe progress', () => {
  expect(topicsFromText('BFS\n dfs, BFS ;; ')).toEqual(['BFS', 'dfs'])
  expect(examFormProblem({ styleId: '', count: 5, hasStyleTopics: true, topics: [] })).toMatch(/stil/)
  expect(examFormProblem({ styleId: 'a', count: 21, hasStyleTopics: true, topics: [] })).toMatch(/1 ile 20/)
  expect(examFormProblem({ styleId: 'a', count: 3, hasStyleTopics: false, topics: [] })).toMatch(/konu/)
  expect(examFormProblem({ styleId: 'a', count: 3, hasStyleTopics: false, topics: ['x'] })).toBe('')
  expect(fileProblem({ name: 'a.exe', size: 5 })).toMatch(/PDF/)
  expect(fileProblem({ name: 'a.pdf', size: 6 * 1024 * 1024 })).toMatch(/5 MB/)
  expect(fileProblem({ name: 'a.docx', size: 10 })).toBe('')
  expect(examStatusText({ status: 'GENERATING', produced: 1, requested: 5 })).toBe('Hazırlanıyor · 1/5 soru')
})

test('uploading a past exam file saves a style and selects it', async () => {
  const user = userEvent.setup()
  const saved = { ...style, id: '22222222-2222-4222-8222-222222222222', name: 'Vize' }
  api.uploadExamStyleFile.mockResolvedValue(saved)
  render(<CourseExams courseId="c" />)
  await screen.findByText('Final 2025', { selector: 'strong' })
  const file = new File(['%PDF-1.4'], 'vize.pdf', { type: 'application/pdf' })
  await user.upload(screen.getByLabelText('Sınav dosyası'), file)
  await user.click(screen.getByRole('button', { name: 'Dosyayı oku' }))
  expect(api.uploadExamStyleFile).toHaveBeenCalledWith('c', file, '')
  expect(await screen.findByLabelText('Sınav stili')).toHaveValue(saved.id)
})

test('an unsupported file is refused in the page without a request', async () => {
  const user = userEvent.setup({ applyAccept: false })
  render(<CourseExams courseId="c" />)
  await screen.findByText('Final 2025', { selector: 'strong' })
  await user.upload(screen.getByLabelText('Sınav dosyası'), new File(['MZ'], 'virus.exe'))
  await user.click(screen.getByRole('button', { name: 'Dosyayı oku' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF')
  expect(api.uploadExamStyleFile).not.toHaveBeenCalled()
})

test('server refusal of an unreadable file is shown as is', async () => {
  const user = userEvent.setup()
  api.uploadExamStyleFile.mockRejectedValue(new ApiError({ status: 422, code: 'VALIDATION_ERROR', message: 'Dosyadan metin okunamadı (taranmış PDF olabilir).' }))
  render(<CourseExams courseId="c" />)
  await user.upload(await screen.findByLabelText('Sınav dosyası'), new File(['%PDF-'], 'scan.pdf'))
  await user.click(screen.getByRole('button', { name: 'Dosyayı oku' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('taranmış PDF')
})

test('generating an exam shows progress until it is ready, then the questions', async () => {
  const user = userEvent.setup()
  const started = { id: 'x1', title: ready.title, status: 'GENERATING', requested: 2, produced: 0, failures: [] }
  api.createExam.mockResolvedValue(started)
  api.exam
    .mockResolvedValueOnce({ ...started, produced: 1, questions: [q('q1')] })
    .mockResolvedValue(ready)
  render(<CourseExams courseId="c" pollMs={10} />)
  await screen.findByLabelText('Sınav stili')
  await user.clear(screen.getByLabelText('Soru sayısı'))
  await user.type(screen.getByLabelText('Soru sayısı'), '2')
  await user.type(screen.getByLabelText('Konular'), 'BFS')
  await user.click(screen.getByRole('button', { name: 'Sınavı hazırla' }))
  expect(api.createExam).toHaveBeenCalledWith('c', { exam_style_id: style.id, count: 2, topics: ['BFS'] })
  expect(await screen.findByRole('status')).toHaveTextContent('Hazırlanıyor')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Hazır · 2/2 soru'))
  expect(screen.getByText('Soru q1?')).toBeInTheDocument()
  expect(screen.getByText('B) Kuyruk')).toBeInTheDocument()
})

test('failures and a partial note are listed, never hidden', async () => {
  const user = userEvent.setup()
  api.exams.mockResolvedValue([{ id: 'x1', title: 'T', status: 'PARTIAL', requested: 3, produced: 1, failures: [], note: null }])
  api.exam.mockResolvedValue({ id: 'x1', title: 'T', status: 'PARTIAL', requested: 3, produced: 1, note: "3 sorudan 1'i hazırlanabildi; kalanı için yeterli kaynak bulunamadı.", failures: [{ topic: 'Nothing', kind: 'OPEN', reason: 'Bu konuda kaynak bulunamadı.' }], questions: [q('q1')] })
  render(<CourseExams courseId="c" />)
  await user.click(await screen.findByRole('button', { name: /T Kısmen hazır/ }))
  expect(await screen.findByText(/3 sorudan 1'i hazırlanabildi/)).toBeInTheDocument()
  expect(screen.getByText('Hazırlanamayan 1 deneme')).toBeInTheDocument()
  expect(screen.getByText('Bu konuda kaynak bulunamadı.', { exact: false, selector: 'li' })).toBeInTheDocument()
})

test('printing with the key loads the answer key once and opens the print dialog', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
  api.exam.mockResolvedValue(ready)
  api.examKey.mockResolvedValue({ id: 'x1', key: [
    { index: 1, quiz_id: 'q1', available: true, expected: 'Kuyruk', explanation: 'FIFO.' },
    { index: 2, quiz_id: 'q2', available: true, expected: null, explanation: null },
  ] })
  render(<CourseExams courseId="c" />)
  await user.click(await screen.findByRole('button', { name: /Final 2025 — yeni sınav Hazır/ }))
  await screen.findByText('Soru q1?')
  expect(screen.queryByLabelText('Cevap anahtarı')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Cevap anahtarıyla yazdır' }))
  const keySection = await screen.findByLabelText('Cevap anahtarı')
  expect(within(keySection).getByText('Kuyruk')).toBeInTheDocument()
  expect(within(keySection).getByText(/öğretmen değerlendirir/)).toBeInTheDocument()
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
  await user.click(screen.getByRole('button', { name: 'Yazdır / PDF olarak kaydet' }))
  expect(api.examKey).toHaveBeenCalledTimes(1)
})

test('a question whose source was removed is not shown, and a question can be solved from the exam', async () => {
  const user = userEvent.setup()
  api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
  api.exam.mockResolvedValue({ ...ready, questions: [q('q1'), { id: 'q2', kind: 'OPEN', available: false }] })
  render(<CourseExams courseId="c" />)
  await user.click(await screen.findByRole('button', { name: /Final 2025 — yeni sınav Hazır/ }))
  expect(await screen.findByText(/kaynağı kaldırıldı/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Bu soruyu çöz' }))
  expect(nav).toHaveBeenCalledWith('/dersler/c/quiz', { quizId: 'q1' })
})

test('a running exam is picked up again when the page is reopened', async () => {
  api.exams.mockResolvedValue([{ id: 'x9', title: 'Sürüyor', status: 'GENERATING', requested: 3, produced: 1, failures: [] }])
  api.exam.mockResolvedValue({ id: 'x9', title: 'Sürüyor', status: 'READY', requested: 3, produced: 3, failures: [], questions: [q('a'), q('b'), q('c')] })
  render(<CourseExams courseId="c" pollMs={10} />)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Hazır · 3/3 soru'))
})

test('removing a style and an exam calls the server', async () => {
  const user = userEvent.setup()
  api.deleteExamStyle.mockResolvedValue({ deleted: true })
  api.deleteExam.mockResolvedValue({ deleted: true })
  api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
  render(<CourseExams courseId="c" />)
  await user.click(await screen.findByRole('button', { name: 'Stili sil' }))
  expect(api.deleteExamStyle).toHaveBeenCalledWith('c', style.id)
  await user.click(await screen.findByRole('button', { name: /sınavını sil/ }))
  expect(api.deleteExam).toHaveBeenCalledWith('c', 'x1')
})
