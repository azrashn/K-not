import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import App from '../../src/App'
import * as session from '../../src/api/session'
import { COURSE, envelope, fakeApi, signIn, USER } from './fake-api'

const LOGIN_OK = { access_token: 'h.p.s', token_type: 'Bearer', expires_in: 3600, user: USER }

describe('login, logout and expired sessions', () => {
  test('unauthenticated users only see the login screen (protected routes)', async () => {
    const { calls } = fakeApi({})
    window.location.hash = '#/dersler'
    render(<App />)
    expect(screen.getByRole('heading', { name: 'K-not’a giriş' })).toBeInTheDocument()
    expect(screen.queryByText('Derslerin')).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
    expect(screen.queryByText(/kayıt ol/i)).not.toBeInTheDocument() // no self-registration
  })

  test('wrong credentials show a clear error; correct ones open the app on the requested route', async () => {
    let attempt = 0
    fakeApi({
      'POST /auth/login': () => (++attempt === 1 ? { status: 401, body: envelope('UNAUTHENTICATED') } : { body: LOGIN_OK }),
      'GET /courses': { body: [COURSE] },
    })
    window.location.hash = '#/dersler'
    render(<App />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('E-posta'), 'ayse@knot.test')
    await user.type(screen.getByLabelText('Parola'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('E-posta ya da parola hatalı.')
    await user.clear(screen.getByLabelText('Parola'))
    await user.type(screen.getByLabelText('Parola'), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))
    expect(await screen.findByText('Veri Yapıları')).toBeInTheDocument()
    expect(screen.getByText('Derslerin')).toBeInTheDocument()
  })

  test('a 401 during use returns to login with an "expired" message', async () => {
    fakeApi({ 'GET /courses': { status: 401, body: envelope('UNAUTHENTICATED') } })
    signIn()
    window.location.hash = '#/dersler'
    render(<App />)
    expect(await screen.findByText('Oturumun sona erdi. Lütfen yeniden giriş yap.')).toBeInTheDocument()
    expect(sessionStorage.getItem('knot.session')).toBeNull()
  })

  test('the session timer expires the session without any request', async () => {
    fakeApi({ 'GET /courses': { body: [] } })
    signIn(USER, 3600)
    window.location.hash = '#/dersler'
    render(<App />)
    await screen.findByText('Derslerin')
    act(() => session.expire())
    expect(await screen.findByText('Oturumun sona erdi. Lütfen yeniden giriş yap.')).toBeInTheDocument()
  })

  test('logout clears the session and shows login (no "expired" message)', async () => {
    fakeApi({ 'GET /courses': { body: [] } })
    signIn()
    window.location.hash = '#/dersler'
    render(<App />)
    await screen.findByText('Derslerin')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Çıkış yap' }))
    expect(await screen.findByRole('heading', { name: 'K-not’a giriş' })).toBeInTheDocument()
    expect(screen.queryByText(/Oturumun sona erdi/)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('knot.session')).toBeNull()
  })
})

describe('courses', () => {
  test('lists real courses with server document counts and role', async () => {
    fakeApi({ 'GET /courses': { body: [COURSE, { ...COURSE, id: 'c2', name: 'İşletim Sistemleri', code: 'BIL 304', my_role: 'INSTRUCTOR', documents: { total: 0, ready: 0, processing: 0, failed: 0 } }] } })
    signIn()
    window.location.hash = '#/dersler'
    render(<App />)
    expect(await screen.findByText('Veri Yapıları')).toBeInTheDocument()
    expect(screen.getByText('1 materyal hazırlanıyor')).toBeInTheDocument()
    expect(screen.getByText('Henüz materyal yok')).toBeInTheDocument()
    expect(screen.getByText(/Öğretim üyesi/)).toBeInTheDocument()
    expect(screen.queryByText(/Örnek ip|Vize · 6 gün/)).not.toBeInTheDocument() // no mock fields on real cards
  })

  test('empty and error states', async () => {
    fakeApi({ 'GET /courses': { body: [] } })
    signIn()
    window.location.hash = '#/dersler'
    const { unmount } = render(<App />)
    expect(await screen.findByText(/Henüz bir derse kayıtlı değilsin/)).toBeInTheDocument()
    unmount()
    let n = 0
    fakeApi({ 'GET /courses': () => (++n === 1 ? new TypeError('down') : { body: [COURSE] }) })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşılamadı')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByText('Veri Yapıları')).toBeInTheDocument()
  })

  test('a course the user may not see (404) is reported without leaking anything', async () => {
    fakeApi({ 'GET /courses/cother': { status: 404, body: envelope('NOT_FOUND') }, 'GET /courses/cother/documents': { status: 404, body: envelope('NOT_FOUND') } })
    signIn()
    window.location.hash = '#/dersler/cother'
    render(<App />)
    expect(await screen.findByText('Ders bulunamadı ya da bu derse kayıtlı değilsin.')).toBeInTheDocument()
    window.location.hash = '#/dersler/cother/calisma'
    await waitFor(() => expect(screen.getByText('Ders bulunamadı ya da bu derse kayıtlı değilsin.')).toBeInTheDocument())
    expect(screen.queryByLabelText('Materyallerine bir soru sor')).not.toBeInTheDocument()
  })
})
