import { describe, expect, test } from 'vitest'
import { isSubmitKey } from '../../src/lib/composer-keys'

const key = (over) => ({ key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, ...over })

describe('isSubmitKey', () => {
  test('plain Enter sends', () => expect(isSubmitKey(key())).toBe(true))
  test('Shift+Enter is a new line, never a send', () => expect(isSubmitKey(key({ shiftKey: true }))).toBe(false))
  test('other modifiers and keys do not send', () => {
    expect(isSubmitKey(key({ ctrlKey: true }))).toBe(false)
    expect(isSubmitKey(key({ key: 'a' }))).toBe(false)
  })
  test('Enter that confirms an input-method composition does not send', () => {
    expect(isSubmitKey(key({ isComposing: true }))).toBe(false)
    expect(isSubmitKey(key({ nativeEvent: { isComposing: true } }))).toBe(false)
    expect(isSubmitKey(key({ keyCode: 229 }))).toBe(false)
  })
})
