import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import ExamsHome from '../../src/pages/ExamsHome'
import { NAV } from '../../src/components/NavRail'
import { parseHash, pathFor } from '../../src/app/store'
import { api } from '../../src/api/endpoints'

const nav = vi.fn()
vi.mock('../../src/api/endpoints')
vi.mock('../../src/app/store', async (orig) => ({ ...(await orig()), useApp: () => ({ navigate: nav }) }))
vi.mock('../../src/components/PageBits', () => ({ MobileBar: () => null }))

beforeEach(() => nav.mockClear())

test('exams have their own menu entry next to Quiz and their own address', () => {
  const ids = NAV.map((n) => n.id)
  expect(ids.indexOf('exams')).toBe(ids.indexOf('quiz') + 1)
  expect(NAV.find((n) => n.id === 'exams').label).toBe('Sınav')
  expect(pathFor('exams')).toBe('/sinav')
  expect(parseHash('#/sinav')).toEqual({ section: 'exams', view: 'exams' })
  expect(parseHash('#/dersler/c1/sinavlar')).toEqual({ section: 'exams', view: 'exams', courseId: 'c1' })
})

test('with one course the exam page of that course opens directly', async () => {
  api.courses.mockResolvedValue([{ id: 'c1', code: 'BIL 211', name: 'Veri Yapıları', term: 'Güz' }])
  render(<ExamsHome />)
  await vi.waitFor(() => expect(nav).toHaveBeenCalledWith('/dersler/c1/sinavlar'))
})

test('with several courses the student picks one', async () => {
  api.courses.mockResolvedValue([
    { id: 'c1', code: 'BIL 211', name: 'Veri Yapıları', term: 'Güz' },
    { id: 'c2', code: 'BIL 304', name: 'Bilgisayar Ağları', term: 'Güz' },
  ])
  const user = userEvent.setup()
  render(<ExamsHome />)
  await user.click(await screen.findByRole('button', { name: /Bilgisayar Ağları/ }))
  expect(nav).toHaveBeenCalledWith('/dersler/c2/sinavlar')
})
