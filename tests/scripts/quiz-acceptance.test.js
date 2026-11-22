import { describe, expect, test } from 'vitest'
import {
  allPassed, checkOpenQuestions, checkQuizCount, checkRepeats, checkSources, checkYield, formatReport, similarStems,
} from '../../scripts/lib/quiz-acceptance-checks.mjs'

const NOTES = { id: 'file_java', kind: 'TXT', status: 'READY' }
const VIDEO = { id: 'video_java', kind: 'VIDEO', status: 'READY' }
const q = (id, question, kind = 'OPEN', source = { material_id: 'file_java', kind: 'TXT' }) => ({ id, kind, question, source })

describe('1. sources', () => {
  test("Azra's run fails: with notes in the course, questions came from the transcript", () => {
    const r = checkSources({ materials: [NOTES, VIDEO], questions: [q('a', 'Ceva object oriented ne demektir?', 'OPEN', { material_id: 'video_java', kind: 'VIDEO' })] })
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('a')
  })
  test('passes when every question comes from a document', () => {
    expect(checkSources({ materials: [NOTES, VIDEO], questions: [q('a', 'Bytecode nerede çalışır?')] }).pass).toBe(true)
  })
  test('a course with only a video may use the transcript', () => {
    const r = checkSources({ materials: [VIDEO], questions: [q('a', 'Object nedir?', 'OPEN', { material_id: 'video_java', kind: 'VIDEO' })] })
    expect(r).toMatchObject({ pass: true })
    expect(r.detail).toContain('belge yok')
  })
})

describe('2. repeats', () => {
  test('stems that differ only in suffixes or order are repeats', () => {
    expect(similarStems('Derleme sürecinde hangi araç kullanılır?', 'Derleme sürecinin hangi aracı kullanılır?')).toBe(true)
    expect(similarStems('Bytecode nerede çalışır?', 'Çöp toplayıcı belleği ne zaman boşaltır?')).toBe(false)
  })
  test('a repeated stem or source sentence fails, naming the questions', () => {
    const r = checkRepeats({
      questions: [q('a', 'Derleme sürecinde hangi araç kullanılır?'), q('b', 'Bytecode nerede çalışır?'), q('c', 'Derleme sürecinin hangi aracı kullanılır?')],
      quotes: ['Bytecode JVM üzerinde çalışır.', 'Java bir dildir.', 'bytecode jvm üzerinde çalışır'],
    })
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('1. ve 3. soru neredeyse aynı')
    expect(r.detail).toContain('1. ve 3. soru aynı kaynak cümlesine dayanıyor')
  })
  test('distinct questions on distinct sentences pass', () => {
    expect(checkRepeats({ questions: [q('a', 'Bytecode nerede çalışır?'), q('b', 'Kalıtım neyi sağlar?')], quotes: ['A cümlesi.', 'B cümlesi.'] }).pass).toBe(true)
  })
})

describe('3. yield', () => {
  test('at least 80% passes', () => expect(checkYield({ asked: 10, produced: 8, note: null }).pass).toBe(true))
  test("Azra's 7 of 14 without a clear reason fails", () => {
    expect(checkYield({ asked: 14, produced: 7, note: 'En sık neden (7/7 deneme): Soru aynıydı (2 deneme)' }).pass).toBe(false)
  })
  test('fewer, with the capacity or the reason in the note, passes', () => {
    expect(checkYield({ asked: 14, produced: 6, note: 'Kaynaklar yaklaşık 6 soruya yetiyor; 14 soru istendi.' }).pass).toBe(true)
    expect(checkYield({ asked: 14, produced: 7, note: "14 sorudan 7'si hazırlandı. Hazırlanamayan 7 sorunun 7'sinde neden: …" }).pass).toBe(true)
  })
})

describe('4. open questions and self-contained stems', () => {
  test('a plain statement as an open question and a stem pointing back fail', () => {
    const r = checkOpenQuestions({ questions: [q('a', 'Java nesne yönelimli bir dildir.'), q('b', 'Bu yöntem neyi sağlar?', 'SHORT_ANSWER')] })
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('1. açık uçlu soru soru değil')
    expect(r.detail).toContain('2. soru tek başına anlaşılmıyor')
  })
  test('a question or an instruction passes; a cloze stem is not judged', () => {
    const r = checkOpenQuestions({ questions: [q('a', 'Kalıtımın amacını açıklayınız.'), q('b', 'Kalıtım neyi sağlar?'), q('c', 'Bu _____ kullanır.', 'CLOZE')] })
    expect(r.pass).toBe(true)
  })
})

describe('5. quiz count', () => {
  const set = (requested, note = null) => ({ type: 'quiz_set', requested, note })
  test('a set of the asked size passes', () => {
    expect(checkQuizCount({ status: 202, started: set(5), finished: { produced: 5 }, asked: 5 }).pass).toBe(true)
  })
  test('a smaller set passes only when the note says the sources carry fewer', () => {
    expect(checkQuizCount({ status: 202, started: set(3, 'Bu konu için kaynaklar yaklaşık 3 soruya yetiyor; 5 soru istendi.'), finished: { produced: 3 }, asked: 5 }).pass).toBe(true)
    expect(checkQuizCount({ status: 202, started: set(3), finished: { produced: 3 }, asked: 5 }).pass).toBe(false)
  })
  test('a single question where a set was asked fails', () => {
    expect(checkQuizCount({ status: 201, started: { id: 'q', kind: 'OPEN' }, finished: null, asked: 5 }).pass).toBe(false)
  })
})

describe('report', () => {
  test('lists every criterion; passes only when all five ran and passed', () => {
    const pass = { pass: true, detail: 'tamam' }
    const all = { sources: pass, repeats: pass, yield: pass, open: pass, count: pass }
    expect(allPassed(all)).toBe(true)
    expect(formatReport(all)).toContain('Sonuç: GEÇTİ')
    const partial = { ...all, count: null }
    expect(allPassed(partial)).toBe(false)
    expect(formatReport(partial)).toContain('ATLANDI')
    expect(formatReport({ ...all, repeats: { pass: false, detail: 'x' } })).toContain('KALDI   2. Aynı sınavda tekrar soru yok')
  })
})
