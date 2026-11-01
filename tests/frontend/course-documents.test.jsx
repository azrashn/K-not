import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { COURSE, doc, envelope, fakeApi, signIn } from './fake-api'

const C = COURSE.id
const open = () => { signIn(); window.location.hash = `#/dersler/${C}`; return render(<App />) }
const row = (id) => document.querySelector(`[data-material="${id}"]`)
const pdf = (name = 'Hafta5_Heap.pdf', size) => {
  const f = new File(['%PDF-1.4 test'], name, { type: 'application/pdf' })
  if (size) Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('document list, status and polling', () => {
  test('shows real statuses, Turkish failure reasons and only valid actions', async () => {
    fakeApi({
      [`GET /courses/${C}`]: { body: COURSE },
      [`GET /courses/${C}/documents`]: { body: [
        doc('ready1', 'READY'),
        doc('scan1', 'FAILED', { status: { state: 'FAILED', ui_state: 'error', stage: null, updated_at: '', error: { code: 'NO_TEXT_LAYER', message_tr: 'Taranmış sayfalar okunamadı. Metin içeren bir PDF yükleyebilirsin.', retryable: false } } }),
        doc('crypt1', 'FAILED', { status: { state: 'FAILED', ui_state: 'error', stage: null, updated_at: '', error: { code: 'ENCRYPTED_PDF', message_tr: 'Dosya parola korumalı. Korumasız bir kopya yükleyebilirsin.', retryable: false } } }),
        doc('flaky1', 'FAILED', { status: { state: 'FAILED', ui_state: 'error', stage: null, updated_at: '', error: { code: 'INDEX_UNAVAILABLE', message_tr: 'Hazırlanırken bir sorun oluştu; tekrar deneniyor.', retryable: true } } }),
        doc('course1', 'READY', { visibility: 'COURSE', can_delete: false, owner_id: 'other' }),
      ] },
    })
    open()
    await screen.findByText('scan1.pdf')
    expect(within(row('scan1')).getByText('Taranmış sayfalar okunamadı. Metin içeren bir PDF yükleyebilirsin.')).toBeInTheDocument()
    expect(within(row('crypt1')).getByText(/parola korumalı/)).toBeInTheDocument()
    expect(within(row('scan1')).queryByRole('button', { name: /Yeniden dene/ })).not.toBeInTheDocument() // not retryable
    expect(within(row('flaky1')).getByRole('button', { name: /Yeniden dene/ })).toBeInTheDocument()
    expect(within(row('course1')).queryByRole('button', { name: /sil/ })).not.toBeInTheDocument() // can_delete false
    expect(within(row('course1')).getByLabelText('Tüm derse açık')).toBeInTheDocument()
    expect(within(row('ready1')).getByText('Kaynakta aç')).toBeInTheDocument()
  })

  test('polls every 3 s while processing, stops when terminal and on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const states = ['UPLOADED', 'EXTRACTING', 'INDEXING', 'READY']
    let i = 0
    const { calls } = fakeApi({
      [`GET /courses/${C}`]: { body: COURSE },
      [`GET /courses/${C}/documents`]: () => ({ body: [doc('d1', states[Math.min(i++, 3)])] }),
    })
    const { unmount } = open()
    await screen.findByText('Yüklendi')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(await screen.findByText('Okunuyor')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(await screen.findByText('Hazırlanıyor')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(await screen.findByText('Hazır')).toBeInTheDocument()
    const polls = calls.filter((c) => c.path === `/courses/${C}/documents`).length
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(calls.filter((c) => c.path === `/courses/${C}/documents`)).toHaveLength(polls) // terminal: no more polling
    unmount()
  })

  test('unmounting during processing stops the poll timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { calls } = fakeApi({ [`GET /courses/${C}`]: { body: COURSE }, [`GET /courses/${C}/documents`]: { body: [doc('d1', 'EMBEDDING')] } })
    const { unmount } = open()
    await screen.findByText('Hazırlanıyor')
    unmount()
    const before = calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(calls).toHaveLength(before)
  })
})

describe('upload, retry, delete, download', () => {
  const base = (docs) => ({ [`GET /courses/${C}`]: { body: COURSE }, [`GET /courses/${C}/documents`]: () => ({ body: docs() }) })

  test('rejects non-PDF and oversized files before any request', async () => {
    const { calls } = fakeApi(base(() => []))
    open()
    const user = userEvent.setup({ applyAccept: false })
    await user.click(await screen.findByRole('button', { name: /Materyal ekle/ }))
    await user.upload(screen.getByLabelText('Dosya seç'), [new File(['x'], 'sunum.pptx', { type: 'application/vnd.ms-powerpoint' }), pdf('buyuk.pdf', 31 * 1024 * 1024)])
    expect(await screen.findByText('sunum.pptx: Yalnızca PDF dosyaları yüklenebilir.')).toBeInTheDocument()
    expect(screen.getByText('buyuk.pdf: Dosya çok büyük (en fazla 30 MB).')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    expect(screen.getByLabelText('Dosya seç')).toHaveAttribute('accept', '.pdf,application/pdf')
  })

  test('uploads a PDF with the chosen type; students cannot pick COURSE visibility', async () => {
    let docs = []
    const { calls } = fakeApi({
      ...base(() => docs),
      [`POST /courses/${C}/documents`]: ({ init }) => { docs = [doc('new1', 'UPLOADED', { original_filename: init.body.get('file').name })]; return { status: 201, body: docs[0] } },
    })
    open()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Materyal ekle/ }))
    expect(screen.queryByLabelText('Görünürlük')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Yüklenecek dosyanın türü'), 'notes')
    await user.upload(screen.getByLabelText('Dosya seç'), pdf())
    expect(await screen.findByText('Hafta5_Heap.pdf')).toBeInTheDocument()
    const post = calls.find((c) => c.method === 'POST')
    expect(post.body.get('document_type')).toBe('notes')
    expect(post.body.get('visibility')).toBe('PRIVATE')
  })

  test('server-side upload errors are shown in Turkish (duplicate, 413, 415, encrypted is reported later)', async () => {
    const errors = [
      { status: 409, body: envelope('DUPLICATE_DOCUMENT', 'dup', { details: { existing_document_id: 'x' } }) },
      { status: 413, body: envelope('PAYLOAD_TOO_LARGE') },
      { status: 415, body: envelope('UNSUPPORTED_MEDIA_TYPE') },
    ]
    fakeApi({ ...base(() => []), [`POST /courses/${C}/documents`]: () => errors.shift() })
    open()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Materyal ekle/ }))
    for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) await user.upload(screen.getByLabelText('Dosya seç'), pdf(name))
    expect(await screen.findByText('a.pdf: Bu dosyayı bu derse zaten yüklemişsin.')).toBeInTheDocument()
    expect(await screen.findByText('b.pdf: Dosya çok büyük (en fazla 30 MB).')).toBeInTheDocument()
    expect(await screen.findByText('c.pdf: Yalnızca PDF dosyaları yüklenebilir.')).toBeInTheDocument()
  })

  test('instructors can choose COURSE visibility', async () => {
    const { calls } = fakeApi({ [`GET /courses/${C}`]: { body: { ...COURSE, my_role: 'INSTRUCTOR' } }, [`GET /courses/${C}/documents`]: { body: [] },
      [`POST /courses/${C}/documents`]: { status: 201, body: doc('n', 'UPLOADED') } })
    open()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Materyal ekle/ }))
    await user.selectOptions(screen.getByLabelText('Görünürlük'), 'COURSE')
    await user.upload(screen.getByLabelText('Dosya seç'), pdf())
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body.get('visibility')).toBe('COURSE'))
  })

  test('retry and two-step delete call the real endpoints', async () => {
    let docs = [doc('flaky1', 'FAILED', { status: { state: 'FAILED', ui_state: 'error', stage: null, updated_at: '', error: { code: 'STALLED', message_tr: 'x', retryable: true } } }), doc('old1', 'READY')]
    const { calls } = fakeApi({
      ...base(() => docs),
      'POST /documents/flaky1/retry': () => { docs = [doc('flaky1', 'UPLOADED'), docs[1]]; return { status: 202, body: docs[0] } },
      'DELETE /documents/old1': () => { docs = docs.filter((d) => d.id !== 'old1'); return { status: 202, body: { id: 'old1', state: 'DELETING' } } },
    })
    open()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Yeniden dene/ }))
    await waitFor(() => expect(within(row('flaky1')).getByText('Yüklendi')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'old1.pdf sil' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false) // confirmation first
    await user.click(screen.getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(row('old1')).toBeNull())
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/documents/old1'])
  })

  test('download fetches the PDF with the bearer token (no token in a URL)', async () => {
    const { calls } = fakeApi({ ...base(() => [doc('ready1', 'READY')]), 'GET /documents/ready1/file': { blob: new Blob(['%PDF-1.4']) } })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    open()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'ready1.pdf indir' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const call = calls.find((c) => c.path === '/documents/ready1/file')
    expect(call.headers.Authorization).toBe('Bearer header.payload.sig')
  })
})
