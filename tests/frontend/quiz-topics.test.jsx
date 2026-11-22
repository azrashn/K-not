import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import { cleanTitle } from '../../src/lib/topic-title'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn(), takeIntent: () => null }) }))

// Azra's course: the quiz topic used to fill with the raw video title.
const VIDEO_TITLE = '2 Dakikada Java   Java Nedir, Ne İşe Yarar…'
const materials = [
  { id: 'video_java', kind: 'VIDEO', title: VIDEO_TITLE, status: 'READY' },
  { id: 'file_java', kind: 'TXT', title: 'java-notlari.txt', status: 'READY' },
]
const chips = async () => Array.from((await screen.findByRole('group', { name: 'Konu önerileri' })).querySelectorAll('button')).map((b) => b.textContent)

beforeEach(() => {
  vi.resetAllMocks()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Java' }])
  api.knowledgeMaterials.mockResolvedValue({ materials })
  api.quizzes.mockResolvedValue([])
  api.examStyles.mockResolvedValue([])
})

test('the topic starts empty and the suggestions come from the sources, not from titles', async () => {
  const user = userEvent.setup()
  api.quizTopics.mockResolvedValue({ topics: ['Kapsülleme', 'Java, bytecode', 'Sınıf, nesne'] })
  render(<CourseQuiz courseId="c" />)
  expect(await screen.findByLabelText('Konu')).toHaveValue('')
  await waitFor(async () => expect(await chips()).toEqual(['Kapsülleme', 'Java, bytecode', 'Sınıf, nesne']))
  expect(api.quizTopics).toHaveBeenCalledWith('c', expect.any(AbortSignal))
  await user.click(screen.getByRole('button', { name: 'Kapsülleme' }))
  expect(screen.getByLabelText('Konu')).toHaveValue('Kapsülleme')
})

test('without server suggestions the titles are cut to their subject', async () => {
  api.quizTopics.mockRejectedValue(new Error('offline'))
  render(<CourseQuiz courseId="c" />)
  await waitFor(async () => expect(await chips()).toEqual(['Java Nedir', 'java-notlari']))
  expect((await chips()).join(' ')).not.toContain('Dakikada')
})

test('earlier practice topics come first', async () => {
  api.quizzes.mockImplementation(async (_c, _s, purpose) => (purpose ? [] : [{ id: 'h', topic: 'final anahtar sözcüğü', kind: 'OPEN', status: 'ANSWERED' }]))
  api.quizTopics.mockResolvedValue({ topics: ['Kapsülleme'] })
  render(<CourseQuiz courseId="c" />)
  await waitFor(async () => expect(await chips()).toEqual(['final anahtar sözcüğü', 'Kapsülleme']))
})

test.each([
  [VIDEO_TITLE, 'Java Nedir'],
  ['java-notlari.txt', 'java-notlari'],
  ['Hafta 4 - AVL Ağaçları.pdf', 'AVL Ağaçları'],
  ['Ders 3 | Kalıtım ve çok biçimlilik', 'Kalıtım ve çok biçimlilik'],
  ['Veri Yapıları Hafta 4', 'Veri Yapıları Hafta 4'],
  ['Nesneye yönelik programlamada sınıflar, nesneler ve kalıtım üzerine uzun bir başlık', 'Nesneye yönelik programlamada sınıflar'],
  ['', ''],
])('cleanTitle(%j) is %j', (title, topic) => {
  expect(cleanTitle(title)).toBe(topic)
  expect(cleanTitle(title).length).toBeLessThanOrEqual(40)
})
