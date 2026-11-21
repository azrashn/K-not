import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseExams from '../../src/pages/CourseExams'
import { api } from '../../src/api/endpoints'
import { ApiError } from '../../src/api/client'
import { averageExamCount, examFormProblem, examFromHash, examHash, examStatusText, fileProblem, rememberExam, topicsFromText } from '../../src/lib/exam'

vi.mock('../../src/api/endpoints')
const nav = vi.hoisted(() => vi.fn())
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: nav }) }))

const profile = { question_count: 4, formats: { MULTIPLE_CHOICE: 1, TRUE_FALSE: 1, CALCULATION: 1, OPEN: 1 }, topic_terms: ['graf'] }
const style = { id: '11111111-1111-4111-8111-111111111111', name: 'Final 2025', profile }
const q = (id, over = {}) => ({ id, kind: 'MULTIPLE_CHOICE', question: `Soru ${id}?`, options: ['Yığın', 'Kuyruk', 'Ağaç', 'Küme'], available: true, source: { title: 'Notlar' }, ...over })
const ready = { id: 'x1', title: 'Final 2025 — yeni sınav', status: 'READY', requested: 2, produced: 2, failures: [], note: null, questions: [q('q1'), q('q2', { kind: 'OPEN', options: [] })] }

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  api.examStyles.mockResolvedValue([style])
  api.exams.mockResolvedValue([])
  window.print = vi.fn()
})
afterEach(() => vi.useRealTimers())

test('helpers bound the form and describe progress', () => {
  expect(topicsFromText('BFS\n dfs, BFS ;; ')).toEqual(['BFS', 'dfs'])
  expect(examFormProblem({ styleIds: [], count: 5, hasStyleTopics: true, topics: [] })).toMatch(/En az bir geçmiş sınav/)
  expect(examFormProblem({ styleIds: ['a', 'b', 'c', 'd', 'e', 'f'], count: 5, hasStyleTopics: true, topics: [] })).toMatch(/En fazla 5/)
  expect(examFormProblem({ styleIds: ['a'], count: 21, hasStyleTopics: true, topics: [] })).toMatch(/1 ile 20/)
  expect(examFormProblem({ styleIds: ['a'], count: 3, hasStyleTopics: false, topics: [] })).toMatch(/konu/)
  expect(examFormProblem({ styleIds: ['a', 'b'], count: 3, hasStyleTopics: false, topics: ['x'] })).toBe('')
  expect(averageExamCount([{ question_count: 4 }, { question_count: 7 }])).toBe(6)
  expect(averageExamCount([{ question_count: 40 }])).toBe(20)
  expect(averageExamCount([])).toBeNull()
  expect(fileProblem({ name: 'a.exe', size: 5 })).toMatch(/PDF/)
  expect(fileProblem({ name: 'a.pdf', size: 6 * 1024 * 1024 })).toMatch(/5 MB/)
  expect(fileProblem({ name: 'a.docx', size: 10 })).toBe('')
  expect(examStatusText({ status: 'GENERATING', produced: 1, requested: 5 })).toBe('Hazırlanıyor · 1/5 soru')
})

test('uploading a past exam file saves a style and adds it to the selection', async () => {
  const user = userEvent.setup()
  const saved = { ...style, id: '22222222-2222-4222-8222-222222222222', name: 'Vize' }
  api.uploadExamStyleFile.mockResolvedValue(saved)
  render(<CourseExams courseId="c" />)
  await screen.findByText('Final 2025', { selector: 'strong' })
  const file = new File(['%PDF-1.4'], 'vize.pdf', { type: 'application/pdf' })
  await user.upload(screen.getByLabelText('Sınav dosyası'), file)
  await user.click(screen.getByRole('button', { name: 'Dosyayı oku' }))
  expect(api.uploadExamStyleFile).toHaveBeenCalledWith('c', file, '')
  expect(await screen.findByRole('checkbox', { name: /Vize/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /Final 2025/ })).toBeChecked()
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
  expect(await screen.findByRole('checkbox', { name: /Final 2025/ })).toBeChecked()
  await user.clear(screen.getByLabelText('Soru sayısı'))
  await user.type(screen.getByLabelText('Soru sayısı'), '2')
  await user.type(screen.getByLabelText('Konular'), 'BFS')
  await user.click(screen.getByRole('button', { name: 'Sınavı hazırla' }))
  expect(api.createExam).toHaveBeenCalledWith('c', { exam_style_ids: [style.id], count: 2, topics: ['BFS'] })
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

test('a question whose source was removed is not shown, and a question is solved on the exam page', async () => {
  const user = userEvent.setup()
  api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
  api.exam.mockResolvedValue({ ...ready, questions: [q('q1'), { id: 'q2', kind: 'OPEN', available: false }] })
  render(<CourseExams courseId="c" />)
  await user.click(await screen.findByRole('button', { name: /Final 2025 — yeni sınav Hazır/ }))
  expect(await screen.findByText(/kaynağı kaldırıldı/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Bu soruyu çöz' }))
  // Not the practice page: the removed question is left out of the count.
  expect(nav).not.toHaveBeenCalled()
  const solver = screen.getByRole('region', { name: 'Sınavı çöz' })
  expect(within(solver).getByText('Soru 1 / 1')).toBeInTheDocument()
  expect(within(solver).getByRole('heading', { name: 'Soru q1?' })).toBeInTheDocument()
})

describe('solving the exam on its page', () => {
  const three = { ...ready, requested: 3, produced: 3, questions: [q('q1'), q('q2'), q('q3', { kind: 'OPEN', options: [] })] }
  const graded = { q1: { score: 0, message: 'Kaynağı tekrar incele.', quote: 'Kuyruk FIFO çalışır.', explanation: 'Kuyrukta ilk giren ilk çıkar.', source: { id: 's1', material_id: 'pdf_a' } },
    q2: { score: 1, message: 'Doğru.', quote: 'Yığın LIFO çalışır.', source: { id: 's2', material_id: 'pdf_a' } },
    q3: { score: null, message: 'Yanıtın kaydedildi.', quote: 'Ağaç hiyerarşiktir.' } }

  beforeEach(() => {
    api.exams.mockResolvedValue([{ ...three, questions: undefined }])
    api.exam.mockResolvedValue(three)
    api.answerQuiz.mockImplementation(async (_c, id) => graded[id])
  })

  test('one question at a time with Önceki / Sonraki, feedback with explanation and source, then a summary', async () => {
    const user = userEvent.setup()
    render(<CourseExams courseId="c" />)
    await user.click(await screen.findByRole('button', { name: /Final 2025 — yeni sınav Hazır/ }))
    await user.click(await screen.findByRole('button', { name: 'Sınavı çöz' }))
    const solver = () => screen.getByRole('region', { name: 'Sınavı çöz' })
    expect(within(solver()).getByText('Soru 1 / 3')).toBeInTheDocument()
    expect(within(solver()).getByRole('button', { name: '← Önceki' })).toBeDisabled()
    // The print buttons stay while solving.
    expect(screen.getByRole('button', { name: 'Yazdır / PDF olarak kaydet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cevap anahtarıyla yazdır' })).toBeInTheDocument()

    await user.click(within(solver()).getByLabelText('Kuyruk'))
    await user.click(within(solver()).getByRole('button', { name: 'Yanıtı değerlendir' }))
    // Saved on the exam question itself: its purpose (EXAM) puts it under "Sınavdan".
    expect(api.answerQuiz).toHaveBeenCalledWith('c', 'q1', '1')
    const feedback = await within(solver()).findByLabelText('Alıştırma geri bildirimi')
    expect(within(feedback).getByText('Kuyrukta ilk giren ilk çıkar.')).toBeInTheDocument()
    expect(within(feedback).getByText('Kuyruk FIFO çalışır.')).toBeInTheDocument()
    await user.click(within(feedback).getByRole('button', { name: 'İlgili kaynağı aç →' }))
    expect(nav).toHaveBeenCalledWith('/dersler/c/ogrenme', { openSource: { id: 's1', material_id: 'pdf_a', quote: 'Kuyruk FIFO çalışır.' } })

    await user.click(within(solver()).getByRole('button', { name: 'Sonraki →' }))
    expect(within(solver()).getByText('Soru 2 / 3')).toBeInTheDocument()
    await user.click(within(solver()).getByLabelText('Yığın'))
    await user.click(within(solver()).getByRole('button', { name: 'Yanıtı değerlendir' }))
    await within(solver()).findByText('Doğru.')
    await user.click(within(solver()).getByRole('button', { name: '← Önceki' }))
    // Going back keeps the earlier result.
    expect(within(solver()).getByText('Kaynağı tekrar incele.')).toBeInTheDocument()
    await user.click(within(solver()).getByRole('button', { name: 'Sonraki →' }))
    await user.click(within(solver()).getByRole('button', { name: 'Sonraki →' }))
    expect(within(solver()).getByText('Soru 3 / 3')).toBeInTheDocument()
    await user.type(within(solver()).getByLabelText('Yanıtın'), 'Hiyerarşik yapı')
    await user.click(within(solver()).getByRole('button', { name: 'Yanıtı değerlendir' }))
    await within(solver()).findByText('Yanıtın kaydedildi.')

    await user.click(within(solver()).getByRole('button', { name: 'Özeti gör' }))
    const summary = screen.getByRole('region', { name: 'Sınav özeti' })
    expect(summary).toHaveTextContent('3 sorudan 3 tanesi yanıtlandı; 1 tanesi cevap anahtarıyla eşleşti.')
    expect(summary).toHaveTextContent('1 yanıt kaydedildi ama otomatik puanlanmadı (açık uçlu).')
    await user.click(within(summary).getByRole('button', { name: 'Soru 1: Soru q1?' }))
    expect(within(solver()).getByText('Soru 1 / 3')).toBeInTheDocument()
    expect(within(solver()).getByText('Kaynağı tekrar incele.')).toBeInTheDocument()
  })

  test('the summary counts unanswered questions and lists none as wrong when nothing was graded wrong', async () => {
    const user = userEvent.setup()
    render(<CourseExams courseId="c" />)
    await user.click(await screen.findByRole('button', { name: /Final 2025 — yeni sınav Hazır/ }))
    await user.click(await screen.findByRole('button', { name: 'Sınavı çöz' }))
    for (let i = 0; i < 2; i++) await user.click(screen.getByRole('button', { name: 'Sonraki →' }))
    await user.click(screen.getByRole('button', { name: 'Özeti gör' }))
    const summary = screen.getByRole('region', { name: 'Sınav özeti' })
    expect(summary).toHaveTextContent('3 sorudan 0 tanesi yanıtlandı; 0 tanesi cevap anahtarıyla eşleşti.')
    expect(summary).toHaveTextContent('3 soru yanıtlanmadı.')
    expect(within(summary).queryByText('Yanlış yanıtlananlar')).toBeNull()
  })
})

describe('the open exam is kept in the address', () => {
  afterEach(() => window.history.replaceState(null, '', '#'))

  test('coming back or reloading with ?exam= opens the same exam', async () => {
    window.history.replaceState(null, '', '#/dersler/c/sinavlar?exam=x1')
    api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
    api.exam.mockResolvedValue(ready)
    render(<CourseExams courseId="c" />)
    expect(await screen.findByText('Soru q1?')).toBeInTheDocument()
    expect(api.exam).toHaveBeenCalledWith('c', 'x1', expect.any(AbortSignal))
  })

  test('opening an exam writes it into the address; deleting it removes it', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '#/dersler/c/sinavlar')
    api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
    api.exam.mockResolvedValue(ready)
    api.deleteExam.mockResolvedValue({ deleted: true })
    render(<CourseExams courseId="c" />)
    await user.click(await screen.findByRole('button', { name: /Final 2025 — yeni sınav Hazır/ }))
    await screen.findByText('Soru q1?')
    expect(window.location.hash).toBe('#/dersler/c/sinavlar?exam=x1')
    await user.click(screen.getByRole('button', { name: /sınavını sil/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/sinavlar'))
  })

  test('an exam in the address that no longer exists opens nothing and is dropped', async () => {
    window.history.replaceState(null, '', '#/dersler/c/sinavlar?exam=gone')
    api.exam.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Exam not found' }))
    render(<CourseExams courseId="c" />)
    await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/sinavlar'))
    expect(screen.getByText('Henüz sınav seçilmedi')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  describe('back to the question being solved', () => {
    const recorded = {
      q1: { id: 'a1', score: 0, response: '1', message: 'Kaynağı tekrar incele.', explanation: 'Kuyruk FIFO çalışır.',
        quote: 'BFS bekleyen düğümleri\nkuyrukta tutar.', source: { id: 's1', material_id: 'pdf_a' } },
      q3: { id: 'a3', score: 1, response: '0', message: 'Doğru.', quote: 'Ağaç hiyerarşiktir.' },
    }
    const three = (answers = recorded) => ({ ...ready, requested: 3, produced: 3,
      questions: ['q1', 'q2', 'q3'].map((id) => q(id, { last_answer: answers[id] ?? null })) })

    test('the address in solve mode reopens that question; earlier answers come from the server with their feedback', async () => {
      const user = userEvent.setup()
      window.history.replaceState(null, '', '#/dersler/c/sinavlar?exam=x1&mode=solve&q=2')
      api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
      api.exam.mockResolvedValue(three())
      render(<CourseExams courseId="c" />)
      const solver = await screen.findByRole('region', { name: 'Sınavı çöz' })
      expect(within(solver).getByText('Soru 2 / 3')).toBeInTheDocument()
      expect(within(solver).queryByLabelText('Alıştırma geri bildirimi')).toBeNull() // q2 not answered yet
      await user.click(within(solver).getByRole('button', { name: '← Önceki' }))
      const feedback = within(screen.getByRole('region', { name: 'Sınavı çöz' })).getByLabelText('Alıştırma geri bildirimi')
      expect(within(feedback).getByText('Kaynağı tekrar incele.')).toBeInTheDocument()
      expect(within(feedback).getByText('Kuyruk FIFO çalışır.')).toBeInTheDocument()
      // The stored quote keeps the PDF line break (it must match the source); it is shown on one line.
      expect(within(feedback).getByText('BFS bekleyen düğümleri kuyrukta tutar.')).toBeInTheDocument()
      expect(screen.getByLabelText('Kuyruk')).toBeChecked() // the answer given
      expect(window.location.hash).toBe('#/dersler/c/sinavlar?exam=x1&mode=solve&q=1')
      // The summary counts the recorded answers, so a reload does not reset it.
      await user.click(screen.getByRole('button', { name: 'Sonraki →' }))
      await user.click(screen.getByRole('button', { name: 'Sonraki →' }))
      await user.click(screen.getByRole('button', { name: 'Özeti gör' }))
      expect(screen.getByRole('region', { name: 'Sınav özeti' })).toHaveTextContent('3 sorudan 2 tanesi yanıtlandı; 1 tanesi cevap anahtarıyla eşleşti.')
    })

    test('solving writes mode and question into the address and the tab record; "Sınav kâğıdına dön" clears the record', async () => {
      const user = userEvent.setup()
      window.history.replaceState(null, '', '#/dersler/c/sinavlar')
      api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
      api.exam.mockResolvedValue(three({}))
      render(<CourseExams courseId="c" />)
      await user.click(await screen.findByRole('button', { name: /Final 2025 — yeni sınav Hazır/ }))
      await user.click(await screen.findByRole('button', { name: 'Sınavı çöz' }))
      await user.click(screen.getByRole('button', { name: 'Sonraki →' }))
      expect(window.location.hash).toBe('#/dersler/c/sinavlar?exam=x1&mode=solve&q=2')
      expect(JSON.parse(sessionStorage.getItem('knot.resume.exam.c'))).toEqual({ id: 'x1', q: 2 })
      await user.click(screen.getAllByRole('button', { name: 'Sınav kâğıdına dön' })[0])
      expect(window.location.hash).toBe('#/dersler/c/sinavlar?exam=x1')
      expect(sessionStorage.getItem('knot.resume.exam.c')).toBeNull()
    })

    test('opened from the menu (no exam in the address): the unfinished exam of this tab, at its question', async () => {
      window.history.replaceState(null, '', '#/dersler/c/sinavlar')
      sessionStorage.setItem('knot.resume.exam.c', JSON.stringify({ id: 'x1', q: 2 }))
      api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
      api.exam.mockResolvedValue(three())
      render(<CourseExams courseId="c" />)
      const solver = await screen.findByRole('region', { name: 'Sınavı çöz' })
      expect(within(solver).getByText('Soru 2 / 3')).toBeInTheDocument()
      expect(api.exam).toHaveBeenCalledWith('c', 'x1', expect.any(AbortSignal))
      await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/sinavlar?exam=x1&mode=solve&q=2'))
    })

    test('a finished exam (every question answered) is not reopened from the record', async () => {
      window.history.replaceState(null, '', '#/dersler/c/sinavlar')
      sessionStorage.setItem('knot.resume.exam.c', JSON.stringify({ id: 'x1', q: 3 }))
      api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
      api.exam.mockResolvedValue(three({ ...recorded, q2: { score: 1, message: 'Doğru.' } }))
      render(<CourseExams courseId="c" />)
      await waitFor(() => expect(sessionStorage.getItem('knot.resume.exam.c')).toBeNull())
      expect(screen.getByText('Henüz sınav seçilmedi')).toBeInTheDocument()
    })

    test('storage that cannot be read is no error: nothing is reopened', async () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
      window.history.replaceState(null, '', '#/dersler/c/sinavlar')
      api.exams.mockResolvedValue([])
      render(<CourseExams courseId="c" />)
      expect(await screen.findByText('Henüz sınav seçilmedi')).toBeInTheDocument()
      expect(api.exam).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    test('"İlgili kaynağı aç" carries the way back to this question', async () => {
      const user = userEvent.setup()
      window.history.replaceState(null, '', '#/dersler/c/sinavlar?exam=x1&mode=solve&q=1')
      api.exams.mockResolvedValue([{ ...ready, questions: undefined }])
      api.exam.mockResolvedValue(three())
      render(<CourseExams courseId="c" />)
      const solver = await screen.findByRole('region', { name: 'Sınavı çöz' })
      await user.click(within(solver).getByRole('button', { name: 'İlgili kaynağı aç →' }))
      expect(nav).toHaveBeenCalledWith('/dersler/c/ogrenme', {
        openSource: { id: 's1', material_id: 'pdf_a', quote: 'BFS bekleyen düğümleri\nkuyrukta tutar.' },
        returnTo: '/dersler/c/sinavlar?exam=x1&mode=solve&q=1',
      })
    })
  })

  test('on another page the address is left alone', () => {
    window.history.replaceState(null, '', '#/dersler/c/quiz')
    rememberExam('c', 'x1')
    expect(window.location.hash).toBe('#/dersler/c/quiz')
    expect(examFromHash('#/dersler/c/sinavlar?exam=x1')).toBe('x1')
    expect(examFromHash('#/dersler/c/sinavlar?exam=<script>')).toBeNull()
    expect(examHash('c', null)).toBe('#/dersler/c/sinavlar')
  })
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

describe('choosing several past exams', () => {
  const vize = { id: '22222222-2222-4222-8222-222222222222', name: 'Vize 2025', profile: { ...profile, question_count: 7, topic_terms: [] } }
  const styles = (n) => Array.from({ length: n }, (_, i) => ({ id: `3333333${i}-3333-4333-8333-333333333333`, name: `Sınav ${i + 1}`, profile }))

  test('several exams are sent together, in the order chosen, with the average size prefilled', async () => {
    const user = userEvent.setup()
    api.examStyles.mockResolvedValue([style, vize])
    api.createExam.mockResolvedValue({ id: 'x1', title: '2 geçmiş sınavdan yeni sınav', status: 'GENERATING', requested: 6, produced: 0, failures: [] })
    api.exam.mockReturnValue(new Promise(() => undefined))
    render(<CourseExams courseId="c" />)
    expect(await screen.findByRole('checkbox', { name: /Final 2025/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Vize 2025/ })).not.toBeChecked()
    expect(screen.getByLabelText('Soru sayısı')).toHaveValue(4)
    await user.click(screen.getByRole('checkbox', { name: /Vize 2025/ }))
    expect(screen.getByLabelText('Soru sayısı')).toHaveValue(6) // (4 + 7) / 2, rounded
    expect(screen.getByText(/Seçilen 2 sınavın/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sınavı hazırla' }))
    expect(api.createExam).toHaveBeenCalledWith('c', { exam_style_ids: [style.id, vize.id], count: 6 })
  })

  test('each option shows the name, the style summary below it and the question count', async () => {
    api.examStyles.mockResolvedValue([style, vize])
    render(<CourseExams courseId="c" />)
    const group = await screen.findByRole('group', { name: 'Geçmiş sınavlar' })
    const option = within(group).getByRole('checkbox', { name: /Final 2025/ }).closest('label')
    expect(option.querySelector('.exam-style-name')).toHaveTextContent('Final 2025')
    // The count is shown once, on the badge; the summary starts with the kind mix.
    expect(option.querySelector('.exam-style-summary').textContent).toBe('çoktan seçmeli 1 · doğru/yanlış 1 · hesaplama 1 · açık uçlu 1')
    expect(option.querySelector('.exam-style-count')).toHaveTextContent('4 soru')
    // Elsewhere (the saved-styles list) the summary keeps its count.
    expect(screen.getAllByText('4 soru · çoktan seçmeli 1 · doğru/yanlış 1 · hesaplama 1 · açık uçlu 1', { selector: '.resume-row small' })).toHaveLength(1)
    // checkbox, text column, badge: in this order, on one row
    expect([...option.children].map((el) => el.className || el.type)).toEqual(['checkbox', 'exam-style-text', 'exam-style-count'])
  })

  test('a size the student typed is kept when the selection changes', async () => {
    const user = userEvent.setup()
    api.examStyles.mockResolvedValue([style, vize])
    render(<CourseExams courseId="c" />)
    await screen.findByRole('checkbox', { name: /Final 2025/ })
    await user.clear(screen.getByLabelText('Soru sayısı'))
    await user.type(screen.getByLabelText('Soru sayısı'), '12')
    await user.click(screen.getByRole('checkbox', { name: /Vize 2025/ }))
    expect(screen.getByLabelText('Soru sayısı')).toHaveValue(12)
  })

  test('with nothing selected the exam cannot be prepared', async () => {
    const user = userEvent.setup()
    render(<CourseExams courseId="c" />)
    await user.click(await screen.findByRole('checkbox', { name: /Final 2025/ }))
    expect(screen.getByRole('button', { name: 'Sınavı hazırla' })).toBeDisabled()
  })

  test('topics are needed only when none of the selected exams has terms', async () => {
    const user = userEvent.setup()
    api.examStyles.mockResolvedValue([vize])
    render(<CourseExams courseId="c" />)
    await screen.findByRole('checkbox', { name: /Vize 2025/ })
    await user.click(screen.getByRole('button', { name: 'Sınavı hazırla' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Seçilen sınavlarda yeterli terim yok')
    expect(api.createExam).not.toHaveBeenCalled()
  })

  test('at most five exams can be selected', async () => {
    const user = userEvent.setup()
    api.examStyles.mockResolvedValue(styles(6))
    render(<CourseExams courseId="c" />)
    await screen.findByRole('checkbox', { name: /Sınav 1/ })
    for (let i = 2; i <= 5; i++) await user.click(screen.getByRole('checkbox', { name: new RegExp(`Sınav ${i}`) }))
    expect(screen.getByRole('checkbox', { name: /Sınav 6/ })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Sınav 5/ }))
    expect(screen.getByRole('checkbox', { name: /Sınav 6/ })).toBeEnabled()
  })

  test('a deleted style leaves the selection', async () => {
    const user = userEvent.setup()
    api.deleteExamStyle.mockResolvedValue({ deleted: true })
    render(<CourseExams courseId="c" />)
    await screen.findByRole('checkbox', { name: /Final 2025/ })
    await user.click(screen.getByRole('button', { name: 'Stili sil' }))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Final 2025/ })).toBeNull())
    expect(screen.getByRole('button', { name: 'Sınavı hazırla' })).toBeDisabled()
  })
})
