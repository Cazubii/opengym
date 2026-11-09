import { describe, it, expect } from 'vitest'
import { setLine, handleLooksValid, normalizeHandle, entryName, isWarmup } from './community.js'

describe('community formatting', () => {
  it('writes a set the way it was lifted', () => {
    expect(setLine({ w: 80, r: 8, done: true }, 'kg')).toBe('80 kg × 8')
    expect(setLine({ r: 12, done: true }, 'kg')).toBe('× 12')
    expect(setLine({ sec: 45, done: true }, 'lb')).toBe('45 s')
    expect(setLine({ sides: { L: { w: 12, r: 10 }, R: { w: 12, r: 9 } } }, 'kg')).toBe('L 12 kg × 10 · R 12 kg × 9')
  })
  it('checks a handle the way the server does', () => {
    expect(normalizeHandle(' @Igor.Silva ')).toBe('igor.silva')
    expect(handleLooksValid('@igor_2')).toBe(true)
    for (const bad of ['ab', '.igor', 'igor.', 'ig..or', 'igor silva', 'a'.repeat(21)]) expect(handleLooksValid(bad)).toBe(false)
  })
  it('names a custom exercise by its owner’s name and marks warm-ups', () => {
    expect(entryName({ id: 'cx1', name: 'My Curl' })).toBe('My Curl')
    expect(isWarmup({ phase: 'warmup' })).toBe(true)
    expect(isWarmup({})).toBe(false)
  })
})
