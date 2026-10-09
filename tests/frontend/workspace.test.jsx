import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import App from '../../src/App'
import { COURSE, doc, envelope, fakeApi, signIn } from './fake-api'
import { DOC, grounded } from './answer-fixtures'

const C = COURSE.id
// pages.v1 page 4 of the AVL fixture: document offsets 157.., code points (𝑛 is one code point).
const PAGE4 = { document_id: DOC, indexing_version: 'c1', page: 4, page_count: 5, char_start: 157, char_end: 230,
  text: 'AVL Ağaçları: Denge Koşulu\n𝑛 düğümlü AVL ağacında farkın en fazla 1 olduğu bilinir.' }
// Offsets are Unicode code points (the 𝑛 before the quote is one code point, two UTF-16 units).
const QUOTE = 'farkın en fazla 1'
const AT = Array.from(PAGE4.text.slice(0, PAGE4.text.indexOf(QUOTE))).length
const HL = { chunk_char_start: 0, chunk_char_end: 17, document_char_start: 157 + AT, document_char_end: 157 + AT + Array.from(QUOTE).length }

function answerWith(opts = {}) {
  const a = grounded(opts)
  for (const cl of a.claims) for (const ct of cl.citations) ct.highlight = opts.noHighlight ? null : HL
  for (const cl of a.claims) for (const ct of cl.citations) ct.quote_verified = !opts.noHighlight
  return a
}

function setup(answerRoute, extra = {}) {
  const api = fakeApi({
    [`GET /courses/${C}`]: { body: COURSE },
    [`GET /courses/${C}/documents`]: { body: [doc(DOC, 'READY', { title: 'Hafta 4 — AVL', original_filename: 'hafta4.pdf' })] },
    [`POST /courses/${C}/answers`]: answerRoute,
    [`GET /documents/${DOC}/pages/4\\?indexing_version=c1`]: { body: PAGE4 },
    ...extra,
  })
  signIn()
  window.location.hash = `#/dersler/${C}/calisma`
  render(<App />)
  return api
}

async function ask(q = 'AVL ağacında fark en fazla kaç olabilir?') {
  const user = userEvent.setup()
  const box = await screen.findByLabelText('Materyallerine bir soru sor')
  await waitFor(() => expect(box).toBeEnabled())
  await user.type(box, q)
  await user.click(screen.getByRole('button', { name: 'Soruyu gönder' }))
  return user
}

describe('questions and answers', () => {
  test('sends only the question (scope is derived by the server) and renders a SIKI answer', async () => {
    const { calls } = setup({ body: answerWith() })
    await ask()
    expect((await screen.findAllByText('İddia metni 1'))[0]).toBeInTheDocument()
    const post = calls.find((c) => c.method === 'POST')
    expect(JSON.parse(post.body)).toEqual({ question: 'AVL ağacında fark en fazla kaç olabilir?' })
    expect(document.querySelector('[data-knot="SIKI"]')).toBeInTheDocument()
    expect(screen.getByText('1 materyalde arandı · 1 kaynakta bulundu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Kaynak: Slayt · s.4/ })).toBeInTheDocument()
  })

  test('shows a searching state while the request is in flight', async () => {
    let release
    setup(() => new Promise((r) => { release = () => r({ body: answerWith() }) }))
    await ask()
    expect(await screen.findByText(/materyalde kanıt aranıyor/)).toBeInTheDocument()
    release()
    expect((await screen.findAllByText('İddia metni 1'))[0]).toBeInTheDocument()
  })

  test('the extractive baseline is labelled as not a production LLM', async () => {
    setup({ body: answerWith() })
    await ask()
    expect(await screen.findByText(/üretken bir dil modeliyle değil/)).toBeInTheDocument()
  })

  test('a citation never upgrades support: server GEVEŞEK stays GEVEŞEK and UNSUPPORTED shows "Kanıt yok"', async () => {
    setup({ body: answerWith({ supports: ['PARTIALLY_SUPPORTED', 'UNSUPPORTED'], label: 'GEVEŞEK' }) })
    await ask()
    await screen.findAllByText('İddia metni 2')
    expect(document.querySelector('[data-knot="GEVESEK"]')).toBeInTheDocument()
    const unsupported = document.querySelector('[data-claim="c2"]')
    expect(within(unsupported).getByText('Kanıt yok')).toBeInTheDocument()
    expect(within(unsupported).queryByRole('button', { name: /Kaynak:/ })).not.toBeInTheDocument() // its citation is not shown as support
    expect(screen.getByRole('button', { name: /Kaynak: Slayt · s.4.*kısmi destek/ })).toBeInTheDocument()
  })

  test('INSUFFICIENT_EVIDENCE is a normal KOPUK answer with the no-evidence panel, not an error', async () => {
    const raw = { ...answerWith({ label: 'KOPUK', outcome: 'INSUFFICIENT_EVIDENCE' }), claims: [], evidence: [],
      insufficient_evidence: { reason: 'NO_RETRIEVED_EVIDENCE', message: 'x', missing_information: [] } }
    setup({ body: raw })
    await ask('Dijkstra algoritması nasıl çalışır?')
    expect((await screen.findAllByText(/bu soruyu yanıtlamaya yetecek kanıt bulunamadı/))[0]).toBeInTheDocument()
    expect(document.querySelector('[data-knot="KOPUK"]')).toBeInTheDocument()
    expect(document.querySelector('[data-no-evidence]')).toBeInTheDocument()
    expect(screen.queryByText('Yanıt alınamadı')).not.toBeInTheDocument()
  })

  test.each([
    [503, 'AI_SERVICE_UNAVAILABLE', /Yapay zekâ hizmetine şu an ulaşılamıyor/],
    [502, 'GENERATION_FAILED', /Yanıt üretilemedi/],
    [504, 'PROVIDER_TIMEOUT', /zamanında üretilemedi/],
    [503, 'INDEX_VERSION_MISMATCH', /Arama dizini bakımda/],
    [429, 'RATE_LIMITED', /Bir dakika sonra tekrar dene/],
    [409, 'NO_READY_DOCUMENTS', /hazır materyal yok/],
  ])('service error %i %s is shown as an error, distinct from KOPUK', async (status, code, text) => {
    setup({ status, body: envelope(code) })
    await ask()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Yanıt alınamadı')
    expect(alert).toHaveTextContent(text)
    expect(document.querySelector('[data-knot]')).not.toBeInTheDocument()
  })

  test('a greeting (NOT_A_QUESTION) shows the reply, no claims, no strength label and no source panel', async () => {
    const raw = { ...answerWith({ label: 'KOPUK', outcome: 'INSUFFICIENT_EVIDENCE' }), claims: [], evidence: [],
      insufficient_evidence: { reason: 'NOT_A_QUESTION', message: 'Merhaba! Materyallerinle ilgili bir soru sorabilirsin.', missing_information: [] } }
    setup({ body: raw })
    await ask('Merhaba')
    expect(await screen.findByText('Merhaba! Materyallerinle ilgili bir soru sorabilirsin.')).toBeInTheDocument()
    expect(document.querySelector('[data-not-question]')).toBeInTheDocument()
    expect(document.querySelector('[data-knot]')).toBeNull()
    expect(document.querySelector('[data-claim]')).toBeNull()
    expect(screen.queryByText(/yanıtlamaya yetecek kanıt bulunamadı/)).not.toBeInTheDocument()
  })

  test('a failed question can be retried', async () => {
    let n = 0
    setup(() => (++n === 1 ? { status: 503, body: envelope('AI_SERVICE_UNAVAILABLE') } : { body: answerWith() }))
    const user = await ask()
    await user.click(await screen.findByRole('button', { name: /Tekrar sor/ }))
    expect((await screen.findAllByText('İddia metni 1'))[0]).toBeInTheDocument()
  })
})

describe('source viewer and citation highlighting', () => {
  test('opens the cited physical page and marks exactly the quoted text (code points)', async () => {
    const { calls } = setup({ body: answerWith() })
    const user = await ask()
    await user.click(await screen.findByRole('button', { name: /Kaynak: Slayt · s.4/ }))
    const mark = await waitFor(() => {
      const m = document.querySelector('[data-evidence-mark]')
      expect(m).toBeTruthy()
      return m
    })
    expect(mark.textContent).toBe(QUOTE)
    expect(AT).toBe(50) // would be 51 if UTF-16 units were counted
    expect(document.querySelector('[data-page-text]').textContent).toContain('𝑛 düğümlü AVL ağacında farkın en fazla 1')
    expect(screen.getByText('sayfa 4 / 5')).toBeInTheDocument()
    expect(calls.some((c) => c.path === `/documents/${DOC}/pages/4?indexing_version=c1`)).toBe(true)
  })

  test('without a verified highlight the excerpt is shown and the page is not marked', async () => {
    setup({ body: answerWith({ noHighlight: true }) })
    const user = await ask()
    await user.click(await screen.findByRole('button', { name: /Kaynak: Slayt · s.4/ }))
    expect(await screen.findByText(/alıntı birebir doğrulanamadı/)).toBeInTheDocument()
    await screen.findByText(/𝑛 düğümlü/)
    expect(document.querySelector('[data-evidence-mark]')).toBeNull()
  })

  test('navigating away offers "Kanıta dön"; a page of a deleted document reports it is gone', async () => {
    setup({ body: answerWith() }, {
      [`GET /documents/${DOC}/pages/5`]: { status: 404, body: envelope('NOT_FOUND') },
    })
    const user = await ask()
    await user.click(await screen.findByRole('button', { name: /Kaynak: Slayt · s.4/ }))
    await waitFor(() => expect(document.querySelector('[data-evidence-mark]')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Sayfa 5' }))
    expect(await screen.findByText(/artık mevcut değil/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Kanıta dön/ }))
    await waitFor(() => expect(document.querySelector('[data-evidence-mark]')?.textContent).toBe('farkın en fazla 1'))
  })

  test('no mock DOCS: the viewer never renders fabricated blocks or diagrams', async () => {
    setup({ body: answerWith() })
    const user = await ask()
    await user.click(await screen.findByRole('button', { name: /Kaynak: Slayt · s.4/ }))
    await screen.findByText(/𝑛 düğümlü/)
    expect(screen.queryByText('Ankara Üniversitesi · Bilgisayar Müh.')).not.toBeInTheDocument()
    expect(document.querySelector('svg[data-diagram]')).toBeNull()
  })

  test('the workspace is unavailable until a document is READY', async () => {
    fakeApi({ [`GET /courses/${C}`]: { body: COURSE }, [`GET /courses/${C}/documents`]: { body: [doc('d1', 'EMBEDDING')] } })
    signIn()
    window.location.hash = `#/dersler/${C}/calisma`
    render(<App />)
    expect(await screen.findByText(/henüz hazır materyal yok/)).toBeInTheDocument()
    expect(screen.getByLabelText('Materyallerine bir soru sor')).toBeDisabled()
  })
})
