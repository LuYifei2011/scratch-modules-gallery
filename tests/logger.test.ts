import { describe, it } from 'bun:test'
import assert from 'bun:assert/strict'
import { truncate, formatDuration, timeNow } from '../scripts/lib/logger.ts'

describe('truncate', () => {
  it('returns original text when within maxLen', () => {
    assert.strictEqual(truncate('hello', 10), 'hello')
  })

  it('returns original text when exactly at maxLen', () => {
    assert.strictEqual(truncate('hello', 5), 'hello')
  })

  it('truncates and adds ellipsis when exceeding maxLen', () => {
    const result = truncate('hello world', 6)
    assert.strictEqual(result.length, 6)
    assert.ok(result.endsWith('…'))
    assert.strictEqual(result, 'hello…')
  })

  it('uses default maxLen of 60', () => {
    const longText = 'a'.repeat(80)
    const result = truncate(longText)
    assert.strictEqual(result.length, 60)
    assert.ok(result.endsWith('…'))
  })
})

describe('formatDuration', () => {
  it('formats sub-second duration in ms', () => {
    assert.strictEqual(formatDuration(500), '500ms')
    assert.strictEqual(formatDuration(0), '0ms')
    assert.strictEqual(formatDuration(999), '999ms')
  })

  it('formats 1 second and above in seconds', () => {
    assert.strictEqual(formatDuration(1000), '1.00s')
    assert.strictEqual(formatDuration(1500), '1.50s')
    assert.strictEqual(formatDuration(12345), '12.35s')
  })
})

describe('timeNow', () => {
  it('returns a time string in HH:MM:SS format', () => {
    const result = timeNow()
    assert.ok(typeof result === 'string')
    // Should contain colons (HH:MM:SS)
    assert.ok(result.includes(':'), `Expected time with colons, got: ${result}`)
  })
})
