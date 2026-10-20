import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import App from '../../src/App'
import { COURSE, doc, envelope, fakeApi, signIn } from './fake-api'

const MINE = { ...COURSE, id: 'cmine00000000000000000001', code: 'K-ABC123', name: 'Kendi Dersim', description: 'Notlarım', is_owner: true, can_edit: true,
  documents: { total: 0, ready: 0, processing: 0, failed: 0 } }
const ENROLLED = { ...COURSE, description: null, is_owner: false, can_edit: false }
const open = () => { signIn(); window.location.hash = '#/dersler'; return render(<App />) }

describe('course creation and editing', () => {
  test('shows + Yeni Ders, keeps enrolled courses, edit only on editable ones', async () => {
    fakeApi({ 'GET /courses': { body: [ENROLLED, MINE] } })
    open()
    expect(await screen.findByRole('button', { name: '+ Yeni Ders' })).toBeInTheDocument()
    expect(screen.getByText('Veri Yapıları')).toBeInTheDocument()
    expect(screen.getByText('Kendi Dersim')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /dersini düzenle/ })).toHaveLength(1)
    expect(screen.getByText('Benim dersim')).toBeInTheDocument()
  })

  test('validates the name, creates the course and opens it', async () => {
    let created = null
    const { calls } = fakeApi({
      'GET /courses': { body: [ENROLLED] },
      'POST /courses': ({ init }) => { created = JSON.parse(init.body); return { status: 201, body: { ...MINE, name: created.name } } },
      [`GET /courses/${MINE.id}`]: () => ({ body: { ...MINE, name: created.name } }),
      [`GET /courses/${MINE.id}/documents`]: { body: [] },
    })
    open()
    await userEvent.click(await screen.findByRole('button', { name: '+ Yeni Ders' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dersi oluştur' }))
    expect(within(dialog).getByText('Ders adı en az 2 karakter olmalı.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    await userEvent.type(within(dialog).getByLabelText(/Ders adı/), 'Algoritmalar')
    await userEvent.type(within(dialog).getByLabelText('Öğretim üyesi'), 'Dr. A')
    await userEvent.type(within(dialog).getByLabelText('Dönem'), 'Güz 2026')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dersi oluştur' }))
    await waitFor(() => expect(created).toEqual({ name: 'Algoritmalar', instructor_name: 'Dr. A', term: 'Güz 2026' })) // boş kod/açıklama gönderilmez
    expect(await screen.findByRole('heading', { name: 'Algoritmalar' })).toBeInTheDocument()
    expect(window.location.hash).toBe(`#/dersler/${MINE.id}`)
    expect(screen.getByRole('button', { name: /Materyal ekle/ })).toBeInTheDocument() // yükleme akışı yeni derste de mevcut
  })

  test('shows a Turkish error and keeps the form on a conflict', async () => {
    fakeApi({ 'GET /courses': { body: [] }, 'POST /courses': { status: 409, body: envelope('CONFLICT') } })
    open()
    expect(await screen.findByText(/“\+ Yeni Ders” ile kendi dersini/)).toBeInTheDocument() // boş durum
    await userEvent.click(screen.getByRole('button', { name: '+ Yeni Ders' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Ders adı/), 'Algoritmalar')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dersi oluştur' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('zaten bir ders var')
    expect(within(dialog).getByLabelText(/Ders adı/)).toHaveValue('Algoritmalar')
  })

  test('owner edits a course with PATCH and sees a confirmation', async () => {
    let patch = null
    let current = MINE
    fakeApi({
      'GET /courses': () => ({ body: [current] }),
      [`PATCH /courses/${MINE.id}`]: ({ init }) => { patch = JSON.parse(init.body); current = { ...MINE, ...patch }; return { body: current } },
    })
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Kendi Dersim dersini düzenle' }))
    const dialog = screen.getByRole('dialog')
    const name = within(dialog).getByLabelText(/Ders adı/)
    expect(name).toHaveValue('Kendi Dersim')
    await userEvent.clear(name)
    await userEvent.type(name, 'Yeni Ad')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(patch.name).toBe('Yeni Ad'))
    expect(await screen.findByText('Ders güncellendi.')).toBeInTheDocument()
    expect(await screen.findByText('Yeni Ad')).toBeInTheDocument()
  })

  test('a document list works for a newly created course (upload target)', async () => {
    fakeApi({
      'GET /courses': { body: [MINE] },
      [`GET /courses/${MINE.id}`]: { body: MINE },
      [`GET /courses/${MINE.id}/documents`]: { body: [doc('d1', 'READY', { course_id: MINE.id })] },
    })
    open()
    await userEvent.click(await screen.findByText('Kendi Dersim'))
    expect(await screen.findByText('d1.pdf')).toBeInTheDocument()
  })
})
