import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkspaceStart from '../../src/components/WorkspaceStart'
import { lastMaterial, recommendedMaterial, rememberMaterial } from '../../src/lib/last-material'

const ms = [
  { id: 'a', kind: 'PDF', title: 'Hafta 1', status: 'READY' },
  { id: 'b', kind: 'PPTX', title: 'Hafta 2', status: 'READY' },
  { id: 'c', kind: 'VIDEO', title: 'Ders videosu', status: 'PROCESSING' },
  { id: 'd', kind: 'TXT', title: 'Notlar', status: 'READY' },
]
beforeEach(() => { localStorage.clear() })

test('the first ready material is recommended, never one that is still processing', () => {
  const r = recommendedMaterial(ms, null)
  expect(r.material.id).toBe('a')
  expect(r.resumed).toBe(false)
  expect(r.others.map((m) => m.id)).toEqual(['b', 'd'])
})

test('the material last opened is recommended while it is still ready', () => {
  expect(recommendedMaterial(ms, 'd')).toMatchObject({ resumed: true, material: { id: 'd' } })
  expect(recommendedMaterial(ms, 'c').resumed).toBe(false) // processing: not offered
  expect(recommendedMaterial(ms, 'gone').material.id).toBe('a')
  expect(recommendedMaterial([], null).material).toBeNull()
})

test('opening a material is remembered per course in this browser', () => {
  rememberMaterial('course-1', 'b')
  expect(lastMaterial('course-1')).toBe('b')
  expect(lastMaterial('course-2')).toBeNull()
})

test('unavailable browser storage is harmless', () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(() => rememberMaterial('c', 'a')).not.toThrow()
  expect(lastMaterial('c')).toBeNull()
  spy.mockRestore(); get.mockRestore()
})

test('the start panel names where to begin and opens it with one click', async () => {
  const user = userEvent.setup(), open = vi.fn()
  render(<WorkspaceStart materials={ms} lastId={null} onOpen={open} />)
  expect(screen.getByText('Önerilen ilk materyal:')).toBeInTheDocument()
  expect(screen.getByText('Hafta 1', { selector: 'strong' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Birlikte öğren' }))
  expect(open).toHaveBeenCalledWith(ms[0])
  await user.click(screen.getByRole('button', { name: 'Notlar' }))
  expect(open).toHaveBeenLastCalledWith(ms[3])
  expect(screen.queryByRole('button', { name: 'Ders videosu' })).toBeNull()
})

test('a returning student is told where they stopped', () => {
  render(<WorkspaceStart materials={ms} lastId="b" onOpen={vi.fn()} />)
  expect(screen.getByText('En son bu materyaldeydin:')).toBeInTheDocument()
  expect(screen.getByText('Hafta 2', { selector: 'strong' })).toBeInTheDocument()
})

test('with nothing ready the panel asks for a material instead of offering a button', () => {
  render(<WorkspaceStart materials={[ms[2]]} lastId={null} onOpen={vi.fn()} />)
  expect(screen.getByText('Önce bir materyal ekle')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Birlikte öğren' })).toBeNull()
})
