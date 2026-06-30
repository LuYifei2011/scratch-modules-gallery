import { describe, expect, it } from 'bun:test'
import path from 'path'
import { isInsideOrEqual, isStrictlyInside } from '../scripts/lib/path-safety.ts'

describe('path safety helpers', () => {
  const parent = path.resolve('/repo/dist')

  it('allows equal paths only for inside-or-equal checks', () => {
    expect(isInsideOrEqual(parent, parent)).toBe(true)
    expect(isStrictlyInside(parent, parent)).toBe(false)
  })

  it('allows child paths for both helpers', () => {
    const child = path.join(parent, 'zh-cn', 'index.html')

    expect(isInsideOrEqual(parent, child)).toBe(true)
    expect(isStrictlyInside(parent, child)).toBe(true)
  })

  it('rejects parent traversal', () => {
    const escaped = path.resolve(parent, '..', 'secret.txt')

    expect(isInsideOrEqual(parent, escaped)).toBe(false)
    expect(isStrictlyInside(parent, escaped)).toBe(false)
  })

  it('rejects sibling paths with matching prefixes', () => {
    const sibling = path.resolve('/repo/dist-other/file.txt')

    expect(isInsideOrEqual(parent, sibling)).toBe(false)
    expect(isStrictlyInside(parent, sibling)).toBe(false)
  })
})
