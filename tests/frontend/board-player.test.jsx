import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StepBoard from '../../src/components/board/StepBoard'

const steps = [
  { board: 'y(0) = x(0)', speech: 'Birinci adım.', formula: null, mark: null, sources: ['[1]'], quote: 'kaynaktan alıntı' },
  { board: 'x(n) = 0 , n < 0 için', speech: 'İkinci adım.', formula: null, mark: 'underline', sources: ['07:14'] },
  { board: 'y(0) = 1', speech: 'Üçüncü adım.', formula: null, mark: 'circle', sources: [] },
]
const evidence = [{ id: 'e1', n: 1, title: 'Video', location: { kind: 'video', start_ms: 290000 } }]

const renderBoard = (props = {}) => render(<StepBoard steps={steps} evidence={evidence} autoPlay={false} fetchAudio={null} {...props} />)
const caption = () => document.querySelector('.board-caption').textContent

describe('one playback state for every control', () => {
  test('finished board: all steps written, silent mode without TTS', () => {
    renderBoard()
    expect(document.querySelectorAll('.board-step')).toHaveLength(3)
    expect(screen.getByText('Sessiz mod')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Oynat/ })).toBeInTheDocument()
  })

  test('clicking a step, the arrows and the caption buttons all move the same player', () => {
    renderBoard()
    fireEvent.click(screen.getAllByRole('button', { name: '2. adıma git' })[0])
    expect(screen.getByRole('button', { name: /Duraklat/ })).toBeInTheDocument()
    expect(caption()).toContain('2/3')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(caption()).toContain('3/3')
    fireEvent.click(screen.getByRole('button', { name: 'Önceki adım' }))
    expect(caption()).toContain('2/3')

    fireEvent.click(screen.getByRole('button', { name: /Duraklat/ }))
    expect(screen.getByRole('button', { name: /Oynat/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Baştan oynat/ }))
    expect(caption()).toContain('1/3')
  })

  test('arrow keys are left alone while typing', () => {
    render(<><input aria-label="soru" /><StepBoard steps={steps} autoPlay={false} fetchAudio={null} /></>)
    fireEvent.keyDown(screen.getByLabelText('soru'), { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: /Oynat/ })).toBeInTheDocument()
  })
})

describe('sources and quote', () => {
  test('the sources list matches step numbers and opens the source', () => {
    const onSource = vi.fn()
    renderBoard({ onSource })
    const list = screen.getByRole('region', { name: 'Adımların kaynakları' })
    expect(Array.from(list.querySelectorAll('.board-source-step')).map((b) => b.textContent)).toEqual(['1', '2'])
    fireEvent.click(list.querySelectorAll('.board-chip')[1])
    expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ ms: 434000 }), 1)
  })

  test('a quote is shown faintly and goes to the step’s first source; no quote, nothing', () => {
    const onSource = vi.fn()
    renderBoard({ onSource })
    const quotes = document.querySelectorAll('.board-quote')
    expect(quotes).toHaveLength(1)
    fireEvent.click(quotes[0])
    expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ evidence: evidence[0], ms: 290000 }), 0)
  })

  test('no steps, no board', () => {
    const { container } = render(<StepBoard steps={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
