import { describe, expect, it } from 'bun:test'
import { truncate, formatDuration, timeNow } from '../scripts/lib/logger.ts'

describe('truncate', () => {
  it('returns original text when within maxLen', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('returns original text when exactly at maxLen', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates and adds ellipsis when exceeding maxLen', () => {
    const result = truncate('hello world', 6)
    expect(result.length).toBe(6)
    expect(result.endsWith('…')).toBeTruthy()
    expect(result).toBe('hello…')
  })

  it('uses default maxLen of 60', () => {
    const longText = 'a'.repeat(80)
    const result = truncate(longText)
    expect(result.length).toBe(60)
    expect(result.endsWith('…')).toBeTruthy()
  })
})

describe('formatDuration', () => {
  it('formats sub-second duration in ms', () => {
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('formats 1 second and above in seconds', () => {
    expect(formatDuration(1000)).toBe('1.00s')
    expect(formatDuration(1500)).toBe('1.50s')
    expect(formatDuration(12345)).toBe('12.35s')
  })
})

describe('timeNow', () => {
  it('returns a time string in HH:MM:SS format', () => {
    const result = timeNow()
    expect(typeof result === 'string').toBeTruthy()
    // Should contain colons (HH:MM:SS)
    expect(result.includes(':')).toBeTruthy()
  })
})
